import type { RelayEvent } from './domain';
import { withRuntimeToolEvents } from './runtime-events';

export function runFileChanges(events?: RelayEvent[] | null) {
  let workspaceDiff = '';
  const files = new Map<
    string,
    {
      id: string;
      path: string;
      diff: string;
      snapshot?: string;
      operation?: string;
      patches?: string[];
    }
  >();
  for (const event of withRuntimeToolEvents(events)) {
    const data = event.data || {};
    const item =
      data.item && typeof data.item === 'object'
        ? (data.item as Record<string, unknown>)
        : {};
    const changes = Array.isArray(item.changes) ? item.changes : [];
    for (const change of changes) {
      if (!change || typeof change !== 'object') continue;
      const record = change as Record<string, unknown>;
      const path = typeof record.path === 'string' ? record.path : '';
      const kindRecord =
        record.kind && typeof record.kind === 'object'
          ? (record.kind as Record<string, unknown>)
          : undefined;
      const kind =
        typeof record.type === 'string'
          ? record.type
          : typeof record.kind === 'string'
            ? record.kind
            : typeof kindRecord?.type === 'string'
              ? kindRecord.type
              : '';
      const reportedDiff =
        typeof record.unified_diff === 'string'
          ? record.unified_diff
          : typeof record.diff === 'string'
            ? record.diff
            : '';
      const content = typeof record.content === 'string' ? record.content : '';
      const reportedSnapshot =
        reportedDiff && !looksLikePatch(reportedDiff)
          ? reportedDiff
          : undefined;
      const snapshot =
        kind === 'add'
          ? content || reportedSnapshot || ''
          : reportedSnapshot || content || undefined;
      const diff =
        kind === 'add' &&
        snapshot !== undefined &&
        !looksLikePatch(reportedDiff)
          ? addedFileDiff(path, snapshot)
          : reportedDiff;
      if (path) {
        const previous = files.get(path);
        if (!previous) {
          files.set(path, {
            id: path,
            path,
            diff,
            snapshot,
            operation: kind,
            patches: diff ? [diff] : [],
          });
          continue;
        }
        if (previous.patches?.includes(diff)) continue;
        if ((kind === 'update' || looksLikePatch(diff)) && diff) {
          const patches = [...(previous.patches || []), diff];
          files.set(path, {
            ...previous,
            diff: patches.join('\n'),
            snapshot: snapshot ?? previous.snapshot,
            operation: kind || previous.operation,
            patches,
          });
          continue;
        }
        files.set(path, {
          id: path,
          path,
          diff,
          snapshot,
          operation: kind,
          patches: diff ? [diff] : [],
        });
      }
    }
    if (
      event.type.toLowerCase().includes('diff.updated') &&
      typeof data.diff === 'string'
    ) {
      workspaceDiff = data.diff;
    }
  }
  for (const change of splitWorkspaceDiff(workspaceDiff)) {
    const matchingPaths = [...files.keys()].filter((path) => {
      const normalized = path.replace(/^file:\/\//, '').replace(/\\/g, '/');
      return (
        normalized === change.path || normalized.endsWith(`/${change.path}`)
      );
    });
    if (!matchingPaths.length) files.set(change.path, change);
  }
  return [...files.values()].map(({ id, path, diff, snapshot }) => ({
    id,
    path,
    diff,
    snapshot,
  }));
}

export function splitWorkspaceDiff(diff: string) {
  const changes: Array<{ id: string; path: string; diff: string }> = [];
  let path = '';
  let lines: string[] = [];
  const flush = () => {
    if (path && lines.length)
      changes.push({ id: path, path, diff: lines.join('\n') });
  };
  for (const line of diff.split('\n')) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (match) {
      flush();
      path = match[2];
      lines = [line];
    } else if (path) {
      lines.push(line);
    }
  }
  flush();
  return changes;
}

function addedFileDiff(path: string, content: string) {
  const lines = content ? content.replace(/\n$/, '').split('\n') : [];
  const body = lines.map((line) => `+${line}`).join('\n');
  const headers = [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${path}`,
  ];
  if (!lines.length) return headers.join('\n');
  return [...headers, `@@ -0,0 +1,${lines.length} @@`, body].join('\n');
}

function looksLikePatch(value: string) {
  return (
    value.startsWith('diff --git ') ||
    value.startsWith('@@ ') ||
    (/^--- .+\n\+\+\+ .+\n/m.test(value) && /^@@ .+ @@/m.test(value))
  );
}
