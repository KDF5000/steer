package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func TestRunApprovalOwnershipAndSingleUse(t *testing.T) {
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
	wid := "approval-" + uuid.NewString()
	if err := st.EnsureWorkspace(ctx, wid, "Approval test"); err != nil {
		t.Fatal(err)
	}
	agent, err := st.CreateAgent(ctx, wid, store.Agent{Name: "Test", RuntimeProvider: "antigravity"})
	if err != nil {
		t.Fatal(err)
	}
	sessionID := uuid.NewString()
	if _, err := st.EnsureSession(ctx, wid, sessionID, "Test", agent.ID, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	runID := uuid.NewString()
	if _, _, err := st.SaveChatRun(ctx, wid, sessionID, agent.ID, "test", runID, "running"); err != nil {
		t.Fatal(err)
	}
	run := relay.Run{ID: runID, Status: relay.RunRunning, Attempt: relay.Attempt{ID: "live"}}
	item := relay.Interaction{ID: "approval", RunID: runID, AttemptID: "live", Kind: relay.InteractionApproval, State: "pending", Data: json.RawMessage(`{"options":[{"kind":"allow_always","optionId":"always"},{"kind":"allow_once","optionId":"once"}]}`)}
	var responses []json.RawMessage
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/runs/" + runID:
			writeJSON(w, 200, run)
		case "/v1/runs/" + runID + "/events/stream":
			w.Header().Set("Content-Type", "text/event-stream")
			events := []relay.Event{
				{Sequence: 1, RunID: runID, AttemptID: "live", Type: "interaction.requested", Data: json.RawMessage(`{"id":"approval","kind":"approval","state":"pending"}`)},
				{Sequence: 2, RunID: runID, AttemptID: "live", Type: "run.succeeded"},
			}
			for _, event := range events {
				raw, _ := json.Marshal(event)
				fmt.Fprintf(w, "id: %d\nevent: relay.event\ndata: %s\n\n", event.Sequence, raw)
			}
		case "/v1/runs/" + runID + "/interactions":
			writeJSON(w, 200, []relay.Interaction{item})
		case "/v1/interactions/approval/resolve":
			var body struct {
				Response json.RawMessage `json:"response"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			responses = append(responses, body.Response)
			item.State = "resolved"
			writeJSON(w, 200, item)
		default:
			t.Errorf("unexpected upstream call %s", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer upstream.Close()
	handler := New(st, upstream.URL, "", upstream.URL, wid, nil).Handler()
	call := func(id, interactionID, body string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodPost, "/api/v1/runs/"+id+"/interactions/"+interactionID+"/resolve", strings.NewReader(body))
		out := httptest.NewRecorder()
		handler.ServeHTTP(out, r)
		return out
	}
	for _, test := range []struct {
		name, id, interactionID, body string
		status                        int
	}{
		{"foreign Run", "not-in-workspace", "approval", `{"decision":"allow_once"}`, 404},
		{"foreign approval", runID, "other", `{"decision":"allow_once"}`, 404},
		{"persistent approval", runID, "approval", `{"decision":"allow_always"}`, 400},
		{"malformed", runID, "approval", `{`, 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			out := call(test.id, test.interactionID, test.body)
			if out.Code != test.status {
				t.Fatalf("%d: %s", out.Code, out.Body.String())
			}
		})
	}
	item.AttemptID = "old"
	if out := call(runID, "approval", `{"decision":"allow_once"}`); out.Code != 409 {
		t.Fatalf("stale approval: %d", out.Code)
	}
	item.AttemptID = "live"
	run.Status = relay.RunCancelled
	if out := call(runID, "approval", `{"decision":"allow_once"}`); out.Code != 409 {
		t.Fatalf("terminal approval: %d", out.Code)
	}
	run.Status = relay.RunRunning
	item.Data = json.RawMessage(`{"options":[{"kind":"allow_always","optionId":"always"}]}`)
	if out := call(runID, "approval", `{"decision":"allow_once"}`); out.Code != 409 {
		t.Fatal("persistent-only permission was accepted")
	}
	item.Data = json.RawMessage(`{"options":[{"kind":"allow_always","optionId":"always"},{"kind":"allow_once","optionId":"once"}]}`)
	if len(responses) != 0 {
		t.Fatal("invalid requests reached resolve")
	}
	if out := call(runID, "approval", `{"decision":"allow_once"}`); out.Code != 200 {
		t.Fatalf("allow: %d %s", out.Code, out.Body.String())
	}
	var answer map[string]any
	if err := json.Unmarshal(responses[0], &answer); err != nil {
		t.Fatal(err)
	}
	if answer["approved"] != true || answer["optionId"] != "once" {
		t.Fatalf("wrong grant: %s", responses[0])
	}
	if out := call(runID, "approval", `{"decision":"reject"}`); out.Code != 409 || len(responses) != 1 {
		t.Fatal("duplicate resolution accepted")
	}
	item.State = "pending"
	if out := call(runID, "approval", `{"decision":"reject"}`); out.Code != 200 {
		t.Fatalf("deny: %d", out.Code)
	}
	answer = nil
	if err := json.Unmarshal(responses[1], &answer); err != nil {
		t.Fatal(err)
	}
	if answer["approved"] != false || answer["optionId"] != nil {
		t.Fatal("denial granted permission")
	}
	saved, err := st.Session(ctx, wid, sessionID)
	if err != nil || saved.AutoApprove {
		t.Fatal("one-time decisions enabled session approval")
	}
	item.State = "pending"
	if out := call(runID, "approval", `{"decision":"allow_session"}`); out.Code != 200 {
		t.Fatalf("session grant: %d %s", out.Code, out.Body.String())
	}
	saved, err = st.Session(ctx, wid, sessionID)
	if err != nil || !saved.AutoApprove {
		t.Fatal("session approval not persisted")
	}
	// Ensuring a session for a later turn must retain its policy.
	saved, err = st.EnsureSession(ctx, wid, sessionID, "next turn", agent.ID, nil, nil, nil, nil)
	if err != nil || !saved.AutoApprove {
		t.Fatal("later turn lost policy")
	}
	delegated, err := st.EnsureSession(ctx, wid, uuid.NewString(), "Delegated", agent.ID, nil, nil, nil, nil)
	if err != nil || delegated.AutoApprove {
		t.Fatal("new/delegated session inherited policy")
	}
	item.State = "pending"
	events := []relay.Event{{Type: "interaction.requested", AttemptID: "live", Data: json.RawMessage(`{"id":"approval","kind":"approval"}`)}}
	restarted := New(st, upstream.URL, "", upstream.URL, wid, nil)
	before := len(responses)
	if approved, err := restarted.autoApproveRun(ctx, wid, run, events); err != nil || !approved || len(responses) != before+1 {
		t.Fatalf("background approval: %v %v", approved, err)
	}
	if approved, err := restarted.autoApproveRun(ctx, wid, run, events); err != nil || !approved || len(responses) != before+1 {
		t.Fatal("replayed approval resolved twice")
	}
	// A live request must be approved before it can become a UI action.
	item.State = "pending"
	before = len(responses)
	stream := httptest.NewRecorder()
	handler.ServeHTTP(stream, httptest.NewRequest(http.MethodGet, "/api/v1/runs/"+runID+"/events/stream", nil))
	if stream.Code != 200 || strings.Contains(stream.Body.String(), "interaction.requested") || !strings.Contains(stream.Body.String(), "run.succeeded") || len(responses) != before+1 {
		t.Fatalf("live stream leaked pending auto-approval: %s", stream.Body.String())
	}
	stream = httptest.NewRecorder()
	handler.ServeHTTP(stream, httptest.NewRequest(http.MethodGet, "/api/v1/runs/"+runID+"/events/stream", nil))
	if strings.Contains(stream.Body.String(), "interaction.requested") || len(responses) != before+1 {
		t.Fatal("a polling/stream race leaked a resolved request or granted twice")
	}
	item.State = "pending"
	item.AttemptID = "old"
	if approved, err := restarted.autoApproveRun(ctx, wid, run, events); err != nil || approved {
		t.Fatal("auto-approved a stale Attempt")
	}
	item.AttemptID = "live"
	item.Kind = relay.InteractionInput
	if approved, err := restarted.autoApproveRun(ctx, wid, run, events); err != nil || approved {
		t.Fatal("auto-approved user input")
	}
	item.Kind = relay.InteractionApproval
	// Another conversation, even with the same Agent, has no grant.
	childRunID := uuid.NewString()
	if _, _, err := st.SaveChatRun(ctx, wid, delegated.ID, agent.ID, "test", childRunID, "running"); err != nil {
		t.Fatal(err)
	}
	if approved, err := restarted.autoApproveRun(ctx, wid, relay.Run{ID: childRunID, Status: relay.RunRunning, Attempt: run.Attempt}, events); err != nil || approved {
		t.Fatal("child conversation used parent policy")
	}
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/sessions/"+sessionID+"/approval-policy", strings.NewReader(`{"autoApprove":false}`))
	out := httptest.NewRecorder()
	handler.ServeHTTP(out, req)
	if out.Code != 200 {
		t.Fatalf("disable: %d %s", out.Code, out.Body.String())
	}
	if approved, err := restarted.autoApproveRun(ctx, wid, run, events); err != nil || approved {
		t.Fatal("disabled session still auto-approved")
	}
	stream = httptest.NewRecorder()
	before = len(responses)
	handler.ServeHTTP(stream, httptest.NewRequest(http.MethodGet, "/api/v1/runs/"+runID+"/events/stream", nil))
	if !strings.Contains(stream.Body.String(), "interaction.requested") || len(responses) != before {
		t.Fatal("disabled policy hid a manual approval")
	}
	if saved, err := st.Session(ctx, wid, sessionID); err != nil || saved.AutoApprove {
		t.Fatal("disable not persisted")
	}

}
