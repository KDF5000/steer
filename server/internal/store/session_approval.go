package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

func (s *Store) SetSessionAutoApproval(ctx context.Context, wid, id string, enabled bool) (Session, error) {
	var session Session
	err := scanSessionFields(s.pool.QueryRow(ctx, `UPDATE chat_sessions SET auto_approve=$3 WHERE workspace_id=$1 AND id=$2 RETURNING `+sessionColumns, wid, id, enabled), &session)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return session, err
}

// Hold the policy row while resolving permissions. Disabling waits for any
// in-flight approval; after it returns no worker can use the previous grant.
// The same lock also serializes automatic approval across Server instances.
func (s *Store) WithSessionAutoApproval(ctx context.Context, wid, id string, approve func() error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var enabled bool
	err = tx.QueryRow(ctx, `SELECT auto_approve FROM chat_sessions WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, wid, id).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if enabled {
		if err := approve(); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
