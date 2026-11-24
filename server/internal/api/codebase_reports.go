package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/KDF5000/steer/server/internal/store"
)

const (
	// maxCodebaseReportRunes caps the comment body. Codebase comments are
	// markdown; a review can be long, so the summary is truncated instead of
	// failing the writeback.
	maxCodebaseReportRunes = 60000
	codebaseReportMarker   = "<!-- steer-review:%s -->"
)

// reportCodebaseRun publishes a finished review as a merge request comment.
// The run is claimed first, so parallel sync loops and multiple server
// replicas cannot post the same review twice. Failures are stored on the run
// and retried by the background worker without rerunning the Agent.
func (s *Server) reportCodebaseRun(ctx context.Context, wid string, run store.CodebaseRun) (store.CodebaseRun, error) {
	if run.Status != "succeeded" || run.ReportStatus == "sent" || run.ReportStatus == "sending" || run.ReportStatus == "skipped" {
		return run, nil
	}
	workflow, err := s.store.CodebaseWorkflow(ctx, wid, run.WorkflowID)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return run, err
	}
	if err == nil && !workflow.ReportEnabled {
		// Check before claiming or resolving credentials: disabled workflows do
		// not read comments, publish results, or consume report retries.
		return s.store.SkipAutomaticCodebaseRunReport(ctx, wid, run.ID, "")
	}
	if strings.TrimSpace(run.Summary) == "" {
		// A succeeded run without a summary cannot be published; mark it so the
		// worker does not retry it forever.
		return s.store.SkipAutomaticCodebaseRunReport(ctx, wid, run.ID, "Review produced no summary.")
	}
	claimed, err := s.store.ClaimCodebaseRunReport(ctx, wid, run.ID)
	if err != nil {
		return run, err
	}
	if !claimed {
		return s.store.CodebaseRun(ctx, wid, run.ID)
	}
	updated, reportErr := s.writeCodebaseReport(ctx, wid, workflow, run)
	if reportErr != nil {
		return s.store.UpdateCodebaseRunReport(ctx, wid, run.ID, "failed", reportErr.Error(), "")
	}
	return updated, nil
}

// publishCodebaseRun is an explicit owner action for the stored review result.
// Shared workflow grants remain read-only and cannot reach this writeback path.
func (s *Server) publishCodebaseRun(w http.ResponseWriter, r *http.Request) {
	wid := s.workspace(r)
	run, err := s.store.CodebaseRun(r.Context(), wid, r.PathValue("id"))
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	if run.Status != "succeeded" || strings.TrimSpace(run.Summary) == "" {
		writeCodebaseError(w, invalidCodebase("Only a successful review with a summary can be written back."))
		return
	}
	if run.ReportStatus == "sent" || run.ReportStatus == "sending" {
		writeJSON(w, http.StatusOK, run)
		return
	}
	workflow, err := s.store.CodebaseWorkflow(r.Context(), wid, run.WorkflowID)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	claimed, err := s.store.ClaimManualCodebaseRunReport(r.Context(), wid, run.ID)
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	if !claimed {
		run, err = s.store.CodebaseRun(r.Context(), wid, run.ID)
	} else {
		// Once claimed, finish the external write and persist its outcome even
		// if the browser closes, so the result is not stranded in "sending".
		reportCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 45*time.Second)
		defer cancel()
		updated, reportErr := s.writeCodebaseReport(reportCtx, wid, workflow, run)
		if reportErr != nil {
			persistCtx, persistCancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
			defer persistCancel()
			run, err = s.store.UpdateCodebaseRunReport(persistCtx, wid, run.ID, "failed", reportErr.Error(), "")
		} else {
			run = updated
		}
	}
	if err != nil {
		writeCodebaseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

func (s *Server) writeCodebaseReport(ctx context.Context, wid string, workflow store.CodebaseWorkflow, run store.CodebaseRun) (store.CodebaseRun, error) {
	connection, credentials, err := s.storedCodebaseCredentialByWorkspace(ctx, wid)
	if err != nil {
		return run, err
	}
	mrID, err := s.codebaseMergeRequestID(ctx, wid, connection.BaseURL, credentials, run)
	if err != nil {
		return run, err
	}
	marker := fmt.Sprintf(codebaseReportMarker, run.WorkflowID)
	content := buildCodebaseReport(workflow, run, marker)
	commentID, err := s.findCodebaseReviewComment(ctx, connection.BaseURL, credentials, run.RepoID, mrID, marker)
	if err != nil {
		return run, err
	}
	if commentID != "" {
		// Re-reviewing an updated MR updates the previous comment in place so
		// reviewers do not accumulate stale duplicates.
		err = requestCodebaseOpenAPI(ctx, connection.BaseURL, credentials, "UpdateComment", map[string]any{
			"Id":      commentID,
			"RepoId":  run.RepoID,
			"Content": content,
		}, nil)
	} else {
		err = requestCodebaseOpenAPI(ctx, connection.BaseURL, credentials, "CreateComment", map[string]any{
			"CommentableType": "merge_request",
			"CommentableId":   strconv.FormatInt(mrID, 10),
			"RepoId":          run.RepoID,
			"Content":         content,
		}, nil)
	}
	if err != nil {
		return run, err
	}
	return s.store.UpdateCodebaseRunReport(ctx, wid, run.ID, "sent", "", run.MRURL)
}

// codebaseMergeRequestID resolves the internal merge request ID used by the
// comment API. The synced row is preferred; otherwise the MR is read live.
func (s *Server) codebaseMergeRequestID(ctx context.Context, wid, baseURL string, credentials codebaseOpenAPICredentials, run store.CodebaseRun) (int64, error) {
	mr, err := s.store.CodebaseMergeRequest(ctx, wid, run.RepoID, run.MRIID)
	if err == nil && mr.ID > 0 {
		return mr.ID, nil
	}
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		return 0, err
	}
	detail, err := codebaseMRDetail(ctx, baseURL, credentials, run.RepoID, run.MRIID)
	if err != nil {
		return 0, err
	}
	if detail.ID <= 0 {
		return 0, upstreamCodebase("codebase_api_incompatible", "Codebase did not return a valid merge request.")
	}
	return detail.ID, nil
}

func (s *Server) findCodebaseReviewComment(ctx context.Context, baseURL string, credentials codebaseOpenAPICredentials, repoID string, mrID int64, marker string) (string, error) {
	var result struct {
		Threads []struct {
			Comments []struct {
				ID      string `json:"Id"`
				Content string `json:"Content"`
			} `json:"Comments"`
		} `json:"Threads"`
	}
	err := requestCodebaseOpenAPI(ctx, baseURL, credentials, "ListThreads", map[string]any{
		"CommentableType": "merge_request",
		"CommentableId":   strconv.FormatInt(mrID, 10),
		"RepoId":          repoID,
	}, &result)
	if err != nil {
		return "", err
	}
	for _, thread := range result.Threads {
		for _, comment := range thread.Comments {
			if strings.Contains(comment.Content, marker) {
				return comment.ID, nil
			}
		}
	}
	return "", nil
}

func buildCodebaseReport(workflow store.CodebaseWorkflow, run store.CodebaseRun, marker string) string {
	summary := strings.TrimSpace(run.Summary)
	if runes := []rune(summary); len(runes) > maxCodebaseReportRunes {
		summary = string(runes[:maxCodebaseReportRunes]) + "\n\n… (truncated)"
	}
	var b strings.Builder
	b.WriteString(marker)
	b.WriteString("\n")
	title := workflow.Name
	if title == "" {
		title = "Steer review"
	}
	b.WriteString("### ")
	b.WriteString(title)
	b.WriteString("\n\n")
	b.WriteString(summary)
	b.WriteString("\n\n---\nPosted by Steer")
	if run.Model != "" {
		b.WriteString(" · ")
		b.WriteString(run.Model)
	}
	b.WriteString("\n")
	return b.String()
}
