import type { RelayEvent } from './domain';

export function runFileChanges(events?: RelayEvent[] | null) {
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
  for (const event of events || []) {
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
      files.set('Workspace diff', {
        id: 'workspace-diff',
        path: 'Workspace diff',
        diff: data.diff,
      });
    }
  }
  return [...files.values()].map(({ id, path, diff, snapshot }) => ({
    id,
    path,
    diff,
    snapshot,
  }));
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
