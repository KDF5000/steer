package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
	channeltypes "github.com/larksuite/oapi-sdk-go/v3/channel/types"
	larkim "github.com/larksuite/oapi-sdk-go/v3/service/im/v1"
)

func TestCredentialEncryptionRoundTrip(t *testing.T) {
	server := &Server{}
	WithCredentialEncryptionKey("test-only-credential-key-that-is-long-enough")(server)
	ciphertext, err := server.encryptCredential("app-secret-value")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(ciphertext), "app-secret-value") {
		t.Fatal("ciphertext contains plaintext")
	}
	plaintext, err := server.decryptCredential(ciphertext)
	if err != nil {
		t.Fatal(err)
	}
	if plaintext != "app-secret-value" {
		t.Fatalf("decrypt = %q", plaintext)
	}
}

func TestFeishuThreadKey(t *testing.T) {
	if got := feishuThreadKey(&channeltypes.NormalizedMessage{ChatType: "p2p", ChatID: "chat", MessageID: "message"}); got != "p2p" {
		t.Fatalf("p2p key = %q", got)
	}
	root := "root-message"
	event := &larkim.P2MessageReceiveV1{Event: &larkim.P2MessageReceiveV1Data{Message: &larkim.EventMessage{RootId: &root}}}
	if got := feishuThreadKey(&channeltypes.NormalizedMessage{ChatType: "group", MessageID: "reply", RawEvent: event}); got != "thread:root-message" {
		t.Fatalf("group reply key = %q", got)
	}
	if got := feishuThreadKey(&channeltypes.NormalizedMessage{ChatType: "group", MessageID: "top"}); got != "thread:top" {
		t.Fatalf("group top-level key = %q", got)
	}
}

func TestFeishuParentMessageContext(t *testing.T) {
	parentID := "parent-message"
	event := &larkim.P2MessageReceiveV1{Event: &larkim.P2MessageReceiveV1Data{Message: &larkim.EventMessage{ParentId: &parentID}}}
	msg := &channeltypes.NormalizedMessage{RawEvent: event}
	if got := feishuParentMessageID(msg); got != parentID {
		t.Fatalf("parent message ID = %q", got)
	}
	parent := &feishuMessageContext{SenderName: "Alice", Content: "请检查这个错误"}
	prompt := composeFeishuPrompt("原因是什么？", parent)
	if !strings.Contains(prompt, `sender="Alice"`) || !strings.Contains(prompt, "请检查这个错误") || !strings.HasSuffix(prompt, "原因是什么？") {
		t.Fatalf("composed prompt did not preserve parent and current message: %q", prompt)
	}
	if got := composeFeishuPrompt("普通消息", nil); got != "普通消息" {
		t.Fatalf("prompt without parent = %q", got)
	}
}

func TestFeishuReplyContextOnlyForNewSession(t *testing.T) {
	parentID := "parent-message"
	msg := &channeltypes.NormalizedMessage{RawEvent: &larkim.P2MessageReceiveV1{Event: &larkim.P2MessageReceiveV1Data{Message: &larkim.EventMessage{ParentId: &parentID}}}}
	for _, test := range []struct {
		name         string
		conversation store.IntegrationConversation
		want         string
	}{
		{name: "first reply imports context", want: parentID},
		{name: "same session skips context", conversation: store.IntegrationConversation{ConversationID: "existing-session"}},
		{name: "reset session imports context", conversation: store.IntegrationConversation{ThreadKey: "thread:root"}, want: parentID},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := feishuReplyContextID(msg, test.conversation); got != test.want {
				t.Fatalf("reply context ID = %q, want %q", got, test.want)
			}
		})
	}
}

func TestFeishuMessagePolicy(t *testing.T) {
	botSender := "app"
	for _, test := range []struct {
		name        string
		msg         channeltypes.NormalizedMessage
		knownThread bool
		want        bool
	}{
		{name: "direct message", msg: channeltypes.NormalizedMessage{ChatType: "p2p"}, want: true},
		{name: "new group mention", msg: channeltypes.NormalizedMessage{ChatType: "group", MentionedBot: true}, want: true},
		{name: "new group without mention", msg: channeltypes.NormalizedMessage{ChatType: "group"}},
		{name: "known thread without mention", msg: channeltypes.NormalizedMessage{ChatType: "group"}, knownThread: true, want: true},
		{name: "known thread with mention", msg: channeltypes.NormalizedMessage{ChatType: "group", MentionedBot: true}, knownThread: true, want: true},
		{name: "mention all ignored", msg: channeltypes.NormalizedMessage{ChatType: "group", MentionAll: true}, knownThread: true},
		{name: "bot reply ignored", msg: channeltypes.NormalizedMessage{ChatType: "group", RawEvent: &larkim.P2MessageReceiveV1{Event: &larkim.P2MessageReceiveV1Data{Sender: &larkim.EventSender{SenderType: &botSender}}}}, knownThread: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := feishuShouldAcceptMessage(&test.msg, test.knownThread); got != test.want {
				t.Fatalf("accept message = %v, want %v", got, test.want)
			}
		})
	}
}

func TestParseFeishuReceivedRichText(t *testing.T) {
	direct := `{"title":"排查结果","content":[[{"tag":"text","text":"错误来自 "},{"tag":"a","text":"日志","href":"https://example.test/log"}],[{"tag":"img","image_key":"img_v2_test"}]]}`
	content, resources := parseFeishuMessageContent("post", direct)
	if !strings.Contains(content, "排查结果") || !strings.Contains(content, "错误来自") || !strings.Contains(content, "[日志](https://example.test/log)") {
		t.Fatalf("direct received post content = %q", content)
	}
	if len(resources) != 1 || resources[0].Type != "image" || resources[0].FileKey != "img_v2_test" {
		t.Fatalf("direct received post resources = %+v", resources)
	}

	localized := `{"zh_cn":{"title":"本地化消息","content":[[{"tag":"text","text":"正文"}]]}}`
	content, _ = parseFeishuMessageContent("post", localized)
	if !strings.Contains(content, "本地化消息") || !strings.Contains(content, "正文") {
		t.Fatalf("localized post content = %q", content)
	}
}

func TestNormalizeFeishuIncomingRichText(t *testing.T) {
	messageType := "post"
	rawContent := `{"title":"引用内容","content":[[{"tag":"text","text":"请检查这里"}]]}`
	event := &larkim.P2MessageReceiveV1{Event: &larkim.P2MessageReceiveV1Data{Message: &larkim.EventMessage{MessageType: &messageType, Content: &rawContent}}}
	msg := &channeltypes.NormalizedMessage{Content: "[rich text message]", RawContentType: "post", RawEvent: event}

	normalized := normalizeFeishuIncomingMessage(msg)
	if !strings.Contains(normalized.Content, "引用内容") || !strings.Contains(normalized.Content, "请检查这里") {
		t.Fatalf("normalized incoming post content = %q", normalized.Content)
	}
}

func TestFeishuTaskCard(t *testing.T) {
	card := feishuExecutionCard("succeeded", nil, "完成内容", "token")
	var payload map[string]any
	if err := json.Unmarshal([]byte(card), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["schema"] != "2.0" || !strings.Contains(card, "完成内容") || !strings.Contains(card, "已完成") {
		t.Fatalf("unexpected completed card: %s", card)
	}
	long := strings.Repeat("中", 24<<10)
	card = feishuExecutionCard("running", nil, long, "token")
	if !strings.Contains(card, "已截断") || len(card) > 30<<10 || !json.Valid([]byte(card)) {
		t.Fatal("oversized card was not safely bounded")
	}
	if !strings.Contains(card, "collapsible_panel") || !strings.Contains(card, `"expanded":false`) {
		t.Fatal("process should default to collapsed")
	}
}

func TestFeishuSeparatesProgressAndFinalMessages(t *testing.T) {
	events := []relay.Event{
		{Sequence: 1, Type: "runtime.trae.item.started", Data: json.RawMessage(`{"item":{"id":"progress","type":"agentMessage","phase":"commentary","text":""}}`)},
		{Sequence: 2, Type: "runtime.trae.item.agentMessage.delta", Data: json.RawMessage(`{"itemId":"progress","delta":"正在检查代码"}`)},
		{Sequence: 3, Type: "runtime.trae.item.completed", Data: json.RawMessage(`{"item":{"id":"progress","type":"agentMessage","phase":"commentary","text":"正在检查代码。"}}`)},
		{Sequence: 4, Type: "runtime.trae.item.started", Data: json.RawMessage(`{"item":{"id":"final","type":"agentMessage","phase":"final_answer","text":""}}`)},
		{Sequence: 5, Type: "runtime.trae.item.agentMessage.delta", Data: json.RawMessage(`{"itemId":"final","delta":"检查完成"}`)},
	}
	if got := feishuProgressContent(events); got != "正在检查代码。" {
		t.Fatalf("progress content = %q", got)
	}
	if got := feishuFinalContent(events); got != "检查完成" {
		t.Fatalf("final content = %q", got)
	}
}

func TestFeishuPromptRemovesBotMentionPlaceholder(t *testing.T) {
	msg := &channeltypes.NormalizedMessage{
		Content:  "@_user_1 /help",
		Mentions: []channeltypes.Mention{{Key: "@_user_1", Name: "飞飞", IsBot: true}},
	}
	if got := feishuPrompt(msg); got != "/help" {
		t.Fatalf("prompt = %q", got)
	}
}

func TestFeishuPromptRemovesAllMentionsBeforeCommandMatching(t *testing.T) {
	tests := []struct {
		name string
		msg  channeltypes.NormalizedMessage
		want string
	}{
		{
			name: "current bot mention without identity marker",
			msg: channeltypes.NormalizedMessage{Content: "@Store-Traex-Coder /status",
				Mentions: []channeltypes.Mention{{Name: "Store-Traex-Coder"}}},
			want: "/status",
		},
		{
			name: "current and other bot mentions",
			msg: channeltypes.NormalizedMessage{Content: "@OtherBot @Store-Traex-Coder /status",
				Mentions: []channeltypes.Mention{{Name: "OtherBot"}, {Name: "Store-Traex-Coder", IsBot: true}}},
			want: "/status",
		},
		{
			name: "mention placeholders",
			msg: channeltypes.NormalizedMessage{Content: "@_user_1 @_user_2 /projects",
				Mentions: []channeltypes.Mention{{Key: "@_user_1"}, {Key: "@_user_2"}}},
			want: "/projects",
		},
		{
			name: "ordinary request mentioning command",
			msg:  channeltypes.NormalizedMessage{Content: "@Store-Traex-Coder 请执行 /status 相关检查", Mentions: []channeltypes.Mention{{Name: "Store-Traex-Coder"}}},
			want: "请执行 /status 相关检查",
		},
		{name: "command in ordinary message", msg: channeltypes.NormalizedMessage{Content: "普通消息中提到 /status"}, want: "普通消息中提到 /status"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := feishuPrompt(&test.msg); got != test.want {
				t.Errorf("feishuPrompt(%q) = %q, want %q", test.msg.Content, got, test.want)
			}
		})
	}
}

func TestFeishuProjectCommand(t *testing.T) {
	tests := []struct {
		prompt string
		query  string
		ok     bool
	}{
		{prompt: "/project", ok: true},
		{prompt: " /PROJECT Demo Project ", query: "Demo Project", ok: true},
		{prompt: "/project none", query: "none", ok: true},
		{prompt: "/projects", ok: false},
		{prompt: "please use /project Demo", ok: false},
	}
	for _, test := range tests {
		query, ok := feishuProjectCommand(test.prompt)
		if query != test.query || ok != test.ok {
			t.Errorf("feishuProjectCommand(%q) = (%q, %v), want (%q, %v)", test.prompt, query, ok, test.query, test.ok)
		}
	}
}

func TestFeishuEffectiveProjectID(t *testing.T) {
	integrationProject := "project-integration"
	chatProject := "project-chat"
	threadProject := "project-thread"
	cases := []struct {
		name            string
		conversation    store.IntegrationConversation
		conversationErr error
		chat            store.IntegrationConversation
		chatErr         error
		fallback        *string
		want            *string
	}{
		{"unbound private chat", store.IntegrationConversation{}, store.ErrNotFound, store.IntegrationConversation{}, store.ErrNotFound, &integrationProject, &integrationProject},
		{"unbound group thread", store.IntegrationConversation{}, store.ErrNotFound, store.IntegrationConversation{}, nil, &integrationProject, &integrationProject},
		{"chat overrides integration", store.IntegrationConversation{}, store.ErrNotFound, store.IntegrationConversation{ProjectID: &chatProject}, nil, &integrationProject, &chatProject},
		{"thread overrides chat", store.IntegrationConversation{ProjectID: &threadProject}, nil, store.IntegrationConversation{ProjectID: &chatProject}, nil, &integrationProject, &threadProject},
		{"existing unbound session stays unbound", store.IntegrationConversation{ConversationID: "existing"}, nil, store.IntegrationConversation{ProjectID: &chatProject}, nil, &integrationProject, nil},
		{"project none restores integration default", store.IntegrationConversation{}, nil, store.IntegrationConversation{}, nil, &integrationProject, &integrationProject},
		{"no defaults", store.IntegrationConversation{}, store.ErrNotFound, store.IntegrationConversation{}, store.ErrNotFound, nil, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := feishuEffectiveProjectID(tc.conversation, tc.conversationErr, tc.chat, tc.chatErr, tc.fallback)
			if (got == nil) != (tc.want == nil) || got != nil && *got != *tc.want {
				t.Fatalf("project = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestNewFeishuWSClientRegistersEventDispatcher(t *testing.T) {
	client := newFeishuWSClient("cli_test", "secret")
	if client.EventHandler() == nil {
		t.Fatal("expected Feishu WebSocket client to have an event dispatcher")
	}
}

func TestFeishuIntegrationManagement(t *testing.T) {
	databaseURL := os.Getenv("STEER_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set STEER_TEST_DATABASE_URL for integration tests")
	}
	st, err := store.Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	wid := "integration-http-" + uuid.NewString()
	if err := st.EnsureWorkspace(context.Background(), wid, "Integration test"); err != nil {
		t.Fatal(err)
	}
	agent, err := st.CreateAgent(context.Background(), wid, store.Agent{Name: "Feishu Agent", RuntimeProvider: "test"})
	if err != nil {
		t.Fatal(err)
	}
	project, err := st.CreateProject(context.Background(), wid, store.Project{
		Name: "Demo Project", WorkspaceKind: "local", WorkspaceSource: "/tmp/demo", ExecutionMode: "in_place",
	})
	if err != nil {
		t.Fatal(err)
	}
	server := New(st, "http://127.0.0.1:1", "", "", wid, nil, WithCredentialEncryptionKey("test-only-credential-key-that-is-long-enough"))
	handler := server.Handler()

	appID := "cli_" + uuid.NewString()
	body := `{"name":"Team bot","appId":"` + appID + `","appSecret":"super-secret","agentId":"` + agent.ID + `","projectId":"` + project.ID + `","enabled":false}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/integrations/feishu", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusCreated {
		t.Fatalf("create = %d: %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "super-secret") {
		t.Fatal("API response exposed app secret")
	}
	var created store.WorkspaceIntegration
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if !created.SecretConfigured || created.Status != "disabled" {
		t.Fatalf("unexpected integration: %+v", created)
	}
	if created.StreamReplies {
		t.Fatal("new integration should default to non-streaming")
	}

	if created.ProjectID == nil || *created.ProjectID != project.ID {
		t.Fatalf("default project did not persist: %v", created.ProjectID)
	}
	stored, err := st.WorkspaceIntegration(context.Background(), wid, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	secret, err := server.decryptCredential(stored.EncryptedCredentials)
	if err != nil || secret != "super-secret" {
		t.Fatalf("stored secret did not round trip: %q %v", secret, err)
	}

	if err := st.SaveIntegrationConversation(context.Background(), store.IntegrationConversation{
		IntegrationID:  created.ID,
		ChatID:         "chat-1",
		ThreadKey:      "p2p",
		ConversationID: "conversation-1",
		ProjectID:      &project.ID,
	}); err != nil {
		t.Fatal(err)
	}
	if err := st.ResetIntegrationConversation(context.Background(), created.ID, "chat-1", "p2p"); err != nil {
		t.Fatal(err)
	}
	conversation, err := st.IntegrationConversation(context.Background(), created.ID, "chat-1", "p2p")
	if err != nil {
		t.Fatal(err)
	}
	if conversation.ConversationID != "" || conversation.ProjectID == nil || *conversation.ProjectID != project.ID {
		t.Fatalf("/new reset should preserve project binding: %+v", conversation)
	}
	if err := st.SetIntegrationConversationProject(context.Background(), created.ID, "chat-1", "p2p", nil); err != nil {
		t.Fatal(err)
	}
	conversation, err = st.IntegrationConversation(context.Background(), created.ID, "chat-1", "p2p")
	if err != nil {
		t.Fatal(err)
	}
	if conversation.ConversationID != "" || conversation.ProjectID != nil {
		t.Fatalf("project unbind should reset conversation: %+v", conversation)
	}
	if err := st.SetIntegrationChatProject(context.Background(), created.ID, "group-chat", feishuChatProjectThreadKey, "thread:new-message", &project.ID); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{feishuChatProjectThreadKey, "thread:new-message"} {
		binding, err := st.IntegrationConversation(context.Background(), created.ID, "group-chat", key)
		if err != nil {
			t.Fatal(err)
		}
		if binding.ConversationID != "" || binding.ProjectID == nil || *binding.ProjectID != project.ID {
			t.Fatalf("chat project binding %q = %+v", key, binding)
		}
	}
	activeTaskID := "task-latest"
	if err := st.SaveIntegrationConversation(context.Background(), store.IntegrationConversation{
		IntegrationID: created.ID, ChatID: "group-chat", ThreadKey: "thread:active",
		ConversationID: "conversation-active", ActiveTaskID: &activeTaskID, ProjectID: &project.ID,
	}); err != nil {
		t.Fatal(err)
	}
	latest, err := st.LatestIntegrationConversationTask(context.Background(), created.ID, "group-chat")
	if err != nil || latest.ActiveTaskID == nil || *latest.ActiveTaskID != activeTaskID {
		t.Fatalf("latest active chat task = %+v, %v", latest, err)
	}

	otherWorkspaceID := "integration-http-" + uuid.NewString()
	if err := st.EnsureWorkspace(context.Background(), otherWorkspaceID, "Other workspace"); err != nil {
		t.Fatal(err)
	}
	otherAgent, err := st.CreateAgent(context.Background(), otherWorkspaceID, store.Agent{Name: "Other Agent", RuntimeProvider: "test"})
	if err != nil {
		t.Fatal(err)
	}
	otherServer := New(st, "http://127.0.0.1:1", "", "", otherWorkspaceID, nil, WithCredentialEncryptionKey("test-only-credential-key-that-is-long-enough"))
	duplicateBody := `{"name":"Duplicate bot","appId":"` + strings.ToUpper(appID) + `","appSecret":"other-secret","agentId":"` + otherAgent.ID + `","enabled":false}`
	req = httptest.NewRequest(http.MethodPost, "/api/v1/integrations/feishu", strings.NewReader(duplicateBody))
	req.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	otherServer.Handler().ServeHTTP(response, req)
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), "already connected to a workspace") {
		t.Fatalf("duplicate App ID = %d: %s", response.Code, response.Body.String())
	}

	foreignProject, err := st.CreateProject(context.Background(), otherWorkspaceID, store.Project{
		Name: "Foreign Project", WorkspaceKind: "local", WorkspaceSource: "/tmp/foreign", ExecutionMode: "in_place",
	})
	if err != nil {
		t.Fatal(err)
	}
	deletedProject, err := st.CreateProject(context.Background(), wid, store.Project{
		Name: "Deleted Project", WorkspaceKind: "local", WorkspaceSource: "/tmp/deleted", ExecutionMode: "in_place",
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.DeleteProject(context.Background(), wid, deletedProject.ID); err != nil {
		t.Fatal(err)
	}
	for _, invalidProject := range []string{foreignProject.ID, deletedProject.ID, "missing-project"} {
		payload, _ := json.Marshal(integrationInput{Name: created.Name, AppID: appID, AgentID: agent.ID, ProjectID: &invalidProject})
		req = httptest.NewRequest(http.MethodPut, "/api/v1/integrations/"+created.ID, strings.NewReader(string(payload)))
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("invalid default project = %d: %s", response.Code, response.Body.String())
		}
	}

	update := `{"name":"Renamed bot","appId":"` + created.ExternalAppID + `","agentId":"` + agent.ID + `","projectId":null,"enabled":false}`
	req = httptest.NewRequest(http.MethodPut, "/api/v1/integrations/"+created.ID, strings.NewReader(update))
	req.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("update = %d: %s", response.Code, response.Body.String())
	}
	stored, err = st.WorkspaceIntegration(context.Background(), wid, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	secret, err = server.decryptCredential(stored.EncryptedCredentials)
	if err != nil || secret != "super-secret" {
		t.Fatalf("blank update replaced secret: %q %v", secret, err)
	}

	if stored.ProjectID != nil {
		t.Fatal("clearing default project did not persist")
	}
	binding, err := st.IntegrationConversation(context.Background(), created.ID, "group-chat", "thread:active")
	if err != nil || binding.ConversationID != "conversation-active" || binding.ProjectID == nil || *binding.ProjectID != project.ID {
		t.Fatalf("default project update reset existing conversation: %+v, %v", binding, err)
	}
	payload, _ := json.Marshal(integrationInput{Name: created.Name, AppID: appID, AgentID: agent.ID, ProjectID: &project.ID})
	req = httptest.NewRequest(http.MethodPut, "/api/v1/integrations/"+created.ID, strings.NewReader(string(payload)))
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusOK {
		t.Fatalf("setting default project = %d: %s", response.Code, response.Body.String())
	}
	stored, err = st.WorkspaceIntegration(context.Background(), wid, created.ID)
	if err != nil || stored.ProjectID == nil || *stored.ProjectID != project.ID {
		t.Fatalf("updated default project = %v, %v", stored.ProjectID, err)
	}

	for _, enabled := range []bool{true, false} {
		payload, _ := json.Marshal(integrationInput{Name: created.Name, AppID: appID, AgentID: agent.ID, ProjectID: &project.ID, StreamReplies: &enabled})
		req = httptest.NewRequest(http.MethodPut, "/api/v1/integrations/"+created.ID, strings.NewReader(string(payload)))
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != http.StatusOK {
			t.Fatalf("stream setting update = %d: %s", response.Code, response.Body.String())
		}
		stored, err = st.WorkspaceIntegration(context.Background(), wid, created.ID)
		if err != nil || stored.StreamReplies != enabled {
			t.Fatalf("stream setting did not persist: %v, %v", stored.StreamReplies, err)
		}
		// Updating other settings without the stream field must preserve it.
		payload, _ = json.Marshal(map[string]any{"name": created.Name, "appId": appID, "agentId": agent.ID, "projectId": project.ID, "enabled": false})
		req = httptest.NewRequest(http.MethodPut, "/api/v1/integrations/"+created.ID, strings.NewReader(string(payload)))
		response = httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != http.StatusOK {
			t.Fatalf("unrelated settings update = %d: %s", response.Code, response.Body.String())
		}
		items, err := st.WorkspaceIntegrations(context.Background(), wid)
		if err != nil || len(items) != 1 || items[0].StreamReplies != enabled {
			t.Fatalf("unrelated update changed stream setting: %+v, %v", items, err)
		}
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/integrations/"+created.ID, nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete = %d: %s", response.Code, response.Body.String())
	}
}
