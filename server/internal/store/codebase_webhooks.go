package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Webhook configuration is independent of API credentials so callbacks can be
// enabled before installing an App or configuring a repository API connection.
type CodebaseWebhook struct {
	WorkspaceID    string    `json:"workspaceId"`
	Enabled        bool      `json:"enabled"`
	TokenHash      string    `json:"-"`
	EncryptedToken []byte    `json:"-"`
	UpdatedAt      time.Time `json:"updatedAt"`
}

type CodebaseWebhookEvent struct {
	ID              int64           `json:"id"`
	WorkspaceID     string          `json:"workspaceId,omitempty"`
	Payload         json.RawMessage `json:"payload,omitempty"`
	ReceivedAt      time.Time       `json:"receivedAt"`
	ProcessedAt     *time.Time      `json:"processedAt,omitempty"`
	ProcessingError string          `json:"processingError,omitempty"`
}

func (s *Store) CodebaseWebhook(ctx context.Context, wid string) (CodebaseWebhook, error) {
	var item CodebaseWebhook
	err := s.pool.QueryRow(ctx, `SELECT workspace_id,enabled,token_hash,encrypted_token,updated_at FROM workspace_codebase_webhooks WHERE workspace_id=$1`, wid).Scan(&item.WorkspaceID, &item.Enabled, &item.TokenHash, &item.EncryptedToken, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

func (s *Store) SaveCodebaseWebhook(ctx context.Context, item CodebaseWebhook) (CodebaseWebhook, error) {
	err := s.pool.QueryRow(ctx, `INSERT INTO workspace_codebase_webhooks(workspace_id,enabled,token_hash,encrypted_token) VALUES($1,$2,$3,$4)
	ON CONFLICT(workspace_id) DO UPDATE SET enabled=EXCLUDED.enabled,token_hash=EXCLUDED.token_hash,encrypted_token=EXCLUDED.encrypted_token,updated_at=now()
	RETURNING updated_at`, item.WorkspaceID, item.Enabled, item.TokenHash, item.EncryptedToken).Scan(&item.UpdatedAt)
	return item, err
}

// Lock the configuration row while accepting an event so disabling or rotating
// the token cannot race an in-flight delivery. Only a durable insert is ACKed.
func (s *Store) AcceptCodebaseWebhook(ctx context.Context, wid, hash, payloadHash string, payload json.RawMessage) (CodebaseWebhookEvent, bool, error) {
	var event CodebaseWebhookEvent
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return event, false, err
	}
	defer tx.Rollback(ctx)
	var accepted bool
	err = tx.QueryRow(ctx, `SELECT enabled AND token_hash=$2 FROM workspace_codebase_webhooks WHERE workspace_id=$1 FOR UPDATE`, wid, hash).Scan(&accepted)
	if errors.Is(err, pgx.ErrNoRows) || err == nil && !accepted {
		return event, false, ErrNotFound
	}
	if err != nil {
		return event, false, err
	}
	err = tx.QueryRow(ctx, `INSERT INTO codebase_webhook_events(workspace_id,payload_hash,payload) VALUES($1,$2,$3)
	ON CONFLICT(workspace_id,payload_hash) DO NOTHING RETURNING id,workspace_id,payload,received_at`, wid, payloadHash, payload).Scan(&event.ID, &event.WorkspaceID, &event.Payload, &event.ReceivedAt)
	duplicate := errors.Is(err, pgx.ErrNoRows)
	if duplicate {
		err = tx.QueryRow(ctx, `SELECT id,workspace_id,payload,received_at FROM codebase_webhook_events WHERE workspace_id=$1 AND payload_hash=$2`, wid, payloadHash).Scan(&event.ID, &event.WorkspaceID, &event.Payload, &event.ReceivedAt)
	}
	if err != nil {
		return event, false, err
	}
	err = tx.Commit(ctx)
	return event, duplicate, err
}

func (s *Store) CodebaseWebhookEvents(ctx context.Context, wid string, after int64) ([]CodebaseWebhookEvent, error) {
	rows, err := s.pool.Query(ctx, `SELECT id,received_at FROM codebase_webhook_events WHERE workspace_id=$1 AND id>$2 ORDER BY id LIMIT 100`, wid, after)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []CodebaseWebhookEvent{}
	for rows.Next() {
		var item CodebaseWebhookEvent
		if err = rows.Scan(&item.ID, &item.ReceivedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// PendingCodebaseWebhookEvents returns accepted events that have not been
// interpreted yet. The payload is included so the worker can start reviews
// without a second query.
func (s *Store) PendingCodebaseWebhookEvents(ctx context.Context, wid string, limit int) ([]CodebaseWebhookEvent, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.pool.Query(ctx, `SELECT id,workspace_id,payload,received_at FROM codebase_webhook_events
WHERE workspace_id=$1 AND processed_at IS NULL ORDER BY id LIMIT $2`, wid, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPendingWebhookEvents(rows)
}

// PendingCodebaseWebhookEventsAll is used by the background worker, which is
// not scoped to a single workspace.
func (s *Store) PendingCodebaseWebhookEventsAll(ctx context.Context, limit int) ([]CodebaseWebhookEvent, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.pool.Query(ctx, `SELECT id,workspace_id,payload,received_at FROM codebase_webhook_events
WHERE processed_at IS NULL ORDER BY id LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanPendingWebhookEvents(rows)
}

func scanPendingWebhookEvents(rows pgx.Rows) ([]CodebaseWebhookEvent, error) {
	items := []CodebaseWebhookEvent{}
	for rows.Next() {
		var item CodebaseWebhookEvent
		if err := rows.Scan(&item.ID, &item.WorkspaceID, &item.Payload, &item.ReceivedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// codebaseWebhookMaxAttempts bounds retries so a permanently failing event
// cannot be retried forever by the background worker.
const codebaseWebhookMaxAttempts = 5

// ClaimCodebaseWebhookEvent marks an event as in-flight so only one worker,
// across server replicas, interprets it. A retryable failure releases the claim
// again through MarkCodebaseWebhookEvent.
func (s *Store) ClaimCodebaseWebhookEvent(ctx context.Context, id int64) (bool, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE codebase_webhook_events SET processed_at=now() WHERE id=$1 AND processed_at IS NULL`, id)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// MarkCodebaseWebhookEvent records the processing outcome. A retryable failure
// releases the claim so the worker retries until the attempt budget is
// exhausted; otherwise the event stays handled with an optional note.
func (s *Store) MarkCodebaseWebhookEvent(ctx context.Context, id int64, processingError string, retry bool) error {
	if retry {
		_, err := s.pool.Exec(ctx, `UPDATE codebase_webhook_events
SET attempts=attempts+1, processing_error=$2,
    processed_at=CASE WHEN attempts+1 >= $3 THEN now() ELSE NULL END
WHERE id=$1`, id, processingError, codebaseWebhookMaxAttempts)
		return err
	}
	_, err := s.pool.Exec(ctx, `UPDATE codebase_webhook_events SET processed_at=now(), processing_error=$2 WHERE id=$1`, id, processingError)
	return err
}
