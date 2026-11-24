package store

import "context"

// Prefer an existing conversation state row (including older thread-ID bindings),
// then the first known alias or root. Every identifier resolves to one state
// row rather than copying session/project/model state between identifiers.
func (s *Store) ResolveIntegrationThread(ctx context.Context, integrationID, chatID string, keys []string) (string, error) {
	var key string
	err := s.pool.QueryRow(ctx, `SELECT COALESCE(a.thread_key,k.key)
FROM unnest($3::text[]) WITH ORDINALITY AS k(key,priority)
LEFT JOIN integration_thread_aliases a ON a.integration_id=$1 AND a.chat_id=$2 AND a.alias_key=k.key
LEFT JOIN integration_conversations c ON c.integration_id=$1 AND c.chat_id=$2 AND c.thread_key=COALESCE(a.thread_key,k.key)
ORDER BY (c.thread_key IS NOT NULL) DESC,k.priority LIMIT 1`, integrationID, chatID, keys).Scan(&key)
	return key, err
}

func (s *Store) BindIntegrationThreadAliases(ctx context.Context, integrationID, chatID, threadKey string, aliases []string) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO integration_thread_aliases(integration_id,chat_id,alias_key,thread_key)
SELECT $1,$2,key,$3 FROM unnest($4::text[]) AS key WHERE key<>$3 AND key<>''
ON CONFLICT (integration_id,chat_id,alias_key) DO NOTHING`, integrationID, chatID, threadKey, aliases)
	return err
}
