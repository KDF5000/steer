package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type CodebaseConnection struct {
	WorkspaceID         string    `json:"workspaceId"`
	BaseURL             string    `json:"baseUrl"`
	AppID               string    `json:"appId"`
	EncryptedAppSecret  []byte    `json:"-"`
	AppSecretConfigured bool      `json:"appSecretConfigured"`
	RemoteUsername      string    `json:"remoteUsername"`
	VerifiedAt          time.Time `json:"verifiedAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

const codebaseConnectionColumns = `workspace_id,base_url,app_id,encrypted_app_secret,remote_username,verified_at,updated_at`

func scanCodebaseConnection(row pgx.Row) (CodebaseConnection, error) {
	var item CodebaseConnection
	err := row.Scan(&item.WorkspaceID, &item.BaseURL, &item.AppID, &item.EncryptedAppSecret, &item.RemoteUsername, &item.VerifiedAt, &item.UpdatedAt)
	item.AppSecretConfigured = len(item.EncryptedAppSecret) != 0
	if errors.Is(err, pgx.ErrNoRows) {
		return item, ErrNotFound
	}
	return item, err
}

func (s *Store) CodebaseConnection(ctx context.Context, wid string) (CodebaseConnection, error) {
	return scanCodebaseConnection(s.pool.QueryRow(ctx, `SELECT `+codebaseConnectionColumns+` FROM workspace_codebase_connections WHERE workspace_id=$1`, wid))
}

func (s *Store) SaveCodebaseConnection(ctx context.Context, item CodebaseConnection) (CodebaseConnection, error) {
	return scanCodebaseConnection(s.pool.QueryRow(ctx, `INSERT INTO workspace_codebase_connections(workspace_id,base_url,app_id,encrypted_app_secret,remote_username,verified_at) VALUES($1,$2,$3,$4,$5,$6)
ON CONFLICT(workspace_id) DO UPDATE SET base_url=EXCLUDED.base_url,app_id=EXCLUDED.app_id,encrypted_app_secret=EXCLUDED.encrypted_app_secret,remote_username=EXCLUDED.remote_username,verified_at=EXCLUDED.verified_at,updated_at=now()
RETURNING `+codebaseConnectionColumns, item.WorkspaceID, item.BaseURL, item.AppID, item.EncryptedAppSecret, item.RemoteUsername, item.VerifiedAt))
}

func (s *Store) DeleteCodebaseConnection(ctx context.Context, wid string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM workspace_codebase_connections WHERE workspace_id=$1`, wid)
	return err
}
