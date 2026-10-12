package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/relay/controlplane"
	"github.com/KDF5000/steer/server/internal/store"
	lark "github.com/larksuite/oapi-sdk-go/v3"
	"github.com/larksuite/oapi-sdk-go/v3/channel"
	"github.com/larksuite/oapi-sdk-go/v3/channel/normalize"
	channeltypes "github.com/larksuite/oapi-sdk-go/v3/channel/types"
	larkcore "github.com/larksuite/oapi-sdk-go/v3/core"
	larkdispatcher "github.com/larksuite/oapi-sdk-go/v3/event/dispatcher"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
	larkws "github.com/larksuite/oapi-sdk-go/v3/ws"
)

type runningIntegration struct {
	cancel  context.CancelFunc
	channel channeltypes.Channel
}

type integrationManager struct {
	server      *Server
	mu          sync.Mutex
	ctx         context.Context
	connections map[string]*runningIntegration
	workers     map[string]context.Context
}

func newIntegrationManager(server *Server) *integrationManager {
	return &integrationManager{server: server, connections: map[string]*runningIntegration{}, workers: map[string]context.Context{}}
}

func (s *Server) StartIntegrations(ctx context.Context) error {
	s.integrations.mu.Lock()
	s.integrations.ctx = ctx
	s.integrations.mu.Unlock()
	items, err := s.store.EnabledWorkspaceIntegrations(ctx)
	if err != nil {
		return err
	}
	for _, item := range items {
		s.integrations.Restart(item.ID)
	}
	return nil
}

func (s *Server) StopIntegrations() {
	s.integrations.mu.Lock()
	items := make([]*runningIntegration, 0, len(s.integrations.connections))
	for _, item := range s.integrations.connections {
		items = append(items, item)
	}
	s.integrations.connections = map[string]*runningIntegration{}
	s.integrations.mu.Unlock()
	for _, item := range items {
		item.cancel()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		_ = item.channel.Stop(ctx)
		cancel()
	}
}

func (m *integrationManager) Stop(id string) {
	m.mu.Lock()
	running := m.connections[id]
	delete(m.connections, id)
	m.mu.Unlock()
	if running == nil {
		return
	}
	running.cancel()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	_ = running.channel.Stop(ctx)
}

func (m *integrationManager) Restart(id string) {
	m.Stop(id)
	m.mu.Lock()
	ctx := m.ctx
	m.mu.Unlock()
	if ctx == nil || ctx.Err() != nil {
		return
	}
	go m.start(ctx, id)
}

func (m *integrationManager) start(parent context.Context, id string) {
	item, err := m.integrationByID(parent, id)
	if err != nil || !item.Enabled || item.Provider != "feishu" {
		return
	}
	secret, err := m.server.decryptCredential(item.EncryptedCredentials)
	if err != nil {
		m.setError(id, err)
		return
	}
	_ = m.server.store.SetIntegrationStatus(context.Background(), id, "connecting", false, nil)

	apiClient := lark.NewClient(item.ExternalAppID, secret, lark.WithLogLevel(larkcore.LogLevelWarn))
	wsClient := newFeishuWSClient(item.ExternalAppID, secret)
	bot := channel.NewChannel(apiClient, wsClient)
	ctx, cancel := context.WithCancel(parent)
	running := &runningIntegration{cancel: cancel, channel: bot}
	m.mu.Lock()
	if _, exists := m.connections[id]; exists {
		m.mu.Unlock()
		cancel()
		return
	}
	m.connections[id] = running
	m.mu.Unlock()

	bot.OnReady(func() {
		_ = m.server.store.SetIntegrationStatus(context.Background(), id, "connected", true, nil)
		m.recoverPending(ctx, item, apiClient, bot)
	})
	bot.OnReconnecting(func() { _ = m.server.store.SetIntegrationStatus(context.Background(), id, "connecting", false, nil) })
	bot.OnReconnected(func() { _ = m.server.store.SetIntegrationStatus(context.Background(), id, "connected", true, nil) })
	bot.OnDisconnected(func() {
		if ctx.Err() == nil {
			_ = m.server.store.SetIntegrationStatus(context.Background(), id, "connecting", false, nil)
		}
	})
	bot.OnError(func(connectionErr error) { m.setError(id, connectionErr) })
	bot.OnMessage(func(_ context.Context, msg *channeltypes.NormalizedMessage) error {
		if err := m.acceptMessage(ctx, item, apiClient, bot, msg); err != nil {
			m.setError(id, err)
		}
		return nil
	})

	if err := bot.Start(ctx); err != nil && !errors.Is(err, context.Canceled) {
		m.setError(id, err)
	}
	m.mu.Lock()
	if m.connections[id] == running {
		delete(m.connections, id)
	}
	m.mu.Unlock()
}

func newFeishuWSClient(appID, appSecret string) *larkws.Client {
	eventHandler := larkdispatcher.NewEventDispatcher("", "")
	return larkws.NewClient(
		appID,
		appSecret,
		larkws.WithEventHandler(eventHandler),
		larkws.WithLogLevel(larkcore.LogLevelWarn),
	)
}

func (m *integrationManager) integrationByID(ctx context.Context, id string) (store.WorkspaceIntegration, error) {
	items, err := m.server.store.EnabledWorkspaceIntegrations(ctx)
	if err != nil {
		return store.WorkspaceIntegration{}, err
	}
	for _, item := range items {
		if item.ID == id {
			return item, nil
		}
	}
	return store.WorkspaceIntegration{}, store.ErrNotFound
}

func (m *integrationManager) setError(id string, err error) {
	message := err.Error()
	_ = m.server.store.SetIntegrationStatus(context.Background(), id, "error", false, &message)
	slog.Warn("Feishu integration error", "integration_id", id, "error", err)
}

func (m *integrationManager) acceptMessage(ctx context.Context, integration store.WorkspaceIntegration, apiClient *lark.Client, bot channeltypes.Channel, msg *channeltypes.NormalizedMessage) error {
	if msg == nil || msg.MessageID == "" || msg.ChatID == "" {
		return nil
	}
	prompt := feishuPrompt(msg)
	threadKey := feishuThreadKey(msg)
	eventID := msg.EventID
	if eventID == "" {
		eventID = msg.MessageID
	}
	created, err := m.server.store.CreateIntegrationEvent(ctx, store.IntegrationEvent{
		IntegrationID: integration.ID, ExternalEventID: eventID, ExternalMessageID: msg.MessageID,
		ChatID: msg.ChatID, ThreadKey: threadKey, SenderID: msg.UserID, Prompt: prompt,
	})
	if err != nil || !created {
		return err
	}
	copy := *msg
	m.startWorker(ctx, integration, apiClient, bot, &copy, eventID, threadKey, prompt)
	return nil
}

func feishuPrompt(msg *channeltypes.NormalizedMessage) string {
	prompt := strings.TrimSpace(msg.Content)
	for _, mention := range msg.Mentions {
		key := strings.TrimPrefix(mention.Key, "@")
		if key != "" {
			prompt = strings.ReplaceAll(prompt, "@"+key, "")
		}
		if mention.Name != "" {
			prompt = strings.ReplaceAll(prompt, "@"+mention.Name, "")
		}
	}
	return strings.TrimSpace(prompt)
}

func (m *integrationManager) startWorker(ctx context.Context, integration store.WorkspaceIntegration, apiClient *lark.Client, bot channeltypes.Channel, msg *channeltypes.NormalizedMessage, eventID, threadKey, prompt string) {
	key := integration.ID + ":" + eventID
	m.mu.Lock()
	if m.workers[key] == ctx {
		m.mu.Unlock()
		return
	}
	m.workers[key] = ctx
	m.mu.Unlock()
	go func() {
		defer func() {
			m.mu.Lock()
			if m.workers[key] == ctx {
				delete(m.workers, key)
			}
			m.mu.Unlock()
		}()
		m.processMessage(ctx, integration, apiClient, bot, msg, eventID, threadKey, prompt)
	}()
}

func (m *integrationManager) recoverPending(ctx context.Context, integration store.WorkspaceIntegration, apiClient *lark.Client, bot channeltypes.Channel) {
	items, err := m.server.store.PendingIntegrationEvents(ctx, integration.ID)
	if err != nil {
		m.setError(integration.ID, err)
		return
	}
	for _, event := range items {
		msg := &channeltypes.NormalizedMessage{EventID: event.ExternalEventID, MessageID: event.ExternalMessageID, ChatID: event.ChatID, UserID: event.SenderID, Content: event.Prompt, RawContentType: "text"}
		m.startWorker(ctx, integration, apiClient, bot, msg, event.ExternalEventID, event.ThreadKey, event.Prompt)
	}
}

func feishuThreadKey(msg *channeltypes.NormalizedMessage) string {
	if msg.ChatType == "p2p" {
		return "p2p"
	}
	if event, ok := msg.RawEvent.(*larkim.P2MessageReceiveV1); ok && event.Event != nil && event.Event.Message != nil {
		message := event.Event.Message
		if message.ThreadId != nil && *message.ThreadId != "" {
			return "thread:" + *message.ThreadId
		}
		if message.RootId != nil && *message.RootId != "" {
			return "thread:" + *message.RootId
		}
	}
	return "thread:" + msg.MessageID
}

func feishuParentMessageID(msg *channeltypes.NormalizedMessage) string {
	if msg == nil {
		return ""
	}
	event, ok := msg.RawEvent.(*larkim.P2MessageReceiveV1)
	if !ok || event.Event == nil || event.Event.Message == nil || event.Event.Message.ParentId == nil {
		return ""
	}
	return strings.TrimSpace(*event.Event.Message.ParentId)
}

type feishuMessageContext struct {
	MessageID  string
	SenderName string
	Content    string
	Resources  []channeltypes.Resource
}

func fetchFeishuMessageContext(ctx context.Context, client *lark.Client, messageID string) (feishuMessageContext, error) {
	req := larkim.NewGetMessageReqBuilder().MessageId(messageID).WithSenderName(true).Build()
	resp, err := client.Im.V1.Message.Get(ctx, req)
	if err != nil {
		return feishuMessageContext{}, err
	}
	if !resp.Success() {
		return feishuMessageContext{}, fmt.Errorf("Feishu message get failed: code=%d message=%s", resp.Code, resp.Msg)
	}
	if resp.Data == nil || len(resp.Data.Items) == 0 || resp.Data.Items[0] == nil {
		return feishuMessageContext{}, fmt.Errorf("Feishu message get returned no message")
	}
	message := resp.Data.Items[0]
	result := feishuMessageContext{MessageID: messageID}
	if message.Sender != nil && message.Sender.SenderName != nil {
		result.SenderName = strings.TrimSpace(*message.Sender.SenderName)
	}
	if message.MsgType != nil && message.Body != nil && message.Body.Content != nil {
		result.Content, result.Resources = normalize.ParseContent(*message.MsgType, *message.Body.Content)
	}
	return result, nil
}

func composeFeishuPrompt(prompt string, parent *feishuMessageContext) string {
	prompt = strings.TrimSpace(prompt)
	if parent == nil || strings.TrimSpace(parent.Content) == "" {
		return prompt
	}
	sender := parent.SenderName
	if sender == "" {
		sender = "飞书用户"
	}
	return fmt.Sprintf("用户正在回复下面这条飞书消息。请把被回复消息作为本次请求的直接上下文。\n\n<feishu_replied_message sender=%q>\n%s\n</feishu_replied_message>\n\n用户当前消息：\n%s", sender, strings.TrimSpace(parent.Content), prompt)
}

type feishuImageSource struct {
	MessageID string
	Resource  channeltypes.Resource
}

func downloadFeishuImages(ctx context.Context, client *lark.Client, sources []feishuImageSource) ([]store.MessageAttachment, error) {
	unique := make(map[string]struct{}, len(sources))
	attachments := make([]store.MessageAttachment, 0, len(sources))
	totalSize := 0
	for _, source := range sources {
		if source.Resource.Type != "image" || source.MessageID == "" || source.Resource.FileKey == "" {
			continue
		}
		key := source.MessageID + ":" + source.Resource.FileKey
		if _, exists := unique[key]; exists {
			continue
		}
		unique[key] = struct{}{}
		if len(attachments) >= maxChatImages {
			return nil, fmt.Errorf("at most %d images are allowed", maxChatImages)
		}
		req := larkim.NewGetMessageResourceReqBuilder().MessageId(source.MessageID).FileKey(source.Resource.FileKey).Type("image").Build()
		resp, err := client.Im.V1.MessageResource.Get(ctx, req)
		if err != nil {
			return nil, fmt.Errorf("download Feishu image: %w", err)
		}
		if !resp.Success() {
			return nil, fmt.Errorf("download Feishu image failed: code=%d message=%s", resp.Code, resp.Msg)
		}
		if resp.File == nil {
			return nil, errors.New("download Feishu image returned no content")
		}
		content, err := io.ReadAll(io.LimitReader(resp.File, maxChatImageSize+1))
		if err != nil {
			return nil, fmt.Errorf("read Feishu image: %w", err)
		}
		name := filepath.Base(strings.TrimSpace(source.Resource.FileName))
		if name == "." || name == "" {
			name = filepath.Base(strings.TrimSpace(resp.FileName))
		}
		if name == "." || name == "" {
			name = fmt.Sprintf("feishu-image-%d", len(attachments)+1)
		}
		if len(content) == 0 || len(content) > maxChatImageSize {
			return nil, fmt.Errorf("image %q is empty or exceeds 5 MB", name)
		}
		totalSize += len(content)
		if totalSize > maxChatImagesSize {
			return nil, errors.New("images exceed the 16 MB total limit")
		}
		detected := http.DetectContentType(content)
		if detected != "image/png" && detected != "image/jpeg" && detected != "image/webp" && detected != "image/gif" {
			return nil, fmt.Errorf("image %q must be PNG, JPEG, WebP, or GIF", name)
		}
		attachments = append(attachments, store.MessageAttachment{Name: name, ContentType: detected, Size: int64(len(content)), Content: content})
	}
	return attachments, nil
}

const maxFeishuCardContentBytes = 24 << 10

const feishuChatProjectThreadKey = "__chat_project_default__"

func feishuEffectiveProjectID(conversation store.IntegrationConversation, conversationErr error, chatDefault store.IntegrationConversation, chatDefaultErr error) *string {
	if conversationErr == nil {
		if conversation.ProjectID != nil || conversation.ConversationID != "" {
			return conversation.ProjectID
		}
	}
	if chatDefaultErr == nil {
		return chatDefault.ProjectID
	}
	return nil
}

func truncateFeishuCardContent(content string) string {
	if len(content) <= maxFeishuCardContentBytes {
		return content
	}
	content = content[:maxFeishuCardContentBytes]
	for !utf8.ValidString(content) {
		content = content[:len(content)-1]
	}
	return content + "\n\n…（内容较长，已截断）"
}

func feishuTaskCard(status, content string) string {
	title := "任务执行中"
	template := "blue"
	if status == "queued" || status == "pending" {
		title = "任务等待执行"
		template = "orange"
	} else if status == "succeeded" {
		title = "任务已完成"
		template = "green"
	} else if status == "failed" {
		title = "任务处理失败"
		template = "red"
	} else if status == "cancelled" {
		title = "任务已取消"
		template = "grey"
	}
	content = strings.TrimSpace(content)
	if content == "" {
		content = "Agent 正在执行，暂时还没有可展示的过程输出。"
	}
	card := map[string]any{
		"schema": "2.0",
		"config": map[string]any{"update_multi": true},
		"header": map[string]any{
			"title":    map[string]any{"tag": "plain_text", "content": title},
			"template": template,
		},
		"body": map[string]any{"elements": []map[string]any{
			{
				"tag":      "collapsible_panel",
				"expanded": true,
				"header": map[string]any{
					"title": map[string]any{"tag": "plain_text", "content": "执行过程"},
				},
				"elements": []map[string]any{{"tag": "markdown", "content": truncateFeishuCardContent(content)}},
			},
		}},
	}
	encoded, _ := json.Marshal(card)
	return string(encoded)
}

type feishuAgentItem struct {
	ID    string `json:"id"`
	Type  string `json:"type"`
	Phase string `json:"phase"`
	Text  string `json:"text"`
}

func feishuAgentMessages(events []relay.Event, acceptedPhase func(string) bool) string {
	phases := map[string]string{}
	texts := map[string]*strings.Builder{}
	order := []string{}
	for _, event := range events {
		if strings.HasSuffix(event.Type, ".item.started") || strings.HasSuffix(event.Type, ".item.completed") {
			var data struct {
				Item feishuAgentItem `json:"item"`
			}
			if json.Unmarshal(event.Data, &data) == nil && data.Item.ID != "" && data.Item.Type == "agentMessage" {
				phases[data.Item.ID] = data.Item.Phase
				if acceptedPhase(data.Item.Phase) {
					if _, exists := texts[data.Item.ID]; !exists {
						texts[data.Item.ID] = &strings.Builder{}
						order = append(order, data.Item.ID)
					}
					if data.Item.Text != "" {
						texts[data.Item.ID].Reset()
						texts[data.Item.ID].WriteString(data.Item.Text)
					}
				}
			}
			continue
		}
		if !strings.Contains(event.Type, ".item.agentMessage.delta") {
			continue
		}
		var data struct {
			Delta  string `json:"delta"`
			ItemID string `json:"itemId"`
		}
		if json.Unmarshal(event.Data, &data) != nil || !acceptedPhase(phases[data.ItemID]) {
			continue
		}
		message := texts[data.ItemID]
		if message == nil {
			message = &strings.Builder{}
			texts[data.ItemID] = message
			order = append(order, data.ItemID)
		}
		message.WriteString(data.Delta)
	}
	parts := make([]string, 0, len(order))
	for _, id := range order {
		if value := strings.TrimSpace(texts[id].String()); value != "" {
			parts = append(parts, value)
		}
	}
	return strings.Join(parts, "\n\n")
}

func feishuFinalContent(events []relay.Event) string {
	return feishuAgentMessages(events, func(phase string) bool {
		return phase == "final" || phase == "final_answer"
	})
}

func feishuProgressContent(events []relay.Event) string {
	return feishuAgentMessages(events, func(phase string) bool { return phase == "commentary" })
}

func (m *integrationManager) streamFeishuTaskStatus(ctx context.Context, integration store.WorkspaceIntegration, bot channeltypes.Channel, msg *channeltypes.NormalizedMessage, task store.Task) error {
	projection, err := m.server.syncRelayRun(ctx, integration.WorkspaceID, task.RelayRunID)
	if err != nil {
		return err
	}
	content := feishuProgressContent(projection.Events)
	status := string(projection.Run.Status)
	if terminal(projection.Run.Status) && content == "" {
		content = strings.TrimSpace(projection.Content)
	}
	stream, err := bot.Stream(ctx, &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Card: feishuTaskCard(status, content)})
	if err != nil {
		_, sendErr := bot.Send(ctx, &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Text: "当前任务状态：" + status})
		if sendErr != nil {
			return errors.Join(err, sendErr)
		}
		return nil
	}
	defer func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = stream.Close(closeCtx)
	}()
	if terminal(projection.Run.Status) {
		return stream.Close(ctx)
	}
	lastContent := content
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
		projection, err = m.server.syncRelayRun(ctx, integration.WorkspaceID, task.RelayRunID)
		if err != nil {
			return err
		}
		content = feishuProgressContent(projection.Events)
		if terminal(projection.Run.Status) && content == "" {
			content = strings.TrimSpace(projection.Content)
		}
		status = string(projection.Run.Status)
		if content != lastContent || terminal(projection.Run.Status) {
			if err := stream.UpdateCard(ctx, feishuTaskCard(status, content)); err != nil {
				return err
			}
			lastContent = content
		}
		if terminal(projection.Run.Status) {
			return stream.Close(ctx)
		}
	}
}

func (m *integrationManager) processMessage(ctx context.Context, integration store.WorkspaceIntegration, apiClient *lark.Client, bot channeltypes.Channel, msg *channeltypes.NormalizedMessage, eventID, threadKey, prompt string) {
	var finalStream channeltypes.StreamController
	defer func() {
		if finalStream == nil {
			return
		}
		closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = finalStream.Close(closeCtx)
	}()
	fail := func(err error) {
		if ctx.Err() != nil {
			return
		}
		message := err.Error()
		_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, "failed", nil, &message)
		if finalStream != nil {
			closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = finalStream.Close(closeCtx)
			cancel()
			finalStream = nil
		}
		_, _ = bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Text: "任务处理失败：" + message})
	}
	if msg.RawContentType != "text" && msg.RawContentType != "post" && msg.RawContentType != "image" {
		fail(fmt.Errorf("当前版本仅支持文本、富文本和图片消息"))
		return
	}
	command := strings.ToLower(strings.TrimSpace(prompt))
	conversation, conversationErr := m.server.store.IntegrationConversation(ctx, integration.ID, msg.ChatID, threadKey)
	if conversationErr != nil && !errors.Is(conversationErr, store.ErrNotFound) {
		fail(conversationErr)
		return
	}
	chatDefault, chatDefaultErr := m.server.store.IntegrationConversation(ctx, integration.ID, msg.ChatID, feishuChatProjectThreadKey)
	if chatDefaultErr != nil && !errors.Is(chatDefaultErr, store.ErrNotFound) {
		fail(chatDefaultErr)
		return
	}
	if command == "/new" {
		if conversationErr == nil && conversation.ActiveTaskID != nil {
			task, taskErr := m.server.store.Task(ctx, integration.WorkspaceID, *conversation.ActiveTaskID)
			if taskErr == nil {
				if projection, syncErr := m.server.syncRelayRun(ctx, integration.WorkspaceID, task.RelayRunID); syncErr == nil && !terminal(projection.Run.Status) {
					_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, "succeeded", conversation.ActiveTaskID, nil)
					_, _ = bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Text: "当前任务仍在执行，请先使用 /cancel，或等待任务完成后再开启新会话。"})
					return
				}
			}
		}
		if err := m.server.store.ResetIntegrationConversation(ctx, integration.ID, msg.ChatID, threadKey); err != nil {
			fail(err)
			return
		}
		_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, "succeeded", nil, nil)
		_, _ = bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Text: "已开启新的 Steer 会话。"})
		return
	}
	if command == "/help" {
		_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, "succeeded", nil, nil)
		_, _ = bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Text: "直接发送消息即可创建任务。\n/projects 查看可用 Project\n/project 查看当前 Project\n/project <项目名称> 切换 Project\n/project none 解除 Project 绑定\n/new 开启新会话\n/status 用可折叠卡片实时查看执行过程\n/cancel 取消当前任务"})
		return
	}
	if command == "/projects" {
		projects, err := m.server.store.Projects(ctx, integration.WorkspaceID)
		if err != nil {
			fail(err)
			return
		}
		response := "当前 Workspace 暂无可用 Project。"
		if len(projects) > 0 {
			var lines []string
			for _, project := range projects {
				lines = append(lines, "- "+project.Name)
			}
			response = "可用 Project：\n" + strings.Join(lines, "\n") + "\n\n使用 /project <项目名称> 进行绑定。"
		}
		_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, "succeeded", nil, nil)
		_, _ = bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Text: response})
		return
	}
	projectQuery, projectCommand := feishuProjectCommand(prompt)
	if projectCommand {
		if projectQuery == "" {
			response := "当前未绑定 Project。使用 /projects 查看可用项目。"
			if projectID := feishuEffectiveProjectID(conversation, conversationErr, chatDefault, chatDefaultErr); projectID != nil {
				if project, err := m.server.store.Project(ctx, integration.WorkspaceID, *projectID); err == nil && project.DeletedAt == nil {
					response = "当前 Project：" + project.Name
				}
			}
			_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, "succeeded", nil, nil)
			_, _ = bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Text: response})
			return
		}
		if conversationErr == nil && conversation.ActiveTaskID != nil {
			task, taskErr := m.server.store.Task(ctx, integration.WorkspaceID, *conversation.ActiveTaskID)
			if taskErr == nil {
				if projection, syncErr := m.server.syncRelayRun(ctx, integration.WorkspaceID, task.RelayRunID); syncErr == nil && !terminal(projection.Run.Status) {
					_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, "succeeded", conversation.ActiveTaskID, nil)
					_, _ = bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Text: "当前任务仍在执行，请先使用 /cancel，或等待任务完成后再切换 Project。"})
					return
				}
			}
		}
		if strings.EqualFold(projectQuery, "none") {
			if err := m.server.store.SetIntegrationChatProject(ctx, integration.ID, msg.ChatID, feishuChatProjectThreadKey, threadKey, nil); err != nil {
				fail(err)
				return
			}
			_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, "succeeded", nil, nil)
			_, _ = bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Text: "已解除当前飞书会话的默认 Project，当前话题的下一条消息将开启新的 Steer 会话，后续新话题也将不再绑定 Project。"})
			return
		}
		projects, err := m.server.store.Projects(ctx, integration.WorkspaceID)
		if err != nil {
			fail(err)
			return
		}
		var selected *store.Project
		for index := range projects {
			if strings.EqualFold(projects[index].Name, projectQuery) {
				selected = &projects[index]
				break
			}
		}
		if selected == nil {
			_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, "succeeded", nil, nil)
			_, _ = bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Text: "未找到 Project「" + projectQuery + "」。使用 /projects 查看可用项目。"})
			return
		}
		if err := m.server.store.SetIntegrationChatProject(ctx, integration.ID, msg.ChatID, feishuChatProjectThreadKey, threadKey, &selected.ID); err != nil {
			fail(err)
			return
		}
		_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, "succeeded", nil, nil)
		_, _ = bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Text: "已将当前飞书会话的默认 Project 切换为「" + selected.Name + "」。当前话题的下一条消息将开启新的 Steer 会话，后续新话题也会自动使用该 Project。"})
		return
	}
	if command == "/status" || command == "/cancel" {
		taskConversation := conversation
		if command == "/status" && (conversationErr != nil || taskConversation.ActiveTaskID == nil) {
			latest, latestErr := m.server.store.LatestIntegrationConversationTask(ctx, integration.ID, msg.ChatID)
			if latestErr == nil {
				taskConversation = latest
			} else if !errors.Is(latestErr, store.ErrNotFound) {
				fail(latestErr)
				return
			}
		}
		if taskConversation.ActiveTaskID == nil {
			_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, "succeeded", nil, nil)
			_, _ = bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Text: "当前会话没有正在执行的任务。"})
			return
		}
		task, err := m.server.store.Task(ctx, integration.WorkspaceID, *taskConversation.ActiveTaskID)
		if err != nil {
			fail(err)
			return
		}
		if projection, syncErr := m.server.syncRelayRun(ctx, integration.WorkspaceID, task.RelayRunID); syncErr == nil {
			task.Status = string(projection.Run.Status)
		}
		if command == "/status" && !terminal(relay.RunStatus(task.Status)) {
			_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, "running", taskConversation.ActiveTaskID, nil)
			if err := m.streamFeishuTaskStatus(ctx, integration, bot, msg, task); err != nil {
				fail(err)
				return
			}
		} else if command == "/cancel" && !terminal(relay.RunStatus(task.Status)) {
			if _, err := m.server.relay.CancelRun(ctx, task.RelayRunID, controlplane.CancelRequest{Reason: "Cancelled from Feishu", RequestedBy: "steer-feishu"}); err != nil {
				fail(err)
				return
			}
			_, _ = bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Text: "已请求取消当前任务。"})
		} else {
			_, _ = bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Text: "当前任务状态：" + task.Status})
		}
		_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, "succeeded", taskConversation.ActiveTaskID, nil)
		return
	}
	var parentContext *feishuMessageContext
	if parentID := feishuParentMessageID(msg); parentID != "" {
		parent, err := fetchFeishuMessageContext(ctx, apiClient, parentID)
		if err != nil {
			fail(fmt.Errorf("读取被回复的飞书消息失败：%w", err))
			return
		}
		parentContext = &parent
	}
	if msg.RawContentType == "image" {
		prompt = "请分析附带的图片。"
	}
	if strings.TrimSpace(prompt) == "" && parentContext != nil {
		prompt = "请根据被回复的消息继续处理。"
	}
	if strings.TrimSpace(prompt) == "" {
		fail(fmt.Errorf("请输入任务内容"))
		return
	}
	imageSources := make([]feishuImageSource, 0, len(msg.Resources)+maxChatImages)
	for _, resource := range msg.Resources {
		imageSources = append(imageSources, feishuImageSource{MessageID: msg.MessageID, Resource: resource})
	}
	if parentContext != nil {
		for _, resource := range parentContext.Resources {
			imageSources = append(imageSources, feishuImageSource{MessageID: parentContext.MessageID, Resource: resource})
		}
	}
	attachments, err := downloadFeishuImages(ctx, apiClient, imageSources)
	if err != nil {
		fail(err)
		return
	}
	prompt = composeFeishuPrompt(prompt, parentContext)
	reactionID, reactionErr := addFeishuTypingReaction(ctx, apiClient, msg.MessageID)
	reactionRemoved := false
	removeTyping := func() {
		if reactionErr != nil || reactionRemoved {
			return
		}
		reactionRemoved = true
		removeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := removeFeishuReaction(removeCtx, apiClient, msg.MessageID, reactionID); err != nil {
			slog.Warn("Could not remove Feishu typing reaction", "integration_id", integration.ID, "message_id", msg.MessageID, "error", err)
		}
	}
	if reactionErr != nil {
		slog.Warn("Could not add Feishu typing reaction", "integration_id", integration.ID, "message_id", msg.MessageID, "error", reactionErr)
	} else {
		defer removeTyping()
	}

	selectedProjectID := feishuEffectiveProjectID(conversation, conversationErr, chatDefault, chatDefaultErr)
	if selectedProjectID != nil {
		project, err := m.server.store.Project(ctx, integration.WorkspaceID, *selectedProjectID)
		if err != nil || project.DeletedAt != nil {
			fail(fmt.Errorf("当前绑定的 Project 已不可用，请使用 /projects 重新选择"))
			return
		}
	}
	request := chatRequest{AgentID: integration.AgentID, Prompt: prompt, ProjectID: selectedProjectID, IdempotencyKey: "feishu:" + eventID}
	if conversationErr == nil && conversation.ConversationID != "" {
		request.SessionID = &conversation.ConversationID
	}
	request.Metadata, _ = json.Marshal(map[string]string{"provider": "feishu", "integrationId": integration.ID, "eventId": eventID, "messageId": msg.MessageID, "chatId": msg.ChatID, "senderId": msg.UserID})
	result, _, err := m.server.submitConversationTask(ctx, integration.WorkspaceID, request, attachments, "feishu")
	if err != nil {
		fail(err)
		return
	}
	taskID := result.Task.ID
	_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, "running", &taskID, nil)
	_ = m.server.store.SaveIntegrationConversation(context.Background(), store.IntegrationConversation{IntegrationID: integration.ID, ChatID: msg.ChatID, ThreadKey: threadKey, ConversationID: result.Task.ConversationID, ActiveTaskID: &taskID, ProjectID: selectedProjectID})

	lastFinalContent := ""
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		projection, syncErr := m.server.syncRelayRun(ctx, integration.WorkspaceID, result.Task.RelayRunID)
		if syncErr != nil {
			fail(syncErr)
			return
		}
		if terminal(projection.Run.Status) {
			status := "succeeded"
			response := strings.TrimSpace(projection.Content)
			if projection.Run.Status != relay.RunSucceeded {
				status = "failed"
				response = "任务" + feishuStatusText(string(projection.Run.Status))
				if projection.Error != nil {
					response += "：" + *projection.Error
				}
			}
			if response == "" {
				response = "任务已完成。"
			}
			_ = m.server.store.UpdateIntegrationEvent(context.Background(), integration.ID, eventID, status, &taskID, projection.Error)
			_ = m.server.store.SaveIntegrationConversation(context.Background(), store.IntegrationConversation{IntegrationID: integration.ID, ChatID: msg.ChatID, ThreadKey: threadKey, ConversationID: result.Task.ConversationID, ProjectID: selectedProjectID})
			if projection.Run.Status == relay.RunSucceeded && finalStream != nil {
				if strings.HasPrefix(response, lastFinalContent) && len(response) > len(lastFinalContent) {
					if appendErr := finalStream.Append(ctx, response[len(lastFinalContent):]); appendErr != nil {
						slog.Warn("Could not append final Feishu response", "integration_id", integration.ID, "message_id", msg.MessageID, "error", appendErr)
					}
				}
				closeErr := finalStream.Close(ctx)
				finalStream = nil
				if closeErr != nil {
					m.setError(integration.ID, closeErr)
					_, _ = bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Markdown: response})
				}
			} else {
				if finalStream != nil {
					closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					_ = finalStream.Close(closeCtx)
					cancel()
					finalStream = nil
				}
				_, sendErr := bot.Send(context.Background(), &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Markdown: response})
				if sendErr != nil {
					m.setError(integration.ID, sendErr)
				}
			}
			return
		}
		content := strings.TrimSpace(feishuFinalContent(projection.Events))
		if content != "" && finalStream == nil {
			stream, streamErr := bot.Stream(ctx, &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Markdown: content})
			if streamErr != nil {
				slog.Warn("Could not create Feishu final response stream", "integration_id", integration.ID, "message_id", msg.MessageID, "error", streamErr)
			} else {
				finalStream = stream
				lastFinalContent = content
				removeTyping()
			}
		} else if finalStream != nil && strings.HasPrefix(content, lastFinalContent) && len(content) > len(lastFinalContent) {
			if appendErr := finalStream.Append(ctx, content[len(lastFinalContent):]); appendErr != nil {
				slog.Warn("Could not stream final Feishu response", "integration_id", integration.ID, "message_id", msg.MessageID, "error", appendErr)
			} else {
				lastFinalContent = content
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func feishuProjectCommand(prompt string) (string, bool) {
	trimmed := strings.TrimSpace(prompt)
	lower := strings.ToLower(trimmed)
	if lower == "/project" {
		return "", true
	}
	if strings.HasPrefix(lower, "/project ") {
		return strings.TrimSpace(trimmed[len("/project "):]), true
	}
	return "", false
}

func addFeishuTypingReaction(ctx context.Context, client *lark.Client, messageID string) (string, error) {
	body := larkim.NewCreateMessageReactionReqBodyBuilder().
		ReactionType(larkim.NewEmojiBuilder().EmojiType("Typing").Build()).
		Build()
	req := larkim.NewCreateMessageReactionReqBuilder().MessageId(messageID).Body(body).Build()
	resp, err := client.Im.V1.MessageReaction.Create(ctx, req)
	if err != nil {
		return "", err
	}
	if !resp.Success() {
		return "", fmt.Errorf("Feishu reaction create failed: code=%d message=%s", resp.Code, resp.Msg)
	}
	if resp.Data == nil || resp.Data.ReactionId == nil || *resp.Data.ReactionId == "" {
		return "", fmt.Errorf("Feishu reaction create returned no reaction ID")
	}
	return *resp.Data.ReactionId, nil
}

func removeFeishuReaction(ctx context.Context, client *lark.Client, messageID, reactionID string) error {
	req := larkim.NewDeleteMessageReactionReqBuilder().MessageId(messageID).ReactionId(reactionID).Build()
	resp, err := client.Im.V1.MessageReaction.Delete(ctx, req)
	if err != nil {
		return err
	}
	if !resp.Success() {
		return fmt.Errorf("Feishu reaction delete failed: code=%d message=%s", resp.Code, resp.Msg)
	}
	return nil
}

func feishuStatusText(status string) string {
	switch status {
	case "cancelled":
		return "已取消"
	case "failed":
		return "执行失败"
	default:
		return "已结束"
	}
}
