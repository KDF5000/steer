package store

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

var (
	ErrNotFound = errors.New("not found")
	ErrConflict = errors.New("conflict")
)

type Store struct{ pool *pgxpool.Pool }

type Agent struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspaceId"`
	Name            string    `json:"name"`
	Role            string    `json:"role"`
	Instructions    string    `json:"instructions"`
	RuntimeProvider string    `json:"runtimeProvider"`
	RuntimeID       *string   `json:"runtimeId"`
	Model           *string   `json:"model"`
	WorkspaceKind   *string   `json:"workspaceKind"`
	WorkspaceSource *string   `json:"workspaceSource"`
	WorkspaceRef    *string   `json:"workspaceRef"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type Project struct {
	ID              string     `json:"id"`
	WorkspaceID     string     `json:"workspaceId"`
	Name            string     `json:"name"`
	WorkspaceKind   string     `json:"workspaceKind"`
	WorkspaceSource string     `json:"workspaceSource"`
	WorkspaceRef    *string    `json:"workspaceRef"`
	WorkspaceSubdir *string    `json:"workspaceSubdir"`
	ExecutionMode   string     `json:"executionMode"`
	RuntimeID       *string    `json:"runtimeId"`
	DeletedAt       *time.Time `json:"deletedAt"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
}

type Session struct {
	ID                 string    `json:"id"`
	WorkspaceID        string    `json:"workspaceId"`
	Title              string    `json:"title"`
	AgentID            string    `json:"agentId"`
	ProjectID          *string   `json:"projectId"`
	ExecutionRuntimeID *string   `json:"executionRuntimeId"`
	WorkspaceKey       *string   `json:"workspaceKey"`
	WorkspaceKind      *string   `json:"workspaceKind"`
	WorkspaceSource    *string   `json:"workspaceSource"`
	WorkspaceRef       *string   `json:"workspaceRef"`
	WorkspaceSubdir    *string   `json:"workspaceSubdir"`
	ExecutionMode      *string   `json:"executionMode"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

func scanProject(row pgx.Row) (Project, error) {
	var project Project
	err := row.Scan(&project.ID, &project.WorkspaceID, &project.Name, &project.WorkspaceKind, &project.WorkspaceSource, &project.WorkspaceRef, &project.WorkspaceSubdir, &project.ExecutionMode, &project.RuntimeID, &project.DeletedAt, &project.CreatedAt, &project.UpdatedAt)
	return project, err
}

const projectColumns = `id,workspace_id,name,workspace_kind,workspace_source,workspace_ref,workspace_subdir,execution_mode,runtime_id,deleted_at,created_at,updated_at`

func (s *Store) Projects(ctx context.Context, wid string) ([]Project, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+projectColumns+` FROM projects WHERE workspace_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC`, wid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	projects := []Project{}
	for rows.Next() {
		project, err := scanProject(rows)
		if err != nil {
			return nil, err
		}
		projects = append(projects, project)
	}
	return projects, rows.Err()
}

func (s *Store) Project(ctx context.Context, wid, id string) (Project, error) {
	project, err := scanProject(s.pool.QueryRow(ctx, `SELECT `+projectColumns+` FROM projects WHERE workspace_id=$1 AND id=$2`, wid, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Project{}, ErrNotFound
	}
	return project, err
}

func (s *Store) CreateProject(ctx context.Context, wid string, project Project) (Project, error) {
	project.ID = uuid.NewString()
	project.WorkspaceID = wid
	return scanProject(s.pool.QueryRow(ctx, `INSERT INTO projects(id,workspace_id,name,workspace_kind,workspace_source,workspace_ref,workspace_subdir,execution_mode,runtime_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING `+projectColumns,
		project.ID, project.WorkspaceID, project.Name, project.WorkspaceKind, project.WorkspaceSource, project.WorkspaceRef, project.WorkspaceSubdir, project.ExecutionMode, project.RuntimeID))
}

func (s *Store) UpdateProject(ctx context.Context, wid, id string, project Project) (Project, error) {
	updated, err := scanProject(s.pool.QueryRow(ctx, `UPDATE projects SET name=$3,workspace_kind=$4,workspace_source=$5,workspace_ref=$6,workspace_subdir=$7,execution_mode=$8,runtime_id=$9,updated_at=now() WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING `+projectColumns,
		wid, id, project.Name, project.WorkspaceKind, project.WorkspaceSource, project.WorkspaceRef, project.WorkspaceSubdir, project.ExecutionMode, project.RuntimeID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Project{}, ErrNotFound
	}
	return updated, nil
}

func (s *Store) DeleteProject(ctx context.Context, wid, id string) (Project, error) {
	project, err := scanProject(s.pool.QueryRow(ctx, `UPDATE projects SET deleted_at=now(),updated_at=now() WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING `+projectColumns, wid, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Project{}, ErrNotFound
	}
	return project, err
}

type Message struct {
	ID          string              `json:"id"`
	WorkspaceID string              `json:"workspaceId"`
	SessionID   string              `json:"sessionId"`
	Role        string              `json:"role"`
	Content     string              `json:"content"`
	Status      string              `json:"status"`
	RelayRunID  *string             `json:"relayRunId"`
	Error       *string             `json:"error"`
	CreatedAt   time.Time           `json:"createdAt"`
	UpdatedAt   time.Time           `json:"updatedAt"`
	Attachments []MessageAttachment `json:"attachments,omitempty"`
}

type MessageAttachment struct {
	ID          string    `json:"id"`
	MessageID   string    `json:"messageId"`
	Name        string    `json:"name"`
	ContentType string    `json:"contentType"`
	Size        int64     `json:"size"`
	Content     []byte    `json:"-"`
	CreatedAt   time.Time `json:"createdAt"`
}

type Artifact struct {
	ID              string    `json:"id"`
	WorkspaceID     string    `json:"workspaceId"`
	RelayArtifactID *string   `json:"relayArtifactId"`
	RelayRunID      string    `json:"relayRunId"`
	Name            string    `json:"name"`
	Type            string    `json:"type"`
	Ref             string    `json:"ref"`
	ContentType     *string   `json:"contentType"`
	Size            *int64    `json:"size"`
	State           string    `json:"state"`
	CreatedAt       time.Time `json:"createdAt"`
}

type RunLink struct {
	RelayRunID  string    `json:"runId"`
	WorkspaceID string    `json:"-"`
	Purpose     string    `json:"purpose"`
	SessionID   *string   `json:"sessionId"`
	AgentID     string    `json:"agentId"`
	Status      string    `json:"status"`
	Summary     *string   `json:"summary"`
	Error       *string   `json:"error"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type SharedConversation struct {
	ID              string          `json:"id"`
	WorkspaceID     string          `json:"-"`
	SessionID       string          `json:"-"`
	MessageID       *string         `json:"-"`
	TokenHash       string          `json:"-"`
	Snapshot        json.RawMessage `json:"snapshot"`
	CreatedByUserID *string         `json:"-"`
	CreatedAt       time.Time       `json:"createdAt"`
}

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &Store{pool: pool}, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Migrate(ctx context.Context) error {
	entries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		return err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version := strings.TrimSuffix(entry.Name(), ".sql")
		var applied bool
		_ = s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version=$1)`, version).Scan(&applied)
		if applied {
			continue
		}
		body, err := migrationFiles.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return err
		}
		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, string(body)); err == nil {
			_, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version) VALUES ($1)`, version)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("migration %s: %w", version, err)
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) EnsureWorkspace(ctx context.Context, id, name string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO workspaces(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING`, id, name)
	return err
}

func scanAgent(row pgx.Row) (Agent, error) {
	var a Agent
	err := row.Scan(&a.ID, &a.WorkspaceID, &a.Name, &a.Role, &a.Instructions, &a.RuntimeProvider, &a.RuntimeID, &a.Model, &a.WorkspaceKind, &a.WorkspaceSource, &a.WorkspaceRef, &a.CreatedAt, &a.UpdatedAt)
	return a, err
}

const agentColumns = `id,workspace_id,name,role,instructions,runtime_provider,runtime_id,model,workspace_kind,workspace_source,workspace_ref,created_at,updated_at`

func (s *Store) Agents(ctx context.Context, workspaceID string) ([]Agent, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+agentColumns+` FROM agents WHERE workspace_id=$1 ORDER BY created_at`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Agent{}
	for rows.Next() {
		a, err := scanAgent(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, a)
	}
	return result, rows.Err()
}

func (s *Store) Agent(ctx context.Context, workspaceID, id string) (Agent, error) {
	a, err := scanAgent(s.pool.QueryRow(ctx, `SELECT `+agentColumns+` FROM agents WHERE workspace_id=$1 AND id=$2`, workspaceID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Agent{}, ErrNotFound
	}
	return a, err
}

func (s *Store) CreateAgent(ctx context.Context, workspaceID string, a Agent) (Agent, error) {
	a.ID = uuid.NewString()
	a.WorkspaceID = workspaceID
	return scanAgent(s.pool.QueryRow(ctx, `INSERT INTO agents(id,workspace_id,name,role,instructions,runtime_provider,runtime_id,model,workspace_kind,workspace_source,workspace_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING `+agentColumns,
		a.ID, a.WorkspaceID, a.Name, a.Role, a.Instructions, a.RuntimeProvider, a.RuntimeID, a.Model, a.WorkspaceKind, a.WorkspaceSource, a.WorkspaceRef))
}

func (s *Store) Sessions(ctx context.Context, wid string) ([]Session, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+sessionColumns+` FROM chat_sessions WHERE workspace_id=$1 ORDER BY updated_at DESC`, wid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Session{}
	for rows.Next() {
		var x Session
		if err := scanSessionFields(rows, &x); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (s *Store) Session(ctx context.Context, wid, id string) (Session, error) {
	var x Session
	err := scanSessionFields(s.pool.QueryRow(ctx, `SELECT `+sessionColumns+` FROM chat_sessions WHERE workspace_id=$1 AND id=$2`, wid, id), &x)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	return x, err
}

func (s *Store) DeleteSession(ctx context.Context, wid, id string) (Session, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback(ctx)

	if _, err = tx.Exec(ctx, `DELETE FROM artifacts WHERE workspace_id=$1 AND relay_run_id IN (SELECT relay_run_id FROM run_links WHERE workspace_id=$1 AND session_id=$2)`, wid, id); err != nil {
		return Session{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM message_attachments WHERE workspace_id=$1 AND session_id=$2`, wid, id); err != nil {
		return Session{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM messages WHERE workspace_id=$1 AND session_id=$2`, wid, id); err != nil {
		return Session{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM run_links WHERE workspace_id=$1 AND session_id=$2`, wid, id); err != nil {
		return Session{}, err
	}

	var deleted Session
	err = scanSessionFields(tx.QueryRow(ctx, `DELETE FROM chat_sessions WHERE workspace_id=$1 AND id=$2 RETURNING `+sessionColumns, wid, id), &deleted)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	if err != nil {
		return Session{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Session{}, err
	}
	return deleted, nil
}

func (s *Store) Messages(ctx context.Context, wid, sessionID string) ([]Message, error) {
	rows, err := s.pool.Query(ctx, `SELECT id,workspace_id,session_id,role,content,status,relay_run_id,error,created_at,updated_at FROM messages WHERE workspace_id=$1 AND session_id=$2 ORDER BY created_at, CASE role WHEN 'user' THEN 0 ELSE 1 END, id`, wid, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Message{}
	for rows.Next() {
		var x Message
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &x.SessionID, &x.Role, &x.Content, &x.Status, &x.RelayRunID, &x.Error, &x.CreatedAt, &x.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	attachmentRows, err := s.pool.Query(ctx, `SELECT id,message_id,name,content_type,size,created_at FROM message_attachments WHERE workspace_id=$1 AND session_id=$2 ORDER BY created_at,id`, wid, sessionID)
	if err != nil {
		return nil, err
	}
	defer attachmentRows.Close()
	byMessage := make(map[string][]MessageAttachment)
	for attachmentRows.Next() {
		var item MessageAttachment
		if err := attachmentRows.Scan(&item.ID, &item.MessageID, &item.Name, &item.ContentType, &item.Size, &item.CreatedAt); err != nil {
			return nil, err
		}
		byMessage[item.MessageID] = append(byMessage[item.MessageID], item)
	}
	if err := attachmentRows.Err(); err != nil {
		return nil, err
	}
	for index := range out {
		out[index].Attachments = byMessage[out[index].ID]
	}
	return out, nil
}

func (s *Store) Message(ctx context.Context, wid, id string) (Message, error) {
	var item Message
	err := s.pool.QueryRow(ctx, `SELECT id,workspace_id,session_id,role,content,status,relay_run_id,error,created_at,updated_at FROM messages WHERE workspace_id=$1 AND id=$2`, wid, id).Scan(
		&item.ID, &item.WorkspaceID, &item.SessionID, &item.Role, &item.Content, &item.Status, &item.RelayRunID, &item.Error, &item.CreatedAt, &item.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	return item, err
}

func (s *Store) CreateSharedConversation(ctx context.Context, share SharedConversation) error {
	share.ID = uuid.NewString()
	_, err := s.pool.Exec(ctx, `INSERT INTO shared_conversations(id,workspace_id,session_id,message_id,token_hash,snapshot,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
		share.ID, share.WorkspaceID, share.SessionID, share.MessageID, share.TokenHash, share.Snapshot, share.CreatedByUserID)
	return err
}

func (s *Store) SharedConversationByToken(ctx context.Context, hash string) (SharedConversation, error) {
	var share SharedConversation
	err := s.pool.QueryRow(ctx, `SELECT id,workspace_id,session_id,message_id,token_hash,snapshot,created_by_user_id,created_at FROM shared_conversations WHERE token_hash=$1`, hash).Scan(
		&share.ID, &share.WorkspaceID, &share.SessionID, &share.MessageID, &share.TokenHash, &share.Snapshot, &share.CreatedByUserID, &share.CreatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return SharedConversation{}, ErrNotFound
	}
	return share, err
}

const sessionColumns = `id,workspace_id,title,agent_id,project_id,execution_runtime_id,workspace_key,workspace_kind,workspace_source,workspace_ref,workspace_subdir,execution_mode,created_at,updated_at`

type rowScanner interface {
	Scan(...any) error
}

func scanSessionFields(row rowScanner, x *Session) error {
	return row.Scan(&x.ID, &x.WorkspaceID, &x.Title, &x.AgentID, &x.ProjectID, &x.ExecutionRuntimeID, &x.WorkspaceKey, &x.WorkspaceKind, &x.WorkspaceSource, &x.WorkspaceRef, &x.WorkspaceSubdir, &x.ExecutionMode, &x.CreatedAt, &x.UpdatedAt)
}

func (s *Store) EnsureSession(ctx context.Context, wid, sessionID, title, agentID string, projectID, executionRuntimeID, workspaceKey *string, project *Project) (Session, error) {
	var workspaceKind, workspaceSource, workspaceRef, workspaceSubdir, executionMode *string
	if project != nil {
		workspaceKind = &project.WorkspaceKind
		workspaceSource = &project.WorkspaceSource
		workspaceRef = project.WorkspaceRef
		workspaceSubdir = project.WorkspaceSubdir
		executionMode = &project.ExecutionMode
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO chat_sessions(id,workspace_id,title,agent_id,project_id,execution_runtime_id,workspace_key,workspace_kind,workspace_source,workspace_ref,workspace_subdir,execution_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
		ON CONFLICT(id) DO UPDATE SET
			execution_runtime_id=COALESCE(chat_sessions.execution_runtime_id, EXCLUDED.execution_runtime_id),
			workspace_key=COALESCE(chat_sessions.workspace_key, EXCLUDED.workspace_key),
			workspace_kind=COALESCE(chat_sessions.workspace_kind, EXCLUDED.workspace_kind),
			workspace_source=COALESCE(chat_sessions.workspace_source, EXCLUDED.workspace_source),
			workspace_ref=COALESCE(chat_sessions.workspace_ref, EXCLUDED.workspace_ref),
			workspace_subdir=COALESCE(chat_sessions.workspace_subdir, EXCLUDED.workspace_subdir),
			execution_mode=COALESCE(chat_sessions.execution_mode, EXCLUDED.execution_mode)
		WHERE chat_sessions.workspace_id=EXCLUDED.workspace_id`, sessionID, wid, title, agentID, projectID, executionRuntimeID, workspaceKey, workspaceKind, workspaceSource, workspaceRef, workspaceSubdir, executionMode)
	if err != nil {
		return Session{}, err
	}
	var x Session
	err = scanSessionFields(s.pool.QueryRow(ctx, `SELECT `+sessionColumns+` FROM chat_sessions WHERE workspace_id=$1 AND id=$2`, wid, sessionID), &x)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrNotFound
	}
	return x, err
}

// UpdateSessionAgent records the Agent selected for the next turn. Runtime and
// workspace placement remain pinned independently on the Session.
func (s *Store) UpdateSessionAgent(ctx context.Context, wid, sessionID, agentID string) error {
	command, err := s.pool.Exec(ctx, `UPDATE chat_sessions SET agent_id=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2`, wid, sessionID, agentID)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) SaveChatRun(ctx context.Context, wid, sessionID, agentID, prompt, runID, status string, attachments ...MessageAttachment) (Message, Message, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Message{}, Message{}, err
	}
	defer tx.Rollback(ctx)
	now := time.Now()
	user := Message{ID: uuid.NewString(), WorkspaceID: wid, SessionID: sessionID, Role: "user", Content: prompt, Status: "complete", CreatedAt: now, UpdatedAt: now}
	assistant := Message{ID: uuid.NewString(), WorkspaceID: wid, SessionID: sessionID, Role: "agent", Status: status, RelayRunID: &runID, CreatedAt: now, UpdatedAt: now}
	_, err = tx.Exec(ctx, `INSERT INTO messages(id,workspace_id,session_id,role,content,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)`, user.ID, wid, sessionID, user.Role, user.Content, user.Status, now)
	if err != nil {
		return Message{}, Message{}, err
	}
	for index := range attachments {
		item := &attachments[index]
		item.ID = uuid.NewString()
		item.MessageID = user.ID
		item.CreatedAt = now
		_, err = tx.Exec(ctx, `INSERT INTO message_attachments(id,workspace_id,session_id,message_id,name,content_type,size,content,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, item.ID, wid, sessionID, user.ID, item.Name, item.ContentType, item.Size, item.Content, now)
		if err != nil {
			return Message{}, Message{}, err
		}
	}
	user.Attachments = attachments
	_, err = tx.Exec(ctx, `INSERT INTO messages(id,workspace_id,session_id,role,content,status,relay_run_id,created_at,updated_at) VALUES($1,$2,$3,$4,'',$5,$6,$7,$7)`, assistant.ID, wid, sessionID, assistant.Role, status, runID, now)
	if err != nil {
		return Message{}, Message{}, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO run_links(relay_run_id,workspace_id,purpose,session_id,agent_id,status) VALUES($1,$2,'chat',$3,$4,$5)`, runID, wid, sessionID, agentID, status)
	if err != nil {
		return Message{}, Message{}, err
	}
	_, err = tx.Exec(ctx, `UPDATE chat_sessions SET agent_id=$3,updated_at=$4 WHERE workspace_id=$1 AND id=$2`, wid, sessionID, agentID, now)
	if err != nil {
		return Message{}, Message{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return Message{}, Message{}, err
	}
	return user, assistant, nil
}

func (s *Store) MessageAttachment(ctx context.Context, wid, messageID, attachmentID string) (MessageAttachment, error) {
	var item MessageAttachment
	err := s.pool.QueryRow(ctx, `SELECT id,message_id,name,content_type,size,content,created_at FROM message_attachments WHERE workspace_id=$1 AND message_id=$2 AND id=$3`, wid, messageID, attachmentID).Scan(&item.ID, &item.MessageID, &item.Name, &item.ContentType, &item.Size, &item.Content, &item.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return MessageAttachment{}, ErrNotFound
	}
	return item, err
}

func (s *Store) UpdateRun(ctx context.Context, wid, runID, status, content string, runErr *string, lastSeq int) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	// Ignore stale polls (including a delayed running response after success).
	var previousStatus string
	var previousSeq int
	err = tx.QueryRow(ctx, `SELECT status,last_event_sequence FROM run_links WHERE workspace_id=$1 AND relay_run_id=$2 FOR UPDATE`, wid, runID).Scan(&previousStatus, &previousSeq)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if lastSeq < previousSeq || (isTerminal(previousStatus) && previousStatus != status) {
		return nil
	}
	_, err = tx.Exec(ctx, `UPDATE messages SET content=$3,status=$4,error=$5,updated_at=now() WHERE workspace_id=$1 AND relay_run_id=$2`, wid, runID, content, status, runErr)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE run_links SET status=$3,summary=$4,error=$5,last_event_sequence=$6,updated_at=now() WHERE workspace_id=$1 AND relay_run_id=$2`, wid, runID, status, content, runErr, lastSeq)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func isTerminal(status string) bool {
	return status == "succeeded" || status == "failed" || status == "cancelled"
}
func (s *Store) RunLink(ctx context.Context, wid, runID string) (RunLink, error) {
	var x RunLink
	err := s.pool.QueryRow(ctx, `SELECT relay_run_id,workspace_id,purpose,session_id,agent_id,status,summary,error,created_at,updated_at FROM run_links WHERE workspace_id=$1 AND relay_run_id=$2`, wid, runID).Scan(&x.RelayRunID, &x.WorkspaceID, &x.Purpose, &x.SessionID, &x.AgentID, &x.Status, &x.Summary, &x.Error, &x.CreatedAt, &x.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return RunLink{}, ErrNotFound
	}
	return x, err
}

func (s *Store) Artifacts(ctx context.Context, wid string) ([]Artifact, error) {
	rows, err := s.pool.Query(ctx, `SELECT id,workspace_id,relay_artifact_id,relay_run_id,name,type,ref,content_type,size,state,created_at FROM artifacts WHERE workspace_id=$1 AND type NOT ILIKE '%instruction%' AND type NOT ILIKE '%final_message%' AND name NOT ILIKE '%-last-message.%' ORDER BY created_at DESC`, wid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Artifact{}
	for rows.Next() {
		var x Artifact
		if err := rows.Scan(&x.ID, &x.WorkspaceID, &x.RelayArtifactID, &x.RelayRunID, &x.Name, &x.Type, &x.Ref, &x.ContentType, &x.Size, &x.State, &x.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, x)
	}
	return out, rows.Err()
}

func (s *Store) Artifact(ctx context.Context, wid, id string) (Artifact, error) {
	var x Artifact
	err := s.pool.QueryRow(ctx, `SELECT id,workspace_id,relay_artifact_id,relay_run_id,name,type,ref,content_type,size,state,created_at FROM artifacts WHERE workspace_id=$1 AND id=$2`, wid, id).Scan(&x.ID, &x.WorkspaceID, &x.RelayArtifactID, &x.RelayRunID, &x.Name, &x.Type, &x.Ref, &x.ContentType, &x.Size, &x.State, &x.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Artifact{}, ErrNotFound
	}
	return x, err
}
func (s *Store) UpsertArtifact(ctx context.Context, wid string, link RunLink, id, name, typ, ref, contentType string, size int64) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO artifacts(id,workspace_id,relay_artifact_id,relay_run_id,name,type,ref,content_type,size,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'ready') ON CONFLICT(workspace_id,relay_artifact_id) WHERE relay_artifact_id IS NOT NULL DO UPDATE SET name=EXCLUDED.name,type=EXCLUDED.type,ref=EXCLUDED.ref,content_type=EXCLUDED.content_type,size=EXCLUDED.size`, uuid.NewString(), wid, id, link.RelayRunID, name, typ, ref, contentType, size)
	return err
}
