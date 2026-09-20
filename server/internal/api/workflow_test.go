package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

// Exercise the Chat-first HTTP contract with real PostgreSQL and a fake Relay.
func TestConversationWorkflowHTTP(t *testing.T) {
	databaseURL := os.Getenv("STEER_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set STEER_TEST_DATABASE_URL for integration tests")
	}
	st, err := store.Open(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err = st.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	wid := "http-test-" + uuid.NewString()
	if err = st.EnsureWorkspace(context.Background(), wid, "HTTP test"); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	requests := []relay.Request{}
	const content = "## Report\n\n| Check | Result |\n| --- | --- |\n| Sources | Verified |"
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "POST" && r.URL.Path == "/v1/runs":
			var in relay.Request
			if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
				http.Error(w, "invalid", 400)
				return
			}
			mu.Lock()
			requests = append(requests, in)
			mu.Unlock()
			writeJSON(w, 202, map[string]any{"id": uuid.NewString(), "status": "running"})
		case r.URL.Path == "/v1/nodes":
			writeJSON(w, 200, []map[string]any{{"id": "test-node", "runtimes": []map[string]any{{"id": "test-node/test", "provider": "test"}}}})
		case strings.HasSuffix(r.URL.Path, "/events/stream"):
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "id: 1\nevent: relay.event\ndata: {\"id\":\"event-1\",\"sequence\":1,\"type\":\"run.succeeded\"}\n\n")
		case strings.HasSuffix(r.URL.Path, "/events"):
			writeJSON(w, 200, []any{})
		case strings.HasSuffix(r.URL.Path, "/artifacts"):
			id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v1/runs/"), "/artifacts")
			writeJSON(w, 200, []map[string]any{{"id": "artifact-" + id, "name": "report.md", "type": "report", "content_type": "text/markdown", "size": len(content)}})
		case strings.HasPrefix(r.URL.Path, "/v1/artifacts/"):
			fmt.Fprint(w, content)
		case strings.HasPrefix(r.URL.Path, "/v1/runs/"):
			writeJSON(w, 200, map[string]any{"id": strings.TrimPrefix(r.URL.Path, "/v1/runs/"), "status": "succeeded", "result": map[string]string{"summary": "Done"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer relayServer.Close()
	handler := New(st, relayServer.URL, "", relayServer.URL, wid, nil).Handler()
	call := func(method, path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "/api/v1"+path, strings.NewReader(body))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s = %d, want %d: %s", method, path, w.Code, want, w.Body.String())
		}
		return w
	}
	var agent store.Agent
	json.Unmarshal(call("POST", "/agents", `{"name":"Executor","runtimeProvider":"test"}`, 201).Body.Bytes(), &agent)
	var reviewer store.Agent
	json.Unmarshal(call("POST", "/agents", `{"name":"Reviewer","runtimeProvider":"test"}`, 201).Body.Bytes(), &reviewer)
	settingsResponse := call("PUT", "/system/settings", fmt.Sprintf(`{"systemAgentId":%q,"language":"zh-CN"}`, reviewer.ID), 200)
	if !strings.Contains(settingsResponse.Body.String(), `"language":"zh-CN"`) {
		t.Fatalf("system language was not saved: %s", settingsResponse.Body.String())
	}
	var skill store.Skill
	json.Unmarshal(call("POST", "/skills", `{"name":"Careful review","description":"Review changes","content":"Always inspect the complete diff."}`, 201).Body.Bytes(), &skill)
	call("PUT", "/agents/"+reviewer.ID+"/skills", fmt.Sprintf(`{"skillIds":[%q]}`, skill.ID), 200)
	var document store.Document
	json.Unmarshal(call("POST", "/documents", `{"title":"Runbook","url":"https://example.test/runbook","description":"Operations reference"}`, 201).Body.Bytes(), &document)
	var note store.Note
	json.Unmarshal(call("POST", "/notes", `{"title":"Follow up","content":"Check the rollout","tags":["release","release"],"pinned":true}`, 201).Body.Bytes(), &note)
	if skill.ID == "" || document.ID == "" || note.ID == "" || len(note.Tags) != 1 {
		t.Fatalf("library resources were not created: skill=%+v document=%+v note=%+v", skill, document, note)
	}
	var logEntry store.WorkLogEntry
	json.Unmarshal(call("POST", "/work-log/entries", `{"content":"Finished the work log API"}`, 201).Body.Bytes(), &logEntry)
	if logEntry.ID == "" || logEntry.Content != "Finished the work log API" || logEntry.SourceKind != "manual" {
		t.Fatalf("work log entry was not created: %+v", logEntry)
	}
	call("PUT", "/work-log/summaries", `{"periodKind":"week","periodStart":"2026-09-14","content":"Completed the work log API."}`, 200)
	call("PUT", "/work-log/summaries", `{"periodKind":"day","periodStart":"2026-09-19","content":"Daily summaries are not supported."}`, 400)
	var workLog struct {
		Entries   []store.WorkLogEntry   `json:"entries"`
		Summaries []store.WorkLogSummary `json:"summaries"`
	}
	json.Unmarshal(call("GET", "/work-log?since=2026-09-01T00:00:00Z", "", 200).Body.Bytes(), &workLog)
	if len(workLog.Entries) != 1 || len(workLog.Summaries) != 1 {
		t.Fatalf("work log was not returned: %+v", workLog)
	}
	var project store.Project
	json.Unmarshal(call("POST", "/projects", `{"name":"Remote repository","workspaceKind":"local","workspaceSource":"/srv/repository","runtimeId":"test-node/test"}`, 201).Body.Bytes(), &project)
	var started struct{ SessionID, RunID string }
	json.Unmarshal(call("POST", "/chat", fmt.Sprintf(`{"prompt":"Inspect","agentId":%q,"projectId":%q}`, agent.ID, project.ID), 202).Body.Bytes(), &started)
	call("POST", "/chat", fmt.Sprintf(`{"prompt":"Continue","agentId":%q,"sessionId":%q}`, reviewer.ID, started.SessionID), 202)
	call("GET", "/runs/"+started.RunID, "", 200)
	activity := call("POST", "/work-log/activity", `{"from":"2000-01-01T00:00:00Z","to":"2100-01-01T00:00:00Z"}`, 202)
	if !strings.Contains(activity.Body.String(), "runId") {
		t.Fatalf("Agent activity did not start a system run: %s", activity.Body.String())
	}
	var activityRun struct {
		RunID string `json:"runId"`
	}
	json.Unmarshal(activity.Body.Bytes(), &activityRun)
	if activityRun.RunID == "" {
		t.Fatalf("Agent activity returned no durable run: %s", activity.Body.String())
	}
	activeRun := call("GET", "/work-log/activity-run?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z", "", 200)
	if !strings.Contains(activeRun.Body.String(), activityRun.RunID) {
		t.Fatalf("Agent activity run was not recoverable: %s", activeRun.Body.String())
	}
	duplicateActivity := call("POST", "/work-log/activity", `{"from":"2000-01-01T00:00:00Z","to":"2100-01-01T00:00:00Z"}`, 202)
	if !strings.Contains(duplicateActivity.Body.String(), activityRun.RunID) {
		t.Fatalf("Repeated activity request did not reuse the background run: %s", duplicateActivity.Body.String())
	}
	call("DELETE", "/work-log/activity-run/"+activityRun.RunID, "", 204)
	dismissedRun := call("GET", "/work-log/activity-run?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z", "", 200)
	if !strings.Contains(dismissedRun.Body.String(), `"run":null`) {
		t.Fatalf("Acknowledged activity run was still returned: %s", dismissedRun.Body.String())
	}
	weekly := call("POST", "/work-log/weekly-summary", `{"periodStart":"2026-09-14","from":"2026-09-14T00:00:00Z","to":"2026-09-21T00:00:00Z"}`, 202)
	if !strings.Contains(weekly.Body.String(), "runId") {
		t.Fatalf("weekly summary did not start a system run: %s", weekly.Body.String())
	}
	stream := call("GET", "/runs/"+started.RunID+"/events/stream?after=0", "", 200)
	if contentType := stream.Header().Get("Content-Type"); contentType != "text/event-stream" {
		t.Fatalf("stream content type=%q", contentType)
	}
	if body := stream.Body.String(); !strings.Contains(body, "event: relay.event") || !strings.Contains(body, "event: steer.done") {
		t.Fatalf("unexpected stream body: %q", body)
	}
	mu.Lock()
	sent := append([]relay.Request(nil), requests...)
	mu.Unlock()
	if len(sent) != 4 || sent[0].Workspace.Source != "/srv/repository" || sent[1].Workspace.Source != "/srv/repository" || !strings.Contains(sent[0].Input.Prompt, "direct working conversation") {
		t.Fatalf("conversation context not propagated: %+v", sent)
	}
	if sent[1].AgentID != reviewer.ID || sent[1].Runtime.Provider != "test" || sent[1].Runtime.ID != "test-node/test" {
		t.Fatalf("Agent switch not propagated: %+v", sent[1])
	}
	if sent[2].AgentID != reviewer.ID || sent[2].Source.Kind != "steer.system" || sent[3].AgentID != reviewer.ID || sent[3].Source.Kind != "steer.system" {
		t.Fatalf("system Agent not used for AI tasks: %+v", sent[2:])
	}
	if !strings.Contains(sent[2].Input.Prompt, "Original task: Inspect") ||
		!strings.Contains(sent[2].Input.Prompt, "user (complete):\nInspect") ||
		!strings.Contains(sent[2].Input.Prompt, "user (complete):\nContinue") {
		t.Fatalf("today's session messages not propagated to activity summary: %s", sent[2].Input.Prompt)
	}
	if !strings.Contains(sent[2].Input.Prompt, "Simplified Chinese") || !strings.Contains(sent[3].Input.Prompt, "Simplified Chinese") {
		t.Fatalf("system language not propagated to AI tasks: %+v", sent[2:])
	}
	if len(sent[1].Instructions.Agent) != 1 || !strings.Contains(sent[1].Instructions.Agent[0].Content, "Always inspect the complete diff.") {
		t.Fatalf("assigned Skill not propagated: %+v", sent[1].Instructions.Agent)
	}
	call("PUT", "/projects/"+project.ID, `{"name":"Moved repository","workspaceKind":"local","workspaceSource":"/srv/moved","runtimeId":"test-node/test","executionMode":"in_place"}`, 200)
	call("DELETE", "/projects/"+project.ID, "", 200)
	call("POST", "/chat", fmt.Sprintf(`{"prompt":"After deletion","agentId":%q,"sessionId":%q}`, reviewer.ID, started.SessionID), 202)
	mu.Lock()
	sent = append([]relay.Request(nil), requests...)
	mu.Unlock()
	if len(sent) != 3 || sent[2].Workspace.Source != "/srv/repository" {
		t.Fatalf("existing conversation did not retain its Project snapshot: %+v", sent)
	}
	var bootstrap struct {
		Artifacts []store.Artifact `json:"artifacts"`
		Sessions  []store.Session  `json:"sessions"`
		Projects  []store.Project  `json:"projects"`
	}
	json.Unmarshal(call("GET", "/bootstrap", "", 200).Body.Bytes(), &bootstrap)
	if len(bootstrap.Artifacts) != 1 || len(bootstrap.Sessions) != 1 {
		t.Fatalf("incomplete projection: %+v", bootstrap)
	}
	if len(bootstrap.Projects) != 0 {
		t.Fatalf("deleted Project remains visible: %+v", bootstrap.Projects)
	}
	if bootstrap.Sessions[0].AgentID != reviewer.ID {
		t.Fatalf("session did not retain latest Agent: %+v", bootstrap.Sessions[0])
	}
	artifact := bootstrap.Artifacts[0]
	var preview struct {
		Content string `json:"content"`
	}
	json.Unmarshal(call("GET", "/artifacts/"+artifact.ID+"/content", "", 200).Body.Bytes(), &preview)
	if preview.Content != content {
		t.Fatalf("preview was not file content: %q", preview.Content)
	}
	call("DELETE", "/sessions/"+started.SessionID, "", 200)
	call("GET", "/sessions/"+started.SessionID, "", 404)
	json.Unmarshal(call("GET", "/bootstrap", "", 200).Body.Bytes(), &bootstrap)
	if len(bootstrap.Sessions) != 0 || len(bootstrap.Artifacts) != 0 {
		t.Fatalf("deleted conversation remains projected: %+v", bootstrap)
	}
}
