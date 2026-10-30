'use client';
import { useEffect, useState } from 'react';
import {
  Folder,
  Bot,
  Server,
  FileText,
  LoaderCircle,
  MessageSquare,
  Users,
  Pin,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import { useI18n } from '@/lib/i18n';
import { useSidebar } from '@/components/ui/sidebar';
import {
  steer,
  type SessionSearchResult,
  type ProjectRecord,
} from '@/lib/steer-client';
import type { Artifact } from '@/lib/domain';

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(
    `(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'gi',
  );
  return (
    <>
      {text
        .split(pattern)
        .map((part, i) =>
          terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
            <mark key={i}>{part}</mark>
          ) : (
            part
          ),
        )}
    </>
  );
}
export function SessionSearchDialog({
  open,
  onOpen,
  projects,
  artifacts,
  onProject,
  onArtifact,
  onAgents,
  onSession,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  projects: (Pick<ProjectRecord, 'id' | 'name' | 'deletedAt'> & {
    navigationDisabled?: boolean;
  })[];
  artifacts: Artifact[];
  onProject: (id: string) => void;
  onArtifact: (index: number) => void;
  onAgents: (tab: string) => void;
  onSession: (result: SessionSearchResult) => Promise<void>;
}) {
  const { t } = useI18n();
  const { isMobile, setOpenMobile } = useSidebar();
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('');
  const [period, setPeriod] = useState('');
  const [results, setResults] = useState<SessionSearchResult[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState('');
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const filterKey = `${query}:${project}:${period}`;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      setError('');
      const params = new URLSearchParams({
        q: query,
        projectId: project,
        offset: String(offset),
      });
      if (period)
        params.set(
          'from',
          new Date(Date.now() - Number(period) * 86400000).toISOString(),
        );
      steer
        .searchSessions(params, controller.signal)
        .then((data) => {
          if (controller.signal.aborted) return;
          setResults((prev) =>
            offset
              ? [
                  ...prev.filter(
                    (item) => !data.results.some((next) => next.id === item.id),
                  ),
                  ...data.results,
                ]
              : data.results,
          );
          setMore(data.hasMore);
        })
        .catch((e) => {
          if (!controller.signal.aborted)
            setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!controller.signal.aborted) setBusy(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, filterKey, offset, retry, query, project, period]);
  const change = (action: () => void) => {
    setOffset(0);
    setResults([]);
    setMore(false);
    setBusy(true);
    action();
  };
  const select = async (result: SessionSearchResult) => {
    setOpening(result.id);
    setError('');
    try {
      await onSession(result);
      onOpen(false);
      if (isMobile) setOpenMobile(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening('');
    }
  };
  const includes = (name: string) =>
    name.toLowerCase().includes(query.trim().toLowerCase());
  return (
    <Dialog open={open} onOpenChange={onOpen}>
      <DialogContent className="ws-search-dialog ws-session-search-dialog">
        <DialogTitle className="sr-only">{t('Search workspace')}</DialogTitle>
        <DialogDescription className="sr-only">
          {t('Search conversation titles and messages, projects, and results.')}
        </DialogDescription>
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={(v) => change(() => setQuery(v))}
            maxLength={200}
            placeholder={t('Search conversations and messages…')}
          />
          <div className="ws-session-search-filters">
            <label>
              <span className="sr-only">{t('Project')}</span>
              <select
                value={project}
                onChange={(e) => change(() => setProject(e.target.value))}
              >
                <option value="">{t('All projects')}</option>
                {projects
                  .filter((p) => !p.deletedAt)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span className="sr-only">{t('Last activity')}</span>
              <select
                value={period}
                onChange={(e) => change(() => setPeriod(e.target.value))}
              >
                <option value="">{t('Any time')}</option>
                <option value="7">{t('Last 7 days')}</option>
                <option value="30">{t('Last 30 days')}</option>
                <option value="90">{t('Last 90 days')}</option>
              </select>
            </label>
          </div>
          {error && (
            <div role="alert" className="ws-session-search-state">
              {error}{' '}
              <button onClick={() => setRetry((v) => v + 1)}>
                {t('Retry')}
              </button>
            </div>
          )}
          <CommandList>
            <CommandGroup heading={t('Conversation results')}>
              {results.map((result) => (
                <CommandItem
                  className="ws-session-search-result"
                  key={result.id}
                  value={`session-${result.id}`}
                  disabled={Boolean(opening) || busy}
                  onSelect={() => void select(result)}
                >
                  {opening === result.id ? (
                    <LoaderCircle className="animate-spin" />
                  ) : result.shareId ? (
                    <Users />
                  ) : (
                    <MessageSquare />
                  )}
                  <div>
                    <strong>
                      <span>
                        <Highlight text={result.title} query={query} />
                      </span>
                      {result.pinned && <Pin />}
                    </strong>
                    <small>
                      {result.projectName || t('No project')} ·{' '}
                      {new Date(result.updatedAt).toLocaleDateString()}{' '}
                      {result.shareId
                        ? `· ${t('Collaborative conversation')}`
                        : ''}
                    </small>
                    {result.snippet && (
                      <p>
                        <Highlight
                          text={result.snippet.replace(/\s+/g, ' ')}
                          query={query}
                        />
                      </p>
                    )}
                    {result.matchCount > 1 && (
                      <small>
                        {t('{count} matching messages', {
                          count: result.matchCount,
                        })}
                      </small>
                    )}
                  </div>
                </CommandItem>
              ))}
              {!busy && !error && !results.length && (
                <p className="ws-session-search-state">
                  {t('No matching conversations.')}
                </p>
              )}
              {busy && (
                <output className="ws-session-search-state">
                  <LoaderCircle className="animate-spin" />
                  {t('Searching…')}
                </output>
              )}
              {more && !busy && (
                <button
                  className="ws-session-search-more"
                  onClick={() => setOffset(results.length)}
                >
                  {t('Load more')}
                </button>
              )}
            </CommandGroup>
            {!project && !period && (
              <>
                <CommandGroup heading={t('Projects')}>
                  {projects
                    .filter(
                      (p) =>
                        !p.deletedAt &&
                        !p.navigationDisabled &&
                        includes(p.name),
                    )
                    .map((p) => (
                      <CommandItem
                        key={p.id}
                        value={`project-${p.id}`}
                        onSelect={() => {
                          onProject(p.id);
                          onOpen(false);
                        }}
                      >
                        <Folder />
                        {p.name}
                      </CommandItem>
                    ))}
                </CommandGroup>
                <CommandGroup heading={t('Results')}>
                  {artifacts
                    .map((a, i) => ({ a, i }))
                    .filter(({ a }) => includes(a.title))
                    .map(({ a, i }) => (
                      <CommandItem
                        key={a.id}
                        value={`artifact-${a.id}`}
                        onSelect={() => {
                          onArtifact(i);
                          onOpen(false);
                        }}
                      >
                        <FileText />
                        {a.title}
                      </CommandItem>
                    ))}
                </CommandGroup>
                <CommandGroup heading={t('System')}>
                  {['agents', 'runtimes']
                    .filter((tab) =>
                      includes(t(tab === 'agents' ? 'Agents' : 'Runtimes')),
                    )
                    .map((tab) => (
                      <CommandItem
                        key={tab}
                        value={tab}
                        onSelect={() => {
                          onAgents(tab);
                          onOpen(false);
                        }}
                      >
                        {tab === 'agents' ? <Bot /> : <Server />}
                        {t(tab === 'agents' ? 'Agents' : 'Runtimes')}
                      </CommandItem>
                    ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
