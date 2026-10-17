package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type WorkspaceAPIKey struct {
	ID              string     `json:"id"`
	WorkspaceID     string     `json:"workspaceId"`
	Name            string     `json:"name"`
	TokenHash       string     `json:"-"`
	TokenPrefix     string     `json:"prefix"`
	Scopes          []string   `json:"scopes"`
	CreatedByUserID string     `json:"-"`
	CreatedAt       time.Time  `json:"createdAt"`
	LastUsedAt      *time.Time `json:"lastUsedAt"`
	RevokedAt       *time.Time `json:"revokedAt"`
}

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

type RelayNodeEnrollment struct {
	NodeID      string
	ID          string
	OwnerUserID string
	TokenHash   string
	ExpiresAt   time.Time
}

type RelayNode struct {
	ID          string     `json:"id"`
	OwnerUserID string     `json:"-"`
	Name        string     `json:"name"`
	Capacity    int        `json:"capacity"`
	State       string     `json:"state"`
	LastSeenAt  *time.Time `json:"lastSeenAt"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type RelayNodeRuntime struct {
	ID        string    `json:"id"`
	NodeID    string    `json:"nodeId"`
	Provider  string    `json:"provider"`
	Version   string    `json:"version"`
	State     string    `json:"state"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type WorkspaceRuntimeBinding struct {
	ID                 string    `json:"id"`
	WorkspaceID        string    `json:"workspaceId"`
	NodeRuntimeID      string    `json:"nodeRuntimeId"`
	AuthorizedByUserID string    `json:"-"`
	Status             string    `json:"status"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

var (
	ErrRuntimeBindingInUse = errors.New("runtime binding is still used by an Agent, Project, or conversation")
	ErrRelayNodeOnline     = errors.New("Relay Node must be offline before it can be removed")
	ErrRelayNodeInUse      = errors.New("Relay Node still has Runtime bindings assigned to a workspace")
	ErrRelayNodeReferenced = errors.New("Relay Node runtimes are still in use")
)

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

func (s *Store) CreateRelayNodeEnrollment(ctx context.Context, userID, hash, nodeID string, expiresAt time.Time) (RelayNodeEnrollment, error) {
	enrollment := RelayNodeEnrollment{ID: uuid.NewString(), OwnerUserID: userID, TokenHash: hash, NodeID: nodeID, ExpiresAt: expiresAt}
	_, err := s.pool.Exec(ctx, `INSERT INTO relay_node_enrollments(id,owner_user_id,token_hash,expires_at,node_id) VALUES($1,$2,$3,$4,$5)`,
		enrollment.ID, enrollment.OwnerUserID, enrollment.TokenHash, enrollment.ExpiresAt, enrollment.NodeID)
	return enrollment, err
}

// EnrollRelayNode consumes an installation token and establishes immutable
// ownership for a physical Node. Re-registration never transfers ownership.
func (s *Store) EnrollRelayNode(ctx context.Context, tokenHash, nodeID, name string, capacity int, state string, lastSeen time.Time) (RelayNode, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return RelayNode{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var ownerID string
	err = tx.QueryRow(ctx, `UPDATE relay_node_enrollments SET consumed_at=now() WHERE token_hash=$1 AND node_id=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING owner_user_id`, tokenHash, nodeID).Scan(&ownerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return RelayNode{}, ErrNotFound
	}
	if err != nil {
		return RelayNode{}, err
	}
	var node RelayNode
	err = tx.QueryRow(ctx, `INSERT INTO relay_nodes(id,owner_user_id,name,capacity,state,last_seen_at) VALUES($1,$2,$3,$4,$5,$6)
		ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,capacity=EXCLUDED.capacity,state=EXCLUDED.state,last_seen_at=EXCLUDED.last_seen_at,updated_at=now()
		WHERE relay_nodes.owner_user_id=EXCLUDED.owner_user_id
		RETURNING id,owner_user_id,name,capacity,state,last_seen_at,created_at,updated_at`,
		nodeID, ownerID, name, capacity, state, lastSeen).Scan(&node.ID, &node.OwnerUserID, &node.Name, &node.Capacity, &node.State, &node.LastSeenAt, &node.CreatedAt, &node.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return RelayNode{}, ErrConflict
	}
	if err != nil {
		return RelayNode{}, err
	}
	return node, tx.Commit(ctx)
}

func (s *Store) RelayNodeByID(ctx context.Context, nodeID string) (RelayNode, error) {
	var node RelayNode
	err := s.pool.QueryRow(ctx, `SELECT id,owner_user_id,name,capacity,state,last_seen_at,created_at,updated_at FROM relay_nodes WHERE id=$1`, nodeID).
		Scan(&node.ID, &node.OwnerUserID, &node.Name, &node.Capacity, &node.State, &node.LastSeenAt, &node.CreatedAt, &node.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return RelayNode{}, ErrNotFound
	}
	return node, err
}

func (s *Store) SyncRelayNode(ctx context.Context, nodeID, name string, capacity int, state string, lastSeen time.Time, runtimes []RelayNodeRuntime) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	command, err := tx.Exec(ctx, `UPDATE relay_nodes SET name=$2,capacity=$3,state=$4,last_seen_at=$5,updated_at=now() WHERE id=$1`, nodeID, name, capacity, state, lastSeen)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrNotFound
	}
	seen := make([]string, 0, len(runtimes))
	for _, runtime := range runtimes {
		seen = append(seen, runtime.ID)
		_, err := tx.Exec(ctx, `INSERT INTO relay_node_runtimes(id,node_id,provider,version,state) VALUES($1,$2,$3,$4,$5)
			ON CONFLICT(id) DO UPDATE SET node_id=EXCLUDED.node_id,provider=EXCLUDED.provider,version=EXCLUDED.version,state=EXCLUDED.state,updated_at=now()`,
			runtime.ID, nodeID, runtime.Provider, runtime.Version, runtime.State)
		if err != nil {
			return err
		}
	}
	if len(seen) == 0 {
		_, err = tx.Exec(ctx, `DELETE FROM relay_node_runtimes WHERE node_id=$1`, nodeID)
	} else {
		_, err = tx.Exec(ctx, `DELETE FROM relay_node_runtimes WHERE node_id=$1 AND NOT (id=ANY($2))`, nodeID, seen)
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) RelayNodesForOwner(ctx context.Context, userID string) ([]RelayNode, error) {
	rows, err := s.pool.Query(ctx, `SELECT id,owner_user_id,name,capacity,state,last_seen_at,created_at,updated_at FROM relay_nodes WHERE owner_user_id=$1 ORDER BY updated_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	nodes := []RelayNode{}
	for rows.Next() {
		var node RelayNode
		if err := rows.Scan(&node.ID, &node.OwnerUserID, &node.Name, &node.Capacity, &node.State, &node.LastSeenAt, &node.CreatedAt, &node.UpdatedAt); err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

func (s *Store) RelayNodeRuntimes(ctx context.Context, nodeID string) ([]RelayNodeRuntime, error) {
	rows, err := s.pool.Query(ctx, `SELECT id,node_id,provider,version,state,created_at,updated_at FROM relay_node_runtimes WHERE node_id=$1 ORDER BY provider`, nodeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	runtimes := []RelayNodeRuntime{}
	for rows.Next() {
		var runtime RelayNodeRuntime
		if err := rows.Scan(&runtime.ID, &runtime.NodeID, &runtime.Provider, &runtime.Version, &runtime.State, &runtime.CreatedAt, &runtime.UpdatedAt); err != nil {
			return nil, err
		}
		runtimes = append(runtimes, runtime)
	}
	return runtimes, rows.Err()
}

func (s *Store) DeleteOwnedRelayNode(ctx context.Context, userID, nodeID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var state string
	err = tx.QueryRow(ctx, `SELECT state FROM relay_nodes WHERE id=$1 AND owner_user_id=$2 FOR UPDATE`, nodeID, userID).Scan(&state)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if state != "offline" {
		return ErrRelayNodeOnline
	}
	var agentReferences, projectReferences int
	if err := tx.QueryRow(ctx, `SELECT
		(SELECT COUNT(*) FROM agents a
			JOIN workspace_runtime_bindings b ON b.id=a.runtime_id AND b.workspace_id=a.workspace_id
			JOIN relay_node_runtimes r ON r.id=b.node_runtime_id
			WHERE r.node_id=$1),
		(SELECT COUNT(*) FROM projects p
			JOIN workspace_runtime_bindings b ON b.id=p.runtime_id AND b.workspace_id=p.workspace_id
			JOIN relay_node_runtimes r ON r.id=b.node_runtime_id
			WHERE r.node_id=$1 AND p.deleted_at IS NULL)
	`, nodeID).Scan(&agentReferences, &projectReferences); err != nil {
		return err
	}
	referenceLabel := func(count int, singular string) string {
		if count == 1 {
			return fmt.Sprintf("1 %s", singular)
		}
		return fmt.Sprintf("%d %ss", count, singular)
	}
	usedBy := make([]string, 0, 2)
	if agentReferences > 0 {
		usedBy = append(usedBy, referenceLabel(agentReferences, "Agent"))
	}
	if projectReferences > 0 {
		usedBy = append(usedBy, referenceLabel(projectReferences, "Project"))
	}
	if len(usedBy) > 0 {
		return fmt.Errorf("%w by %s; migrate those references to another Runtime before removing the Node", ErrRelayNodeReferenced, strings.Join(usedBy, ", "))
	}
	// A conversation's execution Runtime is routing state, not conversation
	// content. Preserve the history while allowing the next turn to resolve a
	// current Runtime from its Project or Agent.
	if _, err := tx.Exec(ctx, `UPDATE chat_sessions c SET execution_runtime_id=NULL,updated_at=now()
		FROM workspace_runtime_bindings b,relay_node_runtimes r
		WHERE c.execution_runtime_id=b.id AND b.node_runtime_id=r.id AND r.node_id=$1`, nodeID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM workspace_runtime_bindings b
		USING relay_node_runtimes r
		WHERE b.node_runtime_id=r.id AND r.node_id=$1`, nodeID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM relay_node_runtimes WHERE node_id=$1`, nodeID); err != nil {
		return err
	}
	command, err := tx.Exec(ctx, `DELETE FROM relay_nodes WHERE id=$1 AND owner_user_id=$2`, nodeID, userID)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrNotFound
	}
	return tx.Commit(ctx)
}

func (s *Store) BindRelayNodeRuntimes(ctx context.Context, workspaceID, userID, nodeID string, runtimeIDs []string) error {
	workspace, err := s.WorkspaceForUser(ctx, userID, workspaceID)
	if err != nil {
		return err
	}
	if workspace.ID == "" {
		return ErrNotFound
	}
	node, err := s.RelayNodeByID(ctx, nodeID)
	if err != nil {
		return err
	}
	if node.OwnerUserID != userID {
		return ErrNotFound
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for _, runtimeID := range runtimeIDs {
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM relay_node_runtimes WHERE id=$1 AND node_id=$2)`, runtimeID, nodeID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		_, err := tx.Exec(ctx, `INSERT INTO workspace_runtime_bindings(id,workspace_id,node_runtime_id,authorized_by_user_id) VALUES($1,$2,$3,$4)
			ON CONFLICT(workspace_id,node_runtime_id) DO UPDATE SET status='active',authorized_by_user_id=EXCLUDED.authorized_by_user_id,updated_at=now()`,
			uuid.NewString(), workspaceID, runtimeID, userID)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) WorkspaceRuntimeBindings(ctx context.Context, workspaceID string) ([]WorkspaceRuntimeBinding, error) {
	rows, err := s.pool.Query(ctx, `SELECT id,workspace_id,node_runtime_id,authorized_by_user_id,status,created_at,updated_at FROM workspace_runtime_bindings WHERE workspace_id=$1 AND status='active' ORDER BY created_at`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	bindings := []WorkspaceRuntimeBinding{}
	for rows.Next() {
		var binding WorkspaceRuntimeBinding
		if err := rows.Scan(&binding.ID, &binding.WorkspaceID, &binding.NodeRuntimeID, &binding.AuthorizedByUserID, &binding.Status, &binding.CreatedAt, &binding.UpdatedAt); err != nil {
			return nil, err
		}
		bindings = append(bindings, binding)
	}
	return bindings, rows.Err()
}

// DisconnectRuntimeBinding removes only the workspace's logical access to a
// physical Runtime. The Node, physical Runtime, and bindings in other
// workspaces remain untouched.
func (s *Store) DisconnectRuntimeBinding(ctx context.Context, workspaceID, bindingID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(
		SELECT 1 FROM workspace_runtime_bindings
		WHERE workspace_id=$1 AND id=$2 AND status='active'
	)`, workspaceID, bindingID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrNotFound
	}

	var referenced bool
	if err := tx.QueryRow(ctx, `SELECT
		EXISTS(SELECT 1 FROM agents WHERE workspace_id=$1 AND runtime_id=$2)
		OR EXISTS(SELECT 1 FROM projects WHERE workspace_id=$1 AND runtime_id=$2 AND deleted_at IS NULL)
		OR EXISTS(SELECT 1 FROM chat_sessions WHERE workspace_id=$1 AND execution_runtime_id=$2)
	`, workspaceID, bindingID).Scan(&referenced); err != nil {
		return err
	}
	if referenced {
		return ErrRuntimeBindingInUse
	}

	command, err := tx.Exec(ctx, `DELETE FROM workspace_runtime_bindings WHERE workspace_id=$1 AND id=$2`, workspaceID, bindingID)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrNotFound
	}
	return tx.Commit(ctx)
}

func (s *Store) ResolveRuntimeBinding(ctx context.Context, workspaceID, bindingID string) (WorkspaceRuntimeBinding, RelayNodeRuntime, error) {
	var binding WorkspaceRuntimeBinding
	var runtime RelayNodeRuntime
	err := s.pool.QueryRow(ctx, `SELECT b.id,b.workspace_id,b.node_runtime_id,b.authorized_by_user_id,b.status,b.created_at,b.updated_at,
		r.id,r.node_id,r.provider,r.version,r.state,r.created_at,r.updated_at
		FROM workspace_runtime_bindings b JOIN relay_node_runtimes r ON r.id=b.node_runtime_id
		WHERE b.workspace_id=$1 AND b.id=$2 AND b.status='active'`, workspaceID, bindingID).
		Scan(&binding.ID, &binding.WorkspaceID, &binding.NodeRuntimeID, &binding.AuthorizedByUserID, &binding.Status, &binding.CreatedAt, &binding.UpdatedAt,
			&runtime.ID, &runtime.NodeID, &runtime.Provider, &runtime.Version, &runtime.State, &runtime.CreatedAt, &runtime.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceRuntimeBinding{}, RelayNodeRuntime{}, ErrNotFound
	}
	return binding, runtime, err
}

func (s *Store) RuntimeAssigned(ctx context.Context, workspaceID, bindingID string) (bool, error) {
	var assigned bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workspace_runtime_bindings WHERE workspace_id=$1 AND id=$2 AND status='active')`, workspaceID, bindingID).Scan(&assigned)
	return assigned, err
}

func scanWorkspaceAPIKey(row pgx.Row) (WorkspaceAPIKey, error) {
	var key WorkspaceAPIKey
	err := row.Scan(&key.ID, &key.WorkspaceID, &key.Name, &key.TokenHash, &key.TokenPrefix, &key.Scopes, &key.CreatedByUserID, &key.CreatedAt, &key.LastUsedAt, &key.RevokedAt)
	return key, err
}

const workspaceAPIKeyColumns = `id,workspace_id,name,token_hash,token_prefix,scopes,created_by_user_id,created_at,last_used_at,revoked_at`

func (s *Store) CreateWorkspaceAPIKey(ctx context.Context, key WorkspaceAPIKey) (WorkspaceAPIKey, error) {
	if key.ID == "" {
		key.ID = uuid.NewString()
	}
	return scanWorkspaceAPIKey(s.pool.QueryRow(ctx, `INSERT INTO workspace_api_keys(id,workspace_id,name,token_hash,token_prefix,scopes,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING `+workspaceAPIKeyColumns,
		key.ID, key.WorkspaceID, key.Name, key.TokenHash, key.TokenPrefix, key.Scopes, key.CreatedByUserID))
}

func (s *Store) WorkspaceAPIKeys(ctx context.Context, workspaceID string) ([]WorkspaceAPIKey, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+workspaceAPIKeyColumns+` FROM workspace_api_keys WHERE workspace_id=$1 ORDER BY created_at DESC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []WorkspaceAPIKey{}
	for rows.Next() {
		key, err := scanWorkspaceAPIKey(rows)
		if err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func (s *Store) WorkspaceAPIKeyByToken(ctx context.Context, hash string) (WorkspaceAPIKey, error) {
	key, err := scanWorkspaceAPIKey(s.pool.QueryRow(ctx, `UPDATE workspace_api_keys SET last_used_at=now() WHERE token_hash=$1 AND revoked_at IS NULL RETURNING `+workspaceAPIKeyColumns, hash))
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceAPIKey{}, ErrNotFound
	}
	return key, err
}

func (s *Store) RevokeWorkspaceAPIKey(ctx context.Context, workspaceID, id string) (WorkspaceAPIKey, error) {
	key, err := scanWorkspaceAPIKey(s.pool.QueryRow(ctx, `UPDATE workspace_api_keys SET revoked_at=COALESCE(revoked_at,now()) WHERE workspace_id=$1 AND id=$2 RETURNING `+workspaceAPIKeyColumns, workspaceID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceAPIKey{}, ErrNotFound
	}
	return key, err
}
