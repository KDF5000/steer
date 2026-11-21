package store

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// CodebaseMergeRequest is the persisted form of a Codebase merge request.
// Merge requests belong to a repository, so several workflows that review the
// same repository share one synced copy.
type CodebaseMergeRequest struct {
	ID           int64                `json:"id"`
	IID          int                  `json:"iid"`
	ProjectID    int64                `json:"project_id"`
	Title        string               `json:"title"`
	Description  string               `json:"description"`
	State        string               `json:"state"`
	WebURL       string               `json:"web_url"`
	SourceBranch string               `json:"source_branch"`
	TargetBranch string               `json:"target_branch"`
	CreatedAt    *time.Time           `json:"created_at"`
	UpdatedAt    *time.Time           `json:"updated_at"`
	Draft        bool                 `json:"draft"`
	Labels       []string             `json:"labels"`
	Author       CodebaseMRAuthor     `json:"author"`
	References   CodebaseMRReferences `json:"references"`
	SyncedAt     time.Time            `json:"synced_at"`
}

type CodebaseMRAuthor struct {
	Name     string `json:"name"`
	Username string `json:"username"`
}

type CodebaseMRReferences struct {
	Full string `json:"full"`
}

type CodebaseRepoSync struct {
	WorkspaceID     string     `json:"workspaceId"`
	RepoID          string     `json:"repoId"`
	RepoPath        string     `json:"repoPath"`
	RepoName        string     `json:"repoName"`
	LastSyncedAt    *time.Time `json:"lastSyncedAt"`
	LastMRUpdatedAt *time.Time `json:"lastMrUpdatedAt"`
	LastCreated     int        `json:"lastCreated"`
	LastUpdated     int        `json:"lastUpdated"`
	LastError       string     `json:"lastError"`
}

// CodebaseRepo is a managed repository together with its sync cursor and the
// number of persisted merge requests.
type CodebaseRepo struct {
	RepoID          string     `json:"repoId"`
	RepoPath        string     `json:"repoPath"`
	RepoName        string     `json:"repoName"`
	LastSyncedAt    *time.Time `json:"lastSyncedAt"`
	LastMRUpdatedAt *time.Time `json:"lastMrUpdatedAt"`
	LastCreated     int        `json:"lastCreated"`
	LastUpdated     int        `json:"lastUpdated"`
	OpenCount       int        `json:"openCount"`
	TotalCount      int        `json:"totalCount"`
	LastError       string     `json:"lastError"`
}

const codebaseMRColumns = `repo_id,repo_path,mr_number,mr_id,title,description,state,web_url,source_branch,target_branch,author_name,author_username,draft,labels,mr_created_at,mr_updated_at,synced_at`

func scanCodebaseMR(row pgx.Row) (CodebaseMergeRequest, error) {
	var item CodebaseMergeRequest
	var repoID, repoPath string
	var labels []byte
	err := row.Scan(
		&repoID, &repoPath, &item.IID, &item.ID, &item.Title, &item.Description,
		&item.State,
		&item.WebURL, &item.SourceBranch, &item.TargetBranch,
		&item.Author.Name, &item.Author.Username, &item.Draft, &labels,
		&item.CreatedAt, &item.UpdatedAt, &item.SyncedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrNotFound
	}
	if err != nil {
		return item, err
	}
	if id, err := strconv.ParseInt(repoID, 10, 64); err == nil {
		item.ProjectID = id
	}
	item.Labels = []string{}
	if len(labels) > 0 {
		_ = json.Unmarshal(labels, &item.Labels)
	}
	item.References.Full = repoPath + "!" + strconv.Itoa(item.IID)
	return item, nil
}

// UpsertCodebaseMergeRequests stores the newest copy of each merge request.
// Rows whose persisted fields did not change are left untouched so the sync
// result can distinguish new, updated, and already-known merge requests.
func (s *Store) UpsertCodebaseMergeRequests(ctx context.Context, wid, repoID, repoPath string, items []CodebaseMergeRequest) (created, updated, unchanged int, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, 0, 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, item := range items {
		labels, err := json.Marshal(item.Labels)
		if err != nil {
			return 0, 0, 0, err
		}
		var inserted bool
		err = tx.QueryRow(ctx, `INSERT INTO codebase_merge_requests(
workspace_id,repo_id,repo_path,mr_number,mr_id,title,description,state,web_url,source_branch,target_branch,
author_name,author_username,draft,labels,mr_created_at,mr_updated_at,synced_at)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,now())
ON CONFLICT (workspace_id,repo_id,mr_number) DO UPDATE SET
  repo_path=EXCLUDED.repo_path,
  mr_id=EXCLUDED.mr_id,
  title=EXCLUDED.title,
  description=EXCLUDED.description,
  state=EXCLUDED.state,
  web_url=EXCLUDED.web_url,
  source_branch=EXCLUDED.source_branch,
  target_branch=EXCLUDED.target_branch,
  author_name=EXCLUDED.author_name,
  author_username=EXCLUDED.author_username,
  draft=EXCLUDED.draft,
  labels=EXCLUDED.labels,
  mr_created_at=EXCLUDED.mr_created_at,
  mr_updated_at=EXCLUDED.mr_updated_at,
  synced_at=now()
WHERE codebase_merge_requests.repo_path IS DISTINCT FROM EXCLUDED.repo_path
   OR codebase_merge_requests.mr_id IS DISTINCT FROM EXCLUDED.mr_id
   OR codebase_merge_requests.title IS DISTINCT FROM EXCLUDED.title
   OR codebase_merge_requests.description IS DISTINCT FROM EXCLUDED.description
   OR codebase_merge_requests.state IS DISTINCT FROM EXCLUDED.state
   OR codebase_merge_requests.web_url IS DISTINCT FROM EXCLUDED.web_url
   OR codebase_merge_requests.source_branch IS DISTINCT FROM EXCLUDED.source_branch
   OR codebase_merge_requests.target_branch IS DISTINCT FROM EXCLUDED.target_branch
   OR codebase_merge_requests.author_name IS DISTINCT FROM EXCLUDED.author_name
   OR codebase_merge_requests.author_username IS DISTINCT FROM EXCLUDED.author_username
   OR codebase_merge_requests.draft IS DISTINCT FROM EXCLUDED.draft
   OR codebase_merge_requests.labels IS DISTINCT FROM EXCLUDED.labels
   OR codebase_merge_requests.mr_created_at IS DISTINCT FROM EXCLUDED.mr_created_at
   OR codebase_merge_requests.mr_updated_at IS DISTINCT FROM EXCLUDED.mr_updated_at
RETURNING (xmax = 0)`, wid, repoID, repoPath, item.IID, item.ID, item.Title, item.Description,
			item.State, item.WebURL, item.SourceBranch, item.TargetBranch, item.Author.Name,
			item.Author.Username, item.Draft, string(labels), item.CreatedAt, item.UpdatedAt,
		).Scan(&inserted)
		if errors.Is(err, pgx.ErrNoRows) {
			unchanged++
			continue
		}
		if err != nil {
			return 0, 0, 0, err
		}
		if inserted {
			created++
		} else {
			updated++
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, 0, err
	}
	return created, updated, unchanged, nil
}

// CodebaseMergeRequests lists persisted merge requests for one repository.
// state accepts open/merged/closed, or an empty string for all states.
func (s *Store) CodebaseMergeRequests(ctx context.Context, wid, repoID, state, search string, page, pageSize int) ([]CodebaseMergeRequest, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	rows, err := s.pool.Query(ctx, `SELECT `+codebaseMRColumns+` FROM codebase_merge_requests
WHERE workspace_id=$1 AND repo_id=$2
  AND ($3='' OR state=$3)
  AND ($4='' OR title ILIKE '%' || $4 || '%')
ORDER BY mr_updated_at DESC NULLS LAST, mr_number DESC
LIMIT $5 OFFSET $6`, wid, repoID, state, search, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := []CodebaseMergeRequest{}
	for rows.Next() {
		item, err := scanCodebaseMR(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var total int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM codebase_merge_requests
WHERE workspace_id=$1 AND repo_id=$2
  AND ($3='' OR state=$3)
  AND ($4='' OR title ILIKE '%' || $4 || '%')`, wid, repoID, state, search).Scan(&total); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (s *Store) CodebaseMergeRequest(ctx context.Context, wid, repoID string, number int) (CodebaseMergeRequest, error) {
	return scanCodebaseMR(s.pool.QueryRow(ctx, `SELECT `+codebaseMRColumns+` FROM codebase_merge_requests WHERE workspace_id=$1 AND repo_id=$2 AND mr_number=$3`, wid, repoID, number))
}

func (s *Store) CodebaseMergeRequestCounts(ctx context.Context, wid, repoID string) (open, total int, err error) {
	err = s.pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE state='open'), count(*) FROM codebase_merge_requests WHERE workspace_id=$1 AND repo_id=$2`, wid, repoID).Scan(&open, &total)
	return open, total, err
}

// CodebaseRepos lists repositories registered in the workspace together with
// their sync cursor and merge request counts. A repository exists independently
// of review workflows, so it can be synced before any workflow is configured.
func (s *Store) CodebaseRepos(ctx context.Context, wid string) ([]CodebaseRepo, error) {
	rows, err := s.pool.Query(ctx, `SELECT r.repo_id, r.repo_path, r.repo_name,
       s.last_synced_at, s.last_mr_updated_at,
       COALESCE(s.last_created,0), COALESCE(s.last_updated,0), COALESCE(s.last_error,''),
       COALESCE(m.open_count,0), COALESCE(m.total_count,0)
FROM codebase_repositories r
LEFT JOIN codebase_repo_syncs s ON s.workspace_id=$1 AND s.repo_id=r.repo_id
LEFT JOIN (
  SELECT repo_id, count(*) FILTER (WHERE state='open') AS open_count, count(*) AS total_count
  FROM codebase_merge_requests WHERE workspace_id=$1 GROUP BY repo_id
) m ON m.repo_id=r.repo_id
WHERE r.workspace_id=$1
ORDER BY r.repo_path`, wid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []CodebaseRepo{}
	for rows.Next() {
		var item CodebaseRepo
		if err := rows.Scan(&item.RepoID, &item.RepoPath, &item.RepoName, &item.LastSyncedAt, &item.LastMRUpdatedAt, &item.LastCreated, &item.LastUpdated, &item.LastError, &item.OpenCount, &item.TotalCount); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func scanCodebaseRepoSync(row pgx.Row) (CodebaseRepoSync, error) {
	var item CodebaseRepoSync
	err := row.Scan(&item.WorkspaceID, &item.RepoID, &item.RepoPath, &item.RepoName, &item.LastSyncedAt, &item.LastMRUpdatedAt, &item.LastCreated, &item.LastUpdated, &item.LastError)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

func (s *Store) CodebaseRepoSync(ctx context.Context, wid, repoID string) (CodebaseRepoSync, error) {
	return scanCodebaseRepoSync(s.pool.QueryRow(ctx, `SELECT workspace_id,repo_id,repo_path,repo_name,last_synced_at,last_mr_updated_at,last_created,last_updated,last_error FROM codebase_repo_syncs WHERE workspace_id=$1 AND repo_id=$2`, wid, repoID))
}

// SetCodebaseRepoSyncError records a failed sync without advancing the cursor,
// so the next attempt still walks the same incremental window.
func (s *Store) SetCodebaseRepoSyncError(ctx context.Context, wid, repoID, repoPath, message string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO codebase_repo_syncs(workspace_id,repo_id,repo_path,last_error)
VALUES($1,$2,$3,$4)
ON CONFLICT (workspace_id,repo_id) DO UPDATE SET last_error=EXCLUDED.last_error`, wid, repoID, repoPath, message)
	return err
}

func (s *Store) SaveCodebaseRepoSync(ctx context.Context, item CodebaseRepoSync) (CodebaseRepoSync, error) {
	return scanCodebaseRepoSync(s.pool.QueryRow(ctx, `INSERT INTO codebase_repo_syncs(workspace_id,repo_id,repo_path,repo_name,last_synced_at,last_mr_updated_at,last_created,last_updated,last_error)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT (workspace_id,repo_id) DO UPDATE SET
  repo_path=EXCLUDED.repo_path,
  repo_name=EXCLUDED.repo_name,
  last_synced_at=EXCLUDED.last_synced_at,
  last_mr_updated_at=EXCLUDED.last_mr_updated_at,
  last_created=EXCLUDED.last_created,
  last_updated=EXCLUDED.last_updated,
  last_error=EXCLUDED.last_error
RETURNING workspace_id,repo_id,repo_path,repo_name,last_synced_at,last_mr_updated_at,last_created,last_updated,last_error`,
		item.WorkspaceID, item.RepoID, item.RepoPath, item.RepoName, item.LastSyncedAt, item.LastMRUpdatedAt, item.LastCreated, item.LastUpdated, item.LastError))
}
