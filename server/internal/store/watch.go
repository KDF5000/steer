package store

import (
	"context"
	"time"
)

// WatchConversation is a bounded projection for small-screen clients. Full
// replies remain available through the existing task endpoint.
type WatchConversation struct {
	ID              string     `json:"id"`
	Title           string     `json:"title"`
	AgentID         string     `json:"agentId"`
	AgentName       string     `json:"agentName"`
	ProjectName     string     `json:"projectName"`
	TaskID          *string    `json:"taskId"`
	Status          string     `json:"status"`
	Summary         string     `json:"summary"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	LastUserMessage string     `json:"lastUserMessage"`
	StartedAt       *time.Time `json:"startedAt"`
}

func (s *Store) WatchConversations(ctx context.Context, wid string) ([]WatchConversation, error) {
	rows, err := s.pool.Query(ctx, `
 SELECT c.id,c.title,c.agent_id,COALESCE(a.name,'Agent'),COALESCE(p.name,'未绑定项目'),
 t.id,COALESCE(t.status,'idle'),LEFT(COALESCE(t.result,t.error,m.content,''),2000),
 GREATEST(COALESCE((SELECT MAX(recent.created_at) FROM messages recent WHERE recent.workspace_id=c.workspace_id AND recent.session_id=c.id),c.created_at),c.updated_at,COALESCE(t.updated_at,c.updated_at)) AS activity_at,
 LEFT(COALESCE(u.content,''),4000),t.started_at
 FROM chat_sessions c
 LEFT JOIN agents a ON a.id=c.agent_id AND a.workspace_id=c.workspace_id
 LEFT JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id
 LEFT JOIN LATERAL (SELECT id,status,result,error,updated_at,started_at FROM tasks
 WHERE workspace_id=c.workspace_id AND conversation_id=c.id ORDER BY created_at DESC,id DESC LIMIT 1) t ON true
 LEFT JOIN LATERAL (SELECT content FROM messages WHERE workspace_id=c.workspace_id
 AND session_id=c.id AND role IN ('assistant','agent') ORDER BY created_at DESC,id DESC LIMIT 1) m ON true
 LEFT JOIN LATERAL (SELECT content FROM messages WHERE workspace_id=c.workspace_id
 AND session_id=c.id AND role='user' ORDER BY created_at DESC,id DESC LIMIT 1) u ON true
 WHERE c.workspace_id=$1 AND NOT c.archived
 ORDER BY CASE WHEN t.status IN ('running','queued','pending','starting') THEN 0 ELSE 1 END,
 c.pinned DESC,activity_at DESC,c.id LIMIT 50`, wid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []WatchConversation{}
	for rows.Next() {
		var item WatchConversation
		if err := rows.Scan(&item.ID, &item.Title, &item.AgentID, &item.AgentName, &item.ProjectName, &item.TaskID, &item.Status, &item.Summary, &item.UpdatedAt, &item.LastUserMessage, &item.StartedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
