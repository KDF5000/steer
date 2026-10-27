package api

import (
	"context"
	"errors"
	"github.com/KDF5000/steer/server/internal/store"
	"net/http"
	"net/mail"
	"strings"
)

type collaborationKey struct{}

func (s *Server) listResourceShares(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	if u.ID == "" {
		writeJSON(w, 403, map[string]string{"error": "Sign in to manage sharing."})
		return
	}
	items, err := s.store.ResourceShares(r.Context(), u, s.workspace(r))
	if err != nil {
		writeError(w, err)
		return
	}
	type entry struct {
		store.ResourceShare
		Owned bool `json:"owned"`
	}
	out := []entry{}
	for _, g := range items {
		out = append(out, entry{g, g.OwnerUserID == u.ID})
	}
	writeJSON(w, 200, out)
}
func (s *Server) inviteResource(w http.ResponseWriter, r *http.Request) {
	u := userFromContext(r.Context())
	wid := s.workspace(r)
	if _, err := s.store.WorkspaceForUser(r.Context(), u.ID, wid); err != nil {
		writeError(w, err)
		return
	}
	var in struct {
		Email          string  `json:"email"`
		Permission     string  `json:"permission"`
		ProjectID      *string `json:"projectId"`
		MaxConcurrency int     `json:"maxConcurrency"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, err)
		return
	}
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))
	addr, err := mail.ParseAddress(in.Email)
	if err != nil || addr.Address != in.Email || strings.EqualFold(in.Email, u.Email) {
		writeJSON(w, 400, map[string]string{"error": "Enter another user's email address."})
		return
	}
	kind := r.PathValue("kind")
	if kind != "session" && kind != "agent" {
		writeJSON(w, 400, map[string]string{"error": "invalid resource kind"})
		return
	}
	if in.Permission != "view" && in.Permission != "execute" {
		writeJSON(w, 400, map[string]string{"error": "invalid permission"})
		return
	}
	if in.MaxConcurrency == 0 {
		in.MaxConcurrency = 1
	}
	if in.MaxConcurrency < 1 || in.MaxConcurrency > 10 {
		writeJSON(w, 400, map[string]string{"error": "concurrency must be between 1 and 10"})
		return
	}
	if kind == "session" {
		session, err := s.store.Session(r.Context(), wid, r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		if session.SharedAgentGrantID != nil && in.Permission == "execute" {
			writeJSON(w, 400, map[string]string{"error": "A shared Agent's execution grant cannot be forwarded. Share this conversation with view permission."})
			return
		}
		in.ProjectID = nil
	} else {
		if in.Permission != "execute" || in.ProjectID == nil {
			writeJSON(w, 400, map[string]string{"error": "Shared Agents require an authorized project and execute permission."})
			return
		}
		agent, err := s.store.Agent(r.Context(), wid, r.PathValue("id"))
		if err != nil {
			writeError(w, err)
			return
		}
		project, err := s.store.Project(r.Context(), wid, *in.ProjectID)
		if err != nil || project.DeletedAt != nil {
			writeError(w, store.ErrNotFound)
			return
		}
		if project.SharedSourceProjectID != nil {
			writeJSON(w, 403, map[string]string{"error": "Shared project execution grants cannot be forwarded."})
			return
		}
		if agent.RuntimeID == nil {
			writeJSON(w, 400, map[string]string{"error": "Bind this Agent to a Runtime before sharing."})
			return
		}
		if project.WorkspaceKind == "local" {
			if _, err = s.projectAgentRuntime(r.Context(), wid, project, agent); err != nil {
				writeTaskError(w, err)
				return
			}
		} else if _, err = s.physicalRuntimeID(r.Context(), wid, *agent.RuntimeID); err != nil {
			writeTaskError(w, err)
			return
		}
	}
	g, err := s.store.CreateResourceShare(r.Context(), store.ResourceShare{Kind: kind, ResourceID: r.PathValue("id"), WorkspaceID: wid, OwnerUserID: u.ID, RecipientEmail: in.Email, Permission: in.Permission, ProjectID: in.ProjectID, MaxConcurrency: in.MaxConcurrency})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 201, g)
}
func (s *Server) acceptResourceShare(w http.ResponseWriter, r *http.Request) {
	g, err := s.store.AcceptResourceShare(r.Context(), r.PathValue("id"), userFromContext(r.Context()))
	if err != nil {
		writeError(w, err)
		return
	}
	if g.Kind == "agent" {
		if err := s.importSharedAgentProject(r.Context(), s.workspace(r), g); err != nil {
			writeError(w, err)
			return
		}
	}
	writeJSON(w, 200, g)
}

func (s *Server) importSharedAgentProject(ctx context.Context, wid string, g store.ResourceShare) error {
	agent, err := s.store.Agent(ctx, g.WorkspaceID, g.ResourceID)
	if err != nil {
		return err
	}
	project, err := s.store.Project(ctx, g.WorkspaceID, value(g.ProjectID))
	if err != nil {
		return err
	}
	if project.DeletedAt != nil {
		return store.ErrNotFound
	}
	_, err = s.store.EnsureSharedAgentProject(ctx, wid, g, agent, project)
	return err
}

// Accepted grants are account scoped. Materialize their project entries in the
// selected private Workspace, including grants accepted before this feature.
func (s *Server) importAcceptedAgentProjects(ctx context.Context, wid string) error {
	u := userFromContext(ctx)
	if u.ID == "" {
		return nil
	}
	shares, err := s.store.ResourceShares(ctx, u, wid)
	if err != nil {
		return err
	}
	for _, g := range shares {
		if g.Kind != "agent" || g.Status != "accepted" || g.RecipientUserID == nil || *g.RecipientUserID != u.ID {
			continue
		}
		found, err := s.store.SharedAgentProjectExists(ctx, wid, g.ID)
		if err != nil {
			return err
		}
		if found {
			continue
		}
		if err := s.importSharedAgentProject(ctx, wid, g); err != nil && !errors.Is(err, store.ErrNotFound) {
			return err
		}
	}
	return nil
}

func (s *Server) revokeResourceShare(w http.ResponseWriter, r *http.Request) {
	if err := s.store.RevokeResourceShare(r.Context(), r.PathValue("id"), userFromContext(r.Context())); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(204)
}
func (s *Server) updateResourceShare(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Permission string `json:"permission"`
	}
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, err)
		return
	}
	g, err := s.store.ResourceShare(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	if in.Permission != "view" && in.Permission != "execute" || g.Kind == "agent" && in.Permission != "execute" {
		writeJSON(w, 400, map[string]string{"error": "invalid permission"})
		return
	}
	if g.Kind == "session" && in.Permission == "execute" {
		c, err := s.store.Session(r.Context(), g.WorkspaceID, g.ResourceID)
		if err != nil {
			writeError(w, err)
			return
		}
		if c.SharedAgentGrantID != nil {
			writeJSON(w, 400, map[string]string{"error": "Execution grants cannot be forwarded."})
			return
		}
	}
	if err := s.store.SetSharePermission(r.Context(), g.ID, userFromContext(r.Context()).ID, in.Permission); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (s *Server) accessibleShare(r *http.Request, id string, kind string) (store.ResourceShare, error) {
	g, err := s.store.ResourceShare(r.Context(), id)
	if err != nil {
		return g, err
	}
	u := userFromContext(r.Context())
	if g.Kind != kind || g.Status == "revoked" || g.ResourceName == "" || u.ID == "" {
		return g, store.ErrNotFound
	}
	if g.OwnerUserID == u.ID {
		return g, nil
	}
	if g.Status != "accepted" || g.RecipientUserID == nil || *g.RecipientUserID != u.ID {
		return g, store.ErrNotFound
	}
	return g, nil
}
func (s *Server) createSharedAgentConversation(w http.ResponseWriter, r *http.Request) {
	g, err := s.accessibleShare(r, r.PathValue("id"), "agent")
	if err != nil {
		writeError(w, err)
		return
	}
	if g.Status != "accepted" || g.OwnerUserID == userFromContext(r.Context()).ID {
		writeJSON(w, 400, map[string]string{"error": "Accept the Agent invitation before using it."})
		return
	}
	agent, err := s.store.Agent(r.Context(), g.WorkspaceID, g.ResourceID)
	if err != nil {
		writeError(w, err)
		return
	}
	project, err := s.store.Project(r.Context(), g.WorkspaceID, value(g.ProjectID))
	if err != nil || project.DeletedAt != nil {
		writeError(w, store.ErrNotFound)
		return
	}
	runtimeID := value(agent.RuntimeID)
	if project.WorkspaceKind == "local" {
		runtimeID, err = s.projectAgentRuntime(r.Context(), g.WorkspaceID, project, agent)
	} else {
		_, err = s.physicalRuntimeID(r.Context(), g.WorkspaceID, runtimeID)
	}
	if err != nil {
		writeTaskError(w, err)
		return
	}
	session, err := s.store.CreateSharedAgentSession(r.Context(), s.workspace(r), g, agent, project, runtimeID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, 201, session)
}

// A scoped gateway dispatches only resources belonging to this exact conversation.
// It never grants Workspace membership or access to bootstrap/configuration APIs.
func (s *Server) collaborationAccess(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g, err := s.accessibleShare(r, r.PathValue("shareID"), "session")
		if err != nil {
			writeError(w, err)
			return
		}
		path := strings.Trim(r.PathValue("path"), "/")
		parts := strings.Split(path, "/")
		allowed := false
		if r.Method == "GET" && len(parts) == 2 && parts[0] == "sessions" && parts[1] == g.ResourceID {
			allowed = true
		}
		if r.Method == "POST" && len(parts) == 3 && parts[0] == "conversations" && parts[1] == g.ResourceID && parts[2] == "tasks" {
			allowed = true
		}
		if len(parts) >= 2 && (parts[0] == "runs" || parts[0] == "tasks") {
			runID := parts[1]
			if parts[0] == "tasks" {
				t, e := s.store.Task(r.Context(), g.WorkspaceID, runID)
				if e == nil && t.ConversationID == g.ResourceID {
					runID = t.RelayRunID
				} else {
					runID = ""
				}
			}
			link, e := s.store.RunLink(r.Context(), g.WorkspaceID, runID)
			if e == nil && value(link.SessionID) == g.ResourceID {
				allowed = r.Method == "GET" && (len(parts) == 2 || len(parts) == 4 && parts[2] == "events" && parts[3] == "stream" || parts[0] == "tasks" && len(parts) == 3 && (parts[2] == "artifacts" || parts[2] == "events") || parts[0] == "runs" && len(parts) == 3 && parts[2] == "workspace") || r.Method == "POST" && len(parts) == 3 && parts[2] == "cancel"
			}
		}
		if r.Method == "GET" && len(parts) == 4 && parts[0] == "messages" && parts[2] == "attachments" {
			m, e := s.store.Message(r.Context(), g.WorkspaceID, parts[1])
			allowed = e == nil && m.SessionID == g.ResourceID
		}
		if r.Method == "GET" && len(parts) == 3 && parts[0] == "artifacts" && (parts[2] == "content" || parts[2] == "download") {
			a, e := s.store.Artifact(r.Context(), g.WorkspaceID, parts[1])
			if e == nil {
				link, e := s.store.RunLink(r.Context(), g.WorkspaceID, a.RelayRunID)
				allowed = e == nil && value(link.SessionID) == g.ResourceID
			}
		}
		if !allowed {
			writeError(w, store.ErrNotFound)
			return
		}
		if r.Method != "GET" && g.OwnerUserID != userFromContext(r.Context()).ID && g.Permission != "execute" {
			writeJSON(w, 403, map[string]string{"error": "This conversation is shared with view permission."})
			return
		}
		ctx := context.WithValue(r.Context(), workspaceContextKey, g.WorkspaceID)
		ctx = context.WithValue(ctx, collaborationKey{}, g)
		copy := r.Clone(ctx)
		urlCopy := *r.URL
		urlCopy.Path = "/api/v1/" + path
		copy.URL = &urlCopy
		next.ServeHTTP(w, copy)
	})
}

func (s *Server) sharedAgentExecution(ctx context.Context, wid string, in chatRequest) (string, *store.ResourceShare, error) {
	if in.SessionID == nil {
		return wid, nil, nil
	}
	session, err := s.store.Session(ctx, wid, *in.SessionID)
	if errors.Is(err, store.ErrNotFound) {
		return wid, nil, nil
	}
	if err != nil {
		return wid, nil, err
	}
	if session.SharedAgentGrantID == nil {
		return wid, nil, nil
	}
	if in.ProjectID != nil && value(in.ProjectID) != value(session.ProjectID) || in.TargetAgentID != "" && in.TargetAgentID != in.AgentID {
		return wid, nil, taskRequestError{Status: 403, Message: "This conversation can only use Agents authorized for this shared project."}
	}
	imported, err := s.store.Project(ctx, wid, value(session.ProjectID))
	if err != nil {
		return wid, nil, err
	}
	shares, err := s.store.ResourceShares(ctx, userFromContext(ctx), wid)
	if err != nil {
		return wid, nil, err
	}
	var g store.ResourceShare
	for _, candidate := range shares {
		if candidate.Kind == "agent" && candidate.Status == "accepted" && candidate.ResourceID == in.AgentID &&
			candidate.RecipientUserID != nil && *candidate.RecipientUserID == userFromContext(ctx).ID &&
			value(candidate.ProjectID) == value(imported.SharedSourceProjectID) && candidate.WorkspaceID == value(imported.SharedSourceWorkspaceID) {
			g = candidate
			break
		}
	}
	if g.ID == "" {
		for _, candidate := range shares {
			if candidate.ID == value(session.SharedAgentGrantID) && candidate.ResourceID == in.AgentID && candidate.Status == "accepted" && value(candidate.ProjectID) != value(imported.SharedSourceProjectID) {
				return wid, nil, taskRequestError{Status: 409, Message: "The authorized project has changed. Start a new shared Agent conversation."}
			}
		}
		return wid, nil, taskRequestError{Status: 403, Message: "Shared Agent access has been revoked or this Agent is not authorized for this project."}
	}
	p, err := s.store.Project(ctx, g.WorkspaceID, value(g.ProjectID))
	if err != nil || p.DeletedAt != nil {
		return wid, nil, store.ErrNotFound
	}
	if value(session.WorkspaceSource) != p.WorkspaceSource || value(session.WorkspaceKind) != p.WorkspaceKind || value(session.WorkspaceRef) != value(p.WorkspaceRef) || value(session.WorkspaceSubdir) != value(p.WorkspaceSubdir) {
		return wid, nil, taskRequestError{Status: 409, Message: "The authorized project has changed. Start a new shared Agent conversation."}
	}
	return g.WorkspaceID, &g, nil
}
