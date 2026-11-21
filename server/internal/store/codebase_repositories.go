package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// ErrCodebaseRepoInUse is returned when deleting a repository that still has
// review workflows bound to it.
var ErrCodebaseRepoInUse = errors.New("repository is still used by a review workflow")

type CodebaseRepository struct {
	RepoID    string `json:"repoId"`
	RepoPath  string `json:"repoPath"`
	RepoName  string `json:"repoName"`
	CreatedAt string `json:"createdAt"`
}

// AddCodebaseRepository registers a repository in the workspace. Re-adding an
// existing repository refreshes its path and name so renamed projects converge.
func (s *Store) AddCodebaseRepository(ctx context.Context, wid, repoID, repoPath, repoName string) (CodebaseRepository, error) {
	var item CodebaseRepository
	err := s.pool.QueryRow(ctx, `INSERT INTO codebase_repositories(workspace_id,repo_id,repo_path,repo_name)
VALUES($1,$2,$3,$4)
ON CONFLICT (workspace_id,repo_id) DO UPDATE SET repo_path=EXCLUDED.repo_path, repo_name=EXCLUDED.repo_name
RETURNING repo_id,repo_path,repo_name,created_at::text`, wid, repoID, repoPath, repoName).
		Scan(&item.RepoID, &item.RepoPath, &item.RepoName, &item.CreatedAt)
	return item, err
}

func (s *Store) CodebaseRepositoryByID(ctx context.Context, wid, repoID string) (CodebaseRepository, error) {
	var item CodebaseRepository
	err := s.pool.QueryRow(ctx, `SELECT repo_id,repo_path,repo_name,created_at::text FROM codebase_repositories WHERE workspace_id=$1 AND repo_id=$2`, wid, repoID).
		Scan(&item.RepoID, &item.RepoPath, &item.RepoName, &item.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

// DeleteCodebaseRepository removes a repository together with its synced merge
// requests. Workflows are not deleted implicitly: the caller must remove or
// rebind them first so a review configuration never points at a missing repo.
func (s *Store) DeleteCodebaseRepository(ctx context.Context, wid, repoID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var used int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM codebase_workflows WHERE workspace_id=$1 AND repo_id=$2`, wid, repoID).Scan(&used); err != nil {
		return err
	}
	if used > 0 {
		return ErrCodebaseRepoInUse
	}
	tag, err := tx.Exec(ctx, `DELETE FROM codebase_repositories WHERE workspace_id=$1 AND repo_id=$2`, wid, repoID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if _, err = tx.Exec(ctx, `DELETE FROM codebase_merge_requests WHERE workspace_id=$1 AND repo_id=$2`, wid, repoID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM codebase_repo_syncs WHERE workspace_id=$1 AND repo_id=$2`, wid, repoID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
