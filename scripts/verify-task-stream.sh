#!/usr/bin/env bash

set -euo pipefail

base_url="${STEER_BASE_URL:-http://localhost:8080/api/v1}"
api_key="${STEER_API_KEY:-}"
agent_id="${STEER_AGENT_ID:-${1:-}}"
project_id="${STEER_PROJECT_ID:-${2:-}}"
prompt="${3:-这是一次 API 流式输出验证。请简短回复流式接口验证成功。}"

for command in curl jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    printf 'Missing required command: %s\n' "$command" >&2
    exit 1
  fi
done

if [[ -z "$api_key" ]]; then
  printf 'Set STEER_API_KEY before running this script.\n' >&2
  exit 1
fi

if [[ -z "$agent_id" ]]; then
  printf 'Set STEER_AGENT_ID or pass the Agent ID as the first argument.\n' >&2
  exit 1
fi

payload="$({
  jq -n \
    --arg agentId "$agent_id" \
    --arg projectId "$project_id" \
    --arg prompt "$prompt" \
    '{agentId: $agentId, prompt: $prompt}
      + if $projectId == "" then {} else {projectId: $projectId} end'
})"

printf 'Creating task at %s ...\n' "$base_url"
created="$({
  curl --fail-with-body --silent --show-error \
    --request POST "$base_url/tasks" \
    --header "Authorization: Bearer $api_key" \
    --header 'Content-Type: application/json' \
    --header "Idempotency-Key: stream-check-$(date +%s)-$$" \
    --data "$payload"
})"

task_id="$(jq -er '.taskId' <<<"$created")"
conversation_id="$(jq -er '.conversationId' <<<"$created")"
printf 'Task: %s\nConversation: %s\n\nAgent output:\n' \
  "$task_id" "$conversation_id"

event_name=''
event_data=''
last_sequence=0
done_event=false

while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  case "$line" in
    event:*) event_name="${line#event: }" ;;
    data:*)
      if [[ -n "$event_data" ]]; then
        event_data+=$'\n'
      fi
      event_data+="${line#data: }"
      ;;
    '')
      case "$event_name" in
        relay.event)
          sequence="$(jq -r '.sequence // 0' <<<"$event_data")"
          if [[ "$sequence" =~ ^[0-9]+$ ]] && ((sequence > last_sequence)); then
            last_sequence="$sequence"
          fi

          # Relay also emits provider-specific copies of some events. Consume
          # the normalized event only so the same text is not printed twice.
          delta="$(
            jq -r '
              if .type == "assistant.message.delta"
                and (.data.delta | type) == "string"
              then .data.delta
              else empty
              end
            ' <<<"$event_data"
          )"
          if [[ -n "$delta" ]]; then
            printf '%s' "$delta"
          fi
          ;;
        steer.error)
          printf '\nStream error: %s\n' \
            "$(jq -r '.error // "unknown stream error"' <<<"$event_data")" >&2
          exit 1
          ;;
        steer.done)
          done_event=true
          ;;
      esac
      event_name=''
      event_data=''
      ;;
  esac
done < <(
  curl --fail-with-body --silent --show-error --no-buffer \
    "$base_url/tasks/$task_id/events?after=0" \
    --header "Authorization: Bearer $api_key" \
    --header 'Accept: text/event-stream'
)

printf '\n\nStream finished: done=%s, last sequence=%s\n' \
  "$done_event" "$last_sequence"

final="$({
  curl --fail-with-body --silent --show-error \
    "$base_url/tasks/$task_id" \
    --header "Authorization: Bearer $api_key"
})"

printf 'Final status: %s\n' \
  "$(jq -r '.task.status // .run.status // "unknown"' <<<"$final")"
printf 'Final content:\n%s\n' "$(jq -r '.content // ""' <<<"$final")"

if [[ "$(jq -r '.error // empty' <<<"$final")" != '' ]]; then
  printf 'Task error: %s\n' "$(jq -r '.error' <<<"$final")" >&2
  exit 1
fi
