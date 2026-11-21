package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type IntegrationCard struct {
	ID, IntegrationID, ChatID, ThreadKey, MessageID, Kind string
	Context                                               json.RawMessage
	ExpiresAt                                             time.Time
	ConsumedAt                                            *time.Time
}

func (s *Store) CreateIntegrationCard(ctx context.Context, card IntegrationCard) (IntegrationCard, error) {
	card.ID = uuid.NewString()
	// Expired interaction bindings are no longer useful; keep storage bounded.
	if _, err := s.pool.Exec(ctx, `DELETE FROM integration_cards WHERE expires_at < now()`); err != nil {
		return card, err
	}
	err := s.pool.QueryRow(ctx, `INSERT INTO integration_cards(id,integration_id,chat_id,thread_key,kind,context) VALUES($1,$2,$3,$4,$5,$6) RETURNING expires_at`, card.ID, card.IntegrationID, card.ChatID, card.ThreadKey, card.Kind, card.Context).Scan(&card.ExpiresAt)
	return card, err
}

func (s *Store) BindIntegrationCardMessage(ctx context.Context, id, messageID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE integration_cards SET message_id=$2 WHERE id=$1`, id, messageID)
	return err
}

func (s *Store) IntegrationCard(ctx context.Context, integrationID, id string) (IntegrationCard, error) {
	var card IntegrationCard
	err := s.pool.QueryRow(ctx, `SELECT id,integration_id,chat_id,thread_key,message_id,kind,context,expires_at,consumed_at FROM integration_cards WHERE integration_id=$1 AND id=$2`, integrationID, id).Scan(&card.ID, &card.IntegrationID, &card.ChatID, &card.ThreadKey, &card.MessageID, &card.Kind, &card.Context, &card.ExpiresAt, &card.ConsumedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return card, ErrNotFound
	}
	return card, err
}

func (s *Store) ConsumeIntegrationCard(ctx context.Context, id string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `UPDATE integration_cards SET consumed_at=now() WHERE id=$1 AND consumed_at IS NULL AND expires_at > now()`, id)
	return tag.RowsAffected() == 1, err
}

func (s *Store) SetIntegrationConversationModel(ctx context.Context, integrationID, chatID, threadKey, model, effort string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `INSERT INTO integration_conversations(integration_id,chat_id,thread_key,conversation_id,model_override,reasoning_effort) VALUES($1,$2,$3,'',$4,$5) ON CONFLICT(integration_id,chat_id,thread_key) DO UPDATE SET model_override=EXCLUDED.model_override,reasoning_effort=EXCLUDED.reasoning_effort,updated_at=now()`, integrationID, chatID, threadKey, model, effort); err != nil {
		return err
	}
	// Reflect selection in the Web conversation immediately as well. NULL is the
	// session representation of following Agent/model defaults.
	if _, err := tx.Exec(ctx, `UPDATE chat_sessions SET model_override=NULLIF($4,''),reasoning_effort=NULLIF($5,''),updated_at=now() WHERE id=(SELECT conversation_id FROM integration_conversations WHERE integration_id=$1 AND chat_id=$2 AND thread_key=$3) AND workspace_id=(SELECT workspace_id FROM workspace_integrations WHERE id=$1)`, integrationID, chatID, threadKey, model, effort); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) ClearIntegrationActiveTask(ctx context.Context, integrationID, chatID, threadKey, taskID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE integration_conversations SET active_task_id=NULL,updated_at=now() WHERE integration_id=$1 AND chat_id=$2 AND thread_key=$3 AND active_task_id=$4`, integrationID, chatID, threadKey, taskID)
	return err
}
