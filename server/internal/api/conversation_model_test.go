package api

import (
	"bytes"
	"github.com/KDF5000/steer/server/internal/store"
	"mime/multipart"
	"net/http/httptest"
	"testing"
)

func TestConversationModel(t *testing.T) {
	defaultModel, saved, requested, reset := "default", "saved", "selected", ""
	agent := store.Agent{ID: "owner", Model: &defaultModel}
	session := store.Session{AgentID: agent.ID, ModelOverride: &saved}
	for _, test := range []struct {
		name       string
		agentID    string
		requested  *string
		delegated  bool
		model      string
		overridden bool
	}{
		{"omitted preserves saved override", "owner", nil, false, "saved", true},
		{"explicit overrides saved", "owner", &requested, false, "selected", true},
		{"empty restores default", "owner", &reset, false, "default", false},
		{"different role follows default", "other", nil, false, "default", false},
		{"delegation ignores parent model", "owner", &requested, true, "default", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			selected := agent
			selected.ID = test.agentID
			override, model := conversationModel(session, selected, test.requested, test.delegated)
			if model != test.model || (override != nil) != test.overridden {
				t.Fatalf("model=%q override=%v", model, override)
			}
		})
	}
}

func TestMultipartConversationModel(t *testing.T) {
	for _, model := range []string{"selected-model", ""} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		_ = writer.WriteField("prompt", "Continue")
		_ = writer.WriteField("agentId", "owner")
		_ = writer.WriteField("model", model)
		_ = writer.Close()
		r := httptest.NewRequest("POST", "/api/v1/tasks", &body)
		r.Header.Set("Content-Type", writer.FormDataContentType())
		input, _, err := decodeChatRequest(httptest.NewRecorder(), r)
		if err != nil || input.Model == nil || *input.Model != model {
			t.Fatalf("model=%q input=%+v err=%v", model, input, err)
		}
	}
}
