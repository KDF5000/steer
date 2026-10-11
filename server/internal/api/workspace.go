package api

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

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
	runID, err := s.projectInspectionRunID(r.Context(), wid, project)
	if err != nil {
		if errors.Is(err, errProjectWorkspaceUnavailable) {
			writeJSON(w, http.StatusConflict, map[string]string{
				"error": "No workspace is available on the project's current Runtime yet. Run a task in this Project and try again.",
				"code":  "project_workspace_unavailable",
			})
			return
		}
		writeError(w, err)
		return
	}
	r.SetPathValue("id", runID)
	query := r.URL.Query()
	query.Set("operation", "git-status")
	query.Del("path")
	r.URL.RawQuery = query.Encode()
	s.inspectWorkspace(w, r)
}

var errProjectWorkspaceUnavailable = errors.New("project workspace unavailable on current Runtime")

// projectInspectionRunID keeps directory inspection on the Project's current
// machine. A Relay workspace belongs to the Node that prepared its run, so a
// historical run from a replaced/offline Node must never be used merely
// because it was the Project's last execution.
func (s *Server) projectInspectionRunID(ctx context.Context, wid string, project store.Project) (string, error) {
	links, err := s.store.ProjectRunLinks(ctx, wid, project.ID)
	if err != nil {
		return "", err
	}
	if project.WorkspaceKind != "local" {
		return links[0].RelayRunID, nil
	}

	runtimeID := strings.TrimSpace(value(project.RuntimeID))
	if runtimeID == "" {
		agent, agentErr := s.store.Agent(ctx, wid, links[0].AgentID)
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
	targetNodeID := runtimeNodeID(physicalRuntimeID)
	if targetNodeID == "" {
		return "", errProjectWorkspaceUnavailable
	}
	for _, link := range links {
		run, runErr := s.relay.GetRun(ctx, link.RelayRunID)
		if runErr != nil {
			return "", runErr
		}
		nodeID := strings.TrimSpace(run.Attempt.NodeID)
		if nodeID == "" {
			nodeID = runtimeNodeID(run.Runtime.ID)
		}
		if nodeID == targetNodeID {
			return link.RelayRunID, nil
		}
	}
	return "", errProjectWorkspaceUnavailable
}

func runtimeNodeID(runtimeID string) string {
	index := strings.LastIndex(strings.TrimSpace(runtimeID), "/")
	if index <= 0 {
		return ""
	}
	return runtimeID[:index]
}
