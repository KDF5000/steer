package store

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"time"
)

type ResourceShare struct {
	RecipientName   string    `json:"recipientName"`
	Model           string    `json:"model"`
	AgentRole       string    `json:"agentRole"`
	ProjectSource   string    `json:"projectSource"`
	ProjectKind     string    `json:"projectKind"`
	RuntimeLabel    string    `json:"runtimeLabel"`
	ID              string    `json:"id"`
	Kind            string    `json:"kind"`
	ResourceID      string    `json:"resourceId"`
	WorkspaceID     string    `json:"-"`
	OwnerUserID     string    `json:"ownerId"`
	OwnerName       string    `json:"ownerName"`
	RecipientEmail  string    `json:"recipientEmail"`
	RecipientUserID *string   `json:"-"`
	Permission      string    `json:"permission"`
	Status          string    `json:"status"`
	ProjectID       *string   `json:"projectId"`
	MaxConcurrency  int       `json:"maxConcurrency"`
	ResourceName    string    `json:"resourceName"`
	ProjectName     string    `json:"projectName"`
	RuntimeProvider string    `json:"runtimeProvider"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

const shareSelect = `SELECT g.id,g.kind,g.resource_id,g.workspace_id,g.owner_user_id,u.display_name,g.recipient_email,g.recipient_user_id,g.permission,g.status,COALESCE(g.project_id,c.project_id),g.max_concurrency,COALESCE(c.title,a.name,''),COALESCE(p.name,cp.name,''),COALESCE(a.runtime_provider,ca.runtime_provider,''),COALESCE(p.workspace_source,cp.workspace_source,''),COALESCE(p.workspace_kind,cp.workspace_kind,''),COALESCE(n.name,'') || CASE WHEN n.name IS NOT NULL THEN ' / ' ELSE '' END || COALESCE(a.runtime_provider,ca.runtime_provider,''),COALESCE(ru.display_name,''),COALESCE(a.model,''),COALESCE(a.role,''),g.created_at,g.updated_at FROM resource_shares g JOIN users u ON u.id=g.owner_user_id LEFT JOIN chat_sessions c ON g.kind='session' AND c.id=g.resource_id AND c.workspace_id=g.workspace_id LEFT JOIN agents ca ON ca.id=c.agent_id LEFT JOIN agents a ON g.kind='agent' AND a.id=g.resource_id AND a.workspace_id=g.workspace_id LEFT JOIN projects p ON p.id=g.project_id LEFT JOIN projects cp ON cp.id=c.project_id LEFT JOIN workspace_runtime_bindings b ON b.id=COALESCE(a.runtime_id,c.execution_runtime_id,ca.runtime_id) LEFT JOIN relay_node_runtimes nr ON nr.id=b.node_runtime_id LEFT JOIN relay_nodes n ON n.id=nr.node_id LEFT JOIN users ru ON ru.id=g.recipient_user_id `

func scanShare(row rowScanner) (ResourceShare, error) {
	var g ResourceShare
	err := row.Scan(&g.ID, &g.Kind, &g.ResourceID, &g.WorkspaceID, &g.OwnerUserID, &g.OwnerName, &g.RecipientEmail, &g.RecipientUserID, &g.Permission, &g.Status, &g.ProjectID, &g.MaxConcurrency, &g.ResourceName, &g.ProjectName, &g.RuntimeProvider, &g.ProjectSource, &g.ProjectKind, &g.RuntimeLabel, &g.RecipientName, &g.Model, &g.AgentRole, &g.CreatedAt, &g.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return g, err
}
func (s *Store) ResourceShare(ctx context.Context, id string) (ResourceShare, error) {
	return scanShare(s.pool.QueryRow(ctx, shareSelect+`WHERE g.id=$1`, id))
}
func (s *Store) ResourceShares(ctx context.Context, user User, wid string) ([]ResourceShare, error) {
	rows, err := s.pool.Query(ctx, shareSelect+`WHERE g.status<>'revoked' AND ((g.owner_user_id=$1 AND g.workspace_id=$2) OR lower(g.recipient_email)=lower($3)) AND (c.id IS NOT NULL OR a.id IS NOT NULL) ORDER BY g.updated_at DESC`, user.ID, wid, user.Email)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []ResourceShare{}
	for rows.Next() {
		g, err := scanShare(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, g)
	}
	return items, rows.Err()
}
func (s *Store) CreateResourceShare(ctx context.Context, g ResourceShare) (ResourceShare, error) {
	id := uuid.NewString()
	err := s.pool.QueryRow(ctx, `INSERT INTO resource_shares(id,kind,resource_id,workspace_id,owner_user_id,recipient_email,permission,project_id,max_concurrency) VALUES($1,$2,$3,$4,$5,lower($6),$7,$8,$9) ON CONFLICT(kind,resource_id,recipient_email) DO UPDATE SET permission=EXCLUDED.permission,project_id=EXCLUDED.project_id,max_concurrency=EXCLUDED.max_concurrency,status=CASE WHEN resource_shares.status='revoked' THEN 'pending' ELSE resource_shares.status END,recipient_user_id=CASE WHEN resource_shares.status='revoked' THEN NULL ELSE resource_shares.recipient_user_id END,updated_at=now() RETURNING id`, id, g.Kind, g.ResourceID, g.WorkspaceID, g.OwnerUserID, g.RecipientEmail, g.Permission, g.ProjectID, g.MaxConcurrency).Scan(&id)
	if err != nil {
		return g, err
	}
	return s.ResourceShare(ctx, id)
}
func (s *Store) AcceptResourceShare(ctx context.Context, id string, u User) (ResourceShare, error) {
	cmd, err := s.pool.Exec(ctx, `UPDATE resource_shares SET recipient_user_id=$2,status='accepted',updated_at=now() WHERE id=$1 AND lower(recipient_email)=lower($3) AND status IN ('pending','accepted')`, id, u.ID, u.Email)
	if err != nil {
		return ResourceShare{}, err
	}
	if cmd.RowsAffected() == 0 {
		return ResourceShare{}, ErrNotFound
	}
	return s.ResourceShare(ctx, id)
}
func (s *Store) RevokeResourceShare(ctx context.Context, id string, u User) error {
	cmd, err := s.pool.Exec(ctx, `UPDATE resource_shares SET status='revoked',updated_at=now() WHERE id=$1 AND (owner_user_id=$2 OR lower(recipient_email)=lower($3))`, id, u.ID, u.Email)
	if err == nil && cmd.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}
func (s *Store) SetSharePermission(ctx context.Context, id, userID, permission string) error {
	cmd, err := s.pool.Exec(ctx, `UPDATE resource_shares SET permission=$3,updated_at=now() WHERE id=$1 AND owner_user_id=$2 AND status<>'revoked'`, id, userID, permission)
	if err == nil && cmd.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

// Include deleted entries so ordinary page loads do not undo project removal.
func (s *Store) SharedAgentProjectExists(ctx context.Context, wid, grantID string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM projects WHERE workspace_id=$1 AND shared_source_project_id=(SELECT project_id FROM resource_shares WHERE id=$2))`, wid, grantID).Scan(&exists)
	return exists, err
}

// EnsureSharedAgentProject materializes an authorized project without creating
// a conversation or transferring a Runtime binding.
func (s *Store) EnsureSharedAgentProject(ctx context.Context, wid string, g ResourceShare, agent Agent, project Project) (Project, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Project{}, err
	}
	defer tx.Rollback(ctx)
	var status string
	if err = tx.QueryRow(ctx, `SELECT status FROM resource_shares WHERE id=$1 FOR SHARE`, g.ID).Scan(&status); err != nil {
		return Project{}, err
	}
	if status != "accepted" {
		return Project{}, ErrNotFound
	}
	projectID, _, err := importSharedAgentProject(ctx, tx, wid, g, agent, project)
	if err != nil {
		return Project{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Project{}, err
	}
	return s.Project(ctx, wid, projectID)
}

func importSharedAgentProject(ctx context.Context, tx pgx.Tx, wid string, g ResourceShare, agent Agent, project Project) (string, string, error) {
	// Serialize project imports in one workspace to preserve user-owned names.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "shared-project:"+wid); err != nil {
		return "", "", err
	}
	var projectID string
	err := tx.QueryRow(ctx, `SELECT id FROM projects WHERE workspace_id=$1 AND shared_source_project_id=$2`, wid, project.ID).Scan(&projectID)
	mode := project.ExecutionMode
	if project.WorkspaceKind == "git" {
		mode = "session_worktree"
	}
	if errors.Is(err, pgx.ErrNoRows) {
		projectID = uuid.NewString()
		_, err = tx.Exec(ctx, `INSERT INTO projects(id,workspace_id,name,workspace_kind,workspace_source,workspace_ref,workspace_subdir,execution_mode,node_id,shared_agent_grant_id,shared_source_project_id,shared_source_workspace_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, projectID, wid, project.Name, project.WorkspaceKind, project.WorkspaceSource, project.WorkspaceRef, project.WorkspaceSubdir, mode, project.NodeID, g.ID, project.ID, g.WorkspaceID)
	} else if err == nil {
		_, err = tx.Exec(ctx, `UPDATE projects SET name=$9,workspace_kind=$3,workspace_source=$4,workspace_ref=$5,workspace_subdir=$6,execution_mode=$7,node_id=$8,deleted_at=NULL,updated_at=now() WHERE id=$1 AND workspace_id=$2`, projectID, wid, project.WorkspaceKind, project.WorkspaceSource, project.WorkspaceRef, project.WorkspaceSubdir, mode, project.NodeID, project.Name)
	}
	if err != nil {
		return "", "", err
	}
	return projectID, mode, nil
}

// Shared Agent conversations and their project copies belong to the recipient.
// No Runtime binding or Workspace membership is transferred.
func (s *Store) CreateSharedAgentSession(ctx context.Context, wid string, g ResourceShare, agent Agent, project Project, runtimeID string) (Session, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback(ctx)
	// A revoked invitation cannot race session creation.
	var status string
	if err = tx.QueryRow(ctx, `SELECT status FROM resource_shares WHERE id=$1 FOR SHARE`, g.ID).Scan(&status); err != nil {
		return Session{}, err
	}
	if status != "accepted" {
		return Session{}, ErrNotFound
	}
	projectID, mode, err := importSharedAgentProject(ctx, tx, wid, g, agent, project)
	if err != nil {
		return Session{}, err
	}
	// Re-entering a capability should resume its unused draft. The workspace
	// lock serializes repeated creation requests, without reusing conversations
	// that have already submitted work or a different authorized execution scope.
	var draftID string
	err = tx.QueryRow(ctx, `SELECT c.id FROM chat_sessions c
		WHERE c.workspace_id=$1 AND c.shared_agent_grant_id=$2 AND c.project_id=$3
		AND c.agent_id=$4 AND c.execution_runtime_id=$5
		AND c.workspace_kind IS NOT DISTINCT FROM $6
		AND c.workspace_source IS NOT DISTINCT FROM $7
		AND c.workspace_ref IS NOT DISTINCT FROM $8
		AND c.workspace_subdir IS NOT DISTINCT FROM $9
		AND c.execution_mode IS NOT DISTINCT FROM $10
		AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.session_id=c.id)
		AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.conversation_id=c.id)
		ORDER BY c.updated_at DESC,c.id LIMIT 1`, wid, g.ID, projectID, agent.ID, runtimeID, project.WorkspaceKind, project.WorkspaceSource, project.WorkspaceRef, project.WorkspaceSubdir, mode).Scan(&draftID)
	if err == nil {
		if err = tx.Commit(ctx); err != nil {
			return Session{}, err
		}
		return s.Session(ctx, wid, draftID)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Session{}, err
	}
	id := uuid.NewString()
	key := "steer/" + wid + "/" + id
	_, err = tx.Exec(ctx, `INSERT INTO chat_sessions(id,workspace_id,title,agent_id,project_id,execution_runtime_id,workspace_key,workspace_kind,workspace_source,workspace_ref,workspace_subdir,execution_mode,shared_agent_grant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, id, wid, agent.Name+" · "+project.Name, agent.ID, projectID, runtimeID, key, project.WorkspaceKind, project.WorkspaceSource, project.WorkspaceRef, project.WorkspaceSubdir, mode, g.ID)
	if err != nil {
		return Session{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Session{}, err
	}
	return s.Session(ctx, wid, id)
}
func (s *Store) ShareHasActiveTask(ctx context.Context, id string) (bool, error) {
	var busy bool
	err := s.pool.QueryRow(ctx, `SELECT count(*) >= (SELECT max_concurrency FROM resource_shares WHERE id=$1) FROM tasks t JOIN chat_sessions c ON c.id=t.conversation_id AND c.workspace_id=t.workspace_id WHERE c.shared_agent_grant_id=$1 AND t.status NOT IN ('succeeded','failed','cancelled')`, id).Scan(&busy)
	return busy, err
}

// Only expose shared Agents authorized by imported projects or private conversations.
func (s *Store) SharedSessionAgents(ctx context.Context, wid string) ([]Agent, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+agentColumns+` FROM agents WHERE id IN (
		SELECT agent_id FROM chat_sessions WHERE workspace_id=$1 AND shared_agent_grant_id IS NOT NULL
		UNION SELECT g.resource_id FROM projects p JOIN resource_shares g ON g.project_id=p.shared_source_project_id AND g.workspace_id=p.shared_source_workspace_id
		WHERE p.workspace_id=$1 AND p.deleted_at IS NULL AND g.kind='agent' AND g.status='accepted' AND g.recipient_user_id=(SELECT owner_user_id FROM workspaces WHERE id=$1)
	) AND workspace_id<>$1`, wid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Agent{}
	for rows.Next() {
		a, err := scanAgent(rows)
		if err != nil {
			return nil, err
		}
		a.Shared = true
		a.Instructions = ""
		a.WorkspaceSource = nil
		items = append(items, a)
	}
	return items, rows.Err()
}

// Reconcile active tasks before enforcing a capability's concurrency allowance.
func (s *Store) SharedAgentActiveRuns(ctx context.Context, grantID string) ([]RunLink, error) {
	rows, err := s.pool.Query(ctx, `SELECT t.workspace_id,t.relay_run_id FROM tasks t JOIN chat_sessions c ON c.id=t.conversation_id AND c.workspace_id=t.workspace_id WHERE c.shared_agent_grant_id=$1 AND t.status NOT IN ('succeeded','failed','cancelled')`, grantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []RunLink{}
	for rows.Next() {
		var link RunLink
		if err := rows.Scan(&link.WorkspaceID, &link.RelayRunID); err != nil {
			return nil, err
		}
		items = append(items, link)
	}
	return items, rows.Err()
}
