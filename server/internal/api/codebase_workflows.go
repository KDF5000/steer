package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
	"github.com/google/uuid"
)

func mapCodebaseRunStatus(taskStatus string) string {
	switch taskStatus {
	case "succeeded":
		return "succeeded"
	case "failed", "cancelled", "canceled":
		return "failed"
	case "running", "queued", "pending":
		return "running"
	}
	return "running"
}

// ---- Workflows ----

func (s *Server) listCodebaseWorkflows(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.CodebaseWorkflows(r.Context(), s.workspace(r))
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

type codebaseWorkflowInput struct {
	Name               string   `json:"name"`
	RepoPath           string   `json:"repoPath"`
	AgentID            string   `json:"agentId"`
	ReviewInstruction  string   `json:"reviewInstruction"`
	Model              string   `json:"model"`
	ReasoningEffort    string   `json:"reasoningEffort"`
	SkillIDs           []string `json:"skillIds"`
	ReportEnabled      *bool    `json:"reportEnabled"`
	TriggerWebhook     *bool    `json:"triggerWebhook"`
	SkipDraft          *bool    `json:"skipDraft"`
	AutoLabelEnabled   *bool    `json:"autoLabelEnabled"`
	AutoApproveEnabled *bool    `json:"autoApproveEnabled"`
	RequireCIGreen     *bool    `json:"requireCiGreen"`
	Enabled            *bool    `json:"enabled"`
}

func (in *codebaseWorkflowInput) normalize() {
	in.Name = strings.TrimSpace(in.Name)
	in.RepoPath = strings.TrimSpace(in.RepoPath)
	in.AgentID = strings.TrimSpace(in.AgentID)
	in.ReviewInstruction = strings.TrimSpace(in.ReviewInstruction)
	in.Model = strings.TrimSpace(in.Model)
	in.ReasoningEffort = strings.TrimSpace(in.ReasoningEffort)
	seen := make(map[string]bool, len(in.SkillIDs))
	skillIDs := make([]string, 0, len(in.SkillIDs))
	for _, id := range in.SkillIDs {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		skillIDs = append(skillIDs, id)
	}
	in.SkillIDs = skillIDs
}

// validateReviewSettings checks the run configuration independently of a live
// Relay Node. Model/Effort support is re-validated when the review actually
// starts, so a workflow can be saved while the machine is offline.
func (s *Server) validateReviewSettings(ctx context.Context, wid string, in codebaseWorkflowInput) error {
	if len(in.Model) > 256 || strings.ContainsAny(in.Model, "\r\n\x00") {
		return invalidCodebase("Invalid model name.")
	}
	if in.ReasoningEffort != "" {
		switch in.ReasoningEffort {
		case "none", "minimal", "low", "medium", "high", "xhigh", "max":
		default:
			return invalidCodebase("Invalid reasoning Effort.")
		}
	}
	if len(in.SkillIDs) > 20 {
		return invalidCodebase("A workflow can use at most 20 Skills.")
	}
	if len(in.SkillIDs) == 0 {
		return nil
	}
	skills, err := s.store.SkillsByIDs(ctx, wid, in.SkillIDs)
	if err != nil {
		return err
	}
	if len(skills) != len(in.SkillIDs) {
		return invalidCodebase("Select Skills in this workspace.")
	}
	return nil
}

func (s *Server) resolveCodebaseRepo(r *http.Request, path string) (store.CodebaseWorkflow, error) {
	var workflow store.CodebaseWorkflow
	if !validCodebaseProject(path) {
		return workflow, invalidCodebase("Repository must be a namespace/project path.")
	}
	c, credentials, err := s.storedCodebaseCredential(r)
	if err != nil {
		return workflow, err
	}
	repo, err := codebaseRepository(r.Context(), c.BaseURL, credentials, path)
	if err != nil {
		return workflow, err
	}
	workflow.RepoPath = repo.Path
	workflow.RepoID = repo.ID
	workflow.RepoName = repo.Name
	return workflow, nil
}

func (s *Server) createCodebaseWorkflow(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	var in codebaseWorkflowInput
	if err := decodeJSON(r, &in); err != nil {
		writeCodebaseError(w, invalidCodebase("Invalid workflow input."))
		return
	}
	in.normalize()
	if in.Name == "" || len(in.Name) > 120 {
		writeCodebaseError(w, invalidCodebase("Workflow name is required (max 120 characters)."))
		return
	}
	if in.AgentID == "" {
		writeCodebaseError(w, invalidCodebase("Select a reviewer agent."))
		return
	}
	if _, err := s.store.Agent(r.Context(), wid, in.AgentID); err != nil {
		writeCodebaseError(w, invalidCodebase("Select an agent in this workspace."))
		return
	}
	if err := s.validateReviewSettings(r.Context(), wid, in); err != nil {
		writeCodebaseError(w, err)
		return
	}
	repo, err := s.resolveCodebaseRepo(r, in.RepoPath)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	// Creating a workflow also registers the repository, so it appears in the
	// repository list and can be synced from there.
	if _, err = s.store.AddCodebaseRepository(r.Context(), wid, repo.RepoID, repo.RepoPath, repo.RepoName); err != nil {
		writeCodebaseError(w, err)
		return
	}
	trigger := true
	if in.TriggerWebhook != nil {
		trigger = *in.TriggerWebhook
	}
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	reportEnabled := true
	if in.ReportEnabled != nil {
		reportEnabled = *in.ReportEnabled
	}
	skipDraft := true
	if in.SkipDraft != nil {
		skipDraft = *in.SkipDraft
	}
	autoLabelEnabled := false
	if in.AutoLabelEnabled != nil {
		autoLabelEnabled = *in.AutoLabelEnabled
	}
	autoApproveEnabled := false
	if in.AutoApproveEnabled != nil {
		autoApproveEnabled = *in.AutoApproveEnabled
	}
	requireCIGreen := true
	if in.RequireCIGreen != nil {
		requireCIGreen = *in.RequireCIGreen
	}
	item := store.CodebaseWorkflow{
		ID:                 uuid.NewString(),
		WorkspaceID:        wid,
		Name:               in.Name,
		RepoPath:           repo.RepoPath,
		RepoID:             repo.RepoID,
		RepoName:           repo.RepoName,
		AgentID:            in.AgentID,
		ReviewInstruction:  in.ReviewInstruction,
		Model:              in.Model,
		ReasoningEffort:    in.ReasoningEffort,
		SkillIDs:           in.SkillIDs,
		ReportEnabled:      reportEnabled,
		TriggerWebhook:     trigger,
		SkipDraft:          skipDraft,
		AutoLabelEnabled:   autoLabelEnabled,
		AutoApproveEnabled: autoApproveEnabled,
		RequireCIGreen:     requireCIGreen,
		Enabled:            enabled,
	}
	saved, err := s.store.CreateCodebaseWorkflow(r.Context(), item)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) updateCodebaseWorkflow(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	existing, err := s.store.CodebaseWorkflow(r.Context(), wid, r.PathValue("id"))
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	var in codebaseWorkflowInput
	if err := decodeJSON(r, &in); err != nil {
		writeCodebaseError(w, invalidCodebase("Invalid workflow input."))
		return
	}
	in.normalize()
	if in.Name == "" || len(in.Name) > 120 {
		writeCodebaseError(w, invalidCodebase("Workflow name is required (max 120 characters)."))
		return
	}
	if in.AgentID == "" {
		writeCodebaseError(w, invalidCodebase("Select a reviewer agent."))
		return
	}
	if _, err := s.store.Agent(r.Context(), wid, in.AgentID); err != nil {
		writeCodebaseError(w, invalidCodebase("Select an agent in this workspace."))
		return
	}
	if err := s.validateReviewSettings(r.Context(), wid, in); err != nil {
		writeCodebaseError(w, err)
		return
	}
	item := existing
	item.Name = in.Name
	item.AgentID = in.AgentID
	item.ReviewInstruction = in.ReviewInstruction
	item.Model = in.Model
	item.ReasoningEffort = in.ReasoningEffort
	item.SkillIDs = in.SkillIDs
	if in.ReportEnabled != nil {
		item.ReportEnabled = *in.ReportEnabled
	}
	if in.TriggerWebhook != nil {
		item.TriggerWebhook = *in.TriggerWebhook
	}
	if in.SkipDraft != nil {
		item.SkipDraft = *in.SkipDraft
	}
	if in.AutoLabelEnabled != nil {
		item.AutoLabelEnabled = *in.AutoLabelEnabled
	}
	if in.AutoApproveEnabled != nil {
		item.AutoApproveEnabled = *in.AutoApproveEnabled
	}
	if in.RequireCIGreen != nil {
		item.RequireCIGreen = *in.RequireCIGreen
	}
	if in.Enabled != nil {
		item.Enabled = *in.Enabled
	}
	// Re-verify the repository only when the path changes, so unchanged workflows
	// can be edited without a live Codebase call.
	if in.RepoPath != "" && in.RepoPath != existing.RepoPath {
		repo, err := s.resolveCodebaseRepo(r, in.RepoPath)
		if err != nil {
			writeCodebaseError(w, err)
			return
		}
		item.RepoPath = repo.RepoPath
		item.RepoID = repo.RepoID
		item.RepoName = repo.RepoName
		if _, err = s.store.AddCodebaseRepository(r.Context(), wid, repo.RepoID, repo.RepoPath, repo.RepoName); err != nil {
			writeCodebaseError(w, err)
			return
		}
	}
	saved, err := s.store.UpdateCodebaseWorkflow(r.Context(), item)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) deleteCodebaseWorkflow(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteCodebaseWorkflow(r.Context(), s.workspace(r), r.PathValue("id")); err != nil {
		writeCodebaseError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---- Runs ----

func (s *Server) listCodebaseRuns(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("page") != "" {
		s.listCodebaseRunPage(w, r)
		return
	}
	wid := s.workspace(r)
	q := r.URL.Query()
	workflowID := strings.TrimSpace(q.Get("workflowId"))
	repoID := strings.TrimSpace(q.Get("repoId"))
	limit := 0
	if q.Get("limit") != "" {
		limit, _ = strconv.Atoi(q.Get("limit"))
	}
	items, err := s.store.CodebaseRuns(r.Context(), wid, workflowID, repoID, limit)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	if q.Get("sync") == "true" {
		items = s.syncCodebaseRuns(r.Context(), wid, items, 20)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// syncCodebaseRuns refreshes non-terminal runs that are linked to a Steer task,
// bounded by maxSync to avoid hammering Relay on large lists.
func (s *Server) syncCodebaseRuns(ctx context.Context, wid string, items []store.CodebaseRun, maxSync int) []store.CodebaseRun {
	synced := 0
	for i := range items {
		if synced >= maxSync {
			break
		}
		run := items[i]
		if run.TaskID == "" || run.Status == "succeeded" || run.Status == "failed" || run.Status == "skipped" {
			continue
		}
		task, err := s.store.Task(ctx, wid, run.TaskID)
		if err != nil {
			continue
		}
		if task.RelayRunID != "" {
			if _, err := s.syncRelayRun(ctx, wid, task.RelayRunID); err != nil {
				// Relay may be temporarily unavailable; fall back to the stored task row.
			}
			task, err = s.store.Task(ctx, wid, run.TaskID)
			if err != nil {
				continue
			}
		}
		status := mapCodebaseRunStatus(task.Status)
		var summary, runErr string
		if task.Result != nil {
			summary = *task.Result
		}
		var rawSummaryForMeta string
		if status == "succeeded" {
			rawSummaryForMeta = summary
			if md, ok := s.extractCodebaseRunReviewMarkdown(ctx, wid, task); ok {
				summary = md
			}
			summary = cleanCodebaseReviewSummary(summary)
		}
		if task.Error != nil {
			runErr = *task.Error
		}
		var started, finished *time.Time
		if status == "running" && run.StartedAt == nil {
			now := time.Now().UTC()
			started = &now
		} else if run.StartedAt != nil {
			started = run.StartedAt
		}
		if (status == "succeeded" || status == "failed") && run.FinishedAt == nil {
			now := time.Now().UTC()
			finished = &now
		}
		updated, err := s.store.UpdateCodebaseRun(ctx, wid, run.ID, status, summary, runErr, "", "", started, finished)
		if err == nil {
			if updated.Status == "succeeded" && len(updated.ReviewJSON) == 0 {
				if meta, ok := s.extractCodebaseRunReviewMeta(ctx, wid, task, rawSummaryForMeta); ok {
					if withMeta, metaErr := s.store.UpdateCodebaseRunReviewResult(ctx, wid, updated.ID, meta); metaErr == nil {
						updated = withMeta
					}
				}
			}
			items[i] = updated
			synced++
			if updated.Status == "succeeded" && updated.ReportStatus != "sent" && updated.ReportStatus != "sending" {
				if reported, reportErr := s.reportCodebaseRun(ctx, wid, updated); reportErr == nil {
					items[i] = reported
				}
			}
		}
	}
	return items
}

func (s *Server) createCodebaseRun(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	workflow, err := s.store.CodebaseWorkflow(r.Context(), wid, r.PathValue("id"))
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	if workflow.AgentID == "" {
		writeCodebaseError(w, invalidCodebase("Assign a reviewer agent to this workflow before running a review."))
		return
	}
	var input struct {
		MRIID   int    `json:"mrIid"`
		MRTitle string `json:"mrTitle"`
		MRURL   string `json:"mrUrl"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeCodebaseError(w, invalidCodebase("Invalid run input."))
		return
	}
	if input.MRIID <= 0 {
		writeCodebaseError(w, invalidCodebase("A valid MR number is required."))
		return
	}
	// Reviews run against the persisted merge request so a stale client cannot
	// substitute a different title or URL for the MR that is actually reviewed.
	mr, err := s.store.CodebaseMergeRequest(r.Context(), wid, workflow.RepoID, input.MRIID)
	if errors.Is(err, store.ErrNotFound) {
		writeCodebaseError(w, invalidCodebase("Sync this repository before starting a review."))
		return
	}
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	now := time.Now().UTC()
	run := store.CodebaseRun{
		ID:              uuid.NewString(),
		WorkspaceID:     wid,
		WorkflowID:      workflow.ID,
		RepoPath:        workflow.RepoPath,
		RepoID:          workflow.RepoID,
		MRIID:           mr.IID,
		MRTitle:         mr.Title,
		MRURL:           mr.WebURL,
		HeadSHA:         mr.HeadSHA,
		Trigger:         "manual",
		Status:          "pending",
		Model:           workflow.Model,
		ReasoningEffort: workflow.ReasoningEffort,
		StartedAt:       &now,
	}
	run, err = s.startCodebaseRun(r.Context(), wid, workflow, run, "")
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

// startCodebaseRun creates the run row, submits the reviewer task, and records
// the task link. A submission failure is stored on the run and returned as a
// normal result so callers (manual and webhook) surface the same state.
func (s *Server) startCodebaseRun(ctx context.Context, wid string, workflow store.CodebaseWorkflow, run store.CodebaseRun, idempotencyKey string) (store.CodebaseRun, error) {
	if run.ID == "" {
		run.ID = uuid.NewString()
	}
	run.WorkspaceID = wid
	run.WorkflowID = workflow.ID
	run.RepoPath = workflow.RepoPath
	run.RepoID = workflow.RepoID
	run.Model = workflow.Model
	run.ReasoningEffort = workflow.ReasoningEffort
	if !workflow.ReportEnabled {
		run.ReportStatus = "skipped"
	}
	if run.StartedAt == nil {
		now := time.Now().UTC()
		run.StartedAt = &now
	}
	if mr, err := s.store.CodebaseMergeRequest(ctx, wid, workflow.RepoID, run.MRIID); err == nil {
		if run.HeadSHA == "" && mr.HeadSHA != "" {
			run.HeadSHA = mr.HeadSHA
		}
	}
	if run.Round < 1 {
		run.Round = 1
	}
	if prev, err := s.store.LatestCodebaseRunWithReview(ctx, wid, workflow.ID, run.MRIID); err == nil && len(prev.ReviewJSON) > 0 {
		if prev.Round >= run.Round {
			run.Round = prev.Round + 1
		}
	}
	run, err := s.store.CreateCodebaseRun(ctx, run)
	if err != nil {
		return run, err
	}
	return s.submitReservedCodebaseRun(ctx, wid, workflow, run, idempotencyKey)
}

// submitReservedCodebaseRun dispatches the Agent task for an already-persisted
// codebase_runs row (used by both manual runs and atomically reserved webhook runs).
func (s *Server) submitReservedCodebaseRun(ctx context.Context, wid string, workflow store.CodebaseWorkflow, run store.CodebaseRun, idempotencyKey string) (store.CodebaseRun, error) {
	var mrDescription string
	if mr, err := s.store.CodebaseMergeRequest(ctx, wid, workflow.RepoID, run.MRIID); err == nil {
		mrDescription = mr.Description
	}
	var priorReviewJSON json.RawMessage
	if prev, err := s.store.LatestCodebaseRunWithReview(ctx, wid, workflow.ID, run.MRIID); err == nil && prev.ID != run.ID && len(prev.ReviewJSON) > 0 {
		priorReviewJSON = prev.ReviewJSON
	}
	prompt := buildReviewPrompt(workflow, run, mrDescription, priorReviewJSON)
	meta, _ := json.Marshal(map[string]any{
		"source":       "codebase",
		"workflowId":   workflow.ID,
		"workflowName": workflow.Name,
		"repoPath":     workflow.RepoPath,
		"mrIid":        run.MRIID,
		"headSha":      run.HeadSHA,
		"round":        run.Round,
		"runId":        run.ID,
		"trigger":      run.Trigger,
	})
	result, _, submitErr := s.submitConversationTask(ctx, wid, chatRequest{
		AgentID:         workflow.AgentID,
		Model:           optionalTrimmed(workflow.Model),
		ReasoningEffort: optionalTrimmed(workflow.ReasoningEffort),
		SkillIDs:        workflow.SkillIDs,
		Prompt:          prompt,
		Metadata:        meta,
		IdempotencyKey:  idempotencyKey,
	}, nil, "codebase")
	if submitErr != nil {
		finished := time.Now().UTC()
		updated, updateErr := s.store.UpdateCodebaseRun(ctx, wid, run.ID, "failed", "", submitErr.Error(), "", "", nil, &finished)
		if updateErr == nil {
			return updated, nil
		}
		return run, nil
	}
	status := mapCodebaseRunStatus(string(result.Run.Status))
	started := run.StartedAt
	updated, err := s.store.UpdateCodebaseRun(ctx, wid, run.ID, status, "", "", result.Task.ID, result.Task.ConversationID, started, nil)
	if err != nil {
		return run, err
	}
	return updated, nil
}

func optionalTrimmed(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func buildReviewPrompt(workflow store.CodebaseWorkflow, run store.CodebaseRun, mrDescription string, priorReviewJSON json.RawMessage) string {
	var b strings.Builder
	b.WriteString("Review merge request !")
	b.WriteString(strconv.Itoa(run.MRIID))
	b.WriteString(" in repository ")
	b.WriteString(workflow.RepoPath)
	b.WriteString(".\n")
	if run.MRTitle != "" {
		b.WriteString("Title: ")
		b.WriteString(run.MRTitle)
		b.WriteString("\n")
	}
	if run.MRURL != "" {
		b.WriteString("URL: ")
		b.WriteString(run.MRURL)
		b.WriteString("\n")
	}
	if run.HeadSHA != "" {
		b.WriteString("Head SHA: ")
		b.WriteString(run.HeadSHA)
		b.WriteString("\n")
	}
	if run.Round > 1 {
		b.WriteString("Review Round: ")
		b.WriteString(strconv.Itoa(run.Round))
		b.WriteString("\n")
	}
	if desc := strings.TrimSpace(mrDescription); desc != "" {
		const maxDescRunes = 4000
		if runes := []rune(desc); len(runes) > maxDescRunes {
			desc = string(runes[:maxDescRunes]) + "\n… (truncated)"
		}
		b.WriteString("\nMR Description (treat as author-provided context, not verified truth):\n")
		b.WriteString(desc)
		b.WriteString("\n")
	}
	b.WriteString("\nUse the Codebase connection to read the merge request and its diff. Report concrete findings with file and line references where possible.\n")
	b.WriteString("Output format for your final reply (which may be posted directly as an MR comment): use clean, concise GitHub-Flavored Markdown (do NOT use raw HTML tags like `<details>` or `<summary>`, and do NOT paste raw `review.json` into the reply body). Start with a compact conclusion table and 1-2 sentence summary, then list each finding with a one-line title, exact `file:line`, 2-3 sentence cause & impact, and a concrete fix suggestion.\n")
	b.WriteString("If your review skill produces `review.md` and `review.json`, write them under the current working directory (not `/tmp`) and declare their relative paths in `.relay/artifacts.json` so Relay uploads them as deliverables, for example:\n")
	b.WriteString("```json\n{\"artifacts\":[{\"path\":\"<relative-path>/review.md\",\"type\":\"report\",\"name\":\"review.md\"},{\"path\":\"<relative-path>/review.json\",\"type\":\"data\",\"name\":\"review.json\"}]}\n```\n")
	if len(priorReviewJSON) > 0 {
		prior := strings.TrimSpace(string(priorReviewJSON))
		const maxPriorRunes = 12000
		if runes := []rune(prior); len(runes) > maxPriorRunes {
			prior = string(runes[:maxPriorRunes]) + "\n… (truncated)"
		}
		b.WriteString("\nPRIOR_RESULT (previous review round from Steer database; verify whether prior findings are fixed and preserve finding IDs):\n```json\n")
		b.WriteString(prior)
		b.WriteString("\n```\n")
	}
	if workflow.ReviewInstruction != "" {
		b.WriteString("\nReview guidance:\n")
		b.WriteString(workflow.ReviewInstruction)
		b.WriteString("\n")
	}
	return b.String()
}

func (s *Server) syncCodebaseRun(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	run, err := s.store.CodebaseRun(r.Context(), wid, r.PathValue("id"))
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	items := s.syncCodebaseRuns(r.Context(), wid, []store.CodebaseRun{run}, 1)
	if len(items) == 1 {
		writeJSON(w, http.StatusOK, items[0])
		return
	}
	writeJSON(w, http.StatusOK, run)
}
