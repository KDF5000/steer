package store

import (
	"context"
	"errors"
)

type WatchPushDevice struct {
	ID, WorkspaceID, BindingHash, AccountFingerprint, Token, Topic, Environment string
	APIKeyID                                                                    *string
}

var ErrWatchBinding = errors.New("device binding proof does not match")

func (s *Store) RegisterWatchPush(ctx context.Context, d WatchPushDevice) error {
	tag, err := s.pool.Exec(ctx, `INSERT INTO watch_push_devices(id,workspace_id,api_key_id,binding_hash,account_fingerprint,token,topic,environment)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET workspace_id=EXCLUDED.workspace_id,api_key_id=EXCLUDED.api_key_id,
 account_fingerprint=EXCLUDED.account_fingerprint,token=EXCLUDED.token,topic=EXCLUDED.topic,environment=EXCLUDED.environment,enabled=true,
 created_at=CASE WHEN watch_push_devices.workspace_id<>EXCLUDED.workspace_id OR watch_push_devices.account_fingerprint<>EXCLUDED.account_fingerprint THEN now() ELSE watch_push_devices.created_at END,updated_at=now()
 WHERE watch_push_devices.binding_hash=EXCLUDED.binding_hash`, d.ID, d.WorkspaceID, d.APIKeyID, d.BindingHash, d.AccountFingerprint, d.Token, d.Topic, d.Environment)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrWatchBinding
	}
	return nil
}
func (s *Store) RemoveWatchPush(ctx context.Context, wid, id, binding string) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM watch_push_devices WHERE id=$1 AND workspace_id=$2 AND binding_hash=$3`, id, wid, binding)
	return err
}

// The existing usage synchronizer observes Relay after the browser closes.
// Its completed_at timestamp prevents newly registered watches receiving old tasks.
func (s *Store) EnqueueWatchPush(ctx context.Context, topic string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO watch_push_deliveries(id,device_id,task_id,status)
 SELECT md5(d.id||':'||t.id)::uuid::text,d.id,t.id,u.status FROM watch_push_devices d
 JOIN tasks t ON t.workspace_id=d.workspace_id
 JOIN chat_sessions c ON c.id=t.conversation_id AND c.workspace_id=d.workspace_id AND NOT c.archived
 JOIN run_usage u ON u.workspace_id=t.workspace_id AND u.relay_run_id=t.relay_run_id
 LEFT JOIN workspace_api_keys k ON k.id=d.api_key_id
 WHERE d.enabled AND d.topic=$1 AND (d.api_key_id IS NULL OR (k.revoked_at IS NULL AND 'tasks:read'=ANY(k.scopes)))
 AND u.status IN ('succeeded','failed') AND u.completed_at>=d.created_at AND u.completed_at>now()-interval '24 hours'
 ON CONFLICT(device_id,task_id) DO NOTHING`, topic)
	return err
}

type WatchPushDelivery struct {
	ID, TaskID, ConversationID, Title, AgentID, AgentName, ProjectName, Status string
	Device                                                                     WatchPushDevice
}

func (s *Store) ClaimWatchPush(ctx context.Context, limit int) ([]WatchPushDelivery, error) {
	rows, err := s.pool.Query(ctx, `WITH claim AS (
 SELECT n.id FROM watch_push_deliveries n WHERE n.sent_at IS NULL AND n.attempts<8
 AND n.created_at>now()-interval '24 hours' AND n.available_at<=now() AND (n.lease_until IS NULL OR n.lease_until<now())
 ORDER BY n.available_at LIMIT $1 FOR UPDATE SKIP LOCKED
 ), leased AS (
 UPDATE watch_push_deliveries n SET state='sending',attempts=attempts+1,lease_until=now()+interval '90 seconds'
 FROM claim WHERE n.id=claim.id RETURNING n.*
 ) SELECT n.id,n.task_id,t.conversation_id,c.title,c.agent_id,COALESCE(a.name,'Agent'),COALESCE(p.name,''),n.status,
 d.id,d.workspace_id,d.binding_hash,d.account_fingerprint,d.token,d.topic,d.environment
 FROM leased n JOIN watch_push_devices d ON d.id=n.device_id AND d.enabled
 JOIN tasks t ON t.id=n.task_id AND t.workspace_id=d.workspace_id
 JOIN chat_sessions c ON c.id=t.conversation_id AND c.workspace_id=d.workspace_id
 LEFT JOIN agents a ON a.id=t.agent_id AND a.workspace_id=d.workspace_id
 LEFT JOIN projects p ON p.id=c.project_id AND p.workspace_id=d.workspace_id
 LEFT JOIN workspace_api_keys k ON k.id=d.api_key_id
 WHERE d.api_key_id IS NULL OR (k.revoked_at IS NULL AND 'tasks:read'=ANY(k.scopes))`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WatchPushDelivery{}
	for rows.Next() {
		var n WatchPushDelivery
		if err := rows.Scan(&n.ID, &n.TaskID, &n.ConversationID, &n.Title, &n.AgentID, &n.AgentName, &n.ProjectName, &n.Status, &n.Device.ID, &n.Device.WorkspaceID, &n.Device.BindingHash, &n.Device.AccountFingerprint, &n.Device.Token, &n.Device.Topic, &n.Device.Environment); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}
func (s *Store) FinishWatchPush(ctx context.Context, n WatchPushDelivery, sent, invalidToken bool) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if invalidToken {
		_, err = tx.Exec(ctx, `UPDATE watch_push_devices SET enabled=false WHERE id=$1 AND token=$2 AND account_fingerprint=$3`, n.Device.ID, n.Device.Token, n.Device.AccountFingerprint)
		if err != nil {
			return err
		}
	}
	_, err = tx.Exec(ctx, `UPDATE watch_push_deliveries SET state=CASE WHEN $2 THEN 'sent' ELSE 'pending' END,
 sent_at=CASE WHEN $2 THEN now() ELSE NULL END,lease_until=NULL,
 available_at=now()+make_interval(secs=>LEAST(3600,30*power(2,attempts)::int)) WHERE id=$1`, n.ID, sent || invalidToken)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
