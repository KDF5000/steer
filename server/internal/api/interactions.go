package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
)

// Resolve only an approval belonging to this workspace, Run and live Attempt.
// Session grants live in Steer; Runtime permissions are still granted one at a time.
func (s *Server) resolveRunApproval(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("id")
	link, err := s.store.RunLink(r.Context(), s.workspace(r), runID)
	if err != nil {
		writeError(w, err)
		return
	}
	var input struct {
		Decision string `json:"decision"`
	}
	if err := decodeJSON(r, &input); err != nil || (input.Decision != "allow_once" && input.Decision != "allow_session" && input.Decision != "reject") {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "decision must be allow_once, allow_session or reject"})
		return
	}
	run, err := s.relay.Run(r.Context(), runID)
	if err != nil {
		writeError(w, err)
		return
	}
	if run.Status != relay.RunRunning || run.CancelRequestedAt != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "This task is no longer awaiting approval."})
		return
	}
	items, err := s.relay.Interactions(r.Context(), runID)
	if err != nil {
		writeError(w, err)
		return
	}
	for _, item := range items {
		if item.ID != r.PathValue("interactionID") || item.RunID != runID {
			continue
		}
		if item.State != "pending" || item.Kind != relay.InteractionApproval || item.AttemptID != run.Attempt.ID {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "This approval has already been handled or is no longer active."})
			return
		}
		if input.Decision == "allow_session" && (link.SessionID == nil || *link.SessionID == "") {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "Session approval requires a conversation."})
			return
		}
		raw, ok := approvalResponse(item, input.Decision != "reject")
		if !ok {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "This tool does not offer permission for a single execution."})
			return
		}
		resolved, err := s.relay.ResolveInteraction(r.Context(), item.ID, raw)
		if err != nil {
			// Another browser may have resolved the same request in the meantime.
			writeJSON(w, http.StatusConflict, map[string]string{"error": "Approval could not be submitted. Refresh the task and try again."})
			return
		}
		if input.Decision == "allow_session" {
			if _, err := s.store.SetSessionAutoApproval(r.Context(), s.workspace(r), *link.SessionID, true); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "This operation was approved, but session auto-approval could not be saved. Try again on the next request."})
				return
			}
		}
		writeJSON(w, http.StatusOK, resolved)
		return
	}
	writeError(w, store.ErrNotFound)
}

// Never choose allow_always: its scope and persistence belong to the CLI.
func approvalResponse(item relay.Interaction, allow bool) (json.RawMessage, bool) {
	response := map[string]any{"approved": allow}
	if allow {
		var data struct {
			Options []struct {
				ID   string `json:"optionId"`
				Kind string `json:"kind"`
			} `json:"options"`
		}
		if len(item.Data) > 0 && json.Unmarshal(item.Data, &data) != nil {
			return nil, false
		}
		if len(data.Options) > 0 {
			for _, option := range data.Options {
				if option.Kind == "allow_once" && option.ID != "" {
					response["optionId"] = option.ID
					break
				}
			}
			if response["optionId"] == nil {
				return nil, false
			}
		}
	}
	raw, _ := json.Marshal(response)
	return raw, true
}

func (s *Server) disableSessionAutoApproval(w http.ResponseWriter, r *http.Request) {
	var input struct {
		AutoApprove *bool `json:"autoApprove"`
	}
	if err := decodeJSON(r, &input); err != nil || input.AutoApprove == nil || *input.AutoApprove {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Set autoApprove to false. Enable it from an active approval request."})
		return
	}
	session, err := s.store.SetSessionAutoApproval(r.Context(), s.workspace(r), r.PathValue("id"), false)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, session)
}

func (s *Server) autoApproveRun(ctx context.Context, wid string, run relay.Run, events []relay.Event) (bool, error) {
	if run.Status != relay.RunRunning || run.CancelRequestedAt != nil {
		return false, nil
	}
	pending := map[string]bool{}
	for _, event := range events {
		var data struct {
			ID            string `json:"id"`
			InteractionID string `json:"interaction_id"`
			Kind          string `json:"kind"`
		}
		if event.Type == "interaction.requested" && event.AttemptID == run.Attempt.ID {
			_ = json.Unmarshal(event.Data, &data)
			if data.Kind == "approval" {
				pending[data.ID] = true
			}
		} else if event.Type == "interaction.resolved" {
			_ = json.Unmarshal(event.Data, &data)
			delete(pending, data.InteractionID)
		}
	}
	if len(pending) == 0 {
		return false, nil
	}
	link, err := s.store.RunLink(ctx, wid, run.ID)
	if err != nil {
		return false, err
	}
	if link.SessionID == nil {
		return false, nil
	}
	session, err := s.store.Session(ctx, wid, *link.SessionID)
	if err != nil || !session.AutoApprove {
		return false, err
	}
	ctx, stop := context.WithTimeout(ctx, 5*time.Second)
	defer stop()
	resolved := false
	err = s.store.WithSessionAutoApproval(ctx, wid, session.ID, func() error {
		live, err := s.relay.Run(ctx, run.ID)
		if err != nil {
			return err
		}
		if live.Status != relay.RunRunning || live.CancelRequestedAt != nil || live.Attempt.ID != run.Attempt.ID {
			return nil
		}
		items, err := s.relay.Interactions(ctx, run.ID)
		if err != nil {
			return err
		}
		for _, item := range items {
			if !pending[item.ID] || item.RunID != run.ID || item.AttemptID != live.Attempt.ID || item.Kind != relay.InteractionApproval {
				continue
			}
			// A polling worker can resolve this request before the stream acquires
			// the policy lock. Treat it as handled so the stale pending event is
			// not presented to the user again.
			if item.State == "resolved" {
				resolved = true
				continue
			}
			if item.State != "pending" {
				continue
			}
			response, ok := approvalResponse(item, true)
			if !ok {
				continue
			}
			if _, err := s.relay.ResolveInteraction(ctx, item.ID, response); err != nil {
				return fmt.Errorf("auto-approve tool request: %w", err)
			}
			resolved = true
		}
		return nil
	})
	return resolved, err
}
