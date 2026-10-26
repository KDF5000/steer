package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/KDF5000/relay"
	"github.com/jackc/pgx/v5"
)

// TokenUsage is Relay's versioned usage.updated wire contract. Steer only
// reads normalized snapshots, never provider-native accounting fields.
type TokenUsage = relay.Usage

const captureRunUsageSQL = `INSERT INTO run_usage(relay_run_id,workspace_id,session_id,project_id,agent_id,runtime_id,provider,model,purpose,status,created_at)
 SELECT r.relay_run_id,r.workspace_id,r.session_id,s.project_id,r.agent_id,a.runtime_id,COALESCE(a.runtime_provider,''),a.model,r.purpose,r.status,r.created_at
 FROM run_links r LEFT JOIN chat_sessions s ON s.workspace_id=r.workspace_id AND s.id=r.session_id
 LEFT JOIN agents a ON a.workspace_id=r.workspace_id AND a.id=r.agent_id
 WHERE r.workspace_id=$1 AND r.relay_run_id=$2 ON CONFLICT(relay_run_id) DO NOTHING`

func captureRunUsage(ctx context.Context, tx pgx.Tx, wid, runID string) error {
	_, err := tx.Exec(ctx, captureRunUsageSQL, wid, runID)
	return err
}

func (s *Store) SaveRunUsage(ctx context.Context, wid string, run relay.Run, events []relay.Event) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := captureRunUsage(ctx, tx, wid, run.ID); err != nil {
		return err
	}
	var previousStatus string
	var previousSequence int
	if err := tx.QueryRow(ctx, `SELECT status,last_sequence FROM run_usage WHERE workspace_id=$1 AND relay_run_id=$2 FOR UPDATE`, wid, run.ID).Scan(&previousStatus, &previousSequence); err != nil {
		return err
	}
	sequence := 0
	for _, event := range events {
		if event.Sequence > sequence {
			sequence = event.Sequence
		}
		if event.Type != "usage.updated" || event.RunID != run.ID || event.AttemptID == "" {
			continue
		}
		var u TokenUsage
		if json.Unmarshal(event.Data, &u) != nil || !u.Valid() {
			continue
		}
		_, err = tx.Exec(ctx, `INSERT INTO run_usage_attempts(relay_run_id,attempt_id,sequence,input_tokens,output_tokens,total_tokens,cache_read_tokens,cache_write_tokens,reasoning_tokens,status,source,raw)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT(relay_run_id,attempt_id) DO UPDATE SET sequence=EXCLUDED.sequence,input_tokens=EXCLUDED.input_tokens,output_tokens=EXCLUDED.output_tokens,total_tokens=EXCLUDED.total_tokens,cache_read_tokens=EXCLUDED.cache_read_tokens,cache_write_tokens=EXCLUDED.cache_write_tokens,reasoning_tokens=EXCLUDED.reasoning_tokens,status=EXCLUDED.status,source=EXCLUDED.source,raw=EXCLUDED.raw
    WHERE run_usage_attempts.sequence<EXCLUDED.sequence`, run.ID, event.AttemptID, event.Sequence, u.InputTokens, u.OutputTokens, u.TotalTokens, u.CacheReadTokens, u.CacheWriteTokens, u.ReasoningTokens, u.Status, u.Source, event.Data)
		if err != nil {
			return err
		}
	}
	if sequence >= previousSequence && (!isTerminal(previousStatus) || previousStatus == string(run.Status)) {
		_, err = tx.Exec(ctx, `UPDATE run_usage SET status=$3,completed_at=COALESCE($4,completed_at),last_sequence=$5,attempt_count=GREATEST(attempt_count,$6),runtime_id=COALESCE(NULLIF($7,''),runtime_id),provider=COALESCE(NULLIF($8,''),provider),model=COALESCE(NULLIF($9,''),model),checked_at=now(),synced=true WHERE workspace_id=$1 AND relay_run_id=$2`, wid, run.ID, run.Status, run.CompletedAt, sequence, max(run.Attempt.Number, 1), run.Runtime.ID, run.Runtime.Provider, run.Runtime.Model)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

type UsageSyncRun struct{ WorkspaceID, RunID string }

func (s *Store) UsageSyncRuns(ctx context.Context, limit int) ([]UsageSyncRun, error) {
	rows, err := s.pool.Query(ctx, `WITH live AS (
 SELECT workspace_id,relay_run_id FROM run_usage WHERE created_at>=now()-interval '32 days' AND status NOT IN ('succeeded','failed','cancelled') AND (checked_at IS NULL OR checked_at<now()-interval '5 seconds') ORDER BY checked_at NULLS FIRST,created_at DESC LIMIT GREATEST($1::int/2,1)
), history AS (
 SELECT workspace_id,relay_run_id FROM run_usage WHERE created_at>=now()-interval '32 days' AND NOT synced AND status IN ('succeeded','failed','cancelled') AND (checked_at IS NULL OR checked_at<now()-interval '5 seconds') ORDER BY checked_at NULLS FIRST,created_at DESC LIMIT GREATEST($1::int/2,1)
) SELECT * FROM live UNION ALL SELECT * FROM history`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []UsageSyncRun{}
	for rows.Next() {
		var item UsageSyncRun
		if err := rows.Scan(&item.WorkspaceID, &item.RunID); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// Delay unavailable/expired Relay runs too, so one lost run does not starve
// the remaining workspaces in the background queue.
func (s *Store) MarkUsageChecked(ctx context.Context, wid, runID string) error {
	_, err := s.pool.Exec(ctx, `UPDATE run_usage SET checked_at=now() WHERE workspace_id=$1 AND relay_run_id=$2`, wid, runID)
	return err
}

type UsageTotals struct {
	TokenCount       *int64 `json:"tokenCount"`
	InputTokens      *int64 `json:"inputTokens"`
	OutputTokens     *int64 `json:"outputTokens"`
	CacheReadTokens  *int64 `json:"cacheReadTokens"`
	CacheWriteTokens *int64 `json:"cacheWriteTokens"`
	TokenCoverage    int    `json:"tokenCoverage"`
	TotalRuns        int    `json:"totalRuns"`
	PartialRuns      int    `json:"partialRuns"`
}
type FootprintUsage struct {
	UsageTotals
	SessionID string
	Day       string
}

// Aggregate each attempt exactly once before joining sessions. Parent
// conversation mirrors and message counts are deliberately absent here.
const usageCTE = `WITH per_run AS (
 SELECT r.relay_run_id,r.session_id,r.project_id,r.completed_at,r.purpose,
   sum(u.input_tokens)::bigint input_tokens,sum(u.output_tokens)::bigint output_tokens,sum(u.total_tokens)::bigint total_tokens,
   sum(u.cache_read_tokens)::bigint cache_read_tokens,sum(u.cache_write_tokens)::bigint cache_write_tokens,
   count(u.attempt_id) observed_attempts,
   count(u.attempt_id) FILTER(WHERE u.status='complete') complete_attempts,r.attempt_count
 FROM run_usage r LEFT JOIN run_usage_attempts u ON u.relay_run_id=r.relay_run_id
 WHERE r.workspace_id=$1 AND r.status IN ('succeeded','failed','cancelled') AND r.completed_at >= $2 AND r.completed_at < $3
 AND ($4='' OR r.project_id=$4) AND r.purpose='chat'
 GROUP BY r.relay_run_id
)`
const usageSums = `sum(total_tokens)::bigint,sum(input_tokens)::bigint,sum(output_tokens)::bigint,sum(cache_read_tokens)::bigint,sum(cache_write_tokens)::bigint,
 count(*) FILTER(WHERE complete_attempts=attempt_count),count(*),count(*) FILTER(WHERE observed_attempts>0 AND complete_attempts<>attempt_count)`

func (s *Store) FootprintUsage(ctx context.Context, wid string, from, to time.Time, projectID, timezone string) (UsageTotals, []FootprintUsage, []FootprintUsage, error) {
	totals := UsageTotals{}
	err := s.pool.QueryRow(ctx, usageCTE+` SELECT `+usageSums+` FROM per_run`, wid, from, to, projectID).Scan(&totals.TokenCount, &totals.InputTokens, &totals.OutputTokens, &totals.CacheReadTokens, &totals.CacheWriteTokens, &totals.TokenCoverage, &totals.TotalRuns, &totals.PartialRuns)
	if err != nil {
		return totals, nil, nil, err
	}
	query := func(group string) ([]FootprintUsage, error) {
		expr := "session_id"
		if group == "day" {
			expr = `to_char(completed_at AT TIME ZONE $5,'YYYY-MM-DD')`
		}
		args := []any{wid, from, to, projectID}
		if group == "day" {
			args = append(args, timezone)
		}
		rows, err := s.pool.Query(ctx, usageCTE+` SELECT `+expr+`,`+usageSums+` FROM per_run GROUP BY `+expr, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		items := []FootprintUsage{}
		for rows.Next() {
			item := FootprintUsage{}
			key := &item.SessionID
			if group == "day" {
				key = &item.Day
			}
			if err := rows.Scan(key, &item.TokenCount, &item.InputTokens, &item.OutputTokens, &item.CacheReadTokens, &item.CacheWriteTokens, &item.TokenCoverage, &item.TotalRuns, &item.PartialRuns); err != nil {
				return nil, fmt.Errorf("usage summary: %w", err)
			}
			items = append(items, item)
		}
		return items, rows.Err()
	}
	sessions, err := query("session")
	if err != nil {
		return totals, nil, nil, err
	}
	days, err := query("day")
	return totals, sessions, days, err
}
