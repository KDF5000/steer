package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/KDF5000/relay"
	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

type submittedTask struct {
	Task      store.Task
	Run       relay.Run
	User      store.Message
	Assistant store.Message
}

type taskRequestError struct {
	Status  int
	Message string
}

func (e taskRequestError) Error() string { return e.Message }

func writeTaskError(w http.ResponseWriter, err error) {
	var requestErr taskRequestError
	if errors.As(err, &requestErr) {
		writeJSON(w, requestErr.Status, map[string]string{"error": requestErr.Message})
		return
	}
	writeError(w, err)
}

func (s *Server) createTask(w http.ResponseWriter, r *http.Request) {
	in, attachments, err := decodeChatRequest(w, r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if conversationID := strings.TrimSpace(r.PathValue("id")); conversationID != "" {
		if in.SessionID != nil && strings.TrimSpace(*in.SessionID) != "" && strings.TrimSpace(*in.SessionID) != conversationID {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "conversationId does not match the URL"})
			return
		}
		in.SessionID = &conversationID
	}
	if in.SessionID != nil && in.ConversationID != nil && strings.TrimSpace(*in.SessionID) != "" && strings.TrimSpace(*in.ConversationID) != "" && strings.TrimSpace(*in.SessionID) != strings.TrimSpace(*in.ConversationID) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "sessionId and conversationId must match"})
		return
	}
	if in.SessionID == nil && in.ConversationID != nil {
		in.SessionID = in.ConversationID
	}
	if header := strings.TrimSpace(r.Header.Get("Idempotency-Key")); header != "" {
		if in.IdempotencyKey != "" && in.IdempotencyKey != header {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "idempotencyKey does not match the Idempotency-Key header"})
			return
		}
		in.IdempotencyKey = header
	}
	if len(in.IdempotencyKey) > 200 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Idempotency-Key must not exceed 200 characters"})
		return
	}
	source := "web"
	if _, ok := r.Context().Value(apiKeyContextKey).(store.WorkspaceAPIKey); ok {
		source = "api"
	}
	result, reused, err := s.submitConversationTask(r.Context(), s.workspace(r), in, attachments, source)
	if errors.Is(err, store.ErrConversationBusy) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "This conversation already has an active task.", "code": "conversation_busy"})
		return
	}
	if err != nil {
		writeTaskError(w, err)
		return
	}
	status := http.StatusAccepted
	if reused {
		status = http.StatusOK
	}
	writeJSON(w, status, taskSubmissionResponse(result))
}

func (s *Server) chatTask(w http.ResponseWriter, r *http.Request) {
	in, attachments, err := decodeChatRequest(w, r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	// The compatibility route intentionally retains its historical response
	// shape while using the exact same task execution path.
	result, _, err := s.submitConversationTask(r.Context(), s.workspace(r), in, attachments, "chat")
	if errors.Is(err, store.ErrConversationBusy) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "This conversation already has an active task."})
		return
	}
	if err != nil {
		writeTaskError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"sessionId": result.Task.ConversationID, "runId": result.Run.ID, "status": result.Run.Status, "userMessage": result.User, "assistantMessage": result.Assistant})
}

func taskSubmissionResponse(result submittedTask) map[string]any {
	return map[string]any{
		"taskId":           result.Task.ID,
		"conversationId":   result.Task.ConversationID,
		"sessionId":        result.Task.ConversationID,
		"runId":            result.Task.RelayRunID,
		"status":           result.Task.Status,
		"task":             result.Task,
		"userMessage":      result.User,
		"assistantMessage": result.Assistant,
	}
}

func (s *Server) submitConversationTask(ctx context.Context, wid string, in chatRequest, attachments []store.MessageAttachment, source string) (submittedTask, bool, error) {
	in.Prompt = strings.TrimSpace(in.Prompt)
	in.AgentID = strings.TrimSpace(in.AgentID)
	in.IdempotencyKey = strings.TrimSpace(in.IdempotencyKey)
	if (in.Prompt == "" && len(attachments) == 0) || in.AgentID == "" {
		return submittedTask{}, false, taskRequestError{Status: http.StatusBadRequest, Message: "a prompt or image, and agentId are required"}
	}
	if in.IdempotencyKey != "" {
		existing, err := s.store.TaskByIdempotencyKey(ctx, wid, in.IdempotencyKey)
		if err == nil {
			user, assistant, messageErr := s.store.TaskMessages(ctx, wid, existing)
			if messageErr != nil {
				return submittedTask{}, false, messageErr
			}
			return submittedTask{Task: existing, Run: relay.Run{ID: existing.RelayRunID, Status: relay.RunStatus(existing.Status)}, User: user, Assistant: assistant}, true, nil
		}
		if !errors.Is(err, store.ErrNotFound) {
			return submittedTask{}, false, err
		}
	}

	agent, err := s.store.Agent(ctx, wid, in.AgentID)
	if err != nil {
		return submittedTask{}, false, err
	}
	conversationID := uuid.NewString()
	if in.SessionID != nil && strings.TrimSpace(*in.SessionID) != "" {
		conversationID = strings.TrimSpace(*in.SessionID)
	} else if in.IdempotencyKey != "" {
		conversationID = uuid.NewSHA1(uuid.NameSpaceURL, []byte(wid+":"+in.IdempotencyKey)).String()
	}
	var project *store.Project
	if in.ProjectID != nil && strings.TrimSpace(*in.ProjectID) != "" {
		selected, projectErr := s.store.Project(ctx, wid, strings.TrimSpace(*in.ProjectID))
		if projectErr != nil {
			return submittedTask{}, false, projectErr
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
				return submittedTask{}, false, taskRequestError{Status: http.StatusConflict, Message: "Directory projects require a fixed Runtime. Edit or recreate this Project with a Runtime location."}
			}
		} else if project.WorkspaceKind == "git" {
			key := "steer/" + wid + "/" + conversationID
			workspaceKey = &key
		}
	}
	if executionRuntimeID == nil || strings.TrimSpace(*executionRuntimeID) == "" {
		resolvedRuntimeID, resolveErr := s.firstWorkspaceRuntime(ctx, wid, agent.RuntimeProvider)
		if resolveErr != nil {
			return submittedTask{}, false, resolveErr
		}
		executionRuntimeID = &resolvedRuntimeID
	}
	session, err := s.store.EnsureSession(ctx, wid, conversationID, truncate(title, 72), agent.ID, in.ProjectID, executionRuntimeID, workspaceKey, project)
	if err != nil {
		return submittedTask{}, false, err
	}
	if in.ProjectID != nil && (session.ProjectID == nil || *in.ProjectID != *session.ProjectID) {
		return submittedTask{}, false, taskRequestError{Status: http.StatusConflict, Message: "session is already linked to another project"}
	}
	if project == nil && session.ProjectID != nil {
		selected, projectErr := s.store.Project(ctx, wid, *session.ProjectID)
		if projectErr != nil {
			return submittedTask{}, false, projectErr
		}
		project = &selected
	}
	if session.ExecutionRuntimeID != nil && strings.TrimSpace(*session.ExecutionRuntimeID) != "" {
		executionRuntimeID = session.ExecutionRuntimeID
	}
	if agent.RuntimeID != nil && executionRuntimeID != nil && *agent.RuntimeID != *executionRuntimeID {
		return submittedTask{}, false, taskRequestError{Status: http.StatusConflict, Message: "The selected Agent is fixed to a different Runtime. Fork the conversation to change execution location."}
	}
	if executionRuntimeID != nil {
		provider, providerErr := s.runtimeProvider(ctx, wid, *executionRuntimeID)
		if providerErr != nil {
			return submittedTask{}, false, providerErr
		}
		if provider != agent.RuntimeProvider {
			return submittedTask{}, false, taskRequestError{Status: http.StatusConflict, Message: "The selected Agent uses a provider that is unavailable on this conversation's Runtime."}
		}
	}

	release, err := s.store.TryConversationLock(ctx, wid, conversationID)
	if err != nil {
		return submittedTask{}, false, err
	}
	defer release()
	if active, activeErr := s.store.ActiveConversationTask(ctx, wid, conversationID); activeErr == nil {
		projection, syncErr := s.syncRelayRun(ctx, wid, active.RelayRunID)
		if syncErr != nil || !terminal(projection.Run.Status) {
			return submittedTask{}, false, store.ErrConversationBusy
		}
	} else if !errors.Is(activeErr, store.ErrNotFound) {
		return submittedTask{}, false, activeErr
	}

	if err := s.store.UpdateSessionAgent(ctx, wid, conversationID, agent.ID); err != nil {
		return submittedTask{}, false, err
	}
	previous, err := s.store.Messages(ctx, wid, conversationID)
	if err != nil {
		return submittedTask{}, false, err
	}
	runPrompt := in.Prompt
	if runPrompt == "" {
		runPrompt = "Please inspect the attached image and respond to it."
	}
	input := relay.Input{Type: "text", Version: "1", Prompt: conversationPrompt(previous, runPrompt), ContinuationPrompt: runPrompt}
	if len(attachments) > 0 {
		images := make([]relayInputImage, 0, len(attachments))
		for _, item := range attachments {
			images = append(images, relayInputImage{Name: item.Name, ContentType: item.ContentType, Data: item.Content})
		}
		input.Data, err = json.Marshal(map[string]any{"images": images})
		if err != nil {
			return submittedTask{}, false, err
		}
	}
	relayIdempotencyKey := in.IdempotencyKey
	if relayIdempotencyKey == "" {
		relayIdempotencyKey = uuid.NewString()
	}
	relaySourceKind := "steer.task"
	if source == "chat" {
		relaySourceKind = "steer.chat"
	}
	request := relay.Request{
		TenantID: wid, ProjectID: value(session.ProjectID), SessionID: conversationID, AgentID: agent.ID,
		IdempotencyKey: relayIdempotencyKey,
		Runtime:        relay.RuntimeRequirement{ID: value(executionRuntimeID), Provider: agent.RuntimeProvider, Model: value(agent.Model)},
		Source:         relay.Source{Kind: relaySourceKind, ExternalID: conversationID}, Input: input,
		Principal: relay.Principal{Type: "user", ID: "workspace:" + wid},
	}
	if agent.Instructions != "" {
		request.Instructions.Agent = []relay.InstructionFragment{{ID: agent.ID, Version: "1", Title: agent.Name, Content: agent.Instructions}}
	}
	assignedSkills, err := s.store.AgentSkills(ctx, wid, agent.ID)
	if err != nil {
		return submittedTask{}, false, err
	}
	request.Instructions.Agent = append(request.Instructions.Agent, skillInstructionFragments(assignedSkills)...)
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
	executionMode := value(session.ExecutionMode)
	if executionMode == "" && project != nil {
		executionMode = project.ExecutionMode
	}
	if request.Workspace.Kind == "git" && executionMode == "session_worktree" {
		key := value(session.WorkspaceKey)
		if key == "" {
			key = "steer/" + wid + "/" + conversationID
		}
		request.Workspace.Lifecycle = "reusable"
		request.Workspace.ReuseKey = key
		request.Workspace.Branch = "steer/" + conversationID
	}
	run, err := s.submitRelayRun(ctx, request)
	if err != nil {
		return submittedTask{}, false, fmt.Errorf("submit Relay run: %w", err)
	}
	var idempotencyKey *string
	if in.IdempotencyKey != "" {
		idempotencyKey = &in.IdempotencyKey
	}
	task := store.Task{ID: uuid.NewString(), ConversationID: conversationID, RelayRunID: run.ID, AgentID: agent.ID, Source: source, IdempotencyKey: idempotencyKey, Status: string(run.Status), Metadata: in.Metadata}
	user, assistant, task, err := s.store.SaveTaskRun(ctx, wid, conversationID, agent.ID, in.Prompt, run.ID, string(run.Status), task, attachments...)
	if err != nil {
		return submittedTask{}, false, err
	}
	return submittedTask{Task: task, Run: run, User: user, Assistant: assistant}, false, nil
}

type runProjection struct {
	Run       relay.Run
	Content   string
	Error     *string
	Events    []relay.Event
	Artifacts []relay.Artifact
}

func (s *Server) syncRelayRun(ctx context.Context, wid, runID string) (runProjection, error) {
	run, err := s.relay.GetRun(ctx, runID)
	if err != nil {
		return runProjection{}, err
	}
	events, err := s.relay.Events(ctx, runID)
	if err != nil {
		return runProjection{}, err
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
	artifacts := []relay.Artifact{}
	if terminal(run.Status) {
		artifacts, err = s.relay.Artifacts(ctx, runID)
		if err != nil {
			return runProjection{}, fmt.Errorf("sync deliverables: %w", err)
		}
		link, err := s.store.RunLink(ctx, wid, runID)
		if err != nil {
			return runProjection{}, err
		}
		visible := artifacts[:0]
		for _, artifact := range artifacts {
			if !isDeliverableArtifact(artifact) {
				continue
			}
			visible = append(visible, artifact)
			if err := s.store.UpsertArtifact(ctx, wid, link, artifact.ID, firstNonEmpty(artifact.Name, artifact.Ref, artifact.Type), artifact.Type, artifact.Ref, artifact.ContentType, artifact.Size); err != nil {
				return runProjection{}, err
			}
		}
		artifacts = visible
	}
	if err := s.store.UpdateRun(ctx, wid, runID, string(run.Status), content, runErr, lastSeq); err != nil {
		return runProjection{}, err
	}
	return runProjection{Run: run, Content: content, Error: runErr, Events: events, Artifacts: artifacts}, nil
}

func (s *Server) getTask(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	task, err := s.store.Task(r.Context(), wid, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	projection, err := s.syncRelayRun(r.Context(), wid, task.RelayRunID)
	if err != nil {
		writeError(w, err)
		return
	}
	task, err = s.store.Task(r.Context(), wid, task.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"task": task, "run": projection.Run, "content": projection.Content, "error": projection.Error, "events": projection.Events, "artifacts": projection.Artifacts})
}

func (s *Server) taskArtifacts(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	task, err := s.store.Task(r.Context(), wid, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	if _, err := s.syncRelayRun(r.Context(), wid, task.RelayRunID); err != nil {
		writeError(w, err)
		return
	}
	artifacts, err := s.store.RunArtifacts(r.Context(), wid, task.RelayRunID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, artifacts)
}

func (s *Server) streamTaskEvents(w http.ResponseWriter, r *http.Request) {
	task, err := s.store.Task(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	s.streamRunEventsForID(w, r, task.RelayRunID)
}

func (s *Server) cancelTask(w http.ResponseWriter, r *http.Request) {
	task, err := s.store.Task(r.Context(), s.workspace(r), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	s.cancelRunForID(w, r, task.RelayRunID)
}
