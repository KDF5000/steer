package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/url"
	"strconv"
	"strings"

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

// codebaseWebhookReview is the subset of a merge request event needed to start
// a review. Codebase payloads are not fully documented, so the parser accepts
// GitLab-style and Codebase-style field names and ignores anything else.
type codebaseWebhookReview struct {
	RepoID   string
	RepoPath string
	MRIID    int
	MRTitle  string
	MRURL    string
	Action   string
	State    string
}

// parseCodebaseMergeRequestWebhook returns false when the payload is not a
// merge request event that should start a review.
func parseCodebaseMergeRequestWebhook(payload json.RawMessage) (codebaseWebhookReview, bool) {
	var root map[string]any
	if err := json.Unmarshal(payload, &root); err != nil || root == nil {
		return codebaseWebhookReview{}, false
	}
	kind := strings.ToLower(strings.ReplaceAll(webhookString(root, "event_type", "object_kind", "event", "type", "EventType", "ObjectKind"), "-", "_"))
	// Native Codebase deliveries identify the resource structurally:
	// {Action, Repository, MergeRequest, Sender}, without an EventType field.
	// Only infer the kind for this shape; an explicit unrelated kind wins.
	if kind == "" && firstWebhookMap(root, "MergeRequest") != nil && firstWebhookMap(root, "Repository") != nil {
		kind = "merge_request"
	}
	switch kind {
	case "merge_request", "merge_request_update", "merge_request_updated", "mr":
	default:
		return codebaseWebhookReview{}, false
	}
	attributes := firstWebhookMap(root, "object_attributes", "merge_request", "MergeRequest")
	if attributes == nil {
		attributes = map[string]any{}
	}
	project := firstWebhookMap(root, "project", "repository", "Repository", "Project")
	if project == nil {
		project = map[string]any{}
	}
	action := strings.ToLower(webhookString(attributes, "action", "Action"))
	if action == "" {
		action = strings.ToLower(webhookString(root, "action", "Action"))
	}
	state := strings.ToLower(webhookString(attributes, "state", "status", "State", "Status"))
	mrIID := webhookInt(attributes, "iid", "IID", "number", "Number")
	if mrIID == 0 {
		mrIID = webhookInt(root, "merge_request_iid", "iid", "number")
	}
	review := codebaseWebhookReview{
		Action:   action,
		State:    state,
		MRIID:    mrIID,
		MRTitle:  webhookString(attributes, "title", "Title"),
		MRURL:    webhookString(attributes, "url", "URL", "web_url"),
		RepoID:   webhookString(project, "id", "Id", "ID"),
		RepoPath: webhookString(project, "path_with_namespace", "path", "Path", "name_with_namespace"),
	}
	if review.RepoID == "" {
		review.RepoID = webhookString(attributes, "target_repo_id", "TargetRepoId", "repo_id", "RepoId")
	}
	if review.RepoPath == "" {
		review.RepoPath = webhookString(root, "repository_path", "repo_path")
	}
	if review.MRIID <= 0 || (review.RepoID == "" && review.RepoPath == "") {
		return codebaseWebhookReview{}, false
	}
	if !review.shouldStart() {
		return review, false
	}
	return review, true
}

// shouldStart filters out state changes that cannot need a new review. Updates,
// pushes and reopens all count as a new revision.
func (r codebaseWebhookReview) shouldStart() bool {
	switch r.State {
	case "closed", "merged", "locked":
		return false
	}
	switch r.Action {
	case "close", "closed", "merge", "merged", "approve", "approved", "unapprove", "unapproved", "destroy", "delete":
		return false
	}
	return true
}

func (s *Server) processCodebaseWebhookEvent(ctx context.Context, event store.CodebaseWebhookEvent) {
	claimed, err := s.store.ClaimCodebaseWebhookEvent(ctx, event.ID)
	if err != nil {
		slog.Warn("codebase webhook claim", "event_id", event.ID, "error", err)
		return
	}
	if !claimed {
		return
	}
	review, ok := parseCodebaseMergeRequestWebhook(event.Payload)
	if !ok {
		reason := "unsupported or invalid MR event"
		if review.MRIID > 0 {
			reason = "MR state or action does not require a review"
		}
		slog.Info("codebase webhook skipped", "event_id", event.ID, "reason", reason,
			"repo_id", review.RepoID, "mr_iid", review.MRIID, "action", review.Action, "state", review.State)
		_ = s.store.MarkCodebaseWebhookEvent(ctx, event.ID, "", false)
		return
	}
	workflows, err := s.store.CodebaseWorkflows(ctx, event.WorkspaceID)
	if err != nil {
		_ = s.store.MarkCodebaseWebhookEvent(ctx, event.ID, err.Error(), true)
		return
	}
	started := 0
	matched := 0
	alreadyRunning := 0
	var failures []string
	for _, workflow := range workflows {
		if !workflow.Enabled || !workflow.TriggerWebhook || workflow.AgentID == "" {
			continue
		}
		if !codebaseWorkflowMatchesRepo(workflow, review) {
			continue
		}
		matched++
		// A review that is still pending or running for this MR already covers
		// the revision; do not queue a second Agent task for it.
		if _, err := s.store.CodebaseRunForMergeRequest(ctx, event.WorkspaceID, workflow.ID, review.MRIID); err == nil {
			alreadyRunning++
			continue
		} else if !errors.Is(err, store.ErrNotFound) {
			failures = append(failures, err.Error())
			continue
		}
		run := store.CodebaseRun{
			ID:          uuid.NewString(),
			WorkspaceID: event.WorkspaceID,
			WorkflowID:  workflow.ID,
			RepoPath:    workflow.RepoPath,
			RepoID:      workflow.RepoID,
			MRIID:       review.MRIID,
			MRTitle:     review.MRTitle,
			MRURL:       sanitizeWebhookURL(review.MRURL),
			Trigger:     "webhook",
			Status:      "pending",
		}
		if mr, err := s.store.CodebaseMergeRequest(ctx, event.WorkspaceID, workflow.RepoID, review.MRIID); err == nil {
			if mr.Title != "" {
				run.MRTitle = mr.Title
			}
			if mr.WebURL != "" {
				run.MRURL = mr.WebURL
			}
		}
		key := "codebase:" + workflow.ID + ":" + strconv.Itoa(review.MRIID) + ":" + strconv.FormatInt(event.ID, 10)
		if _, err := s.startCodebaseRun(ctx, event.WorkspaceID, workflow, run, key); err != nil {
			slog.Warn("codebase webhook review start", "workflow_id", workflow.ID, "mr_iid", review.MRIID, "error", err)
			failures = append(failures, err.Error())
			continue
		}
		started++
	}
	slog.Info("codebase webhook processed", "event_id", event.ID, "repo_id", review.RepoID,
		"mr_iid", review.MRIID, "matched_workflows", matched, "created_runs", started,
		"existing_runs", alreadyRunning, "failed_workflows", len(failures))
	note := ""
	if len(failures) > 0 {
		note = strings.Join(failures, "; ")
	}
	if note != "" && started == 0 {
		_ = s.store.MarkCodebaseWebhookEvent(ctx, event.ID, note, true)
		return
	}
	_ = s.store.MarkCodebaseWebhookEvent(ctx, event.ID, note, false)
}

func codebaseWorkflowMatchesRepo(workflow store.CodebaseWorkflow, review codebaseWebhookReview) bool {
	if review.RepoID != "" && workflow.RepoID != "" && review.RepoID == workflow.RepoID {
		return true
	}
	if review.RepoPath != "" && workflow.RepoPath != "" && strings.EqualFold(review.RepoPath, workflow.RepoPath) {
		return true
	}
	return false
}

func firstWebhookMap(root map[string]any, keys ...string) map[string]any {
	for _, key := range keys {
		if value, ok := root[key].(map[string]any); ok {
			return value
		}
	}
	return nil
}

func webhookString(value map[string]any, keys ...string) string {
	for _, key := range keys {
		raw, ok := value[key]
		if !ok {
			continue
		}
		switch typed := raw.(type) {
		case string:
			if trimmed := strings.TrimSpace(typed); trimmed != "" {
				return trimmed
			}
		case json.Number:
			return typed.String()
		case float64:
			return strconv.FormatInt(int64(typed), 10)
		}
	}
	return ""
}

func webhookInt(value map[string]any, keys ...string) int {
	raw := webhookString(value, keys...)
	if raw == "" {
		return 0
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil {
		return 0
	}
	return parsed
}

// sanitizeWebhookURL keeps only absolute HTTP(S) URLs so a payload cannot inject
// a javascript: or credential-bearing link into the run record.
func sanitizeWebhookURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Hostname() == "" || parsed.User != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return ""
	}
	return parsed.String()
}
