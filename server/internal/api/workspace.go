package api

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
)

// Authorize via Steer's run link before forwarding a read-only node inspection.
func (s *Server) inspectWorkspace(w http.ResponseWriter, r *http.Request) {
	if _, err := s.store.RunLink(r.Context(), s.workspace(r), r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	operation := r.URL.Query().Get("operation")
	if operation != "read" && operation != "list" && operation != "diff" && operation != "git-status" {
		writeJSON(w, 400, map[string]string{"error": "invalid workspace operation"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	endpoint := strings.TrimRight(s.relayHTTP.BaseURL, "/") + "/v1/runs/" + url.PathEscape(r.PathValue("id")) + "/workspace?operation=" + url.QueryEscape(operation) + "&path=" + url.QueryEscape(r.URL.Query().Get("path"))
	request, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	request.Header.Set("Authorization", "Bearer "+s.relayHTTP.Token)
	response, err := s.relayHTTP.HTTP.Do(request)
	if err != nil {
		writeError(w, err)
		return
	}
	defer response.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(response.Body, 4<<20))
}

func (s *Server) projectGitStatus(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	project, err := s.store.Project(r.Context(), wid, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	nodeID, err := s.projectInspectionNodeID(r.Context(), wid, project)
	if err != nil {
		if errors.Is(err, errProjectWorkspaceUnavailable) {
			writeJSON(w, http.StatusConflict, map[string]string{
				"error": "No current Runtime is available for this Project. Bind the Project or its Agent to a Runtime and try again.",
				"code":  "project_workspace_unavailable",
			})
			return
		}
		writeError(w, err)
		return
	}
	workspace := relay.WorkspaceSpec{
		Kind:      project.WorkspaceKind,
		Source:    project.WorkspaceSource,
		Ref:       value(project.WorkspaceRef),
		Subdir:    value(project.WorkspaceSubdir),
		Ephemeral: project.WorkspaceKind != "local",
	}
	s.inspectNodeWorkspace(w, r, nodeID, workspace, "git-status", "")
}

var errProjectWorkspaceUnavailable = errors.New("project workspace unavailable on current Runtime")

// projectInspectionNodeID resolves the current physical Node without relying
// on an earlier Run. The Project binding is authoritative; legacy Projects
// without one inherit the Runtime of their most recently created conversation.
func (s *Server) projectInspectionNodeID(ctx context.Context, wid string, project store.Project) (string, error) {
	if nodeID := strings.TrimSpace(value(project.NodeID)); nodeID != "" {
		nodes, err := s.workspaceNodes(ctx, wid)
		if err != nil {
			return "", err
		}
		for _, node := range nodes {
			if node.ID == nodeID && len(node.Runtimes) > 0 {
				return nodeID, nil
			}
		}
		return "", errProjectWorkspaceUnavailable
	}
	runtimeID := strings.TrimSpace(value(project.RuntimeID))
	if runtimeID == "" {
		agentID, agentErr := s.store.LatestProjectAgentID(ctx, wid, project.ID)
		if agentErr != nil {
			if errors.Is(agentErr, store.ErrNotFound) {
				return "", errProjectWorkspaceUnavailable
			}
			return "", agentErr
		}
		agent, agentErr := s.store.Agent(ctx, wid, agentID)
		if agentErr != nil {
			return "", agentErr
		}
		runtimeID = strings.TrimSpace(value(agent.RuntimeID))
		if runtimeID == "" {
			return "", errProjectWorkspaceUnavailable
		}
	}
	physicalRuntimeID, err := s.physicalRuntimeID(ctx, wid, runtimeID)
	if err != nil {
		return "", err
	}
	nodeID := runtimeNodeID(physicalRuntimeID)
	if nodeID == "" {
		return "", errProjectWorkspaceUnavailable
	}
	return nodeID, nil
}

func runtimeNodeID(runtimeID string) string {
	index := strings.LastIndex(strings.TrimSpace(runtimeID), "/")
	if index <= 0 {
		return ""
	}
	return runtimeID[:index]
}

func (s *Server) inspectNodeWorkspace(w http.ResponseWriter, r *http.Request, nodeID string, workspace relay.WorkspaceSpec, operation, path string) {
	workspaceJSON, err := json.Marshal(workspace)
	if err != nil {
		writeError(w, err)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	endpoint := strings.TrimRight(s.relayHTTP.BaseURL, "/") + "/v1/nodes/" + url.PathEscape(nodeID) + "/workspace?operation=" + url.QueryEscape(operation) + "&path=" + url.QueryEscape(path) + "&workspace=" + url.QueryEscape(string(workspaceJSON))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		writeError(w, err)
		return
	}
	request.Header.Set("Authorization", "Bearer "+s.relayHTTP.Token)
	response, err := s.relayHTTP.HTTP.Do(request)
	if err != nil {
		writeError(w, err)
		return
	}
	defer response.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(response.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(response.Body, 4<<20))
}
