package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/KDF5000/relay/controlplane"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
	lark "github.com/larksuite/oapi-sdk-go/v3"
	channeltypes "github.com/larksuite/oapi-sdk-go/v3/channel/types"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

type feishuCardContext struct {
	ConversationID string `json:"conversationId"`
	ProjectID      string `json:"projectId"`
	RuntimeID      string `json:"runtimeId"`
	AgentID        string `json:"agentId"`
	TaskID         string `json:"taskId,omitempty"`
}

func (m *integrationManager) feishuSelectionContext(ctx context.Context, integration store.WorkspaceIntegration, chatID, threadKey string) (store.IntegrationConversation, feishuCardContext, error) {
	conversation, err := m.server.store.IntegrationConversation(ctx, integration.ID, chatID, threadKey)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return conversation, feishuCardContext{}, err
	}
	chat, chatErr := m.server.store.IntegrationConversation(ctx, integration.ID, chatID, feishuChatProjectThreadKey)
	if chatErr != nil && !errors.Is(chatErr, store.ErrNotFound) {
		return conversation, feishuCardContext{}, chatErr
	}
	return conversation, feishuCardContext{ConversationID: conversation.ConversationID, ProjectID: value(feishuEffectiveProjectID(conversation, err, chat, chatErr, integration.ProjectID)), AgentID: integration.AgentID}, nil
}

func (m *integrationManager) feishuModelRuntime(ctx context.Context, integration store.WorkspaceIntegration, snapshot feishuCardContext) (controlplane.Runtime, store.Agent, store.Session, error) {
	agent, err := m.server.store.Agent(ctx, integration.WorkspaceID, integration.AgentID)
	if err != nil {
		return controlplane.Runtime{}, agent, store.Session{}, err
	}
	var session store.Session
	runtimeID := value(agent.RuntimeID)
	if snapshot.ConversationID != "" {
		session, err = m.server.store.Session(ctx, integration.WorkspaceID, snapshot.ConversationID)
		if err != nil {
			return controlplane.Runtime{}, agent, session, err
		}
		if session.ExecutionRuntimeID != nil {
			physical, resolveErr := m.server.physicalRuntimeID(ctx, integration.WorkspaceID, *session.ExecutionRuntimeID)
			if resolveErr != nil {
				return controlplane.Runtime{}, agent, session, resolveErr
			}
			runtimeID, err = m.server.agentRuntimeOnNode(ctx, integration.WorkspaceID, runtimeNodeID(physical), agent)
		}
	} else if snapshot.ProjectID != "" {
		project, lookupErr := m.server.store.Project(ctx, integration.WorkspaceID, snapshot.ProjectID)
		if lookupErr != nil || project.DeletedAt != nil {
			return controlplane.Runtime{}, agent, session, fmt.Errorf("当前项目已不可用，请重新选择项目")
		}
		if project.WorkspaceKind == "local" {
			runtimeID, err = m.server.projectAgentRuntime(ctx, integration.WorkspaceID, project, agent)
		}
	}
	if err != nil {
		return controlplane.Runtime{}, agent, session, err
	}
	if runtimeID == "" {
		runtimeID, err = m.server.firstWorkspaceRuntime(ctx, integration.WorkspaceID, agent.RuntimeProvider)
	}
	if err != nil {
		return controlplane.Runtime{}, agent, session, err
	}
	nodes, err := m.server.workspaceNodes(ctx, integration.WorkspaceID)
	if err != nil {
		return controlplane.Runtime{}, agent, session, err
	}
	for _, node := range nodes {
		for _, runtime := range node.Runtimes {
			if runtime.ID == runtimeID && runtime.Provider == agent.RuntimeProvider && runtime.State != "unhealthy" {
				return runtime, agent, session, nil
			}
		}
	}
	return controlplane.Runtime{}, agent, session, fmt.Errorf("当前 Runtime 不可用，请稍后重试")
}

func (m *integrationManager) sendFeishuSelection(ctx context.Context, integration store.WorkspaceIntegration, bot channeltypes.Channel, msg *channeltypes.NormalizedMessage, threadKey, kind string) error {
	conversation, snapshot, err := m.feishuSelectionContext(ctx, integration, msg.ChatID, threadKey)
	if err != nil {
		return err
	}
	var runtime controlplane.Runtime
	var agent store.Agent
	var session store.Session
	var projects []store.Project
	if kind == "model" {
		runtime, agent, session, err = m.feishuModelRuntime(ctx, integration, snapshot)
		snapshot.RuntimeID = runtime.ID
	} else {
		projects, err = m.server.store.Projects(ctx, integration.WorkspaceID)
	}
	if err != nil {
		return err
	}
	encoded, _ := json.Marshal(snapshot)
	card, err := m.server.store.CreateIntegrationCard(ctx, store.IntegrationCard{IntegrationID: integration.ID, ChatID: msg.ChatID, ThreadKey: threadKey, Kind: kind, Context: encoded})
	if err != nil {
		return err
	}
	content := ""
	if kind == "model" {
		model, _ := conversationModel(session, agent, conversation.ModelOverride, false)
		effort := conversationEffort(session, agent, conversation.ModelOverride, conversation.ReasoningEffort, false)
		content = feishuModelCard(card.ID, runtime, agent, value(model), value(effort), false)
	} else {
		content = feishuProjectCard(card.ID, projects, &snapshot.ProjectID)
	}
	result, err := bot.Send(ctx, &channeltypes.SendInput{ChatID: msg.ChatID, ReplyMessageID: msg.MessageID, Card: content})
	if err != nil {
		return err
	}
	return m.server.store.BindIntegrationCardMessage(ctx, card.ID, result.MessageID)
}

func feishuCardAction(event *channeltypes.CardActionEvent) (action, token string) {
	action = feishuString(event.Action.Value, "action")
	token = feishuString(event.Action.Value, "card_id")
	for _, kind := range []string{"apply_model", "apply_project"} {
		if strings.HasPrefix(event.Action.Name, kind+":") {
			return kind, strings.TrimPrefix(event.Action.Name, kind+":")
		}
	}
	return action, token
}

func validateFeishuCardCallback(card store.IntegrationCard, event *channeltypes.CardActionEvent, now time.Time) error {
	if card.ChatID == "" || card.MessageID == "" || card.ChatID != event.ChatID || card.MessageID != event.MessageID {
		return fmt.Errorf("此卡片不能在当前聊天中操作，请重新发送命令")
	}
	if card.ConsumedAt != nil || !card.ExpiresAt.After(now) {
		return fmt.Errorf("此卡片已使用或已过期，请重新发送命令")
	}
	return nil
}

func feishuSameSelectionContext(before, now feishuCardContext) bool {
	return before.ConversationID == now.ConversationID && before.ProjectID == now.ProjectID && before.AgentID == now.AgentID
}

func patchFeishuCard(ctx context.Context, client *lark.Client, messageID, content string) error {
	resp, err := client.Im.V1.Message.Patch(ctx, larkim.NewPatchMessageReqBuilder().MessageId(messageID).Body(larkim.NewPatchMessageReqBodyBuilder().Content(content).Build()).Build())
	if err != nil {
		return err
	}
	if !resp.Success() {
		return fmt.Errorf("更新飞书卡片失败：code=%d message=%s", resp.Code, resp.Msg)
	}
	return nil
}

func (m *integrationManager) handleFeishuCardAction(ctx context.Context, integration store.WorkspaceIntegration, client *lark.Client, event *channeltypes.CardActionEvent) error {
	action, token := feishuCardAction(event)
	if _, err := uuid.Parse(token); err != nil {
		return fmt.Errorf("卡片操作无效，请重新发送命令")
	}
	card, err := m.server.store.IntegrationCard(ctx, integration.ID, token)
	if err != nil {
		return err
	}
	if err := validateFeishuCardCallback(card, event, time.Now()); err != nil {
		return err
	}
	var snapshot feishuCardContext
	if err := json.Unmarshal(card.Context, &snapshot); err != nil {
		return err
	}
	if action == "cancel_task" {
		if card.Kind != "task" || snapshot.TaskID == "" {
			return fmt.Errorf("取消操作无效")
		}
		task, err := m.server.store.Task(ctx, integration.WorkspaceID, snapshot.TaskID)
		if err != nil {
			return err
		}
		if task.ConversationID != snapshot.ConversationID {
			return fmt.Errorf("任务与此卡片不匹配")
		}
		run, err := m.server.relay.GetRun(ctx, task.RelayRunID)
		if err != nil {
			return err
		}
		if terminal(run.Status) {
			return fmt.Errorf("此任务已经结束")
		}
		_, err = m.server.relay.CancelRun(ctx, task.RelayRunID, controlplane.CancelRequest{Reason: "Cancelled from Feishu card", RequestedBy: "steer-feishu:" + event.Operator.OpenID})
		return err
	}
	if (card.Kind != "model" && card.Kind != "project") || (card.Kind == "model" && action != "choose_model" && action != "model_back" && action != "apply_model") || (card.Kind == "project" && action != "apply_project") {
		return fmt.Errorf("卡片操作不匹配")
	}
	lockID := snapshot.ConversationID
	if lockID == "" {
		lockID = uuid.NewSHA1(uuid.NameSpaceURL, []byte(integration.ID+":"+card.ChatID+":"+card.ThreadKey)).String()
	}
	release, err := m.server.store.TryConversationLock(ctx, integration.WorkspaceID, lockID)
	if err != nil {
		return err
	}
	defer release()
	// Re-read after acquiring the lock to reject duplicate submits across replicas.
	card, err = m.server.store.IntegrationCard(ctx, integration.ID, token)
	if err != nil {
		return err
	}
	if err := validateFeishuCardCallback(card, event, time.Now()); err != nil {
		return err
	}
	conversation, current, err := m.feishuSelectionContext(ctx, integration, card.ChatID, card.ThreadKey)
	if err != nil {
		return err
	}
	if !feishuSameSelectionContext(snapshot, current) {
		return fmt.Errorf("会话或项目已变更，请重新发送 /model 或 /project")
	}
	if action == "apply_model" || action == "apply_project" {
		if conversation.ConversationID != "" {
			active, activeErr := m.server.store.ActiveConversationTask(ctx, integration.WorkspaceID, conversation.ConversationID)
			if activeErr == nil {
				run, runErr := m.server.relay.GetRun(ctx, active.RelayRunID)
				if runErr != nil {
					return runErr
				}
				if !terminal(run.Status) {
					return fmt.Errorf("当前任务仍在执行，请先取消或等待完成后再切换")
				}
			} else if !errors.Is(activeErr, store.ErrNotFound) {
				return activeErr
			}
		}
	}
	response := ""
	if card.Kind == "model" {
		runtime, agent, session, err := m.feishuModelRuntime(ctx, integration, current)
		if err != nil {
			return err
		}
		if snapshot.RuntimeID != runtime.ID {
			return fmt.Errorf("Runtime 已变更，请重新发送 /model")
		}
		if action == "model_back" {
			model, _ := conversationModel(session, agent, conversation.ModelOverride, false)
			return patchFeishuCard(ctx, client, card.MessageID, feishuModelCard(token, runtime, agent, value(model), value(conversation.ReasoningEffort), false))
		}
		model := event.Action.Option
		if action == "apply_model" {
			model = feishuString(event.Action.FormValue, "model")
		}
		if model == "" {
			return fmt.Errorf("请选择模型")
		}
		if model == feishuDefaultOption {
			model = ""
		}
		if model != "" {
			found := false
			for _, option := range feishuModelOptions(runtime) {
				found = found || option.ID == model
			}
			if !found {
				return fmt.Errorf("所选模型已不可用，请重新发送 /model")
			}
		}
		if action == "choose_model" {
			return patchFeishuCard(ctx, client, card.MessageID, feishuModelCard(token, runtime, agent, model, "", true))
		}
		effort := feishuString(event.Action.FormValue, "effort")
		if effort == "" {
			return fmt.Errorf("请选择 effort")
		}
		if effort == feishuDefaultOption {
			effort = ""
		}
		if effort != "" {
			effective := model
			if effective == "" {
				effective = value(agent.Model)
			}
			if err := validateRuntimeEffort(runtime, effective, effort); err != nil {
				return err
			}
		}
		if err := m.server.store.SetIntegrationConversationModel(ctx, integration.ID, card.ChatID, card.ThreadKey, model, effort); err != nil {
			return err
		}
		label := model
		if label == "" {
			label = "Agent 默认"
		}
		effortLabel := effort
		if effortLabel == "" {
			effortLabel = "模型默认"
		}
		response = "当前话题已切换为 " + label + " · effort: " + effortLabel + "。下一次任务生效，保留原 session。"
	} else {
		projectID := feishuString(event.Action.FormValue, "project")
		if projectID == "" {
			return fmt.Errorf("请选择项目")
		}
		var selected *string
		label := "集成默认项目"
		if projectID != feishuDefaultOption {
			project, err := m.server.store.Project(ctx, integration.WorkspaceID, projectID)
			if err != nil || project.DeletedAt != nil {
				return fmt.Errorf("所选项目已不可用，请重新发送 /project")
			}
			selected = &project.ID
			label = project.Name
		}
		if err := m.server.store.SetIntegrationChatProject(ctx, integration.ID, card.ChatID, feishuChatProjectThreadKey, card.ThreadKey, selected); err != nil {
			return err
		}
		response = "已切换至「" + label + "」。当前话题的下一条消息开启新 session，后续新话题也使用该项目。"
	}
	if _, err := m.server.store.ConsumeIntegrationCard(ctx, card.ID); err != nil {
		return err
	}
	if err := patchFeishuCard(ctx, client, card.MessageID, feishuEncodeCard("设置已更新", []feishuElement{feishuMarkdown(response)})); err != nil {
		return fmt.Errorf("设置已保存，但卡片更新失败：%w", err)
	}
	return nil
}
