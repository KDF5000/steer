package store

import (
	"context"
	"time"
)

type CodebaseCalibrationQuery struct {
	WorkflowID string
	RepoID     string
	Days       int // 0 means all time
}

type CodebaseCalibrationOverview struct {
	TotalRuns                      int     `json:"totalRuns"`
	SucceededRuns                  int     `json:"succeededRuns"`
	FailedRuns                     int     `json:"failedRuns"`
	SkippedRuns                    int     `json:"skippedRuns"`
	StructuredRuns                 int     `json:"structuredRuns"`
	UniqueMRs                      int     `json:"uniqueMrs"`
	MultiRoundMRs                  int     `json:"multiRoundMrs"`
	FastTrackRuns                  int     `json:"fastTrackRuns"`
	DeepTrackRuns                  int     `json:"deepTrackRuns"`
	AutoApproveEligibleRuns        int     `json:"autoApproveEligibleRuns"`
	AutoApproveMergedTotal         int     `json:"autoApproveMergedTotal"`
	AutoApproveMergedUnchanged     int     `json:"autoApproveMergedUnchanged"`
	AutoApproveModifiedBeforeMerge int     `json:"autoApproveModifiedBeforeMerge"`
	BlockedRuns                    int     `json:"blockedRuns"`
	HumanRequiredRuns              int     `json:"humanRequiredRuns"`
	HumanLightRuns                 int     `json:"humanLightRuns"`
	AvgDurationSec                 float64 `json:"avgDurationSec"`
	P50DurationSec                 float64 `json:"p50DurationSec"`
	P95DurationSec                 float64 `json:"p95DurationSec"`
}

type CodebaseCalibrationMatrixRow struct {
	RiskLevel           string  `json:"riskLevel"`
	MergePolicy         string  `json:"mergePolicy"`
	TotalRuns           int     `json:"totalRuns"`
	MergedTotal         int     `json:"mergedTotal"`
	MergedUnchanged     int     `json:"mergedUnchanged"`
	ModifiedBeforeMerge int     `json:"modifiedBeforeMerge"`
	AvgDurationSec      float64 `json:"avgDurationSec"`
}

type CodebaseCalibrationRiskRow struct {
	RiskLevel           string  `json:"riskLevel"`
	TotalRuns           int     `json:"totalRuns"`
	FastTrackRuns       int     `json:"fastTrackRuns"`
	DeepTrackRuns       int     `json:"deepTrackRuns"`
	ChangesRequested    int     `json:"changesRequested"`
	NeedsHumanReview    int     `json:"needsHumanReview"`
	NoConfirmedFindings int     `json:"noConfirmedFindings"`
	AvgDurationSec      float64 `json:"avgDurationSec"`
}

type CodebaseCalibrationDailyRow struct {
	Day                  string `json:"day"`
	TotalRuns            int    `json:"totalRuns"`
	SucceededRuns        int    `json:"succeededRuns"`
	AutoApproveEligible  int    `json:"autoApproveEligible"`
	HumanRequiredOrBlock int    `json:"humanRequiredOrBlock"`
}

type CodebaseCalibrationDriftItem struct {
	RunID         string     `json:"runId"`
	WorkflowID    string     `json:"workflowId"`
	RepoPath      string     `json:"repoPath"`
	MRIID         int        `json:"mrIid"`
	MRTitle       string     `json:"mrTitle"`
	MRURL         string     `json:"mrUrl"`
	RiskLevel     string     `json:"riskLevel"`
	HeadSHA       string     `json:"headSha"`
	MergedHeadSHA string     `json:"mergedHeadSha"`
	MRMergedAt    *time.Time `json:"mrMergedAt"`
	CreatedAt     time.Time  `json:"createdAt"`
}

type CodebaseCalibrationStats struct {
	Days         int                            `json:"days"`
	Overview     CodebaseCalibrationOverview    `json:"overview"`
	Matrix       []CodebaseCalibrationMatrixRow `json:"matrix"`
	ByRisk       []CodebaseCalibrationRiskRow   `json:"byRisk"`
	DailyTrend   []CodebaseCalibrationDailyRow  `json:"dailyTrend"`
	DriftSamples []CodebaseCalibrationDriftItem `json:"driftSamples"`
}

// CodebaseCalibration computes shadow-mode calibration metrics and operational
// review statistics for a workspace over the requested time window.
func (s *Store) CodebaseCalibration(ctx context.Context, wid string, q CodebaseCalibrationQuery) (CodebaseCalibrationStats, error) {
	stats := CodebaseCalibrationStats{
		Days:         q.Days,
		Matrix:       []CodebaseCalibrationMatrixRow{},
		ByRisk:       []CodebaseCalibrationRiskRow{},
		DailyTrend:   []CodebaseCalibrationDailyRow{},
		DriftSamples: []CodebaseCalibrationDriftItem{},
	}
	var since *time.Time
	if q.Days > 0 {
		t := time.Now().UTC().AddDate(0, 0, -q.Days)
		since = &t
	}
	baseFilter := `workspace_id=$1
  AND ($2::text='' OR workflow_id=$2)
  AND ($3::text='' OR repo_id=$3)
  AND ($4::timestamptz IS NULL OR created_at >= $4)`

	// 1. Overview KPIs
	err := s.pool.QueryRow(ctx, `SELECT
  count(*),
  count(*) FILTER (WHERE status='succeeded'),
  count(*) FILTER (WHERE status='failed'),
  count(*) FILTER (WHERE status='skipped'),
  count(*) FILTER (WHERE status='succeeded' AND review_json IS NOT NULL),
  count(DISTINCT (repo_id, mr_iid)),
  count(DISTINCT (repo_id, mr_iid)) FILTER (WHERE round >= 2),
  count(*) FILTER (WHERE status='succeeded' AND review_track='fast'),
  count(*) FILTER (WHERE status='succeeded' AND review_track='deep'),
  count(*) FILTER (WHERE status='succeeded' AND merge_policy='auto_approve_eligible'),
  count(*) FILTER (WHERE status='succeeded' AND merge_policy='auto_approve_eligible' AND merged_head_sha<>''),
  count(*) FILTER (WHERE status='succeeded' AND merge_policy='auto_approve_eligible' AND merged_head_sha<>'' AND merged_head_sha=head_sha),
  count(*) FILTER (WHERE status='succeeded' AND merge_policy='auto_approve_eligible' AND merged_head_sha<>'' AND merged_head_sha<>head_sha),
  count(*) FILTER (WHERE status='succeeded' AND merge_policy='block'),
  count(*) FILTER (WHERE status='succeeded' AND merge_policy='human_review_required'),
  count(*) FILTER (WHERE status='succeeded' AND merge_policy='human_review_light'),
  COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) FILTER (WHERE status='succeeded' AND started_at IS NOT NULL AND finished_at IS NOT NULL AND finished_at >= started_at), 0),
  COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at))) FILTER (WHERE status='succeeded' AND started_at IS NOT NULL AND finished_at IS NOT NULL AND finished_at >= started_at), 0),
  COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at))) FILTER (WHERE status='succeeded' AND started_at IS NOT NULL AND finished_at IS NOT NULL AND finished_at >= started_at), 0)
FROM codebase_runs WHERE `+baseFilter, wid, q.WorkflowID, q.RepoID, since).Scan(
		&stats.Overview.TotalRuns,
		&stats.Overview.SucceededRuns,
		&stats.Overview.FailedRuns,
		&stats.Overview.SkippedRuns,
		&stats.Overview.StructuredRuns,
		&stats.Overview.UniqueMRs,
		&stats.Overview.MultiRoundMRs,
		&stats.Overview.FastTrackRuns,
		&stats.Overview.DeepTrackRuns,
		&stats.Overview.AutoApproveEligibleRuns,
		&stats.Overview.AutoApproveMergedTotal,
		&stats.Overview.AutoApproveMergedUnchanged,
		&stats.Overview.AutoApproveModifiedBeforeMerge,
		&stats.Overview.BlockedRuns,
		&stats.Overview.HumanRequiredRuns,
		&stats.Overview.HumanLightRuns,
		&stats.Overview.AvgDurationSec,
		&stats.Overview.P50DurationSec,
		&stats.Overview.P95DurationSec,
	)
	if err != nil {
		return stats, err
	}

	// 2. Risk x MergePolicy calibration matrix
	rows, err := s.pool.Query(ctx, `SELECT
  COALESCE(NULLIF(risk_level,''), 'unknown') AS rl,
  COALESCE(NULLIF(merge_policy,''), 'unknown') AS mp,
  count(*),
  count(*) FILTER (WHERE merged_head_sha<>''),
  count(*) FILTER (WHERE merged_head_sha<>'' AND merged_head_sha=head_sha),
  count(*) FILTER (WHERE merged_head_sha<>'' AND merged_head_sha<>head_sha),
  COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) FILTER (WHERE started_at IS NOT NULL AND finished_at IS NOT NULL AND finished_at >= started_at), 0)
FROM codebase_runs
WHERE `+baseFilter+` AND status='succeeded'
GROUP BY rl, mp
ORDER BY rl, mp`, wid, q.WorkflowID, q.RepoID, since)
	if err != nil {
		return stats, err
	}
	for rows.Next() {
		var r CodebaseCalibrationMatrixRow
		if err = rows.Scan(&r.RiskLevel, &r.MergePolicy, &r.TotalRuns, &r.MergedTotal, &r.MergedUnchanged, &r.ModifiedBeforeMerge, &r.AvgDurationSec); err != nil {
			rows.Close()
			return stats, err
		}
		stats.Matrix = append(stats.Matrix, r)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return stats, err
	}

	// 3. Risk distribution
	rows, err = s.pool.Query(ctx, `SELECT
  COALESCE(NULLIF(risk_level,''), 'unknown') AS rl,
  count(*),
  count(*) FILTER (WHERE review_track='fast'),
  count(*) FILTER (WHERE review_track='deep'),
  count(*) FILTER (WHERE disposition='changes_requested'),
  count(*) FILTER (WHERE disposition='needs_human_review'),
  count(*) FILTER (WHERE disposition='no_confirmed_findings'),
  COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - started_at))) FILTER (WHERE started_at IS NOT NULL AND finished_at IS NOT NULL AND finished_at >= started_at), 0)
FROM codebase_runs
WHERE `+baseFilter+` AND status='succeeded'
GROUP BY rl
ORDER BY rl`, wid, q.WorkflowID, q.RepoID, since)
	if err != nil {
		return stats, err
	}
	for rows.Next() {
		var r CodebaseCalibrationRiskRow
		if err = rows.Scan(&r.RiskLevel, &r.TotalRuns, &r.FastTrackRuns, &r.DeepTrackRuns, &r.ChangesRequested, &r.NeedsHumanReview, &r.NoConfirmedFindings, &r.AvgDurationSec); err != nil {
			rows.Close()
			return stats, err
		}
		stats.ByRisk = append(stats.ByRisk, r)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return stats, err
	}

	// 4. Daily trend
	rows, err = s.pool.Query(ctx, `SELECT
  to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
  count(*),
  count(*) FILTER (WHERE status='succeeded'),
  count(*) FILTER (WHERE status='succeeded' AND merge_policy='auto_approve_eligible'),
  count(*) FILTER (WHERE status='succeeded' AND merge_policy IN ('human_review_required','block'))
FROM codebase_runs
WHERE `+baseFilter+`
GROUP BY day
ORDER BY day DESC
LIMIT 30`, wid, q.WorkflowID, q.RepoID, since)
	if err != nil {
		return stats, err
	}
	for rows.Next() {
		var r CodebaseCalibrationDailyRow
		if err = rows.Scan(&r.Day, &r.TotalRuns, &r.SucceededRuns, &r.AutoApproveEligible, &r.HumanRequiredOrBlock); err != nil {
			rows.Close()
			return stats, err
		}
		stats.DailyTrend = append(stats.DailyTrend, r)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return stats, err
	}
	// Reverse DailyTrend so it is chronological (oldest -> newest).
	for i, j := 0, len(stats.DailyTrend)-1; i < j; i, j = i+1, j-1 {
		stats.DailyTrend[i], stats.DailyTrend[j] = stats.DailyTrend[j], stats.DailyTrend[i]
	}

	// 5. Recent auto_approve_eligible runs that were modified before merge
	rows, err = s.pool.Query(ctx, `SELECT
  id, workflow_id, repo_path, mr_iid, mr_title, mr_url,
  COALESCE(NULLIF(risk_level,''), 'unknown'), head_sha, merged_head_sha, mr_merged_at, created_at
FROM codebase_runs
WHERE `+baseFilter+`
  AND status='succeeded'
  AND merge_policy='auto_approve_eligible'
  AND merged_head_sha<>''
  AND merged_head_sha<>head_sha
ORDER BY mr_merged_at DESC NULLS LAST, created_at DESC
LIMIT 20`, wid, q.WorkflowID, q.RepoID, since)
	if err != nil {
		return stats, err
	}
	for rows.Next() {
		var item CodebaseCalibrationDriftItem
		if err = rows.Scan(&item.RunID, &item.WorkflowID, &item.RepoPath, &item.MRIID, &item.MRTitle, &item.MRURL, &item.RiskLevel, &item.HeadSHA, &item.MergedHeadSHA, &item.MRMergedAt, &item.CreatedAt); err != nil {
			rows.Close()
			return stats, err
		}
		stats.DriftSamples = append(stats.DriftSamples, item)
	}
	rows.Close()
	if err = rows.Err(); err != nil {
		return stats, err
	}
	return stats, nil
}
