package store

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type Skill struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Content     string    `json:"content"`
	SourceKind  string    `json:"sourceKind"`
	SourceURL   *string   `json:"sourceUrl"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

const skillColumns = `id,workspace_id,name,description,content,source_kind,source_url,created_at,updated_at`

func scanSkill(row pgx.Row) (Skill, error) {
	var skill Skill
	err := row.Scan(&skill.ID, &skill.WorkspaceID, &skill.Name, &skill.Description, &skill.Content, &skill.SourceKind, &skill.SourceURL, &skill.CreatedAt, &skill.UpdatedAt)
	return skill, err
}

func (s *Store) Skills(ctx context.Context, workspaceID string) ([]Skill, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+skillColumns+` FROM skills WHERE workspace_id=$1 ORDER BY updated_at DESC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Skill{}
	for rows.Next() {
		skill, scanErr := scanSkill(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, skill)
	}
	return items, rows.Err()
}

func (s *Store) Skill(ctx context.Context, workspaceID, id string) (Skill, error) {
	skill, err := scanSkill(s.pool.QueryRow(ctx, `SELECT `+skillColumns+` FROM skills WHERE workspace_id=$1 AND id=$2`, workspaceID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Skill{}, ErrNotFound
	}
	return skill, err
}

func (s *Store) CreateSkill(ctx context.Context, workspaceID string, skill Skill) (Skill, error) {
	skill.ID = uuid.NewString()
	skill.WorkspaceID = workspaceID
	return scanSkill(s.pool.QueryRow(ctx, `INSERT INTO skills(id,workspace_id,name,description,content,source_kind,source_url) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING `+skillColumns,
		skill.ID, workspaceID, skill.Name, skill.Description, skill.Content, skill.SourceKind, skill.SourceURL))
}

func (s *Store) UpdateSkill(ctx context.Context, workspaceID, id string, skill Skill) (Skill, error) {
	updated, err := scanSkill(s.pool.QueryRow(ctx, `UPDATE skills SET name=$3,description=$4,content=$5,source_kind=$6,source_url=$7,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING `+skillColumns,
		workspaceID, id, skill.Name, skill.Description, skill.Content, skill.SourceKind, skill.SourceURL))
	if errors.Is(err, pgx.ErrNoRows) {
		return Skill{}, ErrNotFound
	}
	return updated, err
}

func (s *Store) DeleteSkill(ctx context.Context, workspaceID, id string) (Skill, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Skill{}, err
	}
	defer tx.Rollback(ctx)
	skill, err := scanSkill(tx.QueryRow(ctx, `DELETE FROM skills WHERE workspace_id=$1 AND id=$2 RETURNING `+skillColumns, workspaceID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Skill{}, ErrNotFound
	}
	if err != nil {
		return Skill{}, err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM agent_skills WHERE workspace_id=$1 AND skill_id=$2`, workspaceID, id); err != nil {
		return Skill{}, err
	}
	return skill, tx.Commit(ctx)
}

func (s *Store) AgentSkills(ctx context.Context, workspaceID, agentID string) ([]Skill, error) {
	rows, err := s.pool.Query(ctx, `SELECT s.id,s.workspace_id,s.name,s.description,s.content,s.source_kind,s.source_url,s.created_at,s.updated_at FROM skills s JOIN agent_skills a ON a.skill_id=s.id AND a.workspace_id=s.workspace_id WHERE a.workspace_id=$1 AND a.agent_id=$2 ORDER BY a.created_at`, workspaceID, agentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Skill{}
	for rows.Next() {
		skill, scanErr := scanSkill(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, skill)
	}
	return items, rows.Err()
}

func (s *Store) AgentSkillAssignments(ctx context.Context, workspaceID string) (map[string][]string, error) {
	rows, err := s.pool.Query(ctx, `SELECT agent_id,skill_id FROM agent_skills WHERE workspace_id=$1 ORDER BY created_at`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := map[string][]string{}
	for rows.Next() {
		var agentID, skillID string
		if err := rows.Scan(&agentID, &skillID); err != nil {
			return nil, err
		}
		items[agentID] = append(items[agentID], skillID)
	}
	return items, rows.Err()
}

func (s *Store) SetAgentSkills(ctx context.Context, workspaceID, agentID string, skillIDs []string) error {
	if _, err := s.Agent(ctx, workspaceID, agentID); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `DELETE FROM agent_skills WHERE workspace_id=$1 AND agent_id=$2`, workspaceID, agentID); err != nil {
		return err
	}
	for _, skillID := range skillIDs {
		var exists bool
		if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM skills WHERE workspace_id=$1 AND id=$2)`, workspaceID, skillID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrNotFound
		}
		if _, err = tx.Exec(ctx, `INSERT INTO agent_skills(workspace_id,agent_id,skill_id) VALUES($1,$2,$3)`, workspaceID, agentID, skillID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

type Document struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	Title       string    `json:"title"`
	URL         string    `json:"url"`
	Description string    `json:"description"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

const documentColumns = `id,workspace_id,title,url,description,created_at,updated_at`

func scanDocument(row pgx.Row) (Document, error) {
	var document Document
	err := row.Scan(&document.ID, &document.WorkspaceID, &document.Title, &document.URL, &document.Description, &document.CreatedAt, &document.UpdatedAt)
	return document, err
}

func (s *Store) Documents(ctx context.Context, workspaceID string) ([]Document, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+documentColumns+` FROM documents WHERE workspace_id=$1 ORDER BY updated_at DESC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Document{}
	for rows.Next() {
		item, scanErr := scanDocument(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) CreateDocument(ctx context.Context, workspaceID string, document Document) (Document, error) {
	document.ID = uuid.NewString()
	return scanDocument(s.pool.QueryRow(ctx, `INSERT INTO documents(id,workspace_id,title,url,description) VALUES($1,$2,$3,$4,$5) RETURNING `+documentColumns,
		document.ID, workspaceID, document.Title, document.URL, document.Description))
}

func (s *Store) UpdateDocument(ctx context.Context, workspaceID, id string, document Document) (Document, error) {
	updated, err := scanDocument(s.pool.QueryRow(ctx, `UPDATE documents SET title=$3,url=$4,description=$5,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING `+documentColumns,
		workspaceID, id, document.Title, document.URL, document.Description))
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	return updated, err
}

func (s *Store) DeleteDocument(ctx context.Context, workspaceID, id string) (Document, error) {
	deleted, err := scanDocument(s.pool.QueryRow(ctx, `DELETE FROM documents WHERE workspace_id=$1 AND id=$2 RETURNING `+documentColumns, workspaceID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	return deleted, err
}

type Note struct {
	ID          string     `json:"id"`
	WorkspaceID string     `json:"workspaceId"`
	Title       string     `json:"title"`
	Content     string     `json:"content"`
	Tags        []string   `json:"tags"`
	Pinned      bool       `json:"pinned"`
	Archived    bool       `json:"archived"`
	ReminderAt  *time.Time `json:"reminderAt"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

type WorkLogEntry struct {
	ID               string    `json:"id"`
	WorkspaceID      string    `json:"workspaceId"`
	Content          string    `json:"content"`
	OccurredAt       time.Time `json:"occurredAt"`
	SourceKind       string    `json:"sourceKind"`
	SourceSessionIDs []string  `json:"sourceSessionIds"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type WorkLogSummary struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspaceId"`
	PeriodKind  string    `json:"periodKind"`
	PeriodStart string    `json:"periodStart"`
	Content     string    `json:"content"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type AgentActivity struct {
	SessionID         string                 `json:"sessionId"`
	Title             string                 `json:"title"`
	AgentName         string                 `json:"agentName"`
	TaskDescription   string                 `json:"-"`
	Messages          []AgentActivityMessage `json:"-"`
	MessageCount      int                    `json:"messageCount"`
	TotalMessageCount int                    `json:"totalMessageCount"`
	UpdatedAt         time.Time              `json:"updatedAt"`
}

type AgentActivityMessage struct {
	Role      string    `json:"role"`
	Content   string    `json:"content"`
	Status    string    `json:"status"`
	UpdatedAt time.Time `json:"updatedAt"`
}

const workLogEntryColumns = `id,workspace_id,content,occurred_at,source_kind,source_session_ids,created_at,updated_at`

func scanWorkLogEntry(row pgx.Row) (WorkLogEntry, error) {
	var item WorkLogEntry
	err := row.Scan(&item.ID, &item.WorkspaceID, &item.Content, &item.OccurredAt, &item.SourceKind, &item.SourceSessionIDs, &item.CreatedAt, &item.UpdatedAt)
	if item.SourceSessionIDs == nil {
		item.SourceSessionIDs = []string{}
	}
	return item, err
}

func (s *Store) WorkLogEntries(ctx context.Context, workspaceID string, since time.Time, limit int) ([]WorkLogEntry, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+workLogEntryColumns+` FROM work_log_entries WHERE workspace_id=$1 AND occurred_at >= $2 ORDER BY occurred_at DESC LIMIT $3`, workspaceID, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []WorkLogEntry{}
	for rows.Next() {
		item, scanErr := scanWorkLogEntry(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) HasWorkLogEntriesBefore(ctx context.Context, workspaceID string, before time.Time) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM work_log_entries WHERE workspace_id=$1 AND occurred_at < $2)`, workspaceID, before).Scan(&exists)
	return exists, err
}

func (s *Store) CreateWorkLogEntry(ctx context.Context, workspaceID string, item WorkLogEntry) (WorkLogEntry, error) {
	item.ID, item.WorkspaceID = uuid.NewString(), workspaceID
	if item.OccurredAt.IsZero() {
		item.OccurredAt = time.Now()
	}
	if item.SourceKind == "" {
		item.SourceKind = "manual"
	}
	if item.SourceSessionIDs == nil {
		item.SourceSessionIDs = []string{}
	}
	return scanWorkLogEntry(s.pool.QueryRow(ctx, `INSERT INTO work_log_entries(id,workspace_id,content,occurred_at,source_kind,source_session_ids) VALUES($1,$2,$3,$4,$5,$6) RETURNING `+workLogEntryColumns, item.ID, workspaceID, item.Content, item.OccurredAt, item.SourceKind, item.SourceSessionIDs))
}

func (s *Store) UpdateWorkLogEntry(ctx context.Context, workspaceID, id, content string) (WorkLogEntry, error) {
	item, err := scanWorkLogEntry(s.pool.QueryRow(ctx, `UPDATE work_log_entries SET content=$3,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING `+workLogEntryColumns, workspaceID, id, content))
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkLogEntry{}, ErrNotFound
	}
	return item, err
}

func (s *Store) DeleteWorkLogEntry(ctx context.Context, workspaceID, id string) (WorkLogEntry, error) {
	item, err := scanWorkLogEntry(s.pool.QueryRow(ctx, `DELETE FROM work_log_entries WHERE workspace_id=$1 AND id=$2 RETURNING `+workLogEntryColumns, workspaceID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkLogEntry{}, ErrNotFound
	}
	return item, err
}

func (s *Store) WorkLogSummaries(ctx context.Context, workspaceID string, since time.Time) ([]WorkLogSummary, error) {
	rows, err := s.pool.Query(ctx, `SELECT id,workspace_id,period_kind,period_start::text,content,created_at,updated_at FROM work_log_summaries WHERE workspace_id=$1 AND period_kind='week' AND period_start >= $2::date ORDER BY period_start DESC`, workspaceID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []WorkLogSummary{}
	for rows.Next() {
		var item WorkLogSummary
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.PeriodKind, &item.PeriodStart, &item.Content, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) UpsertWorkLogSummary(ctx context.Context, workspaceID, kind, start, content string) (WorkLogSummary, error) {
	var item WorkLogSummary
	err := s.pool.QueryRow(ctx, `INSERT INTO work_log_summaries(id,workspace_id,period_kind,period_start,content) VALUES($1,$2,$3,$4::date,$5) ON CONFLICT(workspace_id,period_kind,period_start) DO UPDATE SET content=EXCLUDED.content,updated_at=now() RETURNING id,workspace_id,period_kind,period_start::text,content,created_at,updated_at`, uuid.NewString(), workspaceID, kind, start, content).Scan(&item.ID, &item.WorkspaceID, &item.PeriodKind, &item.PeriodStart, &item.Content, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func (s *Store) AgentActivities(ctx context.Context, workspaceID string, from, to time.Time) ([]AgentActivity, error) {
	const messagesPerSession = 30
	const messageCharacterLimit = 4000
	rows, err := s.pool.Query(ctx, `SELECT s.id,s.title,a.name,COALESCE(first_user.content,''),m.role,m.content,m.status,m.updated_at,m.total_count
		FROM chat_sessions s
		JOIN agents a ON a.id=s.agent_id AND a.workspace_id=s.workspace_id
		LEFT JOIN LATERAL (
			SELECT left(content,$5) AS content FROM messages
			WHERE workspace_id=s.workspace_id AND session_id=s.id AND role='user' AND trim(content)<>''
			ORDER BY created_at,id LIMIT 1
		) first_user ON true
		JOIN LATERAL (
			SELECT role,left(content,$5) AS content,status,updated_at,count(*) OVER () AS total_count FROM messages
			WHERE workspace_id=s.workspace_id AND session_id=s.id AND updated_at >= $2 AND updated_at < $3
				AND role IN ('user','agent') AND trim(content)<>''
			ORDER BY updated_at DESC,id DESC LIMIT $4
		) m ON true
		WHERE s.workspace_id=$1
		ORDER BY s.id,m.updated_at,m.role,m.content`, workspaceID, from, to, messagesPerSession, messageCharacterLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []AgentActivity{}
	bySession := map[string]int{}
	for rows.Next() {
		var sessionID, title, agentName, taskDescription string
		var totalMessageCount int
		var message AgentActivityMessage
		if err := rows.Scan(&sessionID, &title, &agentName, &taskDescription, &message.Role, &message.Content, &message.Status, &message.UpdatedAt, &totalMessageCount); err != nil {
			return nil, err
		}
		index, exists := bySession[sessionID]
		if !exists {
			index = len(items)
			bySession[sessionID] = index
			items = append(items, AgentActivity{SessionID: sessionID, Title: title, AgentName: agentName, TaskDescription: taskDescription, Messages: []AgentActivityMessage{}, TotalMessageCount: totalMessageCount})
		}
		items[index].Messages = append(items[index].Messages, message)
		items[index].MessageCount++
		if message.UpdatedAt.After(items[index].UpdatedAt) {
			items[index].UpdatedAt = message.UpdatedAt
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(items, func(i, j int) bool { return items[i].UpdatedAt.After(items[j].UpdatedAt) })
	return items, nil
}

const noteColumns = `id,workspace_id,title,content,tags,pinned,archived,reminder_at,created_at,updated_at`

func scanNote(row pgx.Row) (Note, error) {
	var note Note
	err := row.Scan(&note.ID, &note.WorkspaceID, &note.Title, &note.Content, &note.Tags, &note.Pinned, &note.Archived, &note.ReminderAt, &note.CreatedAt, &note.UpdatedAt)
	if note.Tags == nil {
		note.Tags = []string{}
	}
	return note, err
}

func (s *Store) Notes(ctx context.Context, workspaceID string) ([]Note, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+noteColumns+` FROM notes WHERE workspace_id=$1 ORDER BY archived,pinned DESC,updated_at DESC`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []Note{}
	for rows.Next() {
		item, scanErr := scanNote(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) CreateNote(ctx context.Context, workspaceID string, note Note) (Note, error) {
	note.ID = uuid.NewString()
	if note.Tags == nil {
		note.Tags = []string{}
	}
	return scanNote(s.pool.QueryRow(ctx, `INSERT INTO notes(id,workspace_id,title,content,tags,pinned,archived,reminder_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING `+noteColumns,
		note.ID, workspaceID, note.Title, note.Content, note.Tags, note.Pinned, note.Archived, note.ReminderAt))
}

func (s *Store) UpdateNote(ctx context.Context, workspaceID, id string, note Note) (Note, error) {
	if note.Tags == nil {
		note.Tags = []string{}
	}
	updated, err := scanNote(s.pool.QueryRow(ctx, `UPDATE notes SET title=$3,content=$4,tags=$5,pinned=$6,archived=$7,reminder_at=$8,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING `+noteColumns,
		workspaceID, id, note.Title, note.Content, note.Tags, note.Pinned, note.Archived, note.ReminderAt))
	if errors.Is(err, pgx.ErrNoRows) {
		return Note{}, ErrNotFound
	}
	return updated, err
}

func (s *Store) DeleteNote(ctx context.Context, workspaceID, id string) (Note, error) {
	deleted, err := scanNote(s.pool.QueryRow(ctx, `DELETE FROM notes WHERE workspace_id=$1 AND id=$2 RETURNING `+noteColumns, workspaceID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Note{}, ErrNotFound
	}
	return deleted, err
}
