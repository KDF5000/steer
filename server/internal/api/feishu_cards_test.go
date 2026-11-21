package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/relay/controlplane"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
	lark "github.com/larksuite/oapi-sdk-go/v3"
	channeltypes "github.com/larksuite/oapi-sdk-go/v3/channel/types"
)

type feishuTestChannel struct {
	channeltypes.Channel
	Sent []*channeltypes.SendInput
}

func (bot *feishuTestChannel) Send(_ context.Context, input *channeltypes.SendInput) (*channeltypes.SendResult, error) {
	bot.Sent = append(bot.Sent, input)
	return &channeltypes.SendResult{MessageID: "generated-card", ChatID: input.ChatID}, nil
}

func TestFeishuExecutionProcessAndCancel(t *testing.T) {
	events := []relay.Event{
		{Type: "runtime.trae.item.started", Data: json.RawMessage(`{"item":{"id":"r","type":"reasoning"}}`)},
		{Type: "runtime.trae.item.reasoning.textDelta", Data: json.RawMessage(`{"itemId":"r","delta":"先检查测试结果"}`)},
		{Type: "runtime.trae.item.started", Data: json.RawMessage(`{"item":{"id":"cmd","type":"commandExecution","command":"go test ./..."}}`)},
		{Type: "runtime.trae.item.commandExecution.outputDelta", Data: json.RawMessage(`{"itemId":"cmd","delta":"ok\n"}`)},
		{Type: "runtime.trae.item.completed", Data: json.RawMessage(`{"item":{"id":"cmd","type":"commandExecution","command":"go test ./...","aggregatedOutput":"ok\nall tests passed","exitCode":0}}`)},
		{Type: "runtime.trae.item.completed", Data: json.RawMessage(`{"item":{"id":"final","type":"agentMessage","phase":"final_answer","text":"这是最终答案"}}`)},
	}
	process := feishuRuntimeProcess(events)
	if process.ToolCount != 1 || len(process.Items) != 2 {
		t.Fatalf("process = %+v", process)
	}
	if process.Items[1].Output != "ok\nall tests passed" {
		t.Fatalf("output duplicated or missing: %+v", process.Items[1])
	}
	running := feishuExecutionCard("running", events, "", "task-card-token")
	for _, text := range []string{"Working through the next step.", "go test ./...", `"expanded":false`, "cancel_task", "task-card-token"} {
		if !strings.Contains(running, text) {
			t.Fatalf("card missing %q: %s", text, running)
		}
	}
	if strings.Contains(running, "all tests passed") {
		t.Fatal("successful command output should not fill the activity feed")
	}
	if strings.Contains(running, "已调用") || strings.Contains(running, "取消本次任务") {
		t.Fatal("process card should not contain a persistent count or text cancel row")
	}
	if strings.Contains(running, "这是最终答案") {
		t.Fatal("final answer leaked into process panel")
	}
	finished := feishuExecutionCard("succeeded", events, "这是最终答案", "task-card-token")
	if strings.Contains(finished, "cancel_task") || !strings.Contains(finished, "这是最终答案") {
		t.Fatalf("terminal card = %s", finished)
	}
}

func TestFeishuCompactProcessControls(t *testing.T) {
	var card map[string]any
	if err := json.Unmarshal([]byte(feishuExecutionCard("running", nil, "", "token")), &card); err != nil {
		t.Fatal(err)
	}
	row := feishuRecord(feishuRecord(card["body"])["elements"].([]any)[0])
	if row["tag"] != "column_set" {
		t.Fatal("controls should share one row")
	}
	columns := row["columns"].([]any)
	panel := feishuRecord(feishuRecord(columns[0])["elements"].([]any)[0])
	header := feishuRecord(panel["header"])
	if feishuRecord(header["icon"])["token"] != "right-small-ccm_outlined" || header["icon_expanded_angle"] != float64(90) || header["icon_position"] != "follow_text" {
		t.Fatalf("unexpected chevron: %v", header)
	}
	stop := feishuRecord(feishuRecord(columns[1])["elements"].([]any)[0])
	if stop["tag"] != "button" || stop["type"] != "text" || feishuRecord(stop["icon"])["token"] != "stop_outlined" {
		t.Fatalf("unexpected stop control: %v", stop)
	}
	if _, exists := stop["text"]; exists {
		t.Fatal("stop control should be icon-only")
	}
}

func TestFeishuCollapsedHeadingUsesShortActivityLabels(t *testing.T) {
	for _, test := range []struct{ name, payload, eventType, want string }{
		{"command", `{"item":{"id":"tool","type":"commandExecution","command":"a very long command with arguments"}}`, "runtime.trae.item.started", "执行命令"},
		{"files", `{"item":{"id":"tool","type":"fileChange","path":"/a/very/long/path"}}`, "runtime.trae.item.started", "修改文件"},
		{"search", `{"item":{"id":"tool","type":"webSearch","query":"a very long query"}}`, "runtime.trae.item.started", "搜索资料"},
		{"reasoning", `{"item":{"id":"r","type":"reasoning","text":"long reasoning content"}}`, "runtime.trae.item.started", "思考中"},
		{"commentary", `{"item":{"id":"a","type":"agentMessage","phase":"commentary","text":"long progress commentary"}}`, "runtime.trae.item.started", "思考中"},
		{"final", `{"item":{"id":"a","type":"agentMessage","phase":"final_answer"}}`, "runtime.trae.item.started", "生成回复"},
		{"tool finished", `{"item":{"id":"tool","type":"commandExecution","command":"long command"}}`, "runtime.trae.item.completed", "思考中"},
		{"raw tool", `{"message":{"content":[{"type":"tool_use","id":"a","name":"long tool name"}]}}`, "runtime.qwenwork.assistant", "调用工具"},
	} {
		t.Run(test.name, func(t *testing.T) {
			process := feishuRuntimeProcess([]relay.Event{{Type: test.eventType, Data: json.RawMessage(test.payload)}})
			if process.Activity != test.want {
				t.Fatalf("heading = %q, want %q", process.Activity, test.want)
			}
		})
	}
}

func TestFeishuStreamJSONToolProjection(t *testing.T) {
	events := []relay.Event{
		{Type: "runtime.qoder.assistant", Data: json.RawMessage(`{"session_id":"s","message":{"content":[{"type":"thinking","thinking":"检查日志"},{"type":"tool_use","id":"tool1","name":"Bash","input":{"command":"pwd"}}]}}`)},
		{Type: "runtime.qoder.user", Data: json.RawMessage(`{"session_id":"s","message":{"content":[{"type":"tool_result","tool_use_id":"tool1","content":"/workspace","is_error":false}]}}`)},
		{Type: "runtime.opencode.tool_use", Data: json.RawMessage(`{"part":{"id":"tool2","tool":"bash","state":{"status":"completed","input":{"command":"ls"},"output":"README.md"}}}`)},
		{Type: "runtime.pi.tool_execution_start", Data: json.RawMessage(`{"toolCallId":"tool3","toolName":"read","args":{"path":"README.md"}}`)},
		{Type: "runtime.pi.tool_execution_end", Data: json.RawMessage(`{"toolCallId":"tool3","toolName":"read","result":{"content":[{"type":"text","text":"# Project"}]},"isError":true}`)},
	}
	process := feishuRuntimeProcess(events)
	if process.ToolCount != 3 {
		t.Fatalf("tool count = %d", process.ToolCount)
	}
	card := feishuExecutionCard("running", events, "", "token")
	for _, text := range []string{"Working through the next step.", "pwd", "README.md", "# Project", "失败"} {
		if !strings.Contains(card, text) {
			t.Fatalf("missing %q", text)
		}
	}
}

func TestFeishuActiveToolHeadingSurvivesCommentary(t *testing.T) {
	events := []relay.Event{
		{Type: "runtime.trae.item.started", Data: json.RawMessage(`{"item":{"id":"script","type":"commandExecution","command":"python3 check.py","status":"inProgress"}}`)},
		{Type: "runtime.trae.item.started", Data: json.RawMessage(`{"item":{"id":"comment","type":"agentMessage","phase":"commentary","text":"正在检查代码。"}}`)},
		{Type: "runtime.trae.item.agentMessage.delta", Data: json.RawMessage(`{"itemId":"comment","delta":"等待脚本结果。"}`)},
	}
	if got := feishuRuntimeProcess(events).Activity; got != "运行脚本" {
		t.Fatalf("commentary replaced active script heading: %q", got)
	}
	events = append(events, relay.Event{Type: "runtime.trae.item.completed", Data: json.RawMessage(`{"item":{"id":"script","type":"commandExecution","status":"inProgress"}}`)})
	process := feishuRuntimeProcess(events)
	if process.Items[0].Status != "completed" || process.Activity != "思考中" {
		t.Fatalf("completed script remained active: %+v", process)
	}
	events = append(events, relay.Event{Type: "runtime.trae.item.started", Data: json.RawMessage(`{"item":{"id":"final","type":"agentMessage","phase":"final_answer"}}`)})
	if got := feishuRuntimeProcess(events).Activity; got != "生成回复" {
		t.Fatalf("final heading = %q", got)
	}
}

func TestFeishuScriptToolHeading(t *testing.T) {
	event := relay.Event{Type: "runtime.trae.item.started", Data: json.RawMessage(`{"item":{"id":"script","type":"mcpToolCall","name":"functions.exec","arguments":{"code":"await tools.exec_command({cmd: 'rg pattern server'})"}}}`)}
	if got := feishuRuntimeProcess([]relay.Event{event}).Activity; got != "运行脚本" {
		t.Fatalf("script tool heading = %q", got)
	}
}

func TestFeishuSelectRequiredOnlyInsideForm(t *testing.T) {
	for _, test := range []struct {
		name        string
		card        string
		wantSelects int
	}{
		{"model picker", feishuModelCard("token", controlplane.Runtime{}, store.Agent{}, "", "", false), 1},
		{"model confirmation", feishuModelCard("token", controlplane.Runtime{}, store.Agent{}, "", "", true), 2},
		{"project picker", feishuProjectCard("token", nil, nil), 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			var payload map[string]any
			if err := json.Unmarshal([]byte(test.card), &payload); err != nil {
				t.Fatal(err)
			}
			selects := 0
			var visit func(any, bool)
			visit = func(value any, inForm bool) {
				switch node := value.(type) {
				case map[string]any:
					if node["tag"] == "form" {
						inForm = true
					}
					if node["tag"] == "select_static" {
						selects++
						_, hasRequired := node["required"]
						if hasRequired != inForm {
							t.Errorf("required allowed only within form: %v", node)
						}
						if inForm && node["required"] != true {
							t.Error("form selection must remain required")
						}
					}
					for _, child := range node {
						visit(child, inForm)
					}
				case []any:
					for _, child := range node {
						visit(child, inForm)
					}
				}
			}
			visit(payload, false)
			if selects != test.wantSelects {
				t.Fatalf("select count = %d, want %d", selects, test.wantSelects)
			}
		})
	}
}

func TestFeishuModelCardEffortMatchesModel(t *testing.T) {
	runtime := controlplane.Runtime{DefaultModel: "a", SupportsReasoningEffort: true, ModelCatalog: []controlplane.RuntimeModel{
		{ID: "a", SupportedReasoningEfforts: []controlplane.ReasoningEffortOption{{Effort: "low"}}},
		{ID: "b", SupportedReasoningEfforts: []controlplane.ReasoningEffortOption{{Effort: "xhigh"}}},
	}}
	card := feishuModelCard("token", runtime, store.Agent{}, "b", "low", true)
	if !strings.Contains(card, "xhigh") || strings.Contains(card, `"value":"low"`) {
		t.Fatalf("efforts not scoped to model: %s", card)
	}
	if !strings.Contains(card, `"initial_option":"b"`) || !strings.Contains(card, "apply_model:token") {
		t.Fatal("model selection not submitted with effort")
	}
	if strings.Contains(feishuModelCard("token", runtime, store.Agent{}, "a", "", false), "apply_model:") {
		t.Fatal("model preview should not change preferences")
	}
}

func TestFeishuCardCallbackScopeAndExpiry(t *testing.T) {
	now := time.Now()
	card := store.IntegrationCard{ChatID: "chat", MessageID: "message", ExpiresAt: now.Add(time.Hour)}
	event := &channeltypes.CardActionEvent{ChatID: "chat", MessageID: "message"}
	if err := validateFeishuCardCallback(card, event, now); err != nil {
		t.Fatal(err)
	}
	event.ChatID = "forwarded-chat"
	if validateFeishuCardCallback(card, event, now) == nil {
		t.Fatal("forwarded card accepted")
	}
	event.ChatID = "chat"
	event.MessageID = "different-card"
	if validateFeishuCardCallback(card, event, now) == nil {
		t.Fatal("different card accepted")
	}
	event.MessageID = "message"
	card.ConsumedAt = &now
	if validateFeishuCardCallback(card, event, now) == nil {
		t.Fatal("reused card accepted")
	}
	card.ConsumedAt = nil
	card.ExpiresAt = now
	if validateFeishuCardCallback(card, event, now) == nil {
		t.Fatal("expired card accepted")
	}
	if feishuSameSelectionContext(feishuCardContext{ConversationID: "old"}, feishuCardContext{ConversationID: "new"}) {
		t.Fatal("stale session accepted")
	}
}

func TestFeishuCardActionsPersistAndPreserveSession(t *testing.T) {
	databaseURL := os.Getenv("STEER_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set STEER_TEST_DATABASE_URL for integration tests")
	}
	ctx := context.Background()
	st, err := store.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	wid := "feishu-cards-" + uuid.NewString()
	if err := st.EnsureWorkspace(ctx, wid, "Feishu card test"); err != nil {
		t.Fatal(err)
	}
	agent, err := st.CreateAgent(ctx, wid, store.Agent{Name: "Bot", RuntimeProvider: "test"})
	if err != nil {
		t.Fatal(err)
	}
	integration, err := st.CreateWorkspaceIntegration(ctx, store.WorkspaceIntegration{WorkspaceID: wid, Provider: "feishu", Name: "Bot", ExternalAppID: uuid.NewString(), AgentID: agent.ID, Status: "disabled", EncryptedCredentials: []byte("test")})
	if err != nil {
		t.Fatal(err)
	}
	runtimeID := "node/test"
	sessionID := uuid.NewString()
	if _, err := st.EnsureSession(ctx, wid, sessionID, "Session", agent.ID, nil, &runtimeID, nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveIntegrationConversation(ctx, store.IntegrationConversation{IntegrationID: integration.ID, ChatID: "chat", ThreadKey: "thread:root", ConversationID: sessionID}); err != nil {
		t.Fatal(err)
	}
	runStatus := "succeeded"
	originalRun := uuid.NewString()
	submittedRun := uuid.NewString()
	var cancelledRuns []string
	var submittedRequest relay.Request
	var fakeMu sync.Mutex
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fakeMu.Lock()
		defer fakeMu.Unlock()
		if r.URL.Path == "/v1/nodes" {
			writeJSON(w, 200, []map[string]any{{"id": "node", "runtimes": []controlplane.Runtime{{ID: runtimeID, Provider: "test", DefaultModel: "a", SupportsReasoningEffort: true, Models: []string{"a", "b"}, ModelCatalog: []controlplane.RuntimeModel{{ID: "a"}, {ID: "b", SupportedReasoningEfforts: []controlplane.ReasoningEffortOption{{Effort: "high"}}}}}}}})
		} else if r.URL.Path == "/v1/runs" && r.Method == "POST" {
			_ = json.NewDecoder(r.Body).Decode(&submittedRequest)
			writeJSON(w, 202, map[string]any{"id": submittedRun, "status": "running"})
		} else if strings.HasSuffix(r.URL.Path, "/events") {
			writeJSON(w, 200, []relay.Event{{Sequence: 1, Type: "runtime.test.item.completed", Data: json.RawMessage(`{"item":{"id":"cmd","type":"commandExecution","command":"go test","aggregatedOutput":"passed","status":"completed"}}`)}})
		} else if strings.HasSuffix(r.URL.Path, "/artifacts") {
			writeJSON(w, 200, []any{})
		} else if strings.HasSuffix(r.URL.Path, "/cancel") {
			cancelledRuns = append(cancelledRuns, r.URL.Path)
			writeJSON(w, 200, map[string]any{"id": originalRun, "status": "cancelled"})
		} else {
			writeJSON(w, 200, map[string]any{"id": strings.TrimPrefix(r.URL.Path, "/v1/runs/"), "status": runStatus, "result": map[string]any{"summary": "Done"}})
		}
	}))
	defer relayServer.Close()
	var patches []string
	larkServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fakeMu.Lock()
		defer fakeMu.Unlock()
		if strings.Contains(r.URL.Path, "/auth/") {
			writeJSON(w, 200, map[string]any{"code": 0, "tenant_access_token": "test-token", "expire": 7200})
			return
		}
		var body struct {
			Content string `json:"content"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		patches = append(patches, body.Content)
		writeJSON(w, 200, map[string]any{"code": 0})
	}))
	defer larkServer.Close()
	client := lark.NewClient("test-app", "test-secret", lark.WithOpenBaseUrl(larkServer.URL))
	m := New(st, relayServer.URL, "", "", wid, nil).integrations
	makeCard := func(kind string, snapshot feishuCardContext) store.IntegrationCard {
		t.Helper()
		encoded, _ := json.Marshal(snapshot)
		card, err := st.CreateIntegrationCard(ctx, store.IntegrationCard{IntegrationID: integration.ID, ChatID: "chat", ThreadKey: "thread:root", Kind: kind, Context: encoded})
		if err != nil {
			t.Fatal(err)
		}
		if err := st.BindIntegrationCardMessage(ctx, card.ID, "card-message"); err != nil {
			t.Fatal(err)
		}
		return card
	}
	modelCard := makeCard("model", feishuCardContext{ConversationID: sessionID, AgentID: agent.ID, RuntimeID: runtimeID})
	event := &channeltypes.CardActionEvent{ChatID: "chat", MessageID: "card-message", Action: channeltypes.CardActionPayload{Name: "apply_model:" + modelCard.ID, FormValue: map[string]any{"model": "b", "effort": "high"}}}
	if err := m.handleFeishuCardAction(ctx, integration, client, event); err != nil {
		t.Fatal(err)
	}
	conversation, err := st.IntegrationConversation(ctx, integration.ID, "chat", "thread:root")
	if err != nil {
		t.Fatal(err)
	}
	if conversation.ConversationID != sessionID || value(conversation.ModelOverride) != "b" || value(conversation.ReasoningEffort) != "high" {
		t.Fatalf("preferences = %+v", conversation)
	}
	session, _ := st.Session(ctx, wid, sessionID)
	if value(session.ModelOverride) != "b" || value(session.ReasoningEffort) != "high" {
		t.Fatalf("Web session not updated: %+v", session)
	}
	if err := m.handleFeishuCardAction(ctx, integration, client, event); err == nil {
		t.Fatal("duplicate submit accepted")
	}
	// The next real Feishu message must submit the selected model and effort on
	// the existing session, and finish the same process card with its answer.
	bot := &feishuTestChannel{}
	msg := &channeltypes.NormalizedMessage{ChatID: "chat", ChatType: "group", MessageID: "user-message", RawContentType: "text", Content: "continue"}
	if _, err := st.CreateIntegrationEvent(ctx, store.IntegrationEvent{IntegrationID: integration.ID, ExternalEventID: "turn", ExternalMessageID: msg.MessageID, ChatID: "chat", ThreadKey: "thread:root", Prompt: "continue"}); err != nil {
		t.Fatal(err)
	}
	m.processMessage(ctx, integration, client, bot, msg, "turn", "thread:root", "continue")
	fakeMu.Lock()
	if submittedRequest.SessionID != sessionID || submittedRequest.Runtime.Model != "b" || submittedRequest.Runtime.ReasoningEffort != "high" {
		t.Errorf("submitted preferences: %+v", submittedRequest)
	}
	finalCard := patches[len(patches)-1]
	fakeMu.Unlock()
	if len(bot.Sent) != 1 || bot.Sent[0].Card == "" || !strings.Contains(finalCard, "Done") || !strings.Contains(finalCard, "go test") || strings.Contains(finalCard, "cancel_task") {
		t.Fatalf("task card not completed: sent=%+v final=%s", bot.Sent, finalCard)
	}
	badModel := makeCard("model", feishuCardContext{ConversationID: sessionID, AgentID: agent.ID, RuntimeID: runtimeID})
	event.Action.Name = "apply_model:" + badModel.ID
	event.Action.FormValue["effort"] = "xhigh"
	if err := m.handleFeishuCardAction(ctx, integration, client, event); err == nil {
		t.Fatal("unsupported effort accepted")
	}
	// Store an original task and bind its card before changing the thread's task.
	_, _, original, err := st.SaveTaskRun(ctx, wid, sessionID, agent.ID, "Work", originalRun, "running", store.Task{Source: "feishu"})
	if err != nil {
		t.Fatal(err)
	}
	cancelCard := makeCard("task", feishuCardContext{TaskID: original.ID, ConversationID: sessionID})
	newTaskID := uuid.NewString()
	if err := st.SaveIntegrationConversation(ctx, store.IntegrationConversation{IntegrationID: integration.ID, ChatID: "chat", ThreadKey: "thread:root", ConversationID: sessionID, ActiveTaskID: &newTaskID}); err != nil {
		t.Fatal(err)
	}
	fakeMu.Lock()
	runStatus = "running"
	fakeMu.Unlock()
	cancel := &channeltypes.CardActionEvent{ChatID: "chat", MessageID: "card-message", Action: channeltypes.CardActionPayload{Value: map[string]any{"action": "cancel_task", "card_id": cancelCard.ID}}}
	if err := m.handleFeishuCardAction(ctx, integration, client, cancel); err != nil {
		t.Fatal(err)
	}
	fakeMu.Lock()
	if len(cancelledRuns) != 1 || cancelledRuns[0] != "/v1/runs/"+originalRun+"/cancel" {
		t.Fatalf("wrong task cancelled: %v", cancelledRuns)
	}
	fakeMu.Unlock()
	// Completing an old task must not clear a newer task or its preferences.
	if err := st.ClearIntegrationActiveTask(ctx, integration.ID, "chat", "thread:root", original.ID); err != nil {
		t.Fatal(err)
	}
	conversation, _ = st.IntegrationConversation(ctx, integration.ID, "chat", "thread:root")
	if value(conversation.ActiveTaskID) != newTaskID || value(conversation.ModelOverride) != "b" {
		t.Fatal("old completion overwrote newer state")
	}
	project, err := st.CreateProject(ctx, wid, store.Project{Name: "Project B", WorkspaceKind: "git", WorkspaceSource: "https://example.test/repo.git"})
	if err != nil {
		t.Fatal(err)
	}
	projectCard := makeCard("project", feishuCardContext{ConversationID: sessionID, AgentID: agent.ID})
	projectEvent := &channeltypes.CardActionEvent{ChatID: "chat", MessageID: "card-message", Action: channeltypes.CardActionPayload{Name: "apply_project:" + projectCard.ID, FormValue: map[string]any{"project": project.ID}}}
	if err := m.handleFeishuCardAction(ctx, integration, client, projectEvent); err == nil {
		t.Fatal("project switched while task was running")
	}
	fakeMu.Lock()
	runStatus = "succeeded"
	fakeMu.Unlock()
	if err := m.handleFeishuCardAction(ctx, integration, client, projectEvent); err != nil {
		t.Fatal(err)
	}
	conversation, _ = st.IntegrationConversation(ctx, integration.ID, "chat", "thread:root")
	chat, _ := st.IntegrationConversation(ctx, integration.ID, "chat", feishuChatProjectThreadKey)
	if conversation.ConversationID != "" || value(conversation.ProjectID) != project.ID || value(chat.ProjectID) != project.ID || conversation.ModelOverride != nil {
		t.Fatalf("project switch = %+v, chat = %+v", conversation, chat)
	}
	event.Action.FormValue["effort"] = "high"
	if err := m.handleFeishuCardAction(ctx, integration, client, event); err == nil {
		t.Fatal("old model card applied after project switch")
	}
	fakeMu.Lock()
	defer fakeMu.Unlock()
	if len(patches) < 2 {
		t.Fatal("selection cards were not updated after applying")
	}
}
