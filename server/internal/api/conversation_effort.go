package api

import (
	"context"
	"net/http"
	"strings"

	"github.com/KDF5000/relay/controlplane"
	"github.com/KDF5000/steer/server/internal/store"
)

// Effort is tied to the selected Agent/model. Empty means use Runtime/model defaults.
func conversationEffort(session store.Session, agent store.Agent, requestedModel, requested *string, delegated bool) *string {
	if delegated {
		return nil
	}
	if requested != nil {
		effort := strings.TrimSpace(*requested)
		if effort != "" {
			return &effort
		}
		return nil
	}
	if session.AgentID != agent.ID {
		return nil
	}
	if requestedModel != nil {
		_, before := conversationModel(session, agent, nil, false)
		_, after := conversationModel(session, agent, requestedModel, false)
		if before != after {
			return nil
		}
	}
	return session.ReasoningEffort
}

func (s *Server) validateReasoningEffort(ctx context.Context, wid, runtimeID, model, effort string) error {
	switch effort {
	case "none", "minimal", "low", "medium", "high", "xhigh", "max":
	default:
		return taskRequestError{Status: http.StatusBadRequest, Message: "Invalid reasoning Effort"}
	}
	// runtimeID has already been resolved against Workspace bindings by submission.
	nodes, err := s.relay.Nodes(ctx)
	if err != nil {
		return err
	}
	for _, node := range nodes {
		for _, runtime := range node.Runtimes {
			if runtime.ID == runtimeID {
				return validateRuntimeEffort(runtime, model, effort)
			}
		}
	}
	return taskRequestError{Status: http.StatusConflict, Message: "Runtime is unavailable; refresh before selecting Effort"}
}

func validateRuntimeEffort(runtime controlplane.Runtime, model, effort string) error {
	if !runtime.SupportsReasoningEffort {
		return taskRequestError{Status: http.StatusConflict, Message: "This Relay Node needs an upgrade to support task Effort"}
	}
	if model == "" {
		model = runtime.DefaultModel
	}
	for _, item := range runtime.ModelCatalog {
		if item.ID != model {
			continue
		}
		for _, option := range item.SupportedReasoningEfforts {
			if option.Effort == effort {
				return nil
			}
		}
		break
	}
	return taskRequestError{Status: http.StatusBadRequest, Message: "The selected model does not support this Effort; refresh its model list"}
}
