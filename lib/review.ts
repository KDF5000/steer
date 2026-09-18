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
      const path = typeof change.path === 'string' ? change.path : '';
      const diff = typeof change.diff === 'string' ? change.diff : '';
      const snapshot = looksLikeUnifiedDiff(diff) ? undefined : diff;
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

function looksLikeUnifiedDiff(value: string) {
  return (
    value.startsWith('diff --git ') ||
    (/^--- .+\n\+\+\+ .+\n/m.test(value) && /^@@ .+ @@/m.test(value))
  );
}
