package api

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
)

// Shared workflows expose display metadata, never instructions, Skills or
// connection/Runtime configuration. Reads do not trigger sync or MR writeback.
type sharedWorkflowView struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	RepoID         string    `json:"repoId"`
	RepoPath       string    `json:"repoPath"`
	Enabled        bool      `json:"enabled"`
	TriggerWebhook bool      `json:"triggerWebhook"`
	ReportEnabled  bool      `json:"reportEnabled"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

func (s *Server) sharedWorkflowGrant(r *http.Request) (store.ResourceShare, store.CodebaseWorkflow, error) {
	g, err := s.accessibleShare(r, r.PathValue("shareID"), "workflow")
	if err != nil {
		return g, store.CodebaseWorkflow{}, err
	}
	wf, err := s.store.CodebaseWorkflow(r.Context(), g.WorkspaceID, g.ResourceID)
	return g, wf, err
}

func (s *Server) sharedWorkflow(w http.ResponseWriter, r *http.Request) {
	g, wf, err := s.sharedWorkflowGrant(r)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"workflow": sharedWorkflowView{wf.ID, wf.Name, wf.RepoID, wf.RepoPath, wf.Enabled, wf.TriggerWebhook, wf.ReportEnabled, wf.CreatedAt, wf.UpdatedAt}, "ownerName": g.OwnerName, "workspaceName": g.WorkspaceName, "permission": "view"})
}

func (s *Server) sharedWorkflowRuns(w http.ResponseWriter, r *http.Request) {
	g, wf, err := s.sharedWorkflowGrant(r)
	if err != nil {
		writeError(w, err)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := s.store.CodebaseRuns(r.Context(), g.WorkspaceID, wf.ID, "", limit)
	if err != nil {
		writeError(w, err)
		return
	}
	// Workspace IDs and runtime execution details are not needed to read reports.
	out := sharedWorkflowRunsView(items)
	writeJSON(w, 200, map[string]any{"items": out})
}

func (s *Server) sharedWorkflowMRs(w http.ResponseWriter, r *http.Request) {
	g, wf, err := s.sharedWorkflowGrant(r)
	if err != nil {
		writeError(w, err)
		return
	}
	ctx := context.WithValue(r.Context(), workspaceContextKey, g.WorkspaceID)
	ctx = context.WithValue(ctx, sharedWorkflowMRKey{}, wf)
	copy := r.Clone(ctx)
	url := *r.URL
	q := url.Query()
	q.Set("repoId", wf.RepoID)
	url.RawQuery = q.Encode()
	copy.URL = &url
	s.codebaseMergeRequests(w, copy)
}

// Derive the conversation from the requested resource, then verify that a run
// of this workflow links to it. A grant never grants access to sibling flows.
func (s *Server) workflowSharedConversation(r *http.Request, g store.ResourceShare, parts []string) (string, error) {
	if len(parts) < 2 {
		return "", store.ErrNotFound
	}
	var conversationID string
	switch parts[0] {
	case "sessions":
		conversationID = parts[1]
	case "runs":
		link, err := s.store.RunLink(r.Context(), g.WorkspaceID, parts[1])
		if err != nil {
			return "", err
		}
		conversationID = value(link.SessionID)
	case "tasks":
		task, err := s.store.Task(r.Context(), g.WorkspaceID, parts[1])
		if err != nil {
			return "", err
		}
		conversationID = task.ConversationID
	case "messages":
		message, err := s.store.Message(r.Context(), g.WorkspaceID, parts[1])
		if err != nil {
			return "", err
		}
		conversationID = message.SessionID
	case "artifacts":
		artifact, err := s.store.Artifact(r.Context(), g.WorkspaceID, parts[1])
		if err != nil {
			return "", err
		}
		link, err := s.store.RunLink(r.Context(), g.WorkspaceID, artifact.RelayRunID)
		if err != nil {
			return "", err
		}
		conversationID = value(link.SessionID)
	}
	allowed, err := s.store.WorkflowHasConversation(r.Context(), g.WorkspaceID, g.ResourceID, conversationID)
	if err != nil {
		return "", err
	}
	if !allowed {
		return "", store.ErrNotFound
	}
	return conversationID, nil
}

type sharedWorkflowRun struct {
	ID             string     `json:"id"`
	MRIID          int        `json:"mrIid"`
	MRTitle        string     `json:"mrTitle"`
	MRURL          string     `json:"mrUrl"`
	Trigger        string     `json:"trigger"`
	Status         string     `json:"status"`
	Summary        string     `json:"summary"`
	Error          string     `json:"error"`
	ConversationID string     `json:"conversationId"`
	ReportStatus   string     `json:"reportStatus"`
	ReportError    string     `json:"reportError"`
	ReportURL      string     `json:"reportUrl"`
	StartedAt      *time.Time `json:"startedAt"`
	FinishedAt     *time.Time `json:"finishedAt"`
	CreatedAt      time.Time  `json:"createdAt"`
}

func sharedWorkflowRunsView(items []store.CodebaseRun) []sharedWorkflowRun {
	out := make([]sharedWorkflowRun, 0, len(items))
	for _, item := range items {
		out = append(out, sharedWorkflowRun{item.ID, item.MRIID, item.MRTitle, item.MRURL, item.Trigger, item.Status, item.Summary, item.Error, item.ConversationID, item.ReportStatus, item.ReportError, item.ReportURL, item.StartedAt, item.FinishedAt, item.CreatedAt})
	}
	return out
}

type sharedWorkflowMRKey struct{}
