package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/relay/controlplane"
	"github.com/KDF5000/relay/sdk"
	"github.com/KDF5000/relay/transport/httpapi"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

type Server struct {
	store            *store.Store
	relay            *sdk.Client
	relayHTTP        *httpapi.Client
	relayPublicURL   string
	defaultWorkspace string
	allowedOrigins   map[string]bool
	authEnabled      bool
	sessionTTL       time.Duration
}

func New(st *store.Store, relayURL, relayToken, relayPublicURL, defaultWorkspace string, origins []string, options ...Option) *Server {
	transport := httpapi.NewAuthenticatedClient(relayURL, relayToken)
	allowed := map[string]bool{}
	for _, origin := range origins {
		if value := strings.TrimSpace(origin); value != "" {
			allowed[value] = true
		}
	}
	server := &Server{store: st, relay: sdk.New(transport), relayHTTP: transport, relayPublicURL: strings.TrimRight(relayPublicURL, "/"), defaultWorkspace: defaultWorkspace, allowedOrigins: allowed, sessionTTL: 30 * 24 * time.Hour}
	for _, option := range options {
		option(server)
	}
	return server
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.health)
	mux.HandleFunc("POST /api/v1/auth/register", s.register)
	mux.HandleFunc("POST /api/v1/auth/login", s.login)
	mux.HandleFunc("POST /api/v1/auth/logout", s.logout)
	mux.HandleFunc("GET /api/v1/auth/me", s.me)
	mux.HandleFunc("GET /api/v1/workspaces", s.listWorkspaces)
	mux.HandleFunc("POST /api/v1/workspaces", s.createWorkspace)
	mux.HandleFunc("POST /api/v1/runtimes/claim-available", s.claimAvailableRuntimes)
	mux.HandleFunc("GET /api/v1/bootstrap", s.bootstrap)
	mux.HandleFunc("GET /api/v1/agents", s.listAgents)
	mux.HandleFunc("POST /api/v1/agents", s.createAgent)
	mux.HandleFunc("GET /api/v1/projects", s.listProjects)
	mux.HandleFunc("POST /api/v1/projects", s.createProject)
	mux.HandleFunc("PUT /api/v1/projects/{id}", s.updateProject)
	mux.HandleFunc("DELETE /api/v1/projects/{id}", s.deleteProject)
	mux.HandleFunc("GET /api/v1/artifacts/{id}/content", s.artifactContent)
	mux.HandleFunc("GET /api/v1/artifacts/{id}/download", s.artifactContent)
	mux.HandleFunc("GET /api/v1/sessions/{id}", s.chatSession)
	mux.HandleFunc("POST /api/v1/sessions/{id}/share", s.shareSession)
	mux.HandleFunc("DELETE /api/v1/sessions/{id}", s.deleteChatSession)
	mux.HandleFunc("POST /api/v1/messages/{id}/share", s.shareMessage)
	mux.HandleFunc("GET /api/v1/messages/{messageId}/attachments/{attachmentId}", s.messageAttachment)
	mux.HandleFunc("GET /api/v1/shares/{token}", s.sharedConversation)
	mux.HandleFunc("POST /api/v1/chat", s.chat)
	mux.HandleFunc("GET /api/v1/runs/{id}", s.run)
	mux.HandleFunc("GET /api/v1/runs/{id}/workspace", s.inspectWorkspace)
	mux.HandleFunc("GET /api/v1/runs/{id}/events/stream", s.streamRunEvents)
	mux.HandleFunc("POST /api/v1/runs/{id}/cancel", s.cancelRun)
	return s.recover(s.cors(s.logRequests(s.authenticate(mux))))
}

func (s *Server) chatSession(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	session, err := s.store.Session(r.Context(), wid, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	messages, err := s.store.Messages(r.Context(), wid, session.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	response := map[string]any{"session": session, "messages": messages}
	if session.ProjectID != nil {
		if project, projectErr := s.store.Project(r.Context(), wid, *session.ProjectID); projectErr == nil {
			response["project"] = project
		}
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) deleteChatSession(w http.ResponseWriter, r *http.Request) {
	deleted, err := s.store.DeleteSession(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deleted)
}

func (s *Server) workspace(r *http.Request) string {
	if value, ok := r.Context().Value(workspaceContextKey).(string); ok && value != "" {
		return value
	}
	if value := strings.TrimSpace(r.Header.Get("X-Steer-Workspace")); value != "" {
		return value
	}
	return s.defaultWorkspace
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	relayStatus := "ok"
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if _, err := s.relay.Nodes(ctx); err != nil {
		relayStatus = "unavailable"
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "relay": relayStatus})
}

func (s *Server) bootstrap(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	ctx := r.Context()
	workspaceName := "Personal workspace"
	if s.authEnabled {
		workspace, err := s.store.WorkspaceForUser(ctx, userFromContext(ctx).ID, wid)
		if err != nil {
			writeError(w, err)
			return
		}
		workspaceName = workspace.Name
	}
	agents, err := s.store.Agents(ctx, wid)
	if err != nil {
		writeError(w, err)
		return
	}
	projects, err := s.store.Projects(ctx, wid)
	if err != nil {
		writeError(w, err)
		return
	}
	artifacts, err := s.store.Artifacts(ctx, wid)
	if err != nil {
		writeError(w, err)
		return
	}
	sessions, err := s.store.Sessions(ctx, wid)
	if err != nil {
		writeError(w, err)
		return
	}
	relayState := map[string]any{"connected": false, "publicUrl": s.relayPublicURL, "nodes": []any{}}
	if nodes, relayErr := s.workspaceNodes(ctx, wid); relayErr == nil {
		relayState["connected"] = true
		relayState["nodes"] = nodes
	} else {
		relayState["error"] = relayErr.Error()
	}
	writeJSON(w, http.StatusOK, map[string]any{"workspace": map[string]string{"id": wid, "name": workspaceName}, "agents": agents, "projects": projects, "artifacts": artifacts, "sessions": sessions, "relay": relayState})
}

func (s *Server) listProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := s.store.Projects(r.Context(), s.workspace(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, projects)
}

func (s *Server) createProject(w http.ResponseWriter, r *http.Request) {
	var project store.Project
	if err := decodeJSON(r, &project); err != nil {
		writeError(w, err)
		return
	}
	if !s.validateProject(w, r, &project) {
		return
	}
	created, err := s.store.CreateProject(r.Context(), s.workspace(r), project)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) updateProject(w http.ResponseWriter, r *http.Request) {
	var project store.Project
	if err := decodeJSON(r, &project); err != nil {
		writeError(w, err)
		return
	}
	if !s.validateProject(w, r, &project) {
		return
	}
	updated, err := s.store.UpdateProject(r.Context(), s.workspace(r), r.PathValue("id"), project)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (s *Server) deleteProject(w http.ResponseWriter, r *http.Request) {
	deleted, err := s.store.DeleteProject(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, deleted)
}

func (s *Server) validateProject(w http.ResponseWriter, r *http.Request, project *store.Project) bool {
	project.Name = strings.TrimSpace(project.Name)
	project.WorkspaceKind = strings.TrimSpace(project.WorkspaceKind)
	project.WorkspaceSource = strings.TrimSpace(project.WorkspaceSource)
	project.ExecutionMode = strings.TrimSpace(project.ExecutionMode)
	if project.Name == "" || project.WorkspaceSource == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and project source are required"})
		return false
	}
	if project.WorkspaceKind == "" {
		project.WorkspaceKind = "local"
	}
	if project.WorkspaceKind != "local" && project.WorkspaceKind != "git" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "project type must be local or git"})
		return false
	}
	if project.ExecutionMode == "" {
		if project.WorkspaceKind == "git" {
			project.ExecutionMode = "session_worktree"
		} else {
			project.ExecutionMode = "in_place"
		}
	}
	if project.WorkspaceKind == "local" {
		if project.ExecutionMode != "in_place" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "directory projects currently support only in_place execution"})
			return false
		}
		if project.RuntimeID == nil || strings.TrimSpace(*project.RuntimeID) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "directory projects require a runtimeId"})
			return false
		}
		nodes, err := s.workspaceNodes(r.Context(), s.workspace(r))
		if err != nil {
			writeError(w, fmt.Errorf("verify project Runtime: %w", err))
			return false
		}
		found := false
		for _, node := range nodes {
			for _, runtime := range node.Runtimes {
				if runtime.ID == *project.RuntimeID {
					found = true
					break
				}
			}
		}
		if !found {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "selected Runtime is not currently available"})
			return false
		}
	} else {
		project.RuntimeID = nil
		if project.ExecutionMode != "session_worktree" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "git projects currently require session_worktree execution"})
			return false
		}
	}
	return true
}

func (s *Server) listAgents(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.Agents(r.Context(), s.workspace(r))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}
func (s *Server) createAgent(w http.ResponseWriter, r *http.Request) {
	var in store.Agent
	if err := decodeJSON(r, &in); err != nil {
		writeError(w, err)
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	in.Role = strings.TrimSpace(in.Role)
	in.RuntimeProvider = strings.TrimSpace(in.RuntimeProvider)
	if in.Name == "" || in.RuntimeProvider == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and runtimeProvider are required"})
		return
	}
	if in.Role == "" {
		in.Role = "General execution"
	}
	if in.RuntimeID != nil && strings.TrimSpace(*in.RuntimeID) != "" {
		assigned, err := s.store.RuntimeAssigned(r.Context(), s.workspace(r), *in.RuntimeID)
		if err != nil {
			writeError(w, err)
			return
		}
		if !assigned {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "The selected Runtime is not assigned to this workspace."})
			return
		}
	}
	item, err := s.store.CreateAgent(r.Context(), s.workspace(r), in)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) artifactContent(w http.ResponseWriter, r *http.Request) {
	artifact, err := s.store.Artifact(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	if artifact.RelayArtifactID == nil || *artifact.RelayArtifactID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "artifact content is unavailable"})
		return
	}
	reader, err := s.relayHTTP.OpenArtifact(r.Context(), *artifact.RelayArtifactID)
	if err != nil {
		writeError(w, fmt.Errorf("open Relay artifact: %w", err))
		return
	}
	defer reader.Close()
	if strings.HasSuffix(r.URL.Path, "/download") {
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filepath.Base(artifact.Name)}))
		if _, err := io.Copy(w, reader); err != nil {
			slog.Error("artifact download interrupted", "error", err)
		}
		return
	}
	const previewLimit = 2 << 20
	content, err := io.ReadAll(io.LimitReader(reader, previewLimit+1))
	if err != nil {
		writeError(w, fmt.Errorf("read Relay artifact: %w", err))
		return
	}
	contentType := "text/plain"
	if artifact.ContentType != nil && *artifact.ContentType != "" {
		contentType = *artifact.ContentType
	}
	if len(content) > previewLimit {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "This file is too large to preview. Download it to read the full content."})
		return
	}
	if !utf8.Valid(content) || strings.ContainsRune(string(content), 0) {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Preview is unavailable for this file type. Download the original file."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": artifact.ID, "name": artifact.Name, "contentType": contentType, "content": string(content)})
}

type chatRequest struct {
	Prompt    string  `json:"prompt"`
	AgentID   string  `json:"agentId"`
	SessionID *string `json:"sessionId"`
	ProjectID *string `json:"projectId"`
}

const (
	maxChatImages      = 4
	maxChatImageSize   = 5 << 20
	maxChatImagesSize  = 16 << 20
	maxChatRequestSize = 18 << 20
)

type relayInputImage struct {
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	Data        []byte `json:"data"`
}

func decodeChatRequest(w http.ResponseWriter, r *http.Request) (chatRequest, []store.MessageAttachment, error) {
	contentType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if contentType != "multipart/form-data" {
		var in chatRequest
		if err := decodeJSON(r, &in); err != nil {
			return chatRequest{}, nil, err
		}
		return in, nil, nil
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxChatRequestSize)
	if err := r.ParseMultipartForm(maxChatRequestSize); err != nil {
		return chatRequest{}, nil, fmt.Errorf("invalid image upload: %w", err)
	}
	in := chatRequest{Prompt: r.FormValue("prompt"), AgentID: r.FormValue("agentId")}
	if value := strings.TrimSpace(r.FormValue("sessionId")); value != "" {
		in.SessionID = &value
	}
	if value := strings.TrimSpace(r.FormValue("projectId")); value != "" {
		in.ProjectID = &value
	}
	files := r.MultipartForm.File["images"]
	if len(files) > maxChatImages {
		return chatRequest{}, nil, fmt.Errorf("at most %d images are allowed", maxChatImages)
	}
	attachments := make([]store.MessageAttachment, 0, len(files))
	totalSize := 0
	for _, header := range files {
		if header.Size > maxChatImageSize {
			return chatRequest{}, nil, fmt.Errorf("image %q exceeds 5 MB", header.Filename)
		}
		file, err := header.Open()
		if err != nil {
			return chatRequest{}, nil, err
		}
		content, readErr := io.ReadAll(io.LimitReader(file, maxChatImageSize+1))
		_ = file.Close()
		if readErr != nil {
			return chatRequest{}, nil, readErr
		}
		if len(content) == 0 || len(content) > maxChatImageSize {
			return chatRequest{}, nil, fmt.Errorf("image %q is empty or exceeds 5 MB", header.Filename)
		}
		totalSize += len(content)
		if totalSize > maxChatImagesSize {
			return chatRequest{}, nil, errors.New("images exceed the 16 MB total limit")
		}
		detected := http.DetectContentType(content)
		if detected != "image/png" && detected != "image/jpeg" && detected != "image/webp" && detected != "image/gif" {
			return chatRequest{}, nil, fmt.Errorf("image %q must be PNG, JPEG, WebP, or GIF", header.Filename)
		}
		attachments = append(attachments, store.MessageAttachment{Name: filepath.Base(header.Filename), ContentType: detected, Size: int64(len(content)), Content: content})
	}
	return in, attachments, nil
}

func (s *Server) chat(w http.ResponseWriter, r *http.Request) {
	in, attachments, err := decodeChatRequest(w, r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	in.Prompt = strings.TrimSpace(in.Prompt)
	if (in.Prompt == "" && len(attachments) == 0) || in.AgentID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "a prompt or image, and agentId are required"})
		return
	}
	wid := s.workspace(r)
	agent, err := s.store.Agent(r.Context(), wid, in.AgentID)
	if err != nil {
		writeError(w, err)
		return
	}
	sessionID := uuid.NewString()
	if in.SessionID != nil && *in.SessionID != "" {
		sessionID = *in.SessionID
	}
	var project *store.Project
	if in.ProjectID != nil && *in.ProjectID != "" {
		selected, projectErr := s.store.Project(r.Context(), wid, *in.ProjectID)
		if projectErr != nil {
			writeError(w, projectErr)
			return
		}
		project = &selected
	}
	title := in.Prompt
	if title == "" {
		title = attachments[0].Name
	}
	executionRuntimeID := agent.RuntimeID
	var workspaceKey *string
	if project != nil {
		if project.WorkspaceKind == "local" {
			if project.RuntimeID != nil && strings.TrimSpace(*project.RuntimeID) != "" {
				executionRuntimeID = project.RuntimeID
			}
			if executionRuntimeID == nil || strings.TrimSpace(*executionRuntimeID) == "" {
				writeJSON(w, http.StatusConflict, map[string]string{"error": "Directory projects require a fixed Runtime. Edit or recreate this Project with a Runtime location."})
				return
			}
		} else if project.WorkspaceKind == "git" {
			key := "steer/" + wid + "/" + sessionID
			workspaceKey = &key
		}
	}
	if executionRuntimeID == nil || strings.TrimSpace(*executionRuntimeID) == "" {
		resolvedRuntimeID, resolveErr := s.firstWorkspaceRuntime(r.Context(), wid, agent.RuntimeProvider)
		if resolveErr != nil {
			writeError(w, resolveErr)
			return
		}
		executionRuntimeID = &resolvedRuntimeID
	}
	session, err := s.store.EnsureSession(r.Context(), wid, sessionID, truncate(title, 72), agent.ID, in.ProjectID, executionRuntimeID, workspaceKey, project)
	if err != nil {
		writeError(w, err)
		return
	}
	if in.ProjectID != nil && (session.ProjectID == nil || *in.ProjectID != *session.ProjectID) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "session is already linked to another project"})
		return
	}
	if project == nil && session.ProjectID != nil {
		selected, projectErr := s.store.Project(r.Context(), wid, *session.ProjectID)
		if projectErr != nil {
			writeError(w, projectErr)
			return
		}
		project = &selected
	}
	if session.ExecutionRuntimeID != nil && strings.TrimSpace(*session.ExecutionRuntimeID) != "" {
		executionRuntimeID = session.ExecutionRuntimeID
	}
	if agent.RuntimeID != nil && executionRuntimeID != nil && *agent.RuntimeID != *executionRuntimeID {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "The selected Agent is fixed to a different Runtime. Fork the conversation to change execution location."})
		return
	}
	if executionRuntimeID != nil {
		provider, providerErr := s.runtimeProvider(r.Context(), wid, *executionRuntimeID)
		if providerErr != nil {
			writeError(w, providerErr)
			return
		}
		if provider != agent.RuntimeProvider {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "The selected Agent uses a provider that is unavailable on this conversation's Runtime."})
			return
		}
	}
	if err := s.store.UpdateSessionAgent(r.Context(), wid, sessionID, agent.ID); err != nil {
		writeError(w, err)
		return
	}
	previous, err := s.store.Messages(r.Context(), wid, sessionID)
	if err != nil {
		writeError(w, err)
		return
	}
	runPrompt := in.Prompt
	if runPrompt == "" {
		runPrompt = "Please inspect the attached image and respond to it."
	}
	prompt := conversationPrompt(previous, runPrompt)
	runtimeID := value(executionRuntimeID)
	model := value(agent.Model)
	input := relay.Input{Type: "text", Version: "1", Prompt: prompt}
	if len(attachments) > 0 {
		images := make([]relayInputImage, 0, len(attachments))
		for _, item := range attachments {
			images = append(images, relayInputImage{Name: item.Name, ContentType: item.ContentType, Data: item.Content})
		}
		input.Data, err = json.Marshal(map[string]any{"images": images})
		if err != nil {
			writeError(w, err)
			return
		}
	}
	request := relay.Request{SessionID: sessionID, AgentID: agent.ID, IdempotencyKey: uuid.NewString(), Runtime: relay.RuntimeRequirement{ID: runtimeID, Provider: agent.RuntimeProvider, Model: model}, Source: relay.Source{Kind: "steer.chat", ExternalID: sessionID}, Input: input, Principal: relay.Principal{Type: "user", ID: "workspace:" + wid}}
	if agent.Instructions != "" {
		request.Instructions.Agent = []relay.InstructionFragment{{ID: agent.ID, Version: "1", Title: agent.Name, Content: agent.Instructions}}
	}
	if session.WorkspaceKind != nil && session.WorkspaceSource != nil {
		request.Workspace = relay.WorkspaceSpec{Kind: *session.WorkspaceKind, Source: *session.WorkspaceSource, Ref: value(session.WorkspaceRef), Subdir: value(session.WorkspaceSubdir)}
	} else if project != nil {
		request.Workspace = relay.WorkspaceSpec{Kind: project.WorkspaceKind, Source: project.WorkspaceSource, Ref: value(project.WorkspaceRef), Subdir: value(project.WorkspaceSubdir)}
	} else {
		request.Workspace = relay.WorkspaceSpec{Kind: value(agent.WorkspaceKind), Source: value(agent.WorkspaceSource), Ref: value(agent.WorkspaceRef)}
	}
	if request.Workspace.Kind == "git" {
		request.Instructions.Turn = append(request.Instructions.Turn, gitProjectWorkspaceInstruction())
	}
	var run relay.Run
	workspaceKind := request.Workspace.Kind
	executionMode := value(session.ExecutionMode)
	if executionMode == "" && project != nil {
		executionMode = project.ExecutionMode
	}
	if workspaceKind == "git" && executionMode == "session_worktree" {
		key := value(session.WorkspaceKey)
		if key == "" {
			key = "steer/" + wid + "/" + sessionID
		}
		request.Workspace.Lifecycle = "reusable"
		request.Workspace.ReuseKey = key
		request.Workspace.Branch = "steer/" + sessionID
	}
	run, err = s.submitRelayRun(r.Context(), request)
	if err != nil {
		writeError(w, fmt.Errorf("submit Relay run: %w", err))
		return
	}
	user, assistant, err := s.store.SaveChatRun(r.Context(), wid, sessionID, agent.ID, in.Prompt, run.ID, string(run.Status), attachments...)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"sessionId": sessionID, "runId": run.ID, "status": run.Status, "userMessage": user, "assistantMessage": assistant})
}

func gitProjectWorkspaceInstruction() relay.InstructionFragment {
	return relay.InstructionFragment{
		ID:      "steer-git-project-worktree",
		Version: "1",
		Title:   "Steer Git Project",
		Content: "Relay has already prepared an isolated Git worktree for the selected Project and starts you inside it. Treat the current working directory as the only authoritative checkout for this conversation. Perform all edits, commits, rebases, builds, and tests in that worktree, and ensure every final change remains there. Do not clone or copy the primary repository into /tmp or another host directory, and do not search the machine for alternate checkouts. If the task requires a second repository that is not contained in the selected Project, explain that constraint to the user instead of modifying an unmanaged checkout.",
	}
}

func (s *Server) runtimeProvider(ctx context.Context, workspaceID, runtimeID string) (string, error) {
	nodes, err := s.workspaceNodes(ctx, workspaceID)
	if err != nil {
		return "", fmt.Errorf("resolve execution Runtime: %w", err)
	}
	for _, node := range nodes {
		for _, runtime := range node.Runtimes {
			if runtime.ID == runtimeID {
				return runtime.Provider, nil
			}
		}
	}
	return "", fmt.Errorf("execution Runtime %q is unavailable", runtimeID)
}

func (s *Server) firstWorkspaceRuntime(ctx context.Context, workspaceID, provider string) (string, error) {
	nodes, err := s.workspaceNodes(ctx, workspaceID)
	if err != nil {
		return "", fmt.Errorf("resolve execution Runtime: %w", err)
	}
	for _, node := range nodes {
		for _, runtime := range node.Runtimes {
			if runtime.Provider == provider {
				return runtime.ID, nil
			}
		}
	}
	return "", fmt.Errorf("no %s Runtime is assigned to this workspace", provider)
}

func (s *Server) workspaceNodes(ctx context.Context, workspaceID string) ([]controlplane.Node, error) {
	nodes, err := s.relay.Nodes(ctx)
	if err != nil || !s.authEnabled {
		return nodes, err
	}
	assigned, err := s.store.WorkspaceRuntimeIDs(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	visible := make([]controlplane.Node, 0, len(nodes))
	for _, node := range nodes {
		filtered := node.Runtimes[:0:0]
		for _, runtime := range node.Runtimes {
			if assigned[runtime.ID] {
				filtered = append(filtered, runtime)
			}
		}
		if len(filtered) > 0 {
			node.Runtimes = filtered
			visible = append(visible, node)
		}
	}
	return visible, nil
}

// submitRelayRun retries an ambiguous successful response once. Relay submissions
// are idempotent, so using the same IdempotencyKey recovers the already-created
// Run without creating a duplicate when a proxy truncates the first response.
func (s *Server) submitRelayRun(ctx context.Context, request relay.Request) (relay.Run, error) {
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		run, err := s.relay.Submit(ctx, request)
		if err == nil && run.ID != "" {
			return run, nil
		}
		if err != nil && !strings.Contains(err.Error(), "decode Relay response") {
			return relay.Run{}, err
		}
		if err != nil {
			lastErr = err
		} else {
			lastErr = errors.New("Relay returned a successful response without a Run payload")
		}
	}
	return relay.Run{}, lastErr
}

func (s *Server) messageAttachment(w http.ResponseWriter, r *http.Request) {
	item, err := s.store.MessageAttachment(r.Context(), s.workspace(r), r.PathValue("messageId"), r.PathValue("attachmentId"))
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", item.ContentType)
	w.Header().Set("Content-Length", fmt.Sprint(item.Size))
	w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": filepath.Base(item.Name)}))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(item.Content)
}

func (s *Server) run(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	runID := r.PathValue("id")
	if _, err := s.store.RunLink(r.Context(), wid, runID); err != nil {
		writeError(w, err)
		return
	}
	run, err := s.relay.GetRun(r.Context(), runID)
	if err != nil {
		writeError(w, err)
		return
	}
	events, err := s.relay.Events(r.Context(), runID)
	if err != nil {
		writeError(w, err)
		return
	}
	content, lastSeq := visibleAssistantContent(run.Status, events, run.Result)
	var runErr *string
	if run.Status == relay.RunFailed || run.Status == relay.RunCancelled {
		message := run.Error
		if message == "" {
			message = "Run " + string(run.Status)
		}
		runErr = &message
	}
	deliverableArtifacts := []relay.Artifact{}
	if terminal(run.Status) {
		relayArtifacts, listErr := s.relay.Artifacts(r.Context(), runID)
		err = listErr
		if err != nil {
			writeError(w, fmt.Errorf("sync deliverables: %w", err))
			return
		}
		link, err := s.store.RunLink(r.Context(), wid, runID)
		if err != nil {
			writeError(w, err)
			return
		}
		for _, artifact := range relayArtifacts {
			if !isDeliverableArtifact(artifact) {
				continue
			}
			deliverableArtifacts = append(deliverableArtifacts, artifact)
			if err := s.store.UpsertArtifact(r.Context(), wid, link, artifact.ID, firstNonEmpty(artifact.Name, artifact.Ref, artifact.Type), artifact.Type, artifact.Ref, artifact.ContentType, artifact.Size); err != nil {
				writeError(w, err)
				return
			}
		}
	}
	if err := s.store.UpdateRun(r.Context(), wid, runID, string(run.Status), content, runErr, lastSeq); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"run": run, "content": content, "error": runErr, "events": events, "artifacts": deliverableArtifacts})
}

func (s *Server) streamRunEvents(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("id")
	if _, err := s.store.RunLink(r.Context(), s.workspace(r), runID); err != nil {
		writeError(w, err)
		return
	}
	after := 0
	if value := r.URL.Query().Get("after"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "after must be a non-negative event sequence"})
			return
		}
		after = parsed
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "streaming is unavailable"})
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-transform")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	err := s.relay.StreamEvents(r.Context(), runID, after, func(event relay.Event) error {
		encoded, err := json.Marshal(event)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(w, "id: %d\nevent: relay.event\ndata: %s\n\n", event.Sequence, encoded); err != nil {
			return err
		}
		flusher.Flush()
		return nil
	})
	if err != nil {
		if r.Context().Err() == nil {
			slog.Warn("Relay event stream interrupted", "run_id", runID, "error", err)
			encoded, _ := json.Marshal(map[string]string{"error": err.Error()})
			_, _ = fmt.Fprintf(w, "event: steer.error\ndata: %s\n\n", encoded)
			flusher.Flush()
		}
		return
	}
	_, _ = fmt.Fprint(w, "event: steer.done\ndata: {}\n\n")
	flusher.Flush()
}

func (s *Server) cancelRun(w http.ResponseWriter, r *http.Request) {
	if _, err := s.store.RunLink(r.Context(), s.workspace(r), r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	run, err := s.relay.CancelRun(r.Context(), r.PathValue("id"), controlplane.CancelRequest{Reason: "Cancelled from Steer", RequestedBy: "steer"})
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

func conversationPrompt(items []store.Message, prompt string) string {
	var b strings.Builder
	b.WriteString("This is a direct working conversation. Respond conversationally and use the selected project as execution context. Do not create or upload an artifact merely to mirror your reply. Create a durable artifact only when the user explicitly asks for a document, code change, export, or other reusable output.\n")
	if len(items) == 0 {
		b.WriteString("\nUser: ")
		b.WriteString(prompt)
		return b.String()
	}
	if len(items) > 12 {
		items = items[len(items)-12:]
	}
	b.WriteString("\nContinue this conversation.\n\n")
	for _, item := range items {
		if item.Status != "complete" && item.Status != "succeeded" {
			continue
		}
		speaker := "User"
		if item.Role == "agent" {
			speaker = "Assistant"
		}
		fmt.Fprintf(&b, "%s: %s\n\n", speaker, item.Content)
	}
	b.WriteString("User: ")
	b.WriteString(prompt)
	return b.String()
}

func isDeliverableArtifact(artifact relay.Artifact) bool {
	typ := strings.ToLower(strings.TrimSpace(artifact.Type))
	name := strings.ToLower(strings.TrimSpace(artifact.Name))
	return !strings.Contains(typ, "instruction") &&
		!strings.Contains(typ, "final_message") &&
		!strings.Contains(name, "-last-message.")
}
func assistantContent(events []relay.Event) (string, int) {
	var streamed strings.Builder
	completed := ""
	final := ""
	itemOrder := []string{}
	itemMessages := map[string]*strings.Builder{}
	last := 0
	for _, event := range events {
		if event.Sequence > last {
			last = event.Sequence
		}
		var data struct {
			Delta  string `json:"delta"`
			Text   string `json:"text"`
			ItemID string `json:"itemId"`
		}
		_ = json.Unmarshal(event.Data, &data)
		if strings.Contains(event.Type, ".item.agentMessage.delta") && data.ItemID != "" {
			message := itemMessages[data.ItemID]
			if message == nil {
				message = &strings.Builder{}
				itemMessages[data.ItemID] = message
				itemOrder = append(itemOrder, data.ItemID)
			}
			message.WriteString(data.Delta)
		}
		if event.Type == "assistant.message.delta" {
			streamed.WriteString(data.Delta)
		}
		if event.Type == "assistant.message.completed" && data.Text != "" {
			completed = data.Text
		}
		if event.Type == "assistant.final.completed" && data.Text != "" {
			final = data.Text
		}
	}
	if final != "" {
		return final, last
	}
	if len(itemOrder) > 0 {
		return itemMessages[itemOrder[len(itemOrder)-1]].String(), last
	}
	if completed != "" {
		return completed, last
	}
	return streamed.String(), last
}

func visibleAssistantContent(status relay.RunStatus, events []relay.Event, result *relay.Result) (string, int) {
	content, last := assistantContent(events)
	if !terminal(status) {
		return "", last
	}
	if strings.TrimSpace(content) == "" && result != nil {
		content = result.Summary
	}
	return content, last
}
func terminal(status relay.RunStatus) bool {
	return status == relay.RunSucceeded || status == relay.RunFailed || status == relay.RunCancelled
}
func value(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
func truncate(v string, n int) string {
	r := []rune(v)
	if len(r) <= n {
		return v
	}
	return string(r[:n])
}
func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return "Artifact"
}

func decodeJSON(r *http.Request, out any) error {
	decoder := json.NewDecoder(io.LimitReader(r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return fmt.Errorf("invalid request: %w", err)
	}
	return nil
}
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	var postgresError *pgconn.PgError
	if errors.As(err, &postgresError) && postgresError.Code == "23505" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "An item with this name already exists in this workspace."})
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		status = http.StatusNotFound
	} else if errors.Is(err, store.ErrConflict) {
		status = http.StatusConflict
	}
	slog.Error("request failed", "error", err)
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && s.allowedOrigins[origin] {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Steer-Workspace")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		slog.Info("request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(started))
	})
}
func (s *Server) recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				slog.Error("panic", "error", recovered)
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}
