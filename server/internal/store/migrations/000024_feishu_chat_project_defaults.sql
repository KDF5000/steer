INSERT INTO integration_conversations (
  integration_id,
  chat_id,
  thread_key,
  conversation_id,
  active_task_id,
  project_id,
  created_at,
  updated_at
)
SELECT DISTINCT ON (integration_id, chat_id)
  integration_id,
  chat_id,
  '__chat_project_default__',
  '',
  NULL,
  project_id,
  now(),
  now()
FROM integration_conversations
WHERE project_id IS NOT NULL
  AND thread_key <> '__chat_project_default__'
ORDER BY integration_id, chat_id, updated_at DESC
ON CONFLICT (integration_id, chat_id, thread_key) DO NOTHING;
