package api

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/KDF5000/relay/controlplane"
	"github.com/KDF5000/steer/server/internal/store"
)

func TestConversationEffort(t *testing.T) {
	model, saved, requested, reset, changed := "model", "high", "low", "", "other-model"
	agent := store.Agent{ID: "owner", Model: &model}
	session := store.Session{AgentID: agent.ID, ReasoningEffort: &saved}
	for _, test := range []struct {
		name, agentID string
		model, effort *string
		delegated     bool
		want          string
	}{
		{"preserve", "owner", nil, nil, false, "high"},
		{"explicit", "owner", nil, &requested, false, "low"},
		{"default", "owner", nil, &reset, false, ""},
		{"switch Agent", "other", nil, nil, false, ""},
		{"switch model", "owner", &changed, nil, false, ""},
		{"same model", "owner", &model, nil, false, "high"},
		{"delegation", "owner", nil, &requested, true, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			target := agent
			target.ID = test.agentID
			got := conversationEffort(session, target, test.model, test.effort, test.delegated)
			if value(got) != test.want {
				t.Fatalf("effort=%v want %q", got, test.want)
			}
		})
	}
}

func TestDecodeConversationEffort(t *testing.T) {
	for _, effort := range []string{"high", ""} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		_ = writer.WriteField("reasoningEffort", effort)
		_ = writer.Close()
		req := httptest.NewRequest("POST", "/tasks", &body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		in, _, err := decodeChatRequest(httptest.NewRecorder(), req)
		if err != nil || in.ReasoningEffort == nil || *in.ReasoningEffort != effort {
			t.Fatalf("in=%+v err=%v", in, err)
		}
	}
	req := httptest.NewRequest("POST", "/tasks", strings.NewReader(`{"reasoningEffort":"xhigh"}`))
	in, _, err := decodeChatRequest(httptest.NewRecorder(), req)
	if err != nil || value(in.ReasoningEffort) != "xhigh" {
		t.Fatalf("in=%+v err=%v", in, err)
	}
}

func TestValidateRuntimeEffort(t *testing.T) {
	runtime := controlplane.Runtime{SupportsReasoningEffort: true, DefaultModel: "gpt", ModelCatalog: []controlplane.RuntimeModel{{ID: "gpt", SupportedReasoningEfforts: []controlplane.ReasoningEffortOption{{Effort: "xhigh"}}}, {ID: "seed"}}}
	if err := validateRuntimeEffort(runtime, "", "xhigh"); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ model, effort string }{{"gpt", "max"}, {"seed", "xhigh"}, {"unknown", "high"}} {
		if err := validateRuntimeEffort(runtime, test.model, test.effort); err == nil {
			t.Fatalf("accepted unsupported Effort %+v", test)
		}
	}
	runtime.SupportsReasoningEffort = false
	if err := validateRuntimeEffort(runtime, "gpt", "xhigh"); err == nil {
		t.Fatal("accepted unsupported Node")
	}
}
