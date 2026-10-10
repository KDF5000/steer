package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/jackc/pgx/v5/pgconn"
)

type integrationInput struct {
	Name      string  `json:"name"`
	AppID     string  `json:"appId"`
	AppSecret string  `json:"appSecret"`
	AgentID   string  `json:"agentId"`
	ProjectID *string `json:"projectId"` // Accepted for compatibility; Projects are bound per conversation.
	Enabled   *bool   `json:"enabled"`
}

func (s *Server) listIntegrations(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.WorkspaceIntegrations(r.Context(), s.workspace(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) validateIntegrationInput(r *http.Request, input *integrationInput, existing *store.WorkspaceIntegration) ([]byte, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.AppID = strings.TrimSpace(input.AppID)
	input.AppSecret = strings.TrimSpace(input.AppSecret)
	input.AgentID = strings.TrimSpace(input.AgentID)
	if input.Name == "" || input.AppID == "" || input.AgentID == "" {
		return nil, taskRequestError{Status: http.StatusBadRequest, Message: "name, appId, and agentId are required"}
	}
	if _, err := s.store.Agent(r.Context(), s.workspace(r), input.AgentID); err != nil {
		return nil, err
	}
	input.ProjectID = nil
	if input.AppSecret == "" {
		if existing == nil {
			return nil, taskRequestError{Status: http.StatusBadRequest, Message: "appSecret is required"}
		}
		return existing.EncryptedCredentials, nil
	}
	return s.encryptCredential(input.AppSecret)
}

func (s *Server) createFeishuIntegration(w http.ResponseWriter, r *http.Request) {
	var input integrationInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	credentials, err := s.validateIntegrationInput(r, &input, nil)
	if err != nil {
		writeTaskError(w, err)
		return
	}
	enabled := true
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	status := "connecting"
	if !enabled {
		status = "disabled"
	}
	created, err := s.store.CreateWorkspaceIntegration(r.Context(), store.WorkspaceIntegration{
		WorkspaceID: s.workspace(r), Provider: "feishu", Name: input.Name, ExternalAppID: input.AppID,
		EncryptedCredentials: credentials, AgentID: input.AgentID, ProjectID: nil,
		Enabled: enabled, Status: status, CreatedByUserID: userFromContext(r.Context()).ID,
	})
	if err != nil {
		writeIntegrationError(w, err)
		return
	}
	if enabled {
		s.integrations.Restart(created.ID)
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) updateIntegration(w http.ResponseWriter, r *http.Request) {
	existing, err := s.store.WorkspaceIntegration(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	var input integrationInput
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	credentials, err := s.validateIntegrationInput(r, &input, &existing)
	if err != nil {
		writeTaskError(w, err)
		return
	}
	enabled := existing.Enabled
	if input.Enabled != nil {
		enabled = *input.Enabled
	}
	bindingChanged := existing.ExternalAppID != input.AppID || existing.AgentID != input.AgentID
	existing.Name, existing.ExternalAppID, existing.EncryptedCredentials = input.Name, input.AppID, credentials
	existing.AgentID, existing.ProjectID, existing.Enabled = input.AgentID, nil, enabled
	existing.Status = "connecting"
	if !enabled {
		existing.Status = "disabled"
	}
	updated, err := s.store.UpdateWorkspaceIntegration(r.Context(), existing)
	if err != nil {
		writeIntegrationError(w, err)
		return
	}
	if bindingChanged {
		if err := s.store.ResetIntegrationConversations(r.Context(), existing.ID); err != nil {
			writeError(w, err)
			return
		}
	}
	s.integrations.Restart(updated.ID)
	writeJSON(w, http.StatusOK, updated)
}

func writeIntegrationError(w http.ResponseWriter, err error) {
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "23505" &&
		(postgresError.ConstraintName == "workspace_integrations_provider_app_lower_idx" ||
			postgresError.ConstraintName == "workspace_integrations_provider_app_idx") {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "This Feishu app is already connected to a workspace."})
		return
	}
	writeError(w, err)
}

func (s *Server) deleteIntegration(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if _, err := s.store.WorkspaceIntegration(r.Context(), s.workspace(r), id); err != nil {
		writeError(w, err)
		return
	}
	s.integrations.Stop(id)
	if err := s.store.DeleteWorkspaceIntegration(r.Context(), s.workspace(r), id); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) reconnectIntegration(w http.ResponseWriter, r *http.Request) {
	item, err := s.store.WorkspaceIntegration(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	if !item.Enabled {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "Enable the integration before reconnecting."})
		return
	}
	if s.credentialCipher == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "Credential encryption is not configured."})
		return
	}
	_ = s.store.SetIntegrationStatus(r.Context(), item.ID, "connecting", false, nil)
	item.Status = "connecting"
	item.LastError = nil
	s.integrations.Restart(item.ID)
	writeJSON(w, http.StatusAccepted, item)
}
