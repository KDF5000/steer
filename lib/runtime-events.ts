import type { RelayEvent } from './domain';

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

// Qoder and QwenWork expose the same stream-json tool protocol. Keep the raw
// events intact and project only confirmed tool calls/results for the UI.
// Proposed edits, denied tools and thinking blocks must never become changes.
export function withRuntimeToolEvents(
  events?: RelayEvent[] | null,
): RelayEvent[] {
  const result: RelayEvent[] = [];
  const calls = new Map<string, RecordValue>();
  const completed = new Set<string>();
  for (const event of events || []) {
    result.push(event);
    const match = /^runtime\.(qoder|qwenwork)\.(assistant|user)$/.exec(
      event.type,
    );
    if (!match) continue;
    const data = record(event.data);
    const message = record(data.message);
    if (!Array.isArray(message.content)) continue;
    for (const value of message.content) {
      const block = record(value);
      const callID = text(block.id || block.tool_use_id);
      if (!callID) continue;
      const key = `${match[1]}:${text(data.session_id)}:${callID}`;
      if (match[2] === 'assistant' && block.type === 'tool_use') {
        if (calls.has(key)) continue;
        const input = record(block.input);
        const name = text(block.name);
        const path = text(input.file_path || input.path);
        const type =
          name === 'Bash'
            ? 'commandExecution'
            : ['Write', 'Edit', 'MultiEdit'].includes(name)
              ? 'fileChange'
              : ['Grep', 'Glob', 'WebSearch', 'WebFetch'].includes(name)
                ? 'webSearch'
                : 'toolCall';
        const item: RecordValue = {
          id: key,
          type,
          name: path ? `${name} ${path}` : name,
          command: text(input.command),
          path,
          query: text(input.query || input.pattern || input.url),
        };
        calls.set(key, item);
        result.push({
          ...event,
          type: `runtime.${match[1]}.item.started`,
          data: { item },
        });
      } else if (match[2] === 'user' && block.type === 'tool_result') {
        const call = calls.get(key);
        if (!call || completed.has(key)) continue;
        completed.add(key);
        const output = record(data.tool_use_result);
        const failed = block.is_error === true || output.success === false;
        const item: RecordValue = {
          ...call,
          status: failed ? 'failed' : 'completed',
        };
        if (!failed && call.type === 'fileChange') {
          const path = text(output.file_path || output.filePath || call.path);
          const diff = text(output.diff);
          // A Write result contains the full resulting file; Edit reports a patch.
          // Never synthesize a patch from requested old/new strings: the tool may
          // have normalized line endings or changed multiple occurrences.
          const content = text(output.content);
          if (path && (diff || typeof output.content === 'string')) {
            item.changes = [
              {
                path,
                type: output.type === 'create' ? 'add' : 'update',
                ...(diff ? { diff } : { content }),
              },
            ];
          }
        }
        result.push({
          ...event,
          type: `runtime.${match[1]}.item.completed`,
          data: { item },
        });
      }
    }
  }
  return result;
}
