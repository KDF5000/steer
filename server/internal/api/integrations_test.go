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

func TestFeishuTaskCard(t *testing.T) {
	card := feishuTaskCard("succeeded", "完成内容")
	var payload map[string]any
	if err := json.Unmarshal([]byte(card), &payload); err != nil {
		t.Fatal(err)
	}
	header, ok := payload["header"].(map[string]any)
	if !ok || header["template"] != "green" {
		t.Fatalf("unexpected card header: %#v", payload["header"])
	}
	long := strings.Repeat("中", maxFeishuCardContentBytes)
	truncated := truncateFeishuCardContent(long)
	if !strings.Contains(truncated, "已截断") || !strings.Contains(feishuTaskCard("running", long), "已截断") {
		t.Fatal("expected oversized card content to be truncated")
	}
	if !strings.Contains(feishuTaskCard("running", "检查中"), "collapsible_panel") {
		t.Fatal("status card should expose progress in a collapsible panel")
	}
	runningCard := feishuTaskCard("running", "检查中")
	if !strings.Contains(runningCard, "任务执行中") || strings.Contains(runningCard, "任务状态") || strings.Contains(runningCard, "可收起") {
		t.Fatalf("unexpected running status card: %s", runningCard)
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
	projectID := "project-default"
	chatDefault := store.IntegrationConversation{ProjectID: &projectID}
	if got := feishuEffectiveProjectID(store.IntegrationConversation{}, store.ErrNotFound, chatDefault, nil); got == nil || *got != projectID {
		t.Fatalf("new thread did not inherit chat project: %v", got)
	}
	if got := feishuEffectiveProjectID(store.IntegrationConversation{ConversationID: "existing"}, nil, chatDefault, nil); got != nil {
		t.Fatalf("existing unbound conversation unexpectedly changed project: %q", *got)
	}
	threadProjectID := "project-thread"
	if got := feishuEffectiveProjectID(store.IntegrationConversation{ProjectID: &threadProjectID}, nil, chatDefault, nil); got == nil || *got != threadProjectID {
		t.Fatalf("thread project should take precedence: %v", got)
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
	if created.ProjectID != nil {
		t.Fatalf("integration-level project should be ignored, got %q", *created.ProjectID)
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

	req = httptest.NewRequest(http.MethodDelete, "/api/v1/integrations/"+created.ID, nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete = %d: %s", response.Code, response.Body.String())
	}
}
