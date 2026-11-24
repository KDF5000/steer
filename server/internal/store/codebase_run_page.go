package store

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
)

type CodebaseRunPageQuery struct {
	WorkflowID    string
	RepoID        string
	Status        string
	IncludeShared bool
	Page          int
	PageSize      int
}

type CodebaseRunPageEntry struct {
	Run     CodebaseRun
	ShareID string
}

type CodebaseRunPage struct {
	Items    []CodebaseRunPageEntry
	Total    int
	Page     int
	PageSize int
}

// Account grants remain independent of the recipient's selected Workspace.
// Owner runs are limited to that selected Workspace. Filtering, counting and
// paging happen over the same authorized union, not separately per source.
const visibleCodebaseRuns = `WITH visible AS (
 SELECT r.*, ''::text AS sharing_id FROM codebase_runs r
 WHERE r.workspace_id=$1 AND $4::boolean
 AND ($5::text='' OR r.workflow_id=$5) AND ($6::text='' OR r.repo_id=$6)
 UNION ALL
 SELECT r.*, g.id AS sharing_id FROM codebase_runs r
 JOIN resource_shares g ON g.kind='workflow' AND g.resource_id=r.workflow_id AND g.workspace_id=r.workspace_id
 JOIN codebase_workflows wf ON wf.id=r.workflow_id AND wf.workspace_id=r.workspace_id
 WHERE $7::boolean AND g.status='accepted' AND g.recipient_user_id=$2 AND lower(g.recipient_email)=lower($3)
 AND ($8::text='' OR g.id=$8) AND ($9::text='' OR wf.repo_path=$9)
), filtered AS (
 SELECT * FROM visible WHERE $10::text='all'
 OR ($10='active' AND status IN ('pending','running'))
 OR ($10='report-failed' AND report_status='failed') OR status=$10
) `

func (s *Store) VisibleCodebaseRunPage(ctx context.Context, wid string, user User, query CodebaseRunPageQuery) (CodebaseRunPage, error) {
	page := CodebaseRunPage{Page: query.Page, PageSize: query.PageSize, Items: []CodebaseRunPageEntry{}}
	if page.Page < 1 {
		page.Page = 1
	}
	if page.PageSize < 1 || page.PageSize > 100 {
		page.PageSize = 25
	}
	if query.Status == "" {
		query.Status = "all"
	}
	sharedWorkflow := strings.HasPrefix(query.WorkflowID, "share:")
	sharedRepo := strings.HasPrefix(query.RepoID, "share-repo:")
	own := !sharedWorkflow && !sharedRepo
	shared := query.IncludeShared && user.ID != "" && (query.WorkflowID == "" || sharedWorkflow) && (query.RepoID == "" || sharedRepo)
	ownWorkflow, ownRepo, shareID, sharePath := "", "", "", ""
	if sharedWorkflow {
		shareID = strings.TrimPrefix(query.WorkflowID, "share:")
	} else {
		ownWorkflow = query.WorkflowID
	}
	if sharedRepo {
		sharePath = strings.TrimPrefix(query.RepoID, "share-repo:")
	} else {
		ownRepo = query.RepoID
	}
	args := []any{wid, user.ID, user.Email, own, ownWorkflow, ownRepo, shared, shareID, sharePath, query.Status}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return page, err
	}
	defer tx.Rollback(ctx)
	if err = tx.QueryRow(ctx, visibleCodebaseRuns+`SELECT count(*) FROM filtered`, args...).Scan(&page.Total); err != nil {
		return page, err
	}
	last := (page.Total + page.PageSize - 1) / page.PageSize
	if last < 1 {
		last = 1
	}
	if page.Page > last {
		page.Page = last
	}
	args = append(args, page.PageSize, (page.Page-1)*page.PageSize)
	rows, err := tx.Query(ctx, visibleCodebaseRuns+`SELECT `+codebaseRunColumns+`,sharing_id FROM filtered ORDER BY created_at DESC,id DESC,sharing_id DESC LIMIT $11 OFFSET $12`, args...)
	if err != nil {
		return page, err
	}
	for rows.Next() {
		var entry CodebaseRunPageEntry
		r := &entry.Run
		if err = rows.Scan(&r.ID, &r.WorkspaceID, &r.WorkflowID, &r.RepoPath, &r.RepoID, &r.MRIID, &r.MRTitle, &r.MRURL, &r.Trigger, &r.Status, &r.Summary, &r.Error, &r.TaskID, &r.ConversationID, &r.Model, &r.ReasoningEffort, &r.ReportStatus, &r.ReportError, &r.ReportURL, &r.StartedAt, &r.FinishedAt, &r.CreatedAt, &entry.ShareID); err != nil {
			rows.Close()
			return page, err
		}
		page.Items = append(page.Items, entry)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return page, err
	}
	return page, tx.Commit(ctx)
}
