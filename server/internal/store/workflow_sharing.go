package store

import "context"

func (s *Store) WorkflowHasConversation(ctx context.Context, wid, workflowID, conversationID string) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM codebase_runs WHERE workspace_id=$1 AND workflow_id=$2 AND conversation_id=$3 AND conversation_id<>'')`, wid, workflowID, conversationID).Scan(&exists)
	return exists, err
}

func (s *Store) LatestWorkflowRunsForMRs(ctx context.Context, wid, workflowID string, numbers []int) ([]CodebaseRun, error) {
	rows, err := s.pool.Query(ctx, `SELECT `+codebaseRunColumns+` FROM (SELECT DISTINCT ON (mr_iid) * FROM codebase_runs WHERE workspace_id=$1 AND workflow_id=$2 AND mr_iid=ANY($3) ORDER BY mr_iid,created_at DESC,id DESC) latest`, wid, workflowID, numbers)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanCodebaseRuns(rows)
}
