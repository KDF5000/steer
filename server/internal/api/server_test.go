package api

import (
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
)

func TestSubmitReusableRunAddsGenericWorkspaceLifecycle(t *testing.T) {
	var received map[string]any
	relayServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Fatal(err)
		}
		writeJSON(w, http.StatusAccepted, map[string]any{"id": "run-1", "status": "queued"})
	}))
	defer relayServer.Close()
	server := New(nil, relayServer.URL, "token", relayServer.URL, "workspace", nil)
	run, err := server.submitReusableRun(context.Background(), relay.Request{
		AgentID:        "agent-1",
		IdempotencyKey: "request-1",
		Runtime:        relay.RuntimeRequirement{ID: "node/codex", Provider: "codex"},
		Workspace:      relay.WorkspaceSpec{Kind: "git", Source: "https://example.test/repo.git", Ref: "main"},
	}, "opaque-key", "steer/session-1")
	if err != nil || run.ID != "run-1" {
		t.Fatalf("run=%+v err=%v", run, err)
	}
	workspaceValue, ok := received["workspace"].(map[string]any)
	if !ok {
		t.Fatalf("workspace=%#v", received["workspace"])
	}
	if workspaceValue["lifecycle"] != "reusable" || workspaceValue["reuse_key"] != "opaque-key" || workspaceValue["branch"] != "steer/session-1" {
		t.Fatalf("workspace=%#v", workspaceValue)
	}
}

func TestDecodeChatRequestAcceptsImageUpload(t *testing.T) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("prompt", "What is in this image?")
	_ = writer.WriteField("agentId", "agent-1")
	part, err := writer.CreateFormFile("images", "screen.png")
	if err != nil {
		t.Fatal(err)
	}
	// A PNG signature is sufficient for net/http content detection.
	_, _ = part.Write(append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 32)...))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/api/v1/chat", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	in, attachments, err := decodeChatRequest(httptest.NewRecorder(), request)
	if err != nil {
		t.Fatal(err)
	}
	if in.Prompt != "What is in this image?" || in.AgentID != "agent-1" || len(attachments) != 1 {
		t.Fatalf("input=%+v attachments=%+v", in, attachments)
	}
	if attachments[0].Name != "screen.png" || attachments[0].ContentType != "image/png" || len(attachments[0].Content) == 0 {
		t.Fatalf("attachment=%+v", attachments[0])
	}
}

func TestConversationPrompt(t *testing.T) {
	items := []store.Message{
		{Role: "user", Content: "first", Status: "complete"},
		{Role: "agent", Content: "second", Status: "succeeded"},
		{Role: "agent", Content: "ignored", Status: "running"},
	}
	got := conversationPrompt(items, "third")
	for _, want := range []string{"User: first", "Assistant: second", "User: third"} {
		if !strings.Contains(got, want) {
			t.Fatalf("prompt %q does not contain %q", got, want)
		}
	}
	if strings.Contains(got, "ignored") {
		t.Fatalf("prompt contains unfinished output: %q", got)
	}
	for _, want := range []string{"direct working conversation", "selected project as execution context", "durable artifact only"} {
		if !strings.Contains(got, want) {
			t.Fatalf("prompt %q does not contain %q", got, want)
		}
	}
}

func TestDeliverableArtifactExcludesRuntimeMessages(t *testing.T) {
	for _, artifact := range []relay.Artifact{
		{Type: "codex_final_message", Name: "codex-last-message.txt"},
		{Type: "trae_final_message", Name: "trae-last-message.txt"},
		{Type: "instruction_file", Name: "AGENTS.md"},
	} {
		if isDeliverableArtifact(artifact) {
			t.Fatalf("runtime artifact treated as deliverable: %+v", artifact)
		}
	}
	if !isDeliverableArtifact(relay.Artifact{Type: "report", Name: "research.md"}) {
		t.Fatal("real report was filtered out")
	}
}

func TestAssistantContentPrefersCompletedMessage(t *testing.T) {
	events := []relay.Event{
		{Sequence: 1, Type: "assistant.message.delta", Data: json.RawMessage(`{"delta":"Hel"}`)},
		{Sequence: 2, Type: "assistant.message.delta", Data: json.RawMessage(`{"delta":"lo"}`)},
		{Sequence: 3, Type: "assistant.message.completed", Data: json.RawMessage(`{"text":"Hello!"}`)},
	}
	content, sequence := assistantContent(events)
	if content != "Hello!" || sequence != 3 {
		t.Fatalf("got content=%q sequence=%d", content, sequence)
	}
}

func TestAssistantContentUsesLastRuntimeAgentMessage(t *testing.T) {
	events := []relay.Event{
		{Sequence: 1, Type: "runtime.trae.item.agentMessage.delta", Data: json.RawMessage(`{"itemId":"progress","delta":"Let me inspect "}`)},
		{Sequence: 2, Type: "runtime.trae.item.agentMessage.delta", Data: json.RawMessage(`{"itemId":"progress","delta":"the code."}`)},
		{Sequence: 3, Type: "runtime.trae.item.agentMessage.delta", Data: json.RawMessage(`{"itemId":"final","delta":"The fix "}`)},
		{Sequence: 4, Type: "runtime.trae.item.agentMessage.delta", Data: json.RawMessage(`{"itemId":"final","delta":"is complete."}`)},
	}
	content, sequence := assistantContent(events)
	if content != "The fix is complete." || sequence != 4 {
		t.Fatalf("content=%q sequence=%d", content, sequence)
	}
}

func TestVisibleAssistantContentHidesProgressAndKeepsOnlyFinalMessage(t *testing.T) {
	events := []relay.Event{
		{Sequence: 1, Type: "assistant.message.completed", Data: json.RawMessage(`{"text":"Let me inspect the code."}`)},
		{Sequence: 2, Type: "assistant.message.completed", Data: json.RawMessage(`{"text":"The fix is complete."}`)},
	}
	result := &relay.Result{Summary: "Let me inspect the code.The fix is complete."}

	running, _ := visibleAssistantContent(relay.RunRunning, events, result)
	if running != "" {
		t.Fatalf("running content=%q, want hidden progress", running)
	}

	completed, sequence := visibleAssistantContent(relay.RunSucceeded, events, result)
	if completed != "The fix is complete." || sequence != 2 {
		t.Fatalf("completed content=%q sequence=%d", completed, sequence)
	}
}

func TestVisibleAssistantContentFallsBackToRuntimeSummary(t *testing.T) {
	result := &relay.Result{Summary: "Final response"}
	content, _ := visibleAssistantContent(relay.RunSucceeded, nil, result)
	if content != "Final response" {
		t.Fatalf("content=%q", content)
	}
}
