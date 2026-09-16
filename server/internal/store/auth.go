package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	DisplayName  string    `json:"displayName"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type Workspace struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	OwnerUserID string    `json:"-"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

const userColumns = `id,email,display_name,password_hash,created_at,updated_at`
const workspaceColumns = `id,name,owner_user_id,created_at,updated_at`

func scanUser(row pgx.Row) (User, error) {
	var user User
	err := row.Scan(&user.ID, &user.Email, &user.DisplayName, &user.PasswordHash, &user.CreatedAt, &user.UpdatedAt)
	return user, err
}

func scanWorkspace(row pgx.Row) (Workspace, error) {
	var workspace Workspace
	err := row.Scan(&workspace.ID, &workspace.Name, &workspace.OwnerUserID, &workspace.CreatedAt, &workspace.UpdatedAt)
	return workspace, err
}

// CreateUser also creates the user's first workspace. The first account on an
// upgraded installation adopts the legacy default workspace so existing data
// remains available after authentication is enabled.
func (s *Store) CreateUser(ctx context.Context, email, displayName, passwordHash, legacyWorkspaceID string) (User, Workspace, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return User{}, Workspace{}, false, err
	}
	defer tx.Rollback(ctx)

	user, err := scanUser(tx.QueryRow(ctx, `INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4) RETURNING `+userColumns,
		uuid.NewString(), email, displayName, passwordHash))
	if err != nil {
		return User{}, Workspace{}, false, err
	}

	var userCount int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&userCount); err != nil {
		return User{}, Workspace{}, false, err
	}
	adopted := false
	var workspace Workspace
	if userCount == 1 && legacyWorkspaceID != "" {
		workspace, err = scanWorkspace(tx.QueryRow(ctx, `UPDATE workspaces SET owner_user_id=$2,updated_at=now() WHERE id=$1 AND owner_user_id IS NULL RETURNING `+workspaceColumns, legacyWorkspaceID, user.ID))
		if err == nil {
			adopted = true
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return User{}, Workspace{}, false, err
		}
	}
	if !adopted {
		workspace, err = scanWorkspace(tx.QueryRow(ctx, `INSERT INTO workspaces(id,name,owner_user_id) VALUES($1,$2,$3) RETURNING `+workspaceColumns,
			uuid.NewString(), "Personal workspace", user.ID))
		if err != nil {
			return User{}, Workspace{}, false, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return User{}, Workspace{}, false, err
	}
	return user, workspace, adopted, nil
}

func (s *Store) UserByEmail(ctx context.Context, email string) (User, error) {
	user, err := scanUser(s.pool.QueryRow(ctx, `SELECT `+userColumns+` FROM users WHERE lower(email)=lower($1)`, email))
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return user, err
}

func (s *Store) CreateAuthSession(ctx context.Context, userID, tokenHash string, expiresAt time.Time) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO auth_sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,$4)`, uuid.NewString(), userID, tokenHash, expiresAt)
	return err
}

func (s *Store) UserBySession(ctx context.Context, tokenHash string) (User, error) {
	user, err := scanUser(s.pool.QueryRow(ctx, `SELECT u.id,u.email,u.display_name,u.password_hash,u.created_at,u.updated_at FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now()`, tokenHash))
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	if err == nil {
		_, _ = s.pool.Exec(ctx, `UPDATE auth_sessions SET last_seen_at=now() WHERE token_hash=$1`, tokenHash)
	}
	return user, err
}

func (s *Store) DeleteAuthSession(ctx context.Context, tokenHash string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM auth_sessions WHERE token_hash=$1`, tokenHash)
	return err
}

func (s *Store) Workspaces(ctx context.Context, userID string) ([]Workspace, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+workspaceColumns+` FROM workspaces WHERE owner_user_id=$1 ORDER BY created_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Workspace{}
	for rows.Next() {
		var workspace Workspace
		if err := rows.Scan(&workspace.ID, &workspace.Name, &workspace.OwnerUserID, &workspace.CreatedAt, &workspace.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, workspace)
	}
	return items, rows.Err()
}

func (s *Store) WorkspaceForUser(ctx context.Context, userID, workspaceID string) (Workspace, error) {
	workspace, err := scanWorkspace(s.pool.QueryRow(ctx, `SELECT `+workspaceColumns+` FROM workspaces WHERE owner_user_id=$1 AND id=$2`, userID, workspaceID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Workspace{}, ErrNotFound
	}
	return workspace, err
}

func (s *Store) CreateWorkspace(ctx context.Context, userID, name string) (Workspace, error) {
	return scanWorkspace(s.pool.QueryRow(ctx, `INSERT INTO workspaces(id,name,owner_user_id) VALUES($1,$2,$3) RETURNING `+workspaceColumns,
		uuid.NewString(), name, userID))
}

func (s *Store) AssignRuntime(ctx context.Context, workspaceID, runtimeID string) error {
	command, err := s.pool.Exec(ctx, `INSERT INTO workspace_runtimes(runtime_id,workspace_id) VALUES($1,$2) ON CONFLICT(runtime_id) DO UPDATE SET workspace_id=EXCLUDED.workspace_id WHERE workspace_runtimes.workspace_id=EXCLUDED.workspace_id`, runtimeID, workspaceID)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

func (s *Store) WorkspaceRuntimeIDs(ctx context.Context, workspaceID string) (map[string]bool, error) {
	rows, err := s.pool.Query(ctx, `SELECT runtime_id FROM workspace_runtimes WHERE workspace_id=$1`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids[id] = true
	}
	return ids, rows.Err()
}

func (s *Store) RuntimeAssigned(ctx context.Context, workspaceID, runtimeID string) (bool, error) {
	var assigned bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_runtimes WHERE workspace_id=$1 AND runtime_id=$2)`, workspaceID, runtimeID).Scan(&assigned)
	return assigned, err
}

func (s *Store) UnassignedRuntime(ctx context.Context, runtimeID string) (bool, error) {
	var available bool
	err := s.pool.QueryRow(ctx, `SELECT NOT EXISTS(SELECT 1 FROM workspace_runtimes WHERE runtime_id=$1)`, runtimeID).Scan(&available)
	return available, err
}
