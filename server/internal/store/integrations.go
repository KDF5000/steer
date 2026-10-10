package store

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type WorkspaceIntegration struct {
	ID                   string     `json:"id"`
	WorkspaceID          string     `json:"workspaceId"`
	Provider             string     `json:"provider"`
	Name                 string     `json:"name"`
	ExternalAppID        string     `json:"appId"`
	EncryptedCredentials []byte     `json:"-"`
	SecretConfigured     bool       `json:"secretConfigured"`
	AgentID              string     `json:"agentId"`
	ProjectID            *string    `json:"projectId"`
	Enabled              bool       `json:"enabled"`
	Status               string     `json:"status"`
	LastError            *string    `json:"lastError"`
	LastConnectedAt      *time.Time `json:"lastConnectedAt"`
	CreatedByUserID      string     `json:"-"`
	CreatedAt            time.Time  `json:"createdAt"`
	UpdatedAt            time.Time  `json:"updatedAt"`
}

type IntegrationConversation struct {
	IntegrationID  string
	ChatID         string
	ThreadKey      string
	ConversationID string
	ActiveTaskID   *string
	ProjectID      *string
}

type IntegrationEvent struct {
	ID                string
	IntegrationID     string
	ExternalEventID   string
	ExternalMessageID string
	ChatID            string
	ThreadKey         string
	SenderID          string
	Prompt            string
	TaskID            *string
	Status            string
	LastError         *string
}

const integrationColumns = `id,workspace_id,provider,name,external_app_id,encrypted_credentials,agent_id,project_id,enabled,status,last_error,last_connected_at,created_by_user_id,created_at,updated_at`

func scanIntegration(row pgx.Row) (WorkspaceIntegration, error) {
	var item WorkspaceIntegration
	err := row.Scan(&item.ID, &item.WorkspaceID, &item.Provider, &item.Name, &item.ExternalAppID, &item.EncryptedCredentials, &item.AgentID, &item.ProjectID, &item.Enabled, &item.Status, &item.LastError, &item.LastConnectedAt, &item.CreatedByUserID, &item.CreatedAt, &item.UpdatedAt)
	item.SecretConfigured = len(item.EncryptedCredentials) > 0
	return item, err
}

func (s *Store) WorkspaceIntegrations(ctx context.Context, workspaceID string) ([]WorkspaceIntegration, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+integrationColumns+` FROM workspace_integrations WHERE workspace_id=$1 ORDER BY created_at`, workspaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []WorkspaceIntegration{}
	for rows.Next() {
		var item WorkspaceIntegration
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.Provider, &item.Name, &item.ExternalAppID, &item.EncryptedCredentials, &item.AgentID, &item.ProjectID, &item.Enabled, &item.Status, &item.LastError, &item.LastConnectedAt, &item.CreatedByUserID, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.SecretConfigured = len(item.EncryptedCredentials) > 0
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) EnabledWorkspaceIntegrations(ctx context.Context) ([]WorkspaceIntegration, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+integrationColumns+` FROM workspace_integrations WHERE enabled=true ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []WorkspaceIntegration{}
	for rows.Next() {
		var item WorkspaceIntegration
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.Provider, &item.Name, &item.ExternalAppID, &item.EncryptedCredentials, &item.AgentID, &item.ProjectID, &item.Enabled, &item.Status, &item.LastError, &item.LastConnectedAt, &item.CreatedByUserID, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		item.SecretConfigured = len(item.EncryptedCredentials) > 0
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) WorkspaceIntegration(ctx context.Context, workspaceID, id string) (WorkspaceIntegration, error) {
	item, err := scanIntegration(s.pool.QueryRow(ctx, `SELECT `+integrationColumns+` FROM workspace_integrations WHERE workspace_id=$1 AND id=$2`, workspaceID, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceIntegration{}, ErrNotFound
	}
	return item, err
}

func (s *Store) CreateWorkspaceIntegration(ctx context.Context, item WorkspaceIntegration) (WorkspaceIntegration, error) {
	item.ID = uuid.NewString()
	return scanIntegration(s.pool.QueryRow(ctx, `INSERT INTO workspace_integrations(id,workspace_id,provider,name,external_app_id,encrypted_credentials,agent_id,project_id,enabled,status,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING `+integrationColumns,
		item.ID, item.WorkspaceID, item.Provider, item.Name, item.ExternalAppID, item.EncryptedCredentials, item.AgentID, item.ProjectID, item.Enabled, item.Status, item.CreatedByUserID))
}

func (s *Store) UpdateWorkspaceIntegration(ctx context.Context, item WorkspaceIntegration) (WorkspaceIntegration, error) {
	updated, err := scanIntegration(s.pool.QueryRow(ctx, `UPDATE workspace_integrations SET name=$3,external_app_id=$4,encrypted_credentials=$5,agent_id=$6,project_id=$7,enabled=$8,status=$9,last_error=NULL,updated_at=now() WHERE workspace_id=$1 AND id=$2 RETURNING `+integrationColumns,
		item.WorkspaceID, item.ID, item.Name, item.ExternalAppID, item.EncryptedCredentials, item.AgentID, item.ProjectID, item.Enabled, item.Status))
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceIntegration{}, ErrNotFound
	}
	return updated, err
}

func (s *Store) DeleteWorkspaceIntegration(ctx context.Context, workspaceID, id string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `DELETE FROM integration_events WHERE integration_id=$1`, id); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM integration_conversations WHERE integration_id=$1`, id); err != nil {
		return err
	}
	tag, err := tx.Exec(ctx, `DELETE FROM workspace_integrations WHERE workspace_id=$1 AND id=$2`, workspaceID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return tx.Commit(ctx)
}

func (s *Store) SetIntegrationStatus(ctx context.Context, id, status string, connected bool, lastErr *string) error {
	if connected {
		_, err := s.pool.Exec(ctx, `UPDATE workspace_integrations SET status=$2,last_error=$3,last_connected_at=now(),updated_at=now() WHERE id=$1`, id, status, lastErr)
		return err
	}
	_, err := s.pool.Exec(ctx, `UPDATE workspace_integrations SET status=$2,last_error=$3,updated_at=now() WHERE id=$1`, id, status, lastErr)
	return err
}

func (s *Store) CreateIntegrationEvent(ctx context.Context, event IntegrationEvent) (bool, error) {
	event.ID = uuid.NewString()
	tag, err := s.pool.Exec(ctx, `INSERT INTO integration_events(id,integration_id,external_event_id,external_message_id,chat_id,thread_key,sender_id,prompt,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'queued') ON CONFLICT(integration_id,external_event_id) DO NOTHING`, event.ID, event.IntegrationID, event.ExternalEventID, event.ExternalMessageID, event.ChatID, event.ThreadKey, event.SenderID, event.Prompt)
	return err == nil && tag.RowsAffected() == 1, err
}

func (s *Store) IntegrationConversation(ctx context.Context, integrationID, chatID, threadKey string) (IntegrationConversation, error) {
	var item IntegrationConversation
	err := s.pool.QueryRow(ctx, `SELECT integration_id,chat_id,thread_key,conversation_id,active_task_id,project_id FROM integration_conversations WHERE integration_id=$1 AND chat_id=$2 AND thread_key=$3`, integrationID, chatID, threadKey).Scan(&item.IntegrationID, &item.ChatID, &item.ThreadKey, &item.ConversationID, &item.ActiveTaskID, &item.ProjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return IntegrationConversation{}, ErrNotFound
	}
	return item, err
}

func (s *Store) LatestIntegrationConversationTask(ctx context.Context, integrationID, chatID string) (IntegrationConversation, error) {
	var item IntegrationConversation
	err := s.pool.QueryRow(ctx, `SELECT integration_id,chat_id,thread_key,conversation_id,active_task_id,project_id FROM integration_conversations WHERE integration_id=$1 AND chat_id=$2 AND active_task_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1`, integrationID, chatID).Scan(&item.IntegrationID, &item.ChatID, &item.ThreadKey, &item.ConversationID, &item.ActiveTaskID, &item.ProjectID)
	if errors.Is(err, pgx.ErrNoRows) {
		return IntegrationConversation{}, ErrNotFound
	}
	return item, err
}

func (s *Store) SaveIntegrationConversation(ctx context.Context, item IntegrationConversation) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO integration_conversations(integration_id,chat_id,thread_key,conversation_id,active_task_id,project_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(integration_id,chat_id,thread_key) DO UPDATE SET conversation_id=EXCLUDED.conversation_id,active_task_id=EXCLUDED.active_task_id,project_id=EXCLUDED.project_id,updated_at=now()`, item.IntegrationID, item.ChatID, item.ThreadKey, item.ConversationID, item.ActiveTaskID, item.ProjectID)
	return err
}

func (s *Store) ResetIntegrationConversation(ctx context.Context, integrationID, chatID, threadKey string) error {
	_, err := s.pool.Exec(ctx, `UPDATE integration_conversations SET conversation_id='',active_task_id=NULL,updated_at=now() WHERE integration_id=$1 AND chat_id=$2 AND thread_key=$3`, integrationID, chatID, threadKey)
	return err
}

func (s *Store) SetIntegrationConversationProject(ctx context.Context, integrationID, chatID, threadKey string, projectID *string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO integration_conversations(integration_id,chat_id,thread_key,conversation_id,active_task_id,project_id) VALUES($1,$2,$3,'',NULL,$4) ON CONFLICT(integration_id,chat_id,thread_key) DO UPDATE SET conversation_id='',active_task_id=NULL,project_id=EXCLUDED.project_id,updated_at=now()`, integrationID, chatID, threadKey, projectID)
	return err
}

func (s *Store) SetIntegrationChatProject(ctx context.Context, integrationID, chatID, defaultThreadKey, currentThreadKey string, projectID *string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	query := `INSERT INTO integration_conversations(integration_id,chat_id,thread_key,conversation_id,active_task_id,project_id) VALUES($1,$2,$3,'',NULL,$4) ON CONFLICT(integration_id,chat_id,thread_key) DO UPDATE SET conversation_id='',active_task_id=NULL,project_id=EXCLUDED.project_id,updated_at=now()`
	if _, err := tx.Exec(ctx, query, integrationID, chatID, defaultThreadKey, projectID); err != nil {
		return err
	}
	if currentThreadKey != defaultThreadKey {
		if _, err := tx.Exec(ctx, query, integrationID, chatID, currentThreadKey, projectID); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) ResetIntegrationConversations(ctx context.Context, integrationID string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM integration_conversations WHERE integration_id=$1`, integrationID)
	return err
}

func (s *Store) UpdateIntegrationEvent(ctx context.Context, integrationID, externalEventID, status string, taskID *string, lastErr *string) error {
	_, err := s.pool.Exec(ctx, `UPDATE integration_events SET status=$3,task_id=COALESCE($4,task_id),last_error=$5,updated_at=now() WHERE integration_id=$1 AND external_event_id=$2`, integrationID, externalEventID, status, taskID, lastErr)
	return err
}

func (s *Store) PendingIntegrationEvents(ctx context.Context, integrationID string) ([]IntegrationEvent, error) {
	rows, err := s.pool.Query(ctx, `SELECT id,integration_id,external_event_id,external_message_id,chat_id,thread_key,sender_id,prompt,task_id,status,last_error FROM integration_events WHERE integration_id=$1 AND status IN ('queued','running') ORDER BY created_at`, integrationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []IntegrationEvent{}
	for rows.Next() {
		var item IntegrationEvent
		if err := rows.Scan(&item.ID, &item.IntegrationID, &item.ExternalEventID, &item.ExternalMessageID, &item.ChatID, &item.ThreadKey, &item.SenderID, &item.Prompt, &item.TaskID, &item.Status, &item.LastError); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
