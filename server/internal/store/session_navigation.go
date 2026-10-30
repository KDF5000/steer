package store

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type SessionUpdate struct {
	Title  *string `json:"title"`
	Pinned *bool   `json:"pinned"`
}

// Navigation changes do not change activity timestamps or execution context.
func (s *Store) UpdateSessionNavigation(ctx context.Context, wid, id string, in SessionUpdate) (Session, error) {
	var session Session
	err := scanSessionFields(s.pool.QueryRow(ctx, `UPDATE chat_sessions SET title=COALESCE($3,title),pinned=COALESCE($4,pinned) WHERE workspace_id=$1 AND id=$2 RETURNING `+sessionColumns, wid, id, in.Title, in.Pinned), &session)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return session, err
}

type SessionSearchInput struct {
	Query     string
	ProjectID string
	From      *time.Time
	To        *time.Time
	Offset    int
}
type SessionSearchResult struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	ProjectID   *string   `json:"projectId"`
	ProjectName string    `json:"projectName"`
	UpdatedAt   time.Time `json:"updatedAt"`
	Pinned      bool      `json:"pinned"`
	ShareID     *string   `json:"shareId,omitempty"`
	MessageID   *string   `json:"messageId,omitempty"`
	Snippet     string    `json:"snippet"`
	MatchCount  int       `json:"matchCount"`
}

func (s *Store) SearchSessions(ctx context.Context, wid string, user User, in SessionSearchInput) ([]SessionSearchResult, error) {
	patterns := []string{}
	for _, term := range strings.Fields(in.Query) {
		patterns = append(patterns, "%"+strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(strings.ToLower(term))+"%")
	}
	// Incoming conversations require an accepted account grant. No owner Workspace
	// bootstrap or unrelated conversation data is exposed. One result per session.
	rows, err := s.pool.Query(ctx, `WITH accessible AS (
 SELECT c.*,g.id AS share_id,p.name AS project_name FROM chat_sessions c
 LEFT JOIN projects p ON p.id=c.project_id AND p.workspace_id=c.workspace_id
 LEFT JOIN LATERAL (SELECT id FROM resource_shares WHERE kind='session' AND resource_id=c.id AND workspace_id=c.workspace_id AND status='accepted' AND recipient_user_id=$2 AND lower(recipient_email)=lower($3) AND owner_user_id<>$2 ORDER BY id LIMIT 1) g ON true
 WHERE (c.workspace_id=$1 OR g.id IS NOT NULL)
 AND ($4='' OR c.project_id=$4)
 AND ($5::timestamptz IS NULL OR c.updated_at >= $5)
 AND ($6::timestamptz IS NULL OR c.updated_at < $6)
 ) SELECT c.id,c.title,c.project_id,COALESCE(c.project_name,''),c.updated_at,
 CASE WHEN c.workspace_id=$1 THEN c.pinned ELSE false END,c.share_id,
 hit.id,COALESCE(hit.snippet,''),COALESCE(hit.count,0)::int
 FROM accessible c
 LEFT JOIN LATERAL (
 SELECT m.id,substring(m.content FROM greatest(1,strpos(lower(m.content),$8)-70) FOR 260) AS snippet,count(*) OVER() AS count
 FROM messages m WHERE m.workspace_id=c.workspace_id AND m.session_id=c.id
 AND (m.role='user' OR (m.role='agent' AND m.status IN ('succeeded','complete','completed')))
 AND cardinality($7::text[])>0 AND lower(m.content) LIKE ALL($7::text[])
 ORDER BY m.created_at DESC,m.id LIMIT 1
 ) hit ON true
 WHERE cardinality($7::text[])=0 OR lower(c.title) LIKE ALL($7::text[]) OR hit.id IS NOT NULL
 ORDER BY (lower(c.title) LIKE ALL($7::text[])) DESC,c.pinned DESC,c.updated_at DESC,c.id
 LIMIT 51 OFFSET $9`, wid, user.ID, user.Email, in.ProjectID, in.From, in.To, patterns, firstSearchTerm(in.Query), in.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	results := []SessionSearchResult{}
	for rows.Next() {
		var x SessionSearchResult
		if err := rows.Scan(&x.ID, &x.Title, &x.ProjectID, &x.ProjectName, &x.UpdatedAt, &x.Pinned, &x.ShareID, &x.MessageID, &x.Snippet, &x.MatchCount); err != nil {
			return nil, err
		}
		results = append(results, x)
	}
	return results, rows.Err()
}
func firstSearchTerm(q string) string {
	terms := strings.Fields(q)
	if len(terms) > 0 {
		return strings.ToLower(terms[0])
	}
	return ""
}
