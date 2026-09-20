import type { RelayEvent } from './domain';

export function runFileChanges(events?: RelayEvent[] | null) {
  const files = new Map<
    string,
    { id: string; path: string; diff: string; snapshot?: string }
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
      const kind = typeof record.type === 'string' ? record.type : '';
      const reportedDiff =
        typeof record.unified_diff === 'string'
          ? record.unified_diff
          : typeof record.diff === 'string'
            ? record.diff
            : '';
      const content = typeof record.content === 'string' ? record.content : '';
      const reportedSnapshot =
        reportedDiff && !looksLikeUnifiedDiff(reportedDiff)
          ? reportedDiff
          : undefined;
      const snapshot =
        kind === 'add'
          ? content || reportedSnapshot || ''
          : reportedSnapshot || content || undefined;
      const diff =
        snapshot !== undefined && !looksLikeUnifiedDiff(reportedDiff)
          ? addedFileDiff(path, snapshot)
          : reportedDiff;
      if (path) files.set(path, { id: path, path, diff, snapshot });
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
  return [...files.values()];
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

function looksLikeUnifiedDiff(value: string) {
  return (
    value.startsWith('diff --git ') ||
    (/^--- .+\n\+\+\+ .+\n/m.test(value) && /^@@ .+ @@/m.test(value))
  );
}
