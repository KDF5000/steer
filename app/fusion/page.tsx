'use client';

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUpRight,
  FileCode,
  FileJson,
  FileImage,
  Bot,
  Check,
  ChevronRight,
  Copy,
  Quote,
  Download,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  MoreHorizontal,
  PanelLeft,
  PanelRightClose,
  PanelRightOpen,
  ChevronDown,
  ChevronLeft,
  Pencil,
  Pin,
  PinOff,
  Archive,
  ArchiveRestore,
  Plus,
  RefreshCw,
  Reply,
  LoaderCircle,
  Search,
  Send,
  Server,
  Settings,
  Share2,
  Users,
  LogOut,
  Library,
  KeyRound,
  MessageSquare,
  NotebookPen,
  Square,
  SquarePen,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  InlineComposer,
  ComposerDraft,
  quotationSummary,
  focusInlineComposer,
} from './inline-composer';
import { SessionSearchDialog } from './session-search';
import type { TaskMessageOptions } from '@/lib/domain';
import hljs from 'highlight.js/lib/common';
import { withRuntimeToolEvents } from '@/lib/runtime-events';
import 'highlight.js/styles/github.css';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { runFileChanges, splitWorkspaceDiff } from '@/lib/review';
import { GettingStarted } from './getting-started';
import { setInterfaceLanguage, useI18n } from '@/lib/i18n';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  AgentProfile as AgentItem,
  Artifact,
  ChatMessage,
  RelayEvent,
  RelayNode,
  RuntimeSummary,
} from '@/lib/domain';
import { runtimeProviderName } from '@/lib/domain';
import {
  steer,
  steerAPIBaseURL,
  SteerHTTPError,
  type AuthUser,
  type AgentRecord,
  type ArtifactRecord,
  type ChatSessionRecord,
  type DocumentRecord,
  type ProjectRecord,
  type SkillRecord,
  type WorkspaceGitStatus,
  type WorkspaceAPIKeyRecord,
  type WorkspaceIntegrationRecord,
  type WorkspaceSettingsRecord,
  type WorkspaceRecord,
} from '@/lib/steer-client';
import { useChatViewport } from './use-chat-viewport';
import { AssetsView, WorkLogView } from './workspace-library';
import {
  AgentTable,
  CollaborationTree,
  CollaborationAvatars,
  SharedSessionAccessDialog,
  ResourceSharingDialog,
  SharedAgentsList,
  type SharingTarget,
} from './resource-sharing';
import type { ResourceShare } from '@/lib/steer-client';
import './fusion.css';

type View = 'chat' | 'artifacts' | 'agents' | 'assets' | 'notes' | 'settings';
const noProjectSessionGroup = '__no-project__';
const recentSessionLimit = 5;

function recentSessionSubset(
  sessions: ChatSessionRecord[],
  activeSessionID: string,
) {
  if (sessions.length <= recentSessionLimit) return sessions;
  const recent = sessions.slice(0, recentSessionLimit);
  const active = sessions.find((session) => session.id === activeSessionID);
  if (!active || recent.some((session) => session.id === active.id)) {
    return recent;
  }
  return [...recent.slice(0, recentSessionLimit - 1), active];
}

function gitRefLabel(ref: string | null | undefined) {
  const value = ref?.trim() || 'HEAD';
  const normalized = ['refs/heads/', 'refs/remotes/origin/', 'origin/'].reduce(
    (current, prefix) =>
      current.startsWith(prefix) ? current.slice(prefix.length) : current,
    value,
  );
  return /^[0-9a-f]{7,40}$/i.test(normalized)
    ? normalized.slice(0, 7)
    : normalized;
}

function configuredProjectBranch(project: ProjectRecord) {
  return project.workspaceKind === 'git'
    ? gitRefLabel(project.workspaceRef)
    : '';
}

function gitStatusBranch(status: WorkspaceGitStatus | undefined) {
  if (!status?.repository) return '';
  const ref = status.detached ? status.commit : status.branch || status.commit;
  return ref ? gitRefLabel(ref) : '';
}

function GitBranchLabel({ branch }: { branch: string }) {
  if (!branch) return null;
  const detached = /^[0-9a-f]{7}$/i.test(branch);
  return (
    <span
      className="ws-git-branch"
      title={detached ? `${branch} (detached HEAD)` : branch}
    >
      <GitBranch aria-hidden="true" />
      <span>{branch}</span>
      {detached && <span className="ws-git-detached">detached</span>}
    </span>
  );
}

type PendingImage = { id: string; file: File; url: string };
type RuntimeChoice = {
  value: string;
  label: string;
  provider: string;
  runtimeId: string;
  models: string[];
  defaultModel: string;
  unavailable?: boolean;
};

function projectRunError(
  error: string | undefined,
  project: ProjectRecord | undefined,
  runtimeId: string | null,
) {
  if (!error?.startsWith('relay workspace: local source is not a directory:'))
    return error;
  const path = error.slice(error.lastIndexOf(':') + 1).trim();
  return `The directory ${path} does not exist on Runtime ${runtimeId || project?.runtimeId || 'selected for this conversation'}. Connect the Relay Node where this path exists, then edit the Project and select that machine.`;
}

function agentFromRecord(agent: AgentRecord): AgentItem {
  return {
    ...agent,
    runtime:
      agent.runtimeId ||
      `Automatic / ${runtimeProviderName(agent.runtimeProvider)}`,
    model: agent.model || 'Runtime default',
    state: 'Idle',
  };
}

function artifactFromRecord(artifact: ArtifactRecord): Artifact {
  return {
    id: artifact.id,
    title: artifact.name,
    fileName: artifact.name,
    createdAt: artifact.createdAt,
    source: 'Conversation run',
    type: artifact.type.replaceAll('_', ' '),
    version: '',
    state: artifact.state === 'ready' ? 'Available' : artifact.state,
    summary: `Produced by Relay Run ${artifact.relayRunId}.`,
    update: '',
    contentType: artifact.contentType,
    size: artifact.size,
    relayRunId: artifact.relayRunId,
  };
}

function markdownLinkText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number')
    return String(children);
  if (Array.isArray(children)) return children.map(markdownLinkText).join('');
  return '';
}

function readableLinkLabel(href: string, title: string | undefined) {
  if (title?.trim()) return title.trim();
  try {
    const url = new URL(href);
    const hostname = url.hostname.replace(/^www\./, '');
    const site =
      {
        'github.com': 'GitHub',
        'gitlab.com': 'GitLab',
        'youtube.com': 'YouTube',
        'youtu.be': 'YouTube',
      }[hostname] || hostname;
    const lastSegment = url.pathname.split('/').filter(Boolean).at(-1);
    if (!lastSegment) return site;
    const page = decodeURIComponent(lastSegment)
      .replace(/\.[a-z0-9]{1,8}$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim();
    return page && page.toLowerCase() !== site.toLowerCase()
      ? `${page} · ${site}`
      : site;
  } catch {
    return href.split('/').filter(Boolean).at(-1) || href;
  }
}

function workspaceLinkPath(href: string) {
  if (/^https?:\/\//i.test(href) || href.startsWith('#')) return '';
  if (href.startsWith('file://')) {
    try {
      return decodeURIComponent(new URL(href).pathname);
    } catch {
      return '';
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return '';
  try {
    return decodeURIComponent(href.split(/[?#]/, 1)[0]);
  } catch {
    return href.split(/[?#]/, 1)[0];
  }
}

type MarkdownWorkspace = {
  runId?: string;
  readImage: ((path: string) => Promise<string>) | null;
  onOpenFile?: (path: string) => void;
};
const MarkdownWorkspaceContext = createContext<MarkdownWorkspace | null>(null);

function createWorkspaceImageReader(runId: string) {
  let root: Promise<string> | undefined;
  return async (path: string) => {
    let relativePath = path;
    if (path.startsWith('/')) {
      root ??= steer
        .inspectWorkspace(runId, 'list')
        .then((result) => result.root)
        .catch((error: unknown) => {
          root = undefined;
          throw error;
        });
      relativePath = workspaceRelativePath(path, await root);
    }
    const image = workspaceImageSource(
      await steer.inspectWorkspace(runId, 'read', relativePath),
    );
    if (!image) throw new Error('Image preview unavailable');
    return image;
  };
}

function MarkdownImage({ src, alt = '', title }: ComponentProps<'img'>) {
  const { t } = useI18n();
  const workspace = useContext(MarkdownWorkspaceContext);
  const source = typeof src === 'string' ? src : '';
  const path = workspaceLinkPath(source);
  const readImage = workspace?.readImage;
  const key = `${workspace?.runId || ''}:${path}`;
  const [result, setResult] = useState({ key: '', source: '', error: '' });
  useEffect(() => {
    if (!path || !readImage) return;
    let cancelled = false;
    void readImage(path)
      .then((image) => {
        if (!cancelled) setResult({ key, source: image, error: '' });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setResult({
            key,
            source: '',
            error:
              error instanceof Error
                ? error.message
                : 'Image preview unavailable',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [key, path, readImage]);

  if (!path) {
    if (!source) return <span>{alt}</span>;
    // oxlint-disable-next-line next/no-img-element -- Markdown may contain arbitrary external image URLs.
    return <img src={source} alt={alt} title={title} loading="lazy" />;
  }
  const image = result.key === key ? result.source : '';
  const error = result.key === key ? result.error : '';
  const label = alt || path.split('/').at(-1) || t('Image');
  return (
    <button
      type="button"
      className="ws-message-image"
      aria-label={t('Open image preview: {name}', { name: label })}
      title={error || title || path}
      disabled={!workspace?.onOpenFile}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        workspace?.onOpenFile?.(path);
      }}
    >
      {image ? (
        // oxlint-disable-next-line next/no-img-element -- Authenticated image data read through the run's Relay workspace.
        <img
          src={image}
          alt={alt}
          onError={() =>
            setResult({ key, source: '', error: 'Image preview unavailable' })
          }
        />
      ) : (
        <span className="ws-message-image-placeholder">
          {error || !readImage ? (
            <FileImage aria-hidden="true" />
          ) : (
            <LoaderCircle
              className="ws-message-image-loading"
              aria-hidden="true"
            />
          )}
          <span>{label}</span>
          <small>
            {t(
              error || !readImage
                ? 'Image preview unavailable'
                : 'Loading image…',
            )}
          </small>
        </span>
      )}
    </button>
  );
}

const Markdown = memo(function Markdown({
  children,
  onOpenWorkspaceFile,
  workspaceRunId,
}: {
  children: string;
  onOpenWorkspaceFile?: (path: string, runId?: string) => void;
  workspaceRunId?: string;
}) {
  const readImage = useMemo(
    () => (workspaceRunId ? createWorkspaceImageReader(workspaceRunId) : null),
    [workspaceRunId],
  );
  const workspace = useMemo(
    () => ({
      runId: workspaceRunId,
      readImage,
      onOpenFile: onOpenWorkspaceFile
        ? (path: string) => onOpenWorkspaceFile(path, workspaceRunId)
        : undefined,
    }),
    [workspaceRunId, readImage, onOpenWorkspaceFile],
  );
  return (
    <MarkdownWorkspaceContext.Provider value={workspace}>
      <div className="ws-markdown">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          urlTransform={(url, key, node) =>
            ((onOpenWorkspaceFile && key === 'href' && node.tagName === 'a') ||
              (workspaceRunId && key === 'src' && node.tagName === 'img')) &&
            url.startsWith('file://')
              ? url
              : defaultUrlTransform(url)
          }
          components={{
            img: MarkdownImage,
            a: ({ children: linkChildren, href = '', title }) => {
              const text = markdownLinkText(linkChildren).trim();
              const rawLink =
                !text ||
                text === href ||
                /^https?:\/\//i.test(text) ||
                text.startsWith('file://');
              const filePath = workspaceLinkPath(href);
              const external = /^https?:\/\//i.test(href);
              return (
                <a
                  href={href}
                  title={href}
                  target={external ? '_blank' : undefined}
                  rel={external ? 'noreferrer noopener' : undefined}
                  onClick={
                    filePath && onOpenWorkspaceFile
                      ? (event) => {
                          event.preventDefault();
                          onOpenWorkspaceFile(filePath, workspaceRunId);
                        }
                      : undefined
                  }
                >
                  <span>
                    {rawLink ? readableLinkLabel(href, title) : linkChildren}
                  </span>
                  {external && <ExternalLink aria-hidden="true" />}
                </a>
              );
            },
          }}
        >
          {children}
        </ReactMarkdown>
      </div>
    </MarkdownWorkspaceContext.Provider>
  );
});

// Keep the elapsed clock local: ticking must not re-render the transcript,
// composer, file tree, or syntax-highlighted diff.
const ResponseStatus = memo(function ResponseStatus({
  message,
}: {
  message: ChatMessage;
}) {
  const [now, setNow] = useState(() => Date.now());
  const terminal = isTerminalStatus(message.status);
  useEffect(() => {
    if (terminal) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [terminal]);
  return (
    <span aria-live={terminal ? undefined : 'polite'}>
      {responseStatusLabel(message, now)}
    </span>
  );
});

const DelegationProgress = memo(function DelegationProgress({
  message,
  onOpen,
}: {
  message: ChatMessage;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const status =
    message.status === 'queued'
      ? 'Waiting to start'
      : message.status === 'cancelling'
        ? 'Stopping'
        : 'Processing';
  return (
    <button
      type="button"
      className="ws-delegation-progress"
      title={t('Open delegated conversation')}
      aria-label={t('Open delegated conversation')}
      onClick={onOpen}
    >
      <LoaderCircle className="ws-delegation-spinner" aria-hidden="true" />
      <span className="ws-delegation-progress-agent">
        {message.context?.agentName}
      </span>
      <span aria-live="polite">{t(status)}</span>
      <span className="ws-delegation-elapsed">
        · {formatElapsed(message.createdAt, undefined, now)}
      </span>
      <ArrowUpRight className="ws-delegation-view" aria-hidden="true" />
    </button>
  );
});

type ProcessActivity = NonNullable<ChatMessage['activityLog']>[number];

function ProcessActionIcon({ label }: { label: string }) {
  return actionFamily(label) === 'command' ? (
    <SquareTerminal aria-hidden="true" />
  ) : (
    <Wrench aria-hidden="true" />
  );
}

const ProcessTranscript = memo(function ProcessTranscript({
  items,
  live = false,
}: {
  items: ProcessActivity[];
  live?: boolean;
}) {
  return (
    <div
      className={`ws-chat-process-transcript${live ? ' is-live' : ''}`}
      aria-label={live ? 'Agent work in progress' : 'Agent execution details'}
      aria-live={live ? 'polite' : undefined}
    >
      {items.map((item) =>
        item.children?.length ? (
          <details className="ws-chat-process-group" key={item.id}>
            <summary>
              <ProcessActionIcon label={item.children[0].label} />
              <strong>{item.label}</strong>
              <ChevronRight
                className="ws-chat-process-group-chevron"
                aria-hidden="true"
              />
            </summary>
            <div className="ws-chat-process-group-content">
              {item.children.map((child) => (
                <div className="ws-chat-process-command" key={child.id}>
                  <ProcessActionIcon label={child.label} />
                  <strong>{child.label}</strong>
                  {child.detail && (
                    <small title={child.detail}>{child.detail}</small>
                  )}
                </div>
              ))}
            </div>
          </details>
        ) : item.kind === 'update' && item.detail ? (
          <Markdown key={item.id}>{item.detail}</Markdown>
        ) : (
          <div
            className={`ws-chat-process-action${item.kind === 'action-active' ? ' is-active' : ''}`}
            key={item.id}
          >
            {item.kind === 'action-active' ? (
              <SquareTerminal aria-hidden="true" />
            ) : (
              <Wrench aria-hidden="true" />
            )}
            <strong>{item.label}</strong>
            {item.detail && <small>{item.detail}</small>}
          </div>
        ),
      )}
    </div>
  );
});

function sessionDisplayTitle(
  session: Pick<ChatSessionRecord, 'title' | 'parentConversationId'>,
) {
  // Older delegated sessions store Agent identity before the task title.
  // Keep the stored name intact and separate that metadata only for display.
  return session.parentConversationId
    ? session.title.replace(/^@[^·]+\s·\s/, '') || session.title
    : session.title;
}

function SessionNavigationItem({
  session,
  active,
  onOpen,
  onDelete,
  onUpdate,
  onRename,
  shared = false,
}: {
  shared?: boolean;
  session: ChatSessionRecord;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onUpdate: (update: { pinned?: boolean; archived?: boolean }) => void;
  onRename: () => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const { t } = useI18n();
  return (
    <SidebarMenuItem className="ws-session-nav-item">
      <SidebarMenuButton
        isActive={active}
        onClick={() => {
          onOpen();
          if (isMobile) setOpenMobile(false);
        }}
        title={session.title}
      >
        <span>{sessionDisplayTitle(session)}</span>
        {session.pinned && (
          <Pin className="ws-session-pin" aria-label={t('Pinned')} />
        )}
        {session.archived && (
          <Archive className="ws-session-pin" aria-label={t('Archived')} />
        )}
        {shared && (
          <Users
            className="ws-session-shared-marker"
            aria-label="Collaborative conversation"
          />
        )}
        {session.parentConversationId && (
          <span className="ws-session-delegation-marker" title={session.title}>
            <ArrowUpRight aria-label="Delegated conversation" />
          </span>
        )}
      </SidebarMenuButton>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuAction
              className="ws-session-actions"
              aria-label={t('Conversation actions')}
            />
          }
        >
          <MoreHorizontal aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start">
          <DropdownMenuItem
            onClick={() => onUpdate({ pinned: !session.pinned })}
          >
            {session.pinned ? <PinOff /> : <Pin />}
            {t(session.pinned ? 'Unpin conversation' : 'Pin conversation')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRename}>
            <Pencil />
            {t('Rename conversation')}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => onUpdate({ archived: !session.archived })}
          >
            {session.archived ? <ArchiveRestore /> : <Archive />}
            {t(
              session.archived
                ? 'Restore conversation'
                : 'Archive conversation',
            )}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 />
            {t('Delete conversation')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

function SessionNavigationList({
  shares = [],
  sessions,
  activeSessionID,
  expanded,
  onToggleExpanded,
  onOpen,
  onDelete,
  onUpdate,
  onRename,
}: {
  shares?: ResourceShare[];
  sessions: ChatSessionRecord[];
  activeSessionID: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onOpen: (session: ChatSessionRecord) => void;
  onDelete: (session: ChatSessionRecord) => void;
  onUpdate: (
    session: ChatSessionRecord,
    update: { pinned?: boolean; archived?: boolean },
  ) => void;
  onRename: (session: ChatSessionRecord) => void;
}) {
  const visibleSessions = expanded
    ? sessions
    : recentSessionSubset(sessions, activeSessionID);
  const hiddenCount = sessions.length - visibleSessions.length;
  const hasMore = sessions.length > recentSessionLimit;
  const label = expanded ? 'Show less' : `Show ${hiddenCount} more`;

  return (
    <SidebarMenuSub className="ws-session-list">
      {visibleSessions.map((session) => (
        <SessionNavigationItem
          key={session.id}
          session={session}
          shared={shares.some(
            (share) =>
              share.owned &&
              share.kind === 'session' &&
              share.resourceId === session.id,
          )}
          active={activeSessionID === session.id}
          onOpen={() => onOpen(session)}
          onDelete={() => onDelete(session)}
          onUpdate={(update) => onUpdate(session, update)}
          onRename={() => onRename(session)}
        />
      ))}
      {hasMore && (
        <li>
          <button
            type="button"
            className={`ws-session-list-more${expanded ? ' is-expanded' : ''}`}
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            <ChevronDown aria-hidden="true" />
            <span>{label}</span>
          </button>
        </li>
      )}
    </SidebarMenuSub>
  );
}

export default function Fusion() {
  const { t } = useI18n();
  const [authReady, setAuthReady] = useState(false);
  const [gettingStarted, setGettingStarted] = useState(false);
  const gettingStartedWorkspace = useRef('');
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [workspaceList, setWorkspaceList] = useState<WorkspaceRecord[]>([]);
  const [workspaceID, setWorkspaceID] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 264;
    const saved = window.localStorage.getItem('steer.sidebarWidth');
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 200 && parsed <= 420
      ? parsed
      : 264;
  });
  const startSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLHRElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      const listeners = new AbortController();
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onPointerMove = (moveEvent: PointerEvent) => {
        const next = Math.max(
          200,
          Math.min(420, startWidth + moveEvent.clientX - startX),
        );
        setSidebarWidth(next);
      };
      const onPointerUp = (upEvent: PointerEvent) => {
        const next = Math.max(
          200,
          Math.min(420, startWidth + upEvent.clientX - startX),
        );
        window.localStorage.setItem('steer.sidebarWidth', String(next));
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        listeners.abort();
      };

      window.addEventListener('pointermove', onPointerMove, {
        signal: listeners.signal,
      });
      window.addEventListener('pointerup', onPointerUp, {
        signal: listeners.signal,
      });
      window.addEventListener('pointercancel', onPointerUp, {
        signal: listeners.signal,
      });
    },
    [sidebarWidth],
  );
  const [workspaceDialog, setWorkspaceDialog] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [expandedSessionGroups, setExpandedSessionGroups] = useState<
    Set<string>
  >(new Set());
  const [expandedSessionLists, setExpandedSessionLists] = useState<Set<string>>(
    new Set(),
  );
  const [view, setView] = useState<View>('chat');
  const [agentTab, setAgentTab] = useState('agents');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [sessionSort, setSessionSort] = useState('message');
  const [showArchived, setShowArchived] = useState(false);
  const [renamingSession, setRenamingSession] =
    useState<ChatSessionRecord | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [sessionUpdateBusy, setSessionUpdateBusy] = useState(false);
  const [sessionUpdateError, setSessionUpdateError] = useState('');
  const [messageFocus, setMessageFocus] = useState<{
    id: string;
    revision: number;
  } | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const saved = localStorage.getItem(
        `steer.sessionSort.v2:${authUser?.id}:${workspaceID}`,
      );
      setSessionSort(saved === 'created' ? 'created' : 'message');
      setShowArchived(false);
      setMessageFocus(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [authUser?.id, workspaceID]);
  const [agentList, setAgentList] = useState<AgentItem[]>([]);
  const [projectList, setProjectList] = useState<ProjectRecord[]>([]);
  const [projectGitStatuses, setProjectGitStatuses] = useState<
    Record<string, WorkspaceGitStatus>
  >({});
  const [artifactList, setArtifactList] = useState<Artifact[]>([]);
  const [skillList, setSkillList] = useState<SkillRecord[]>([]);
  const [documentList, setDocumentList] = useState<DocumentRecord[]>([]);
  const [agentSkillAssignments, setAgentSkillAssignments] = useState<
    Record<string, string[]>
  >({});
  const [workspaceSettings, setWorkspaceSettings] =
    useState<WorkspaceSettingsRecord | null>(null);
  const [selectedArtifact, setSelectedArtifact] = useState(0);
  const [runtimeNodes, setRuntimeNodes] = useState<RelayNode[]>([]);
  const runtimeCapacityPolls = useRef(new Map<string, number>());
  const [relayConnected, setRelayConnected] = useState(false);
  const [relayError, setRelayError] = useState('');
  const [relayPublicURL, setRelayPublicURL] = useState('http://localhost:8787');
  const [chatAgent, setChatAgent] = useState('');
  const [chatProject, setChatProject] = useState('none');
  const [chatInput, setChatInputState] = useState('');
  const [chatInputRevision, setChatInputRevision] = useState(0);
  const chatInputRef = useRef('');
  const readChatInput = useCallback(() => chatInputRef.current, []);
  const updateChatInput = useCallback((text: string) => {
    chatInputRef.current = text;
  }, []);
  const setChatInput = useCallback((text: string) => {
    chatInputRef.current = text;
    setChatInputState(text);
    setChatInputRevision((revision) => revision + 1);
  }, []);
  const [chatImages, setChatImages] = useState<PendingImage[]>([]);
  const [chatWorking, setChatWorking] = useState(false);
  const [chatSessionLoading, setChatSessionLoading] = useState(false);
  const [activeRunID, setActiveRunID] = useState('');
  const [chatSession, setChatSession] = useState('');
  const [chatSessions, setChatSessions] = useState<ChatSessionRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [resourceShares, setResourceShares] = useState<ResourceShare[]>([]);
  const [sharingTarget, setSharingTarget] = useState<SharingTarget | null>(
    null,
  );
  const [sharingLoading, setSharingLoading] = useState(false);
  const [sharingError, setSharingError] = useState('');
  const [accessShare, setAccessShare] = useState<ResourceShare | null>(null);
  const [collaborationShare, setCollaborationShare] =
    useState<ResourceShare | null>(null);
  const [collaborationSession, setCollaborationSession] =
    useState<ChatSessionRecord>();
  const [collaborationAgent, setCollaborationAgent] = useState<AgentItem>();
  const [collaborationProject, setCollaborationProject] =
    useState<ProjectRecord>();
  const sharedAgentResourcesPresent = useRef(false);
  const sharingRefreshInFlight = useRef(new Set<string>());
  useEffect(() => {
    sharedAgentResourcesPresent.current = projectList.some(
      (project) => project.sharedAgentGrantId,
    );
  }, [projectList]);
  const refreshSharing = useCallback(async () => {
    const wid = steer.workspace();
    if (sharingRefreshInFlight.current.has(wid)) return;
    sharingRefreshInFlight.current.add(wid);
    setSharingLoading(true);
    try {
      const shares = await steer.resourceShares();
      if (wid === steer.workspace()) {
        setResourceShares(shares);
        setSharingError('');
        if (
          sharedAgentResourcesPresent.current ||
          shares.some(
            (share) =>
              share.kind === 'agent' &&
              !share.owned &&
              share.status === 'accepted',
          )
        ) {
          const data = await steer.bootstrap();
          if (wid === steer.workspace()) {
            setAgentList(data.agents.map(agentFromRecord));
            setProjectList(data.projects);
            setChatSessions(data.sessions);
          }
        }
      }
    } catch (error) {
      if (wid === steer.workspace())
        setSharingError(error instanceof Error ? error.message : String(error));
    } finally {
      sharingRefreshInFlight.current.delete(wid);
      if (wid === steer.workspace()) setSharingLoading(false);
    }
  }, []);
  useEffect(() => {
    if (authUser && workspaceID) void Promise.resolve().then(refreshSharing);
  }, [authUser, workspaceID, refreshSharing]);
  useEffect(() => {
    if (!authUser || !workspaceID) return;
    const refresh = () => {
      if (
        document.visibilityState === 'visible' &&
        sharedAgentResourcesPresent.current
      )
        void refreshSharing();
    };
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [authUser, workspaceID, refreshSharing]);
  const [agentDialog, setAgentDialog] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentItem | null>(null);
  const [deletingAgent, setDeletingAgent] = useState<AgentItem | null>(null);
  const [deletingAgentBusy, setDeletingAgentBusy] = useState(false);
  const [projectDialog, setProjectDialog] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectRecord | null>(
    null,
  );
  const [deletingProject, setDeletingProject] = useState<ProjectRecord | null>(
    null,
  );
  const [deletingSession, setDeletingSession] =
    useState<ChatSessionRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [runtimeDialog, setRuntimeDialog] = useState(false);
  const [availableRuntimeNodes, setAvailableRuntimeNodes] = useState<
    RelayNode[]
  >([]);
  const [selectedRuntimeIDs, setSelectedRuntimeIDs] = useState<string[]>([]);
  const [runtimeDiscoveryLoading, setRuntimeDiscoveryLoading] = useState(false);
  const [runtimeClaiming, setRuntimeClaiming] = useState(false);
  const [runtimeDiscoveryError, setRuntimeDiscoveryError] = useState('');
  const [relayEnrollmentToken, setRelayEnrollmentToken] = useState('');
  const [relayEnrollmentNodeToken, setRelayEnrollmentNodeToken] = useState('');
  const [relayEnrollmentNodeID, setRelayEnrollmentNodeID] = useState('');
  const [deletingRelayNode, setDeletingRelayNode] = useState<RelayNode | null>(
    null,
  );
  const [deletingRelayNodeBusy, setDeletingRelayNodeBusy] = useState(false);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [formError, setFormError] = useState('');
  const [agentRuntime, setAgentRuntime] = useState('');
  const [agentModel, setAgentModel] = useState('Runtime default');
  const activeRun = useRef('');
  const activeTask = useRef('');
  const pendingChatSubmission = useRef(false);
  const activeRunContext = useRef<{
    project?: ProjectRecord;
    executionRuntimeID: string | null;
  }>({ executionRuntimeID: null });
  const pollingRun = useRef('');
  const mounted = useRef(true);
  const gitStatusWorkspace = useRef('');
  const requestedProjectGitStatuses = useRef(new Set<string>());
  const projectGitStatusController = useRef<AbortController | null>(null);
  const workspaceHydrationSequence = useRef(0);
  const sessionLoadSequence = useRef(0);
  const runtimeDiscoverySequence = useRef(0);
  const routeReady = useRef(false);
  const skipRouteWrite = useRef(false);
  const createAgentLock = useRef(false);

  useEffect(() => {
    if (view === 'chat' || !steer.collaboration()) return;
    steer.setCollaboration('');
    activeRun.current = '';
    activeTask.current = '';
    const frame = requestAnimationFrame(() => {
      setActiveRunID('');
      setChatWorking(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [view]);

  useEffect(() => {
    if (!chatSession || collaborationShare) return;
    const last = messages.reduce(
      (latest, message) =>
        message.createdAt && message.createdAt > latest
          ? message.createdAt
          : latest,
      '',
    );
    if (!last) return;
    const frame = requestAnimationFrame(() =>
      setChatSessions((current) =>
        current.map((session) =>
          session.id === chatSession &&
          last > (session.lastMessageAt || session.createdAt)
            ? { ...session, lastMessageAt: last }
            : session,
        ),
      ),
    );
    return () => cancelAnimationFrame(frame);
  }, [chatSession, collaborationShare, messages]);

  const navigationSessions = [...chatSessions]
    .filter((session) => (showArchived ? session.archived : !session.archived))
    .sort(
      (a, b) =>
        Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
        (sessionSort === 'created'
          ? b.createdAt.localeCompare(a.createdAt)
          : (b.lastMessageAt || b.createdAt).localeCompare(
              a.lastMessageAt || a.createdAt,
            )) ||
        a.id.localeCompare(b.id),
    );
  const unassignedSessions = navigationSessions.filter(
    (session) =>
      !session.projectId ||
      !projectList.some(
        (project) => !project.deletedAt && project.id === session.projectId,
      ),
  );
  const activeChatSession = collaborationShare
    ? collaborationSession
    : chatSessions.find((session) => session.id === chatSession);
  const sharedAgentProject = projectList.find(
    (project) => project.id === chatProject && project.sharedAgentGrantId,
  );
  const sharedProjectGrants = resourceShares.filter(
    (share) =>
      share.kind === 'agent' &&
      !share.owned &&
      share.status === 'accepted' &&
      (
        sharedAgentProject?.sharedAgentGrantIds || [
          sharedAgentProject?.sharedAgentGrantId,
        ]
      ).includes(share.id),
  );
  const sharedProjectAgents = agentList.filter((agent) =>
    sharedProjectGrants.some((share) => share.resourceId === agent.id),
  );
  const currentAgent = collaborationShare
    ? collaborationAgent
    : sharedAgentProject && sharedProjectAgents.length
      ? sharedProjectAgents.find((agent) => agent.id === chatAgent) ||
        sharedProjectAgents[0]
      : agentList.find((agent) => agent.id === chatAgent) || agentList[0];
  const sharedAgentGrant =
    sharedProjectGrants.find(
      (share) => share.resourceId === currentAgent?.id,
    ) ||
    resourceShares.find(
      (share) => share.id === activeChatSession?.sharedAgentGrantId,
    );
  const activeSharedAgentAccess =
    sharedAgentProject?.sharedAgentAccess ||
    activeChatSession?.sharedAgentAccess;
  const sharedAgentRevoked = Boolean(
    activeSharedAgentAccess && activeSharedAgentAccess !== 'accepted',
  );
  const sharedReadOnly = Boolean(
    collaborationShare &&
    !collaborationShare.owned &&
    collaborationShare.permission !== 'execute',
  );
  const sharedExecutionLocked = Boolean(
    collaborationShare ||
    activeChatSession?.sharedAgentGrantId ||
    sharedAgentProject?.sharedAgentGrantId,
  );
  const runtimeChoices = runtimeNodes.flatMap((node) =>
    (node.runtimes || []).map((runtime) => ({
      value: `${runtime.provider}::${runtime.id}`,
      label: `${node.labels?.name || node.id} / ${t(runtimeProviderName(runtime.provider))}`,
      provider: runtime.provider,
      runtimeId: runtime.id,
      models: runtime.models || [],
      defaultModel: runtime.default_model || '',
    })),
  );
  const selectedProject = collaborationShare
    ? collaborationProject
    : projectList.find((project) => project.id === chatProject);
  const composerExecutionRuntimeId =
    activeChatSession?.executionRuntimeId || null;
  const automaticChoices: RuntimeChoice[] = [
    ...new Set(runtimeChoices.map((item) => item.provider)),
  ].map((provider) => ({
    value: `${provider}::`,
    label: `Automatic / ${t(runtimeProviderName(provider))}`,
    provider,
    runtimeId: '',
    models: runtimeChoices
      .filter((item) => item.provider === provider)
      .flatMap((item) => item.models),
    defaultModel:
      runtimeChoices.find((item) => item.provider === provider)?.defaultModel ||
      '',
  }));
  const allRuntimeChoices: RuntimeChoice[] = [
    ...automaticChoices,
    ...runtimeChoices,
  ];
  const agentRuntimeChoices: RuntimeChoice[] =
    editingAgent?.runtimeId &&
    !allRuntimeChoices.some(
      (choice) => choice.runtimeId === editingAgent.runtimeId,
    )
      ? [
          {
            value: `${editingAgent.runtimeProvider || 'unknown'}::${editingAgent.runtimeId}`,
            label: `Unavailable Runtime / ${t(runtimeProviderName(editingAgent.runtimeProvider)) || 'unknown'}`,
            provider: editingAgent.runtimeProvider || 'unknown',
            runtimeId: editingAgent.runtimeId,
            models: [],
            defaultModel: '',
            unavailable: true,
          },
          ...allRuntimeChoices,
        ]
      : allRuntimeChoices;
  const selectedRuntimeChoice = agentRuntimeChoices.find(
    (item) => item.value === agentRuntime,
  );
  const runtimeRows: RuntimeSummary[] = runtimeNodes.map((node) => [
    node,
    node.labels?.location || (node.id.includes('local') ? 'Local' : 'Remote'),
  ]);
  const updateRuntimeCapacity = async (nodeID: string, capacity: number) => {
    const requestedWorkspace = workspaceID;
    runtimeCapacityPolls.current.set(nodeID, capacity);
    try {
      const updated = await steer.updateNodeCapacity(nodeID, capacity);
      setRuntimeNodes((current) =>
        current.map((node) =>
          node.id === nodeID
            ? {
                ...node,
                active: updated.active,
                capacity: updated.capacity,
                desired_capacity: updated.desired_capacity,
                state: updated.state,
                last_seen: updated.last_seen,
              }
            : node,
        ),
      );
      setNotice(`Concurrency for ${nodeID} set to ${capacity}.`);
      void (async () => {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
          if (
            !mounted.current ||
            gitStatusWorkspace.current !== requestedWorkspace ||
            runtimeCapacityPolls.current.get(nodeID) !== capacity
          )
            return;
          const data = await steer.bootstrap().catch(() => null);
          if (
            !data ||
            !mounted.current ||
            gitStatusWorkspace.current !== requestedWorkspace ||
            runtimeCapacityPolls.current.get(nodeID) !== capacity
          )
            continue;
          setRuntimeNodes(data.relay.nodes || []);
          const refreshed = data.relay.nodes?.find(
            (node) => node.id === nodeID,
          );
          if (
            refreshed?.capacity === capacity &&
            (refreshed.desired_capacity ?? refreshed.capacity) === capacity
          ) {
            runtimeCapacityPolls.current.delete(nodeID);
            return;
          }
        }
        runtimeCapacityPolls.current.delete(nodeID);
      })();
    } catch (error) {
      if (runtimeCapacityPolls.current.get(nodeID) === capacity)
        runtimeCapacityPolls.current.delete(nodeID);
      setNotice(
        error instanceof Error
          ? error.message
          : 'Could not update Runtime concurrency.',
      );
      throw error;
    }
  };
  const disconnectRuntime = async (bindingID: string) => {
    const requestedWorkspace = workspaceID;
    await steer.disconnectRuntimeBinding(bindingID);
    const data = await steer.bootstrap();
    if (!mounted.current || steer.workspace() !== requestedWorkspace) return;
    setRuntimeNodes(data.relay.nodes || []);
    setNotice(t('Runtime disconnected from this workspace.'));
  };

  const hydrateWorkspace = useCallback(async (id: string) => {
    setCollaborationShare(null);
    setResourceShares([]);
    setSharingTarget(null);
    const sequence = ++workspaceHydrationSequence.current;
    gitStatusWorkspace.current = id;
    projectGitStatusController.current?.abort();
    projectGitStatusController.current = null;
    requestedProjectGitStatuses.current.clear();
    steer.setWorkspace(id);
    const data = await steer.bootstrap();
    if (
      !mounted.current ||
      sequence !== workspaceHydrationSequence.current ||
      steer.workspace() !== id
    )
      return;
    const agents = data.agents.map(agentFromRecord);
    setAgentList(agents);
    setProjectList(data.projects || []);
    setProjectGitStatuses({});
    setArtifactList(data.artifacts.map(artifactFromRecord));
    setSkillList(data.skills || []);
    setDocumentList(data.documents || []);
    setAgentSkillAssignments(data.agentSkills || {});
    setWorkspaceSettings(data.settings || null);
    setInterfaceLanguage(data.settings?.interfaceLanguage || 'auto');
    setChatSessions(data.sessions || []);
    setExpandedSessionGroups(new Set());
    setExpandedSessionLists(new Set());
    setRuntimeNodes(data.relay.nodes || []);
    setRelayConnected(data.relay.connected);
    setRelayError(data.relay.error || '');
    setRelayPublicURL(data.relay.publicUrl || 'http://localhost:8787');
    setChatAgent(agents[0]?.id || '');
    setChatProject(data.projects?.[0]?.id || 'none');
    const firstRuntime = data.relay.nodes?.flatMap(
      (node) => node.runtimes || [],
    )[0];
    setAgentRuntime(firstRuntime ? `${firstRuntime.provider}::` : '');
    setLoaded(true);
  }, []);

  useEffect(() => {
    mounted.current = true;
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => {
      mounted.current = false;
      window.removeEventListener('keydown', shortcut);
    };
  }, []);

  useEffect(() => {
    const savedWorkspace = window.localStorage.getItem('steer.workspace') || '';
    if (savedWorkspace) steer.setWorkspace(savedWorkspace);
    steer
      .me()
      .then(async (data) => {
        setAuthUser(data.user);
        setWorkspaceList(data.workspaces);
        const selected =
          data.workspaces.find((item) => item.id === savedWorkspace) ||
          data.workspaces[0];
        if (selected) {
          setWorkspaceID(selected.id);
          window.localStorage.setItem('steer.workspace', selected.id);
          await hydrateWorkspace(selected.id);
        }
      })
      .catch((error: unknown) => {
        if (!(error instanceof SteerHTTPError) || error.status !== 401)
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Steer Server is unavailable.',
          );
      })
      .finally(() => setAuthReady(true));
  }, [hydrateWorkspace]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const delegatedRuns = messages.filter(
    (message) =>
      message.role === 'agent' &&
      message.runId &&
      message.context?.delegationSessionId &&
      message.context.delegationSessionId !== chatSession &&
      !isTerminalStatus(message.status),
  );
  const delegatedRunKey = delegatedRuns
    .map((message) => `${message.runId}:${message.context?.taskId || ''}`)
    .join(',');
  useEffect(() => {
    if (!delegatedRunKey) return;
    let cancelled = false;
    let busy = false;
    const runs = delegatedRunKey.split(',').map((pair) => pair.split(':'));
    const refresh = async () => {
      if (busy || cancelled) return;
      busy = true;
      try {
        await Promise.all(
          runs.map(async ([runId, taskId]) => {
            const result = await (
              taskId ? steer.task(taskId) : steer.run(runId)
            ).catch(() => null);
            if (!result || cancelled) return;
            const terminal = isTerminalStatus(result.run.status);
            setMessages((current) =>
              current.map((message) =>
                message.runId === runId
                  ? {
                      ...message,
                      status: result.run.status,
                      text: terminal ? result.content : '',
                      error: result.error || undefined,
                      createdAt: result.run.started_at || message.createdAt,
                      updatedAt:
                        result.run.completed_at ||
                        (terminal
                          ? new Date().toISOString()
                          : message.updatedAt),
                    }
                  : message,
              ),
            );
          }),
        );
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [delegatedRunKey, chatSession]);

  const pollRun = useCallback(async (runID: string) => {
    if (
      activeRun.current !== runID ||
      !mounted.current ||
      pollingRun.current === runID
    )
      return null;
    pollingRun.current = runID;
    const loadSequence = sessionLoadSequence.current;
    const requestedWorkspace = steer.workspace();
    const isCurrent = () =>
      mounted.current &&
      activeRun.current === runID &&
      sessionLoadSequence.current === loadSequence &&
      steer.workspace() === requestedWorkspace;
    try {
      const taskID = activeTask.current;
      const result = taskID ? await steer.task(taskID) : await steer.run(runID);
      if (!isCurrent()) return;
      const terminal = isTerminalStatus(result.run.status);
      const finalDraft = terminal
        ? result.content
        : liveFinalContent(result.events);
      setMessages((current) =>
        current.map((message) =>
          message.runId === runID
            ? {
                ...message,
                text: finalDraft,
                status: result.run.status,
                error: projectRunError(
                  result.error || undefined,
                  activeRunContext.current.project,
                  activeRunContext.current.executionRuntimeID,
                ),
                activity: runActivity(result.events),
                changes: runFileChanges(result.events),
                activityLog: runActivityLog(
                  result.events,
                  result.run.status === 'succeeded' || Boolean(finalDraft),
                ),
                createdAt:
                  result.run.started_at || message.createdAt || undefined,
                updatedAt:
                  result.run.completed_at ||
                  (isTerminalStatus(result.run.status)
                    ? new Date().toISOString()
                    : message.updatedAt),
              }
            : message,
        ),
      );
      if (['succeeded', 'failed', 'cancelled'].includes(result.run.status)) {
        const refreshed = await steer.bootstrap().catch(() => null);
        if (!isCurrent()) return;
        if (refreshed)
          setArtifactList(refreshed.artifacts.map(artifactFromRecord));
        const projectID = activeRunContext.current.project?.id;
        if (projectID) {
          requestedProjectGitStatuses.current.delete(projectID);
          setProjectGitStatuses((current) => {
            if (!(projectID in current)) return current;
            const next = { ...current };
            delete next[projectID];
            return next;
          });
        }
        activeRun.current = '';
        activeTask.current = '';
        setActiveRunID('');
        setChatWorking(false);
        return result;
      }
      return result;
    } catch (error) {
      if (!isCurrent()) return null;
      setNotice(
        error instanceof Error
          ? error.message
          : 'Run status could not be loaded.',
      );
      return null;
    } finally {
      if (
        pollingRun.current === runID &&
        sessionLoadSequence.current === loadSequence
      )
        pollingRun.current = '';
    }
  }, []);

  useEffect(() => {
    if (!activeRunID) return;
    const controller = new AbortController();
    let stopped = false;
    let retryTimer = 0;
    let recoveryTimer = 0;
    let renderTimer = 0;
    let renderFrame = 0;
    let events: RelayEvent[] = [];
    let lastSequence = 0;
    let retryDelay = 600;

    const flushEvents = () => {
      renderFrame = 0;
      if (stopped || activeRun.current !== activeRunID) return;
      const snapshot = [...events];
      const finalDraft = liveFinalContent(snapshot);
      setMessages((current) =>
        current.map((message) =>
          message.runId === activeRunID
            ? {
                ...message,
                text: finalDraft || message.text,
                activity: runActivity(snapshot),
                activityLog: runActivityLog(snapshot, Boolean(finalDraft)),
                changes: runFileChanges(snapshot),
              }
            : message,
        ),
      );
    };

    const scheduleRender = () => {
      if (renderTimer || renderFrame) return;
      renderTimer = window.setTimeout(() => {
        renderTimer = 0;
        renderFrame = window.requestAnimationFrame(flushEvents);
      }, 32);
    };

    const scheduleReconnect = () => {
      if (stopped || activeRun.current !== activeRunID || retryTimer) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = 0;
        void connect();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 5_000);
    };

    const connect = async () => {
      try {
        const receiveEvent = (event: RelayEvent) => {
          if (event.sequence <= lastSequence) return;
          lastSequence = event.sequence;
          events.push(event);
          scheduleRender();
        };
        if (activeTask.current)
          await steer.streamTaskEvents(
            activeTask.current,
            lastSequence,
            controller.signal,
            receiveEvent,
          );
        else
          await steer.streamRunEvents(
            activeRunID,
            lastSequence,
            controller.signal,
            receiveEvent,
          );
        if (stopped) return;
        const latest = await pollRun(activeRunID);
        if (
          !latest ||
          (!isTerminalStatus(latest.run.status) &&
            activeRun.current === activeRunID)
        )
          scheduleReconnect();
      } catch {
        if (stopped || controller.signal.aborted) return;
        const latest = await pollRun(activeRunID);
        if (
          stopped ||
          (latest && isTerminalStatus(latest.run.status)) ||
          activeRun.current !== activeRunID
        )
          return;
        if (latest) {
          events = latest.events;
          lastSequence = events.at(-1)?.sequence || lastSequence;
        }
        scheduleReconnect();
      }
    };

    const recoverRun = () => {
      if (stopped || activeRun.current !== activeRunID || !navigator.onLine)
        return;
      void pollRun(activeRunID);
    };

    const recoverVisibleRun = () => {
      if (document.visibilityState === 'visible') recoverRun();
    };

    window.addEventListener('online', recoverRun);
    document.addEventListener('visibilitychange', recoverVisibleRun);
    recoveryTimer = window.setInterval(recoverRun, 5_000);

    void pollRun(activeRunID).then((initial) => {
      if (
        stopped ||
        (initial && isTerminalStatus(initial.run.status)) ||
        activeRun.current !== activeRunID
      )
        return;
      if (initial) {
        events = initial.events;
        lastSequence = events.at(-1)?.sequence || 0;
      }
      void connect();
    });

    return () => {
      stopped = true;
      controller.abort();
      window.removeEventListener('online', recoverRun);
      document.removeEventListener('visibilitychange', recoverVisibleRun);
      window.clearTimeout(retryTimer);
      window.clearInterval(recoveryTimer);
      window.clearTimeout(renderTimer);
      if (renderFrame) window.cancelAnimationFrame(renderFrame);
    };
  }, [activeRunID, pollRun]);

  const openChatSession = useCallback(
    async (sessionID: string, shared?: ResourceShare) => {
      setMessageFocus(null);
      if (
        sessionID === chatSession &&
        (shared?.id || '') === steer.collaboration()
      ) {
        setView('chat');
        return true;
      }

      steer.setCollaboration(shared?.id || '');
      setCollaborationShare(shared || null);
      setCollaborationAgent(undefined);
      setCollaborationProject(undefined);
      setCollaborationSession(undefined);
      activeRun.current = '';
      activeTask.current = '';
      pollingRun.current = '';
      setActiveRunID('');
      setChatWorking(false);
      const loadSequence = ++sessionLoadSequence.current;
      const sessionSummary = chatSessions.find(
        (session) => session.id === sessionID,
      );
      setChatSession(sessionID);
      setMessages([]);
      setChatSessionLoading(true);
      setView('chat');
      if (sessionSummary) {
        setChatAgent(sessionSummary.agentId);
        setChatProject(sessionSummary.projectId || 'none');
        const group = sessionSummary.projectId || noProjectSessionGroup;
        setExpandedSessionGroups((current) => {
          if (current.has(group)) return current;
          const next = new Set(current);
          next.add(group);
          return next;
        });
      }
      try {
        const data = await steer.session(sessionID);
        if (loadSequence !== sessionLoadSequence.current || !mounted.current)
          return;
        chatImages.forEach((image) => URL.revokeObjectURL(image.url));
        setChatImages([]);
        if (!shared) {
          setChatSessions((current) =>
            current.some((session) => session.id === data.session.id)
              ? current.map((session) =>
                  session.id === data.session.id ? data.session : session,
                )
              : [...current, data.session],
          );
        }
        if (shared) {
          setCollaborationSession(data.session);
          setCollaborationProject(data.project);
          if (data.agent) setCollaborationAgent(agentFromRecord(data.agent));
        }
        setChatAgent(data.session.agentId);
        setChatProject(data.session.projectId || 'none');
        const group = data.session.projectId || noProjectSessionGroup;
        setExpandedSessionGroups((current) => {
          if (current.has(group)) return current;
          const next = new Set(current);
          next.add(group);
          return next;
        });
        if (data.project && !shared) {
          setProjectList((current) =>
            current.some((project) => project.id === data.project?.id)
              ? current
              : [...current, data.project!],
          );
        }
        const sessionMessages: ChatMessage[] = data.messages.map((message) => ({
          id: message.id,
          context: message.context,
          role: message.role,
          text:
            message.role === 'agent' && !isTerminalStatus(message.status)
              ? ''
              : message.content,
          status: message.status,
          runId: message.relayRunId || undefined,
          error: projectRunError(
            message.error || undefined,
            data.project,
            data.session.executionRuntimeId,
          ),
          createdAt: message.createdAt,
          updatedAt: message.updatedAt,
          attachments: message.attachments?.map((attachment) => ({
            ...attachment,
            url: steer.messageAttachmentURL(message.id, attachment.id),
          })),
        }));
        setMessages(sessionMessages);
        setChatSessionLoading(false);
        const storedRunningMessage = sessionMessages.findLast(
          (message) =>
            message.role === 'agent' &&
            Boolean(message.runId) &&
            (!message.context?.delegationSessionId ||
              message.context.delegationSessionId === sessionID) &&
            !isTerminalStatus(message.status),
        );
        if (storedRunningMessage?.runId) {
          activeRun.current = storedRunningMessage.runId;
          activeRunContext.current = {
            project: data.project,
            executionRuntimeID: data.session.executionRuntimeId,
          };
          setActiveRunID(storedRunningMessage.runId);
          setChatWorking(true);
        }
        const enrichedMessages = await Promise.all(
          sessionMessages.map(async (message) => {
            if (message.role !== 'agent' || !message.runId) return message;
            const result = await steer.run(message.runId).catch(() => null);
            if (!result) return message;
            const terminal = isTerminalStatus(result.run.status);
            return {
              ...message,
              text: terminal ? result.content : '',
              status: result.run.status,
              error: projectRunError(
                result.error || undefined,
                data.project,
                data.session.executionRuntimeId,
              ),
              activity: runActivity(result.events),
              changes: runFileChanges(result.events),
              activityLog: runActivityLog(
                result.events,
                result.run.status === 'succeeded',
              ),
              createdAt: result.run.started_at || message.createdAt,
              updatedAt: result.run.completed_at || message.updatedAt,
            };
          }),
        );
        if (loadSequence !== sessionLoadSequence.current || !mounted.current)
          return;
        const enrichedByID = new Map(
          enrichedMessages.map((message) => [message.id, message]),
        );
        setMessages((current) =>
          current.map((message) => {
            const enriched = enrichedByID.get(message.id);
            if (!enriched) return message;
            if (
              isTerminalStatus(message.status) &&
              !isTerminalStatus(enriched.status)
            )
              return message;
            return enriched;
          }),
        );
        const runningMessage = enrichedMessages.findLast(
          (message) =>
            message.role === 'agent' &&
            Boolean(message.runId) &&
            (!message.context?.delegationSessionId ||
              message.context.delegationSessionId === sessionID) &&
            !isTerminalStatus(message.status),
        );
        if (runningMessage?.runId) {
          activeRun.current = runningMessage.runId;
          activeRunContext.current = {
            project: data.project,
            executionRuntimeID: data.session.executionRuntimeId,
          };
          setActiveRunID(runningMessage.runId);
          setChatWorking(true);
        }
        return true;
      } catch (error) {
        if (loadSequence !== sessionLoadSequence.current || !mounted.current)
          return;
        setChatSessionLoading(false);
        setNotice(
          error instanceof Error
            ? error.message
            : 'Could not open this conversation.',
        );
        return false;
      }
    },
    [chatImages, chatSession, chatSessions],
  );

  useEffect(() => {
    if (
      !chatSession ||
      view !== 'chat' ||
      (!collaborationShare &&
        !resourceShares.some(
          (share) =>
            share.kind === 'session' &&
            share.owned &&
            share.resourceId === chatSession,
        ))
    )
      return;
    let cancelled = false;
    const poll = async () => {
      if (pendingChatSubmission.current) return;
      try {
        const data = await steer.session(chatSession);
        if (cancelled || pendingChatSubmission.current) return;
        if (data.sharingPermission)
          setCollaborationShare((current) =>
            current && current.permission !== data.sharingPermission
              ? { ...current, permission: data.sharingPermission! }
              : current,
          );
        setMessages((current) => {
          const previous = new Map(
            current.map((message) => [message.id, message]),
          );
          return data.messages.map((message) => {
            const known = previous.get(message.id);
            return {
              ...known,
              id: message.id,
              role: message.role,
              text: isTerminalStatus(message.status)
                ? message.content
                : known?.text || '',
              status: message.status,
              runId: message.relayRunId || undefined,
              context: message.context,
              createdAt: message.createdAt,
              updatedAt: message.updatedAt,
              attachments: message.attachments?.map((attachment) => ({
                ...attachment,
                url: steer.messageAttachmentURL(message.id, attachment.id),
              })),
            };
          });
        });
        const running = data.messages.findLast(
          (message) =>
            message.role === 'agent' &&
            message.relayRunId &&
            !isTerminalStatus(message.status),
        );
        if (running?.relayRunId && activeRun.current !== running.relayRunId) {
          activeRun.current = running.relayRunId;
          activeTask.current = '';
          setActiveRunID(running.relayRunId);
          setChatWorking(true);
        }
      } catch (error) {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : String(error));
          setCollaborationShare((current) =>
            current ? { ...current, permission: 'view' } : current,
          );
        }
      }
    };
    const timer = window.setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [collaborationShare, chatSession, view, resourceShares]);

  useEffect(() => {
    if (!loaded) return;
    const readRoute = () => {
      skipRouteWrite.current = true;
      const [section, id] = window.location.hash.slice(1).split('/');
      if (section === 'shared' && id) {
        const share = resourceShares.find(
          (item) => item.id === id && item.kind === 'session',
        );
        if (share) void openChatSession(share.resourceId, share);
        return;
      }
      skipRouteWrite.current = true;
      if (section === 'runtimes') {
        setView('agents');
        setAgentTab('runtimes');
      } else if (section === 'agents') {
        setView('agents');
        setAgentTab('agents');
      } else if (section === 'artifacts') {
        setView('artifacts');
        if (id) {
          const index = artifactList.findIndex((item) => item.id === id);
          setSelectedArtifact(index < 0 ? 0 : index);
        }
      } else if (
        section === 'assets' ||
        section === 'notes' ||
        section === 'settings'
      ) {
        setView(section);
      } else {
        setView('chat');
        if (section === 'chat' && id) void openChatSession(id);
      }
    };
    if (
      !routeReady.current ||
      (window.location.hash.startsWith('#shared/') && !collaborationShare)
    ) {
      readRoute();
      routeReady.current = true;
    }
    window.addEventListener('hashchange', readRoute);
    return () => window.removeEventListener('hashchange', readRoute);
  }, [
    artifactList,
    loaded,
    openChatSession,
    resourceShares,
    collaborationShare,
  ]);

  useEffect(() => {
    if (!routeReady.current) return;
    if (skipRouteWrite.current) {
      skipRouteWrite.current = false;
      return;
    }
    const section =
      view === 'agents' && agentTab === 'runtimes' ? 'runtimes' : view;
    const id =
      view === 'chat'
        ? chatSession
        : view === 'artifacts'
          ? artifactList[selectedArtifact]?.id
          : '';
    const hash =
      view === 'chat' && collaborationShare
        ? `#shared/${collaborationShare.id}`
        : `#${section}${id ? `/${id}` : ''}`;
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }, [
    agentTab,
    artifactList,
    chatSession,
    selectedArtifact,
    view,
    collaborationShare,
  ]);

  const loadProjectGitStatus = (projectID: string) => {
    if (
      projectID === 'none' ||
      requestedProjectGitStatuses.current.has(projectID)
    )
      return;
    const requestedWorkspace = steer.workspace();
    projectGitStatusController.current?.abort();
    const controller = new AbortController();
    projectGitStatusController.current = controller;
    requestedProjectGitStatuses.current.add(projectID);
    void steer
      .projectGitStatus(projectID, controller.signal)
      .then((result) => {
        if (
          !mounted.current ||
          gitStatusWorkspace.current !== requestedWorkspace ||
          steer.workspace() !== requestedWorkspace
        )
          return;
        if (result.git)
          setProjectGitStatuses((current) => ({
            ...current,
            [projectID]: result.git!,
          }));
      })
      .catch(() => {
        if (
          gitStatusWorkspace.current === requestedWorkspace &&
          steer.workspace() === requestedWorkspace
        )
          requestedProjectGitStatuses.current.delete(projectID);
      })
      .finally(() => {
        if (projectGitStatusController.current === controller)
          projectGitStatusController.current = null;
      });
  };

  const openCollaborativeSession = async (share: ResourceShare) => {
    if (share.status === 'pending') {
      share = {
        ...share,
        ...(await steer.acceptResourceShare(share.id)),
        owned: share.owned,
      };
    }
    await refreshSharing();
    await openChatSession(share.resourceId, { ...share, status: 'accepted' });
  };

  const startNewChat = (projectID = 'none', authorizedAgentID?: string) => {
    setMessageFocus(null);
    const authorizedProject = projectList.find(
      (project) => project.id === projectID && project.sharedAgentGrantId,
    );
    const authorizedAgent =
      authorizedAgentID ||
      resourceShares.find(
        (share) =>
          (
            authorizedProject?.sharedAgentGrantIds || [
              authorizedProject?.sharedAgentGrantId,
            ]
          ).includes(share.id) && share.status === 'accepted',
      )?.resourceId;
    steer.setCollaboration('');
    setCollaborationShare(null);
    if (authorizedAgent) setChatAgent(authorizedAgent);
    else if (currentAgent?.shared || collaborationShare)
      setChatAgent(agentList.find((agent) => !agent.shared)?.id || '');
    sessionLoadSequence.current += 1;
    activeRun.current = '';
    activeTask.current = '';
    pollingRun.current = '';
    activeRunContext.current = { executionRuntimeID: null };
    setActiveRunID('');
    setChatWorking(false);
    setChatSessionLoading(false);
    setMessages([]);
    setChatSession('');
    setChatInput('');
    chatImages.forEach((image) => URL.revokeObjectURL(image.url));
    setChatImages([]);
    setChatProject(projectID);
    setView('chat');
  };

  const openProject = (projectID: string) => {
    const project = projectList.find((project) => project.id === projectID);
    if (
      project?.sharedAgentAccess &&
      project.sharedAgentAccess !== 'accepted'
    ) {
      const latest = chatSessions
        .filter((session) => session.projectId === projectID)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      if (latest) void openChatSession(latest.id);
      return;
    }
    loadProjectGitStatus(projectID);
    startNewChat(projectID);
  };

  const selectChatProject = (projectID: string) => {
    loadProjectGitStatus(projectID);
    setChatProject(projectID);
  };

  const send = async (override?: string, options?: TaskMessageOptions) => {
    const text = (override ?? chatInputRef.current).trim();
    const images = override ? [] : chatImages;
    if (
      (!text && images.length === 0) ||
      chatWorking ||
      sharedAgentRevoked ||
      !currentAgent ||
      sharedReadOnly
    )
      return false;
    pendingChatSubmission.current = true;
    const optimisticID = `local-${Date.now()}`;
    const loadSequence = sessionLoadSequence.current;
    const requestedWorkspace = steer.workspace();
    const isCurrent = () =>
      mounted.current &&
      sessionLoadSequence.current === loadSequence &&
      steer.workspace() === requestedWorkspace;
    const startedAt = new Date().toISOString();
    setMessages((current) => [
      ...current,
      {
        id: optimisticID,
        role: 'user',
        text,
        createdAt: startedAt,
        attachments: images.map((image) => ({
          id: image.id,
          name: image.file.name,
          contentType: image.file.type,
          size: image.file.size,
          url: image.url,
        })),
      },
    ]);
    setChatInput('');
    setChatWorking(true);
    try {
      let conversationId = chatSession;
      let createdSharedSession: ChatSessionRecord | undefined;
      if (!conversationId && sharedAgentProject?.sharedAgentGrantId) {
        if (!sharedAgentGrant)
          throw new Error(t('Authorized project unavailable.'));
        createdSharedSession = await steer.sharedAgentConversation(
          sharedAgentGrant.id,
        );
        conversationId = createdSharedSession.id;
        setChatSession(conversationId);
        setChatSessions((current) => [
          createdSharedSession!,
          ...current.filter((session) => session.id !== conversationId),
        ]);
      }
      const result = await steer.createTask({
        prompt: text,
        ...options,
        agentId: currentAgent.id,
        ...(chatProject !== 'none' ? { projectId: chatProject } : {}),
        ...(conversationId ? { conversationId } : {}),
        images: images.map((image) => image.file),
      });
      if (!isCurrent()) return false;
      const persistedAttachments = result.userMessage.attachments?.map(
        (attachment) => ({
          ...attachment,
          url: steer.messageAttachmentURL(result.userMessage.id, attachment.id),
        }),
      );
      if (persistedAttachments?.length === images.length)
        images.forEach((image) => URL.revokeObjectURL(image.url));
      setChatImages([]);
      setChatSession(result.sessionId);
      setExpandedSessionGroups((current) => {
        const group =
          chatProject === 'none' ? noProjectSessionGroup : chatProject;
        if (current.has(group)) return current;
        const next = new Set(current);
        next.add(group);
        return next;
      });
      if (!collaborationShare)
        setChatSessions((current) => {
          const now = new Date().toISOString();
          const session: ChatSessionRecord = {
            ...createdSharedSession,
            id: result.sessionId,
            title: (text || images[0]?.file.name || 'Image').slice(0, 72),
            agentId: currentAgent.id,
            projectId: chatProject === 'none' ? null : chatProject,
            executionRuntimeId:
              currentAgent.runtimeId ||
              runtimeNodes
                .find((node) => node.id === selectedProject?.nodeId)
                ?.runtimes?.find(
                  (runtime) =>
                    runtime.provider === currentAgent.runtimeProvider,
                )?.id ||
              null,
            workspaceKey: null,
            createdAt: now,
            updatedAt: now,
            lastMessageAt: now,
          };
          const existing = current.find((item) => item.id === session.id);
          return [
            existing
              ? {
                  ...existing,
                  title:
                    existing.sharedAgentGrantId && !messages.length
                      ? session.title
                      : existing.title,
                  updatedAt: now,
                  lastMessageAt: now,
                  agentId: currentAgent.id,
                  sharedAgentGrantId:
                    sharedAgentGrant?.id || existing.sharedAgentGrantId,
                  sharedAgentAccess: sharedAgentGrant
                    ? 'accepted'
                    : existing.sharedAgentAccess,
                  executionRuntimeId:
                    currentAgent.runtimeId || existing.executionRuntimeId,
                }
              : session,
            ...current.filter((item) => item.id !== session.id),
          ];
        });
      if (result.delegationSession) {
        const child = result.delegationSession;
        setChatSessions((current) => [
          child,
          ...current.filter((item) => item.id !== child.id),
        ]);
        setMessages((current) => [
          ...current.map((item) =>
            item.id === optimisticID
              ? {
                  ...item,
                  id: result.userMessage.id,
                  context: result.userMessage.context,
                  attachments: persistedAttachments || item.attachments,
                }
              : item,
          ),
          {
            id: result.assistantMessage.id,
            context: result.assistantMessage.context,
            role: 'agent',
            text: '',
            status: result.status,
            runId: result.runId,
            createdAt: startedAt,
          },
        ]);
        setChatWorking(false);
        return true;
      }
      activeRun.current = result.runId;
      activeTask.current = result.taskId;
      activeRunContext.current = {
        project: selectedProject,
        executionRuntimeID: composerExecutionRuntimeId,
      };
      setActiveRunID(result.runId);
      setMessages((current) => [
        ...current.map((item) =>
          item.id === optimisticID
            ? {
                ...item,
                id: result.userMessage.id,
                context: result.userMessage.context,
                attachments: persistedAttachments || item.attachments,
              }
            : item,
        ),
        {
          id: result.assistantMessage.id,
          context: result.assistantMessage.context,
          role: 'agent',
          text: '',
          status: result.status,
          runId: result.runId,
          createdAt: startedAt,
          activity: 'Starting Agent',
          activityLog: [{ id: 'starting-agent', label: 'Starting Agent' }],
        },
      ]);
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      setMessages((current) =>
        current.filter((message) => message.id !== optimisticID),
      );
      setChatInput(text);
      setNotice(
        error instanceof Error ? error.message : 'Could not submit the run.',
      );
      setChatWorking(false);
      return false;
    } finally {
      pendingChatSubmission.current = false;
    }
  };

  const stop = async () => {
    if (!activeRun.current) return;
    try {
      if (activeTask.current) await steer.cancelTask(activeTask.current);
      else await steer.cancelRun(activeRun.current);
      setNotice('Stopping the current run…');
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not stop the run.',
      );
    }
  };

  const saveProject = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creatingProject) return;
    const data = new FormData(event.currentTarget);
    const name = formValue(data, 'name');
    const workspaceKind = formValue(data, 'projectType') || 'local';
    const workspaceSource =
      workspaceKind === 'git'
        ? formValue(data, 'repositoryUrl')
        : formValue(data, 'path');
    const nodeId = formValue(data, 'nodeId');
    if (!name || !workspaceSource) {
      setFormError(
        workspaceKind === 'git'
          ? 'Enter a project name and Git repository URL.'
          : 'Enter a project name and directory path.',
      );
      return;
    }
    if (workspaceKind === 'local' && !nodeId) {
      setFormError('Choose the machine where this directory exists.');
      return;
    }
    setCreatingProject(true);
    setFormError('');
    try {
      const input = {
        name,
        workspaceKind,
        workspaceSource,
        workspaceRef: formValue(data, 'ref') || null,
        workspaceSubdir: formValue(data, 'subdir') || null,
        executionMode:
          workspaceKind === 'git' ? 'session_worktree' : 'in_place',
        runtimeId: null,
        nodeId: workspaceKind === 'local' ? nodeId : null,
      } as const;
      const project = editingProject
        ? await steer.updateProject(editingProject.id, input)
        : await steer.createProject(input);
      setProjectList((current) =>
        editingProject
          ? current.map((item) => (item.id === project.id ? project : item))
          : [project, ...current],
      );
      requestedProjectGitStatuses.current.delete(project.id);
      setProjectGitStatuses((current) => {
        if (!(project.id in current)) return current;
        const next = { ...current };
        delete next[project.id];
        return next;
      });
      if (!editingProject) startNewChat(project.id);
      setProjectDialog(false);
      setEditingProject(null);
      setNotice(
        editingProject
          ? 'Project updated.'
          : workspaceKind === 'git'
            ? 'Git project added. Each conversation gets an isolated worktree.'
            : 'Directory project added on the selected machine.',
      );
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Could not add project.',
      );
    } finally {
      setCreatingProject(false);
    }
  };

  const deleteSelectedProject = async () => {
    if (!deletingProject || deleting) return;
    setDeleting(true);
    try {
      const deleted = await steer.deleteProject(deletingProject.id);
      setProjectList((current) =>
        current.map((item) => (item.id === deleted.id ? deleted : item)),
      );
      requestedProjectGitStatuses.current.delete(deleted.id);
      setProjectGitStatuses((current) => {
        if (!(deleted.id in current)) return current;
        const next = { ...current };
        delete next[deleted.id];
        return next;
      });
      if (!chatSession && chatProject === deleted.id) {
        setChatProject('none');
      }
      setDeletingProject(null);
      setNotice(
        'Project deleted. Existing conversations keep their execution context.',
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not delete Project.',
      );
    } finally {
      setDeleting(false);
    }
  };

  const updateSessionNavigation = async (
    session: ChatSessionRecord,
    update: { title?: string; pinned?: boolean; archived?: boolean },
  ) => {
    try {
      const updated = await steer.updateSession(session.id, update);
      setChatSessions((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      return true;
    } catch (error) {
      const text =
        error instanceof Error
          ? error.message
          : t('Could not update conversation.');
      setNotice(text);
      setSessionUpdateError(text);
      return false;
    }
  };
  const beginRename = (session: ChatSessionRecord) => {
    setRenamingSession(session);
    setSessionName(sessionDisplayTitle(session));
    setSessionUpdateError('');
  };

  const deleteSelectedSession = async () => {
    if (!deletingSession || deletingConversation) return;
    if (deletingSession.id === chatSession && chatWorking) {
      setDeletingSession(null);
      setNotice('Stop the current run before deleting this conversation.');
      return;
    }
    setDeletingConversation(true);
    try {
      const deleted = await steer.deleteSession(deletingSession.id);
      setChatSessions((current) =>
        current.filter((session) => session.id !== deleted.id),
      );
      if (chatSession === deleted.id) {
        startNewChat(deleted.projectId || 'none');
      }
      setDeletingSession(null);
      setNotice('Conversation deleted.');
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Could not delete conversation.',
      );
    } finally {
      setDeletingConversation(false);
    }
  };

  useEffect(() => {
    if (!agentDialog) return;
    const requestedWorkspace = workspaceID;
    let cancelled = false;
    void steer
      .bootstrap()
      .then((data) => {
        if (
          !cancelled &&
          mounted.current &&
          steer.workspace() === requestedWorkspace
        ) {
          setRuntimeNodes(data.relay.nodes || []);
        }
      })
      .catch(() => {
        if (!cancelled && steer.workspace() === requestedWorkspace)
          setNotice(
            'Could not refresh Runtime models. Close and reopen the Agent editor to retry.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [agentDialog, workspaceID]);

  useEffect(() => {
    if (!authReady || !authUser || !loaded || !workspaceID) return;
    const key = `steer.firstLoginGuide:${authUser?.id || 'local'}`;
    if (gettingStartedWorkspace.current === key) return;
    gettingStartedWorkspace.current = key;
    const firstVisit = !window.localStorage.getItem(key);
    setGettingStarted(firstVisit && chatSessions.length === 0);
  }, [authReady, loaded, workspaceID, authUser, chatSessions.length]);

  const openNewAgent = () => {
    setEditingAgent(null);
    setAgentRuntime(
      automaticChoices[0]?.value || runtimeChoices[0]?.value || '',
    );
    setAgentModel('Runtime default');
    setFormError('');
    setAgentDialog(true);
  };

  const openAgentEditor = (agent: AgentItem) => {
    setEditingAgent(agent);
    setAgentRuntime(
      agent.runtimeId
        ? `${agent.runtimeProvider || 'unknown'}::${agent.runtimeId}`
        : `${agent.runtimeProvider || ''}::`,
    );
    setAgentModel(agent.model || 'Runtime default');
    setFormError('');
    setAgentDialog(true);
  };

  const saveAgent = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createAgentLock.current) return;
    const data = new FormData(event.currentTarget);
    const name = formValue(data, 'name');
    if (!name || !selectedRuntimeChoice || selectedRuntimeChoice.unavailable) {
      setFormError(
        !name
          ? 'Enter an Agent name.'
          : selectedRuntimeChoice?.unavailable
            ? 'The previously selected Runtime is unavailable. Select an active Runtime.'
            : 'Connect Relay and select a Runtime.',
      );
      return;
    }
    createAgentLock.current = true;
    setCreatingAgent(true);
    setFormError('');
    try {
      const input = {
        name,
        role: formValue(data, 'role') || 'General execution',
        instructions: formValue(data, 'instructions'),
        runtimeProvider: selectedRuntimeChoice.provider,
        runtimeId: selectedRuntimeChoice.runtimeId || null,
        model: agentModel === 'Runtime default' ? null : agentModel,
      };
      const saved = editingAgent
        ? await steer.updateAgent(editingAgent.id, input)
        : await steer.createAgent(input);
      const selectedSkillIDs = data.getAll('skills').map(String);
      await steer.setAgentSkills(saved.id, selectedSkillIDs);
      setAgentSkillAssignments((current) => ({
        ...current,
        [saved.id]: selectedSkillIDs,
      }));
      setAgentList((current) =>
        editingAgent
          ? current.map((agent) =>
              agent.id === saved.id ? agentFromRecord(saved) : agent,
            )
          : [...current, agentFromRecord(saved)],
      );
      setChatAgent((current) => current || saved.id);
      setAgentDialog(false);
      setEditingAgent(null);
      setNotice(editingAgent ? 'Agent updated.' : 'Agent created.');
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Could not save Agent.',
      );
    } finally {
      createAgentLock.current = false;
      setCreatingAgent(false);
    }
  };

  const deleteSelectedAgent = async () => {
    if (!deletingAgent || deletingAgentBusy) return;
    setDeletingAgentBusy(true);
    try {
      const deleted = await steer.deleteAgent(deletingAgent.id);
      setAgentList((current) =>
        current.filter((agent) => agent.id !== deleted.id),
      );
      setAgentSkillAssignments((current) => {
        const next = { ...current };
        delete next[deleted.id];
        return next;
      });
      if (chatAgent === deleted.id) {
        setChatAgent(
          agentList.find((agent) => agent.id !== deleted.id)?.id || '',
        );
      }
      setDeletingAgent(null);
      setNotice('Agent deleted.');
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not delete Agent.',
      );
    } finally {
      setDeletingAgentBusy(false);
    }
  };

  const discoverRuntimes = async () => {
    const sequence = ++runtimeDiscoverySequence.current;
    const requestedWorkspace = workspaceID;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12_000);
    setRuntimeDiscoveryLoading(true);
    setRuntimeDiscoveryError('');
    try {
      const nodes = await steer.relayNodes(controller.signal);
      if (
        !mounted.current ||
        sequence !== runtimeDiscoverySequence.current ||
        steer.workspace() !== requestedWorkspace
      )
        return;
      setAvailableRuntimeNodes(nodes);
      setSelectedRuntimeIDs((current) =>
        current.filter((id) =>
          nodes.some((node) =>
            node.runtimes?.some((runtime) => runtime.id === id),
          ),
        ),
      );
    } catch (error) {
      if (
        !mounted.current ||
        sequence !== runtimeDiscoverySequence.current ||
        steer.workspace() !== requestedWorkspace
      )
        return;
      setRuntimeDiscoveryError(
        timedOut
          ? t(
              'Relay Node refresh timed out. Check the Steer Server and Relay Server connection.',
            )
          : error instanceof Error
            ? error.message
            : 'Could not refresh Relay.',
      );
    } finally {
      window.clearTimeout(timeout);
      if (mounted.current && sequence === runtimeDiscoverySequence.current)
        setRuntimeDiscoveryLoading(false);
    }
  };

  const setupRuntimeReady = runtimeNodes.some((node) => node.runtimes?.length);
  const setupAgentReady = agentList.some((agent) =>
    runtimeChoices.some(
      (runtime) =>
        runtime.provider === agent.runtimeProvider &&
        (!agent.runtimeId || agent.runtimeId === runtime.runtimeId),
    ),
  );
  const setupProject = projectList.find(
    (project) =>
      !project.deletedAt &&
      agentList.some((agent) =>
        runtimeNodes.some(
          (node) =>
            (project.workspaceKind !== 'local' || node.id === project.nodeId) &&
            node.runtimes?.some(
              (runtime) =>
                runtime.provider === agent.runtimeProvider &&
                (!agent.runtimeId || agent.runtimeId === runtime.id),
            ),
        ),
      ),
  );
  const setupCurrentStep = !setupRuntimeReady
    ? 0
    : !setupAgentReady
      ? 1
      : !setupProject
        ? 2
        : 3;
  useEffect(() => {
    if (
      !loaded ||
      !gettingStarted ||
      runtimeDialog ||
      agentDialog ||
      projectDialog
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      if (setupCurrentStep < 2) {
        setView('agents');
        setAgentTab(setupCurrentStep === 0 ? 'runtimes' : 'agents');
      } else if (setupCurrentStep === 2) {
        setSidebarOpen(true);
      } else if (setupProject) {
        const matching = agentList.find((agent) =>
          runtimeNodes.some(
            (node) =>
              (setupProject.workspaceKind !== 'local' ||
                node.id === setupProject.nodeId) &&
              node.runtimes?.some(
                (runtime) =>
                  runtime.provider === agent.runtimeProvider &&
                  (!agent.runtimeId || runtime.id === agent.runtimeId),
              ),
          ),
        );
        if (matching) setChatAgent(matching.id);
        setChatProject(setupProject.id);
        setView('chat');
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    loaded,
    gettingStarted,
    runtimeDialog,
    agentDialog,
    projectDialog,
    setupCurrentStep,
    setupProject,
    agentList,
    runtimeNodes,
  ]);

  const markGuideShown = useCallback(() => {
    if (authUser)
      window.localStorage.setItem(
        `steer.firstLoginGuide:${authUser.id}`,
        'seen',
      );
  }, [authUser]);

  const leaveGettingStarted = () => {
    window.localStorage.setItem(
      `steer.firstLoginGuide:${authUser?.id || 'local'}`,
      'dismissed',
    );
    setGettingStarted(false);
  };
  const setupStep = (step: number) => {
    if (step === 0) openRuntimeDialog();
    if (step === 1) openNewAgent();
    if (step === 2) {
      setEditingProject(null);
      setFormError('');
      setProjectDialog(true);
    }
    if (step === 3 && setupProject) {
      const agent = agentList.find((agent) =>
        runtimeNodes.some(
          (node) =>
            (setupProject.workspaceKind !== 'local' ||
              node.id === setupProject.nodeId) &&
            node.runtimes?.some(
              (runtime) =>
                runtime.provider === agent.runtimeProvider &&
                (!agent.runtimeId || runtime.id === agent.runtimeId),
            ),
        ),
      );
      if (agent) setChatAgent(agent.id);
      startNewChat(setupProject.id);
      leaveGettingStarted();
      window.requestAnimationFrame(() =>
        document
          .querySelector<HTMLTextAreaElement>('[data-onboarding="chat"]')
          ?.focus(),
      );
    }
  };

  const openRuntimeDialog = () => {
    setRuntimeDialog(true);
    setRelayEnrollmentToken('');
    setRelayEnrollmentNodeToken('');
    setRelayEnrollmentNodeID('');
    void discoverRuntimes();
  };

  const claimSelectedRuntimes = async () => {
    if (!selectedRuntimeIDs.length || runtimeClaiming) return;
    const requestedWorkspace = workspaceID;
    setRuntimeClaiming(true);
    setRuntimeDiscoveryError('');
    try {
      const selectedNode = availableRuntimeNodes.find((node) =>
        node.runtimes?.some((runtime) =>
          selectedRuntimeIDs.includes(runtime.id),
        ),
      );
      if (!selectedNode) {
        throw new Error('Select Runtime instances from one Relay Node.');
      }
      const nodeRuntimeIDs = selectedRuntimeIDs.filter((runtimeID) =>
        selectedNode.runtimes?.some((runtime) => runtime.id === runtimeID),
      );
      const nodes = await steer.bindRelayNode(selectedNode.id, nodeRuntimeIDs);
      if (!mounted.current || steer.workspace() !== requestedWorkspace) return;
      const count = selectedRuntimeIDs.length;
      setRuntimeNodes(nodes);
      if (gettingStarted) setRuntimeDialog(false);
      setSelectedRuntimeIDs([]);
      setNotice(`${count} Runtime${count === 1 ? '' : 's'} added.`);
      await discoverRuntimes();
    } catch (error) {
      if (!mounted.current || steer.workspace() !== requestedWorkspace) return;
      setRuntimeDiscoveryError(
        error instanceof Error ? error.message : 'Could not add Runtimes.',
      );
    } finally {
      if (mounted.current && steer.workspace() === requestedWorkspace)
        setRuntimeClaiming(false);
    }
  };

  const createRelayEnrollment = async () => {
    setRuntimeDiscoveryError('');
    try {
      const enrollment = await steer.createRelayNodeEnrollment();
      setSelectedRuntimeIDs([]);
      setRelayEnrollmentToken(enrollment.token);
      setRelayEnrollmentNodeToken(enrollment.nodeToken);
      setRelayEnrollmentNodeID(enrollment.nodeId);
    } catch (error) {
      setRuntimeDiscoveryError(
        error instanceof Error
          ? error.message
          : 'Could not create an installation token.',
      );
    }
  };

  const deleteSelectedRelayNode = async () => {
    if (!deletingRelayNode || deletingRelayNodeBusy) return;
    setDeletingRelayNodeBusy(true);
    try {
      await steer.deleteRelayNode(deletingRelayNode.id);
      const removedRuntimeIDs = new Set(
        (deletingRelayNode.runtimes || []).map((runtime) => runtime.id),
      );
      setAvailableRuntimeNodes((current) =>
        current.filter((node) => node.id !== deletingRelayNode.id),
      );
      setRuntimeNodes((current) =>
        current.filter((node) => node.id !== deletingRelayNode.id),
      );
      setSelectedRuntimeIDs((current) =>
        current.filter((runtimeID) => !removedRuntimeIDs.has(runtimeID)),
      );
      if (relayEnrollmentNodeID === deletingRelayNode.id) {
        setRelayEnrollmentToken('');
        setRelayEnrollmentNodeToken('');
        setRelayEnrollmentNodeID('');
      }
      setDeletingRelayNode(null);
      setNotice('Offline Relay Node removed.');
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not remove Relay Node.',
      );
    } finally {
      setDeletingRelayNodeBusy(false);
    }
  };

  const submitAuth = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authSubmitting) return;
    setAuthSubmitting(true);
    setAuthError('');
    const values = new FormData(event.currentTarget);
    try {
      const data =
        authMode === 'register'
          ? await steer.register({
              email: formValue(values, 'email'),
              password: formValue(values, 'password'),
              displayName: formValue(values, 'displayName'),
            })
          : await steer.login({
              email: formValue(values, 'email'),
              password: formValue(values, 'password'),
            });
      const workspace = data.workspaces[0];
      setAuthUser(data.user);
      setWorkspaceList(data.workspaces);
      if (workspace) {
        setWorkspaceID(workspace.id);
        window.localStorage.setItem('steer.workspace', workspace.id);
        await hydrateWorkspace(workspace.id);
      }
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : 'Authentication failed.',
      );
    } finally {
      setAuthSubmitting(false);
    }
  };

  const activateWorkspace = async (workspace: WorkspaceRecord) => {
    if (workspace.id === workspaceID) return;
    gettingStartedWorkspace.current = '';
    sessionLoadSequence.current += 1;
    setLoaded(false);
    workspaceHydrationSequence.current += 1;
    setLoadError('');
    setWorkspaceID(workspace.id);
    window.localStorage.setItem('steer.workspace', workspace.id);
    setView('chat');
    setChatSession('');
    setMessages([]);
    activeRun.current = '';
    activeTask.current = '';
    pollingRun.current = '';
    setActiveRunID('');
    setChatWorking(false);
    setChatSessionLoading(false);
    try {
      await hydrateWorkspace(workspace.id);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Could not load workspace.',
      );
    }
  };

  const createWorkspace = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creatingWorkspace) return;
    setCreatingWorkspace(true);
    setFormError('');
    const values = new FormData(event.currentTarget);
    try {
      const workspace = await steer.createWorkspace(formValue(values, 'name'));
      setWorkspaceList((current) => [...current, workspace]);
      setWorkspaceDialog(false);
      await activateWorkspace(workspace);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Could not create workspace.',
      );
    } finally {
      setCreatingWorkspace(false);
    }
  };

  const logout = async () => {
    workspaceHydrationSequence.current += 1;
    sessionLoadSequence.current += 1;
    activeRun.current = '';
    activeTask.current = '';
    pollingRun.current = '';
    setActiveRunID('');
    setChatWorking(false);
    setChatSessionLoading(false);
    await steer.logout().catch(() => undefined);
    steer.setWorkspace('');
    window.localStorage.removeItem('steer.workspace');
    setAuthUser(null);
    setWorkspaceList([]);
    setWorkspaceID('');
    gitStatusWorkspace.current = '';
    projectGitStatusController.current?.abort();
    projectGitStatusController.current = null;
    requestedProjectGitStatuses.current.clear();
    gettingStartedWorkspace.current = '';
    setLoaded(false);
    setLoadError('');
  };

  const toggleSessionGroup = (group: string) => {
    setExpandedSessionGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const toggleSessionList = (group: string) => {
    setExpandedSessionLists((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const conversationRunIDs = new Set(
    messages.map((message) => message.runId).filter(Boolean),
  );
  const conversationArtifacts = artifactList.filter((artifact) =>
    conversationRunIDs.has(artifact.relayRunId),
  );

  if (!authReady) {
    return <div className="ws-auth-loading">{t('Loading Steer…')}</div>;
  }

  if (!authUser) {
    return (
      <AuthScreen
        mode={authMode}
        error={authError || loadError}
        submitting={authSubmitting}
        onMode={(mode) => {
          setAuthMode(mode);
          setAuthError('');
        }}
        onSubmit={submitAuth}
      />
    );
  }

  const currentWorkspace =
    workspaceList.find((item) => item.id === workspaceID) || workspaceList[0];

  return (
    <SidebarProvider
      className="ws"
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}
    >
      <Sidebar collapsible="offcanvas" className="ws-sidebar">
        <SidebarHeader className="ws-sidebar-header">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  className="ws-workspace-switcher"
                  type="button"
                  aria-label={t('Switch workspace')}
                />
              }
            >
              <span className="ws-logo">S</span>
              <span>
                <strong>Steer</strong>
                <small>{currentWorkspace?.name || t('Workspace')}</small>
              </span>
              <ChevronDown
                className="ws-workspace-chevron"
                aria-hidden="true"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="bottom"
              align="start"
              className="ws-workspace-menu"
            >
              {workspaceList.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  onClick={() => void activateWorkspace(workspace)}
                >
                  <span className="ws-workspace-menu-avatar">
                    {workspace.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span>{workspace.name}</span>
                  {workspace.id === workspaceID && <Check aria-hidden="true" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                onClick={() => {
                  setFormError('');
                  setWorkspaceDialog(true);
                }}
              >
                <Plus aria-hidden="true" />
                {t('Create workspace')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button className="ws-search" onClick={() => setSearchOpen(true)}>
            <Search aria-hidden="true" /> {t('Search')} <kbd>⌘ K</kbd>
          </button>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup className="ws-conversation-nav">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    className="ws-new-chat-nav"
                    isActive={view === 'chat' && !chatSession}
                    onClick={() => startNewChat(projectList[0]?.id || 'none')}
                  >
                    <SquarePen aria-hidden="true" />
                    <span>{t('New chat')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="ws-project-navigation">
            <SidebarGroupLabel>{t('Projects')}</SidebarGroupLabel>
            <div className="ws-session-navigation-controls">
              <select
                aria-label={t('Conversation order')}
                value={sessionSort}
                onChange={(event) => {
                  const sort = event.target.value;
                  setSessionSort(sort);
                  localStorage.setItem(
                    `steer.sessionSort.v2:${authUser?.id}:${workspaceID}`,
                    sort,
                  );
                }}
              >
                <option value="message">{t('Latest message')}</option>
                <option value="created">{t('Newest created')}</option>
              </select>
              <button
                type="button"
                aria-pressed={showArchived}
                onClick={() => setShowArchived((v) => !v)}
                title={t('Archived conversations')}
              >
                <Archive size={13} />
                {t(showArchived ? 'Back to active' : 'Archived')}
              </button>
            </div>
            {showArchived && !navigationSessions.length && (
              <p className="ws-session-navigation-empty">
                {t('No archived conversations.')}
              </p>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {projectList
                  .filter(
                    (project) =>
                      !project.deletedAt &&
                      (!project.sharedAgentAccess ||
                        project.sharedAgentAccess === 'accepted' ||
                        chatSessions.some(
                          (session) => session.projectId === project.id,
                        )),
                  )
                  .map((project) => {
                    const projectSessions = navigationSessions.filter(
                      (session) => session.projectId === project.id,
                    );
                    const sessionsExpanded = expandedSessionGroups.has(
                      project.id,
                    );
                    const branch =
                      gitStatusBranch(projectGitStatuses[project.id]) ||
                      configuredProjectBranch(project);
                    return (
                      <SidebarMenuItem
                        key={project.id}
                        className="ws-project-nav-item"
                      >
                        {!!projectSessions.length && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="ws-project-session-toggle"
                            aria-label={`${sessionsExpanded ? 'Collapse' : 'Expand'} conversations for ${project.name}`}
                            aria-expanded={sessionsExpanded}
                            onClick={() => toggleSessionGroup(project.id)}
                          >
                            <ChevronRight aria-hidden="true" />
                          </Button>
                        )}
                        <SidebarMenuButton
                          className={
                            projectSessions.length
                              ? 'ws-project-nav-button has-sessions'
                              : 'ws-project-nav-button'
                          }
                          isActive={
                            view === 'chat' &&
                            !chatSession &&
                            chatProject === project.id
                          }
                          onClick={() => openProject(project.id)}
                          title={
                            project.sharedAgentGrantId
                              ? `${t('Shared project')} · ${project.workspaceSource}`
                              : project.workspaceSource
                          }
                        >
                          {project.sharedAgentGrantId ? (
                            <Users aria-label={t('Shared project')} />
                          ) : (
                            <Folder aria-hidden="true" />
                          )}
                          <span className="ws-project-name">
                            {project.name}
                          </span>
                          {project.sharedAgentAccess &&
                          project.sharedAgentAccess !== 'accepted' ? (
                            <span className="ws-shared-agent-revoked">
                              {t('Access revoked')}
                            </span>
                          ) : (
                            <GitBranchLabel branch={branch} />
                          )}
                        </SidebarMenuButton>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <SidebarMenuAction
                                showOnHover
                                aria-label={`Project actions for ${project.name}`}
                              />
                            }
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            side="right"
                            align="start"
                            sideOffset={-10}
                            alignOffset={10}
                            className="w-44 min-w-44 rounded-xl border border-[#e5e5e7] bg-white p-1.5 text-[#202124] shadow-[0_12px_32px_rgba(24,24,27,0.14),0_2px_8px_rgba(24,24,27,0.08)] ring-0"
                          >
                            {!project.sharedAgentGrantId && (
                              <DropdownMenuItem
                                className="h-9 gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 font-medium transition-colors hover:bg-[#f1f1f3]"
                                onClick={() => {
                                  setFormError('');
                                  setEditingProject(project);
                                  setProjectDialog(true);
                                }}
                              >
                                <Pencil aria-hidden="true" />
                                {t('Edit project')}
                              </DropdownMenuItem>
                            )}

                            <DropdownMenuItem
                              className="h-9 gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 font-medium transition-colors hover:bg-[#f1f1f3]"
                              onClick={() => {
                                void navigator.clipboard.writeText(project.id);
                                setNotice(t('Project ID copied.'));
                              }}
                            >
                              <Copy aria-hidden="true" />
                              {t('Copy Project ID')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              className="h-9 gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 font-medium transition-colors hover:bg-[#fff0f1] hover:text-[#b3434d]"
                              onClick={() => setDeletingProject(project)}
                            >
                              <Trash2 aria-hidden="true" />
                              {t('Delete project')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {!!projectSessions.length && sessionsExpanded && (
                          <SessionNavigationList
                            shares={resourceShares}
                            sessions={projectSessions}
                            activeSessionID={view === 'chat' ? chatSession : ''}
                            expanded={expandedSessionLists.has(project.id)}
                            onToggleExpanded={() =>
                              toggleSessionList(project.id)
                            }
                            onOpen={(session) =>
                              void openChatSession(session.id)
                            }
                            onDelete={setDeletingSession}
                            onUpdate={(session, update) =>
                              void updateSessionNavigation(session, update)
                            }
                            onRename={beginRename}
                          />
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                {!!unassignedSessions.length && (
                  <SidebarMenuItem className="ws-unassigned-project">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ws-project-session-toggle"
                      aria-label={`${expandedSessionGroups.has(noProjectSessionGroup) ? 'Collapse' : 'Expand'} conversations without a project`}
                      aria-expanded={expandedSessionGroups.has(
                        noProjectSessionGroup,
                      )}
                      onClick={() => toggleSessionGroup(noProjectSessionGroup)}
                    >
                      <ChevronRight aria-hidden="true" />
                    </Button>
                    <div className="ws-unassigned-project-label">
                      <Folder aria-hidden="true" />
                      <span>{t('No project')}</span>
                    </div>
                    {expandedSessionGroups.has(noProjectSessionGroup) && (
                      <SessionNavigationList
                        shares={resourceShares}
                        sessions={unassignedSessions}
                        activeSessionID={view === 'chat' ? chatSession : ''}
                        expanded={expandedSessionLists.has(
                          noProjectSessionGroup,
                        )}
                        onToggleExpanded={() =>
                          toggleSessionList(noProjectSessionGroup)
                        }
                        onOpen={(session) => void openChatSession(session.id)}
                        onDelete={setDeletingSession}
                        onUpdate={(session, update) =>
                          void updateSessionNavigation(session, update)
                        }
                        onRename={beginRename}
                      />
                    )}
                  </SidebarMenuItem>
                )}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    data-onboarding="project"
                    onClick={() => {
                      setFormError('');
                      setEditingProject(null);
                      setProjectDialog(true);
                    }}
                  >
                    <Plus aria-hidden="true" />
                    <span>{t('Add project')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="ws-collaborative-project-navigation">
            <SidebarGroupLabel>{t('Collaborative projects')}</SidebarGroupLabel>
            <SidebarGroupContent>
              {sharingError ? (
                <div className="ws-collaborative-project-state" role="alert">
                  <span>{t('Unable to load collaborative projects.')}</span>
                  <button type="button" onClick={() => void refreshSharing()}>
                    {t('Try again')}
                  </button>
                </div>
              ) : sharingLoading &&
                !resourceShares.some(
                  (share) => share.kind === 'session' && !share.owned,
                ) ? (
                <output className="ws-collaborative-project-state">
                  {t('Loading…')}
                </output>
              ) : (
                <CollaborationTree
                  compact
                  shares={resourceShares}
                  activeId={
                    view === 'chat' ? collaborationShare?.id : undefined
                  }
                  onOpen={openCollaborativeSession}
                />
              )}
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>{t('Workspace')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'assets'}
                    onClick={() => setView('assets')}
                  >
                    <Library aria-hidden="true" />
                    <span>{t('Assets')}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>
                    {skillList.length + documentList.length}
                  </SidebarMenuBadge>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'notes'}
                    onClick={() => setView('notes')}
                  >
                    <NotebookPen aria-hidden="true" />
                    <span>{t('Footprints')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'artifacts'}
                    onClick={() => setView('artifacts')}
                  >
                    <FileText aria-hidden="true" />
                    <span>{t('Artifacts')}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{artifactList.length}</SidebarMenuBadge>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>{t('System')}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'settings'}
                    onClick={() => setView('settings')}
                  >
                    <Settings aria-hidden="true" />
                    <span>{t('Settings')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'agents' && agentTab !== 'runtimes'}
                    onClick={() => {
                      setAgentTab('agents');
                      setView('agents');
                    }}
                  >
                    <Bot aria-hidden="true" />
                    <span>{t('Agents')}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{agentList.length}</SidebarMenuBadge>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'agents' && agentTab === 'runtimes'}
                    onClick={() => {
                      setAgentTab('runtimes');
                      setView('agents');
                    }}
                  >
                    <Server aria-hidden="true" />
                    <span>{t('Runtimes')}</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{runtimeRows.length}</SidebarMenuBadge>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="ws-sidebar-footer">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  className="ws-account-menu"
                  type="button"
                  aria-label={t('Account menu')}
                />
              }
            >
              <span className="ws-avatar">
                {authUser.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span>
                <strong>{authUser.displayName}</strong>
                <small>{authUser.email}</small>
              </span>
              <ChevronDown aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="start"
              className="ws-account-dropdown w-56"
            >
              <DropdownMenuItem onClick={() => void logout()}>
                <LogOut aria-hidden="true" />
                {t('Sign out')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
        <hr
          className="ws-sidebar-resize-handle"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          onPointerDown={startSidebarResize}
        />
      </Sidebar>
      <SidebarInset className="ws-main">
        {view !== 'chat' && (
          <header className="ws-topbar">
            <SidebarTrigger aria-label="Toggle sidebar" />
            <span>
              {view === 'artifacts'
                ? t('Artifacts')
                : view === 'assets'
                  ? t('Assets')
                  : view === 'notes'
                    ? t('Footprints')
                    : view === 'settings'
                      ? t('Settings')
                      : agentTab !== 'runtimes'
                        ? t('Agents')
                        : t('Runtimes')}
            </span>
          </header>
        )}
        {!loaded ? (
          <div className="ws-page">
            {loadError ? (
              <div role="alert" className="ws-load-error">
                <AlertCircle />
                <h1>{t('Workspace unavailable')}</h1>
                <p>{loadError}</p>
                <Button onClick={() => window.location.reload()}>
                  {t('Try again')}
                </Button>
              </div>
            ) : (
              <output className="ws-content-state">
                {t('Loading workspace…')}
              </output>
            )}
          </div>
        ) : view === 'chat' ? (
          <WorkspaceChatView
            key={chatSession || 'new-chat'}
            sessionId={chatSession}
            messageFocus={messageFocus}
            agents={
              sharedAgentProject && sharedProjectAgents.length
                ? sharedProjectAgents
                : sharedExecutionLocked
                  ? currentAgent
                    ? [currentAgent]
                    : []
                  : agentList.filter((agent) => !agent.shared)
            }
            agent={currentAgent}
            showHumanAuthors={Boolean(
              collaborationShare ||
              resourceShares.some(
                (share) =>
                  share.owned &&
                  share.kind === 'session' &&
                  share.resourceId === chatSession,
              ),
            )}
            readOnly={sharedReadOnly || sharedAgentRevoked}
            readOnlyReason={
              sharedAgentRevoked
                ? 'Agent access has been revoked. You can still view this conversation.'
                : undefined
            }
            executionLocked={sharedExecutionLocked}
            agentSelectionLocked={Boolean(collaborationShare)}
            sharingLabel={
              sharedAgentRevoked
                ? t('Access revoked')
                : collaborationShare
                  ? `${collaborationShare.ownerName} · ${t(sharedReadOnly ? 'View only' : 'Can collaborate')}`
                  : sharedAgentGrant
                    ? `${t('Provided by')} ${sharedAgentGrant.ownerName} · ${t('Private conversation')}`
                    : undefined
            }
            collaborationMembers={resourceShares.filter(
              (share) =>
                share.owned &&
                share.kind === 'session' &&
                share.resourceId === chatSession,
            )}
            sharingUser={authUser}
            publicShareAllowed={!collaborationShare}
            onManageSharing={() => {
              void refreshSharing();
              if (collaborationShare) setAccessShare(collaborationShare);
              else if (chatSession)
                setSharingTarget({
                  kind: 'session',
                  id: chatSession,
                  name: activeChatSession?.title || t('Conversation'),
                  context: selectedProject?.name,
                  viewOnly: Boolean(activeChatSession?.sharedAgentGrantId),
                });
            }}
            projectRuntimeChoices={
              !sharedExecutionLocked &&
              (selectedProject?.workspaceKind === 'local' ||
                composerExecutionRuntimeId)
                ? runtimeChoices.filter((runtime) =>
                    runtimeNodes.some(
                      (node) =>
                        node.id ===
                          (selectedProject?.workspaceKind === 'local'
                            ? selectedProject.nodeId
                            : runtimeNodes.find((candidate) =>
                                candidate.runtimes?.some(
                                  (item) =>
                                    item.id === composerExecutionRuntimeId,
                                ),
                              )?.id) &&
                        node.runtimes?.some(
                          (item) => item.id === runtime.runtimeId,
                        ),
                    ),
                  )
                : undefined
            }
            projects={
              collaborationShare
                ? collaborationProject
                  ? [collaborationProject]
                  : []
                : projectList
            }
            project={chatProject}
            artifacts={conversationArtifacts}
            messages={messages}
            sessionTitle={activeChatSession?.title}
            parentConversationId={activeChatSession?.parentConversationId}
            runtimeLabel={
              collaborationShare?.runtimeLabel ||
              sharedAgentGrant?.runtimeLabel ||
              runtimeChoices.find(
                (runtime) =>
                  runtime.runtimeId ===
                    (composerExecutionRuntimeId || currentAgent?.runtimeId) &&
                  runtime.provider === currentAgent?.runtimeProvider,
              )?.label ||
              (currentAgent?.runtimeId
                ? t('Runtime unavailable')
                : `Automatic / ${t(runtimeProviderName(currentAgent?.runtimeProvider))}`)
            }
            sessionLoading={chatSessionLoading}
            input={chatInput}
            inputRevision={chatInputRevision}
            readDraftInput={readChatInput}
            onDraftInput={updateChatInput}
            images={chatImages}
            working={chatWorking}
            onAgent={setChatAgent}
            onDelegationSession={(id) => {
              if (collaborationShare) {
                setNotice(
                  t('This delegated conversation has not been shared.'),
                );
                return;
              }
              void openChatSession(id);
            }}
            onProject={selectChatProject}
            onAddProject={() => setProjectDialog(true)}
            onInput={setChatInput}
            onImages={(files) => {
              const supported = new Set([
                'image/png',
                'image/jpeg',
                'image/webp',
                'image/gif',
              ]);
              const accepted = files.filter((file) => {
                if (!supported.has(file.type)) {
                  setNotice(`${file.name} must be PNG, JPEG, WebP, or GIF.`);
                  return false;
                }
                if (file.size > 5 * 1024 * 1024) {
                  setNotice(`${file.name} exceeds the 5 MB limit.`);
                  return false;
                }
                return true;
              });
              setChatImages((current) => {
                const slots = Math.max(0, 4 - current.length);
                if (accepted.length > slots)
                  setNotice('You can attach up to 4 images.');
                const remainingBytes =
                  16 * 1024 * 1024 -
                  current.reduce((total, image) => total + image.file.size, 0);
                let selectedBytes = 0;
                const selected = accepted.slice(0, slots).filter((file) => {
                  if (selectedBytes + file.size > remainingBytes) return false;
                  selectedBytes += file.size;
                  return true;
                });
                if (selected.length < Math.min(accepted.length, slots))
                  setNotice('Images can use up to 16 MB in total.');
                return [
                  ...current,
                  ...selected.map((file, index) => ({
                    id: `image-${Date.now()}-${index}`,
                    file,
                    url: URL.createObjectURL(file),
                  })),
                ];
              });
            }}
            onRemoveImage={(id) =>
              setChatImages((current) => {
                const removed = current.find((image) => image.id === id);
                if (removed) URL.revokeObjectURL(removed.url);
                return current.filter((image) => image.id !== id);
              })
            }
            onSend={(options) => send(undefined, options)}
            onRetry={(prompt, options) => void send(prompt, options)}
            onStop={() => void stop()}
            onNotice={setNotice}
            onArtifact={(id) => {
              const index = artifactList.findIndex((item) => item.id === id);
              setSelectedArtifact(index < 0 ? 0 : index);
              setView('artifacts');
            }}
          />
        ) : view === 'artifacts' ? (
          <ArtifactsView
            artifacts={artifactList}
            selected={selectedArtifact}
            onSelect={setSelectedArtifact}
          />
        ) : view === 'assets' ? (
          <AssetsView
            skills={skillList}
            documents={documentList}
            agents={agentList}
            agentSkills={agentSkillAssignments}
            onSkills={setSkillList}
            onDocuments={setDocumentList}
            onAgentSkills={setAgentSkillAssignments}
            onNotice={setNotice}
          />
        ) : view === 'notes' ? (
          <WorkLogView
            key={`${authUser.id}:${workspaceID}`}
            draftKey={`steer.work-log.v1:${authUser.id}:${workspaceID}`}
            sessions={chatSessions}
            projects={projectList}
            onOpenSession={(sessionID) => void openChatSession(sessionID)}
            onNotice={setNotice}
          />
        ) : view === 'settings' ? (
          <SystemSettingsView
            agents={agentList}
            settings={workspaceSettings}
            onSettings={setWorkspaceSettings}
            onNotice={setNotice}
          />
        ) : (
          <AgentsView
            agents={agentList.filter((agent) => !agent.shared)}
            shares={resourceShares}
            sharingError={sharingError}
            onShareAgent={(agent) => {
              void refreshSharing();
              setSharingTarget({
                kind: 'agent',
                id: agent.id,
                name: agent.name,
              });
            }}
            onUseSharedAgent={async (share) => {
              await steer.acceptResourceShare(share.id);
              const data = await steer.bootstrap();
              setAgentList(data.agents.map(agentFromRecord));
              setProjectList(data.projects);
              setChatSessions(data.sessions);
              const project = data.projects.find((project) =>
                (
                  project.sharedAgentGrantIds || [project.sharedAgentGrantId]
                ).includes(share.id),
              );
              if (!project)
                throw new Error(t('Authorized project unavailable.'));
              startNewChat(project.id, share.resourceId);
            }}
            onRefreshSharing={refreshSharing}
            runtimes={runtimeRows}
            relayConnected={relayConnected}
            relayError={relayError}
            tab={agentTab}
            onTab={setAgentTab}
            onCreate={openNewAgent}
            onEdit={openAgentEditor}
            onDelete={setDeletingAgent}
            onAddRuntime={openRuntimeDialog}
            onCapacity={updateRuntimeCapacity}
            onDisconnect={disconnectRuntime}
            onRemoveNode={setDeletingRelayNode}
            onNotice={setNotice}
            onChat={(id) => {
              setChatAgent(id);
              startNewChat(
                projectList.find((project) => project.id === chatProject)
                  ?.sharedAgentGrantId
                  ? 'none'
                  : chatProject,
              );
            }}
          />
        )}
      </SidebarInset>

      <SharedSessionAccessDialog
        key={accessShare?.id || 'no-access'}
        share={accessShare}
        onClose={() => setAccessShare(null)}
        onLeave={async () => {
          if (accessShare) {
            await steer.revokeResourceShare(accessShare.id);
            await refreshSharing();
            startNewChat();
          }
        }}
      />
      <ResourceSharingDialog
        key={`${sharingTarget?.kind}:${sharingTarget?.id}`}
        target={sharingTarget}
        user={authUser}
        shares={resourceShares}
        projects={projectList}
        onClose={() => setSharingTarget(null)}
        onRefresh={refreshSharing}
      />
      <Dialog open={workspaceDialog} onOpenChange={setWorkspaceDialog}>
        <DialogContent className="ws-workspace-dialog">
          <DialogTitle>{t('Create workspace')}</DialogTitle>
          <DialogDescription>
            {t(
              'Projects, conversations, Agents, and Runtimes stay isolated inside this workspace.',
            )}
          </DialogDescription>
          <form onSubmit={createWorkspace}>
            <label>
              {t('Name')}
              <input
                name="name"
                autoComplete="off"
                placeholder="e.g. Acme engineering"
                maxLength={80}
                required
              />
            </label>
            {formError && (
              <p className="ws-form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="ws-form-actions">
              <button type="button" onClick={() => setWorkspaceDialog(false)}>
                {t('Cancel')}
              </button>
              <button type="submit" disabled={creatingWorkspace}>
                {creatingWorkspace ? t('Creating…') : t('Create workspace')}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(renamingSession)}
        onOpenChange={(open) => {
          if (!open && !sessionUpdateBusy) setRenamingSession(null);
        }}
      >
        <DialogContent className="ws-workspace-dialog">
          <DialogTitle>{t('Rename conversation')}</DialogTitle>
          <DialogDescription>
            {t('Use a short name that describes the task.')}
          </DialogDescription>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!renamingSession || sessionUpdateBusy) return;
              setSessionUpdateBusy(true);
              setSessionUpdateError('');
              if (
                await updateSessionNavigation(renamingSession, {
                  title: sessionName.trim(),
                })
              )
                setRenamingSession(null);
              setSessionUpdateBusy(false);
            }}
          >
            <label>
              {t('Name')}
              <input
                value={sessionName}
                onChange={(event) => setSessionName(event.target.value)}
                maxLength={160}
                required
              />
            </label>
            {sessionUpdateError && (
              <p role="alert" className="ws-form-error">
                {sessionUpdateError}
              </p>
            )}
            <div className="ws-form-actions">
              <button
                type="button"
                disabled={sessionUpdateBusy}
                onClick={() => setRenamingSession(null)}
              >
                {t('Cancel')}
              </button>
              <button
                type="submit"
                disabled={sessionUpdateBusy || !sessionName.trim()}
              >
                {t('Save')}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <SessionSearchDialog
        key={workspaceID}
        onSession={async (result) => {
          let shared: ResourceShare | undefined;
          if (result.shareId) {
            shared = (await steer.resourceShares()).find(
              (share) =>
                share.id === result.shareId && share.status === 'accepted',
            );
            if (!shared)
              throw new Error(t('Conversation access is no longer available.'));
          }
          setMessageFocus(null);
          if (!(await openChatSession(result.id, shared)))
            throw new Error(t('Could not open this conversation.'));
          if (result.messageId)
            setMessageFocus({ id: result.messageId, revision: Date.now() });
        }}
        open={searchOpen}
        onOpen={setSearchOpen}
        projects={[
          ...projectList,
          ...resourceShares
            .filter(
              (share) =>
                share.kind === 'session' &&
                !share.owned &&
                share.status === 'accepted' &&
                share.projectId &&
                !projectList.some((project) => project.id === share.projectId),
            )
            .filter(
              (share, index, list) =>
                list.findIndex((item) => item.projectId === share.projectId) ===
                index,
            )
            .map((share) => ({
              id: share.projectId!,
              name: share.projectName,
              deletedAt: null,
              navigationDisabled: true,
            })),
        ]}
        artifacts={artifactList}
        onProject={openProject}
        onArtifact={(index) => {
          setSelectedArtifact(index);
          setView('artifacts');
        }}
        onAgents={(tab) => {
          setAgentTab(tab);
          setView('agents');
        }}
      />
      <GettingStarted
        open={
          loaded &&
          gettingStarted &&
          !runtimeDialog &&
          !agentDialog &&
          !projectDialog
        }
        completed={[
          setupRuntimeReady,
          setupAgentReady,
          Boolean(setupProject),
          chatSessions.length > 0,
        ]}
        onStep={setupStep}
        onSkip={leaveGettingStarted}
        onShown={markGuideShown}
      />
      <ProjectDialog
        key={`project:${editingProject?.id || 'new'}:${projectDialog ? 'open' : 'closed'}`}
        open={projectDialog}
        creating={creatingProject}
        error={formError}
        nodes={runtimeNodes}
        project={editingProject}
        defaultRuntimeId={
          editingProject?.runtimeId || currentAgent?.runtimeId || ''
        }
        onOpen={(open) => {
          setProjectDialog(open);
          if (!open) setEditingProject(null);
        }}
        onSubmit={saveProject}
      />
      <AlertDialog
        open={Boolean(deletingProject)}
        onOpenChange={(open) => !open && !deleting && setDeletingProject(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingProject?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              It will disappear from the Project list. Existing conversations
              keep their pinned workspace and remain usable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault();
                void deleteSelectedProject();
              }}
            >
              {deleting ? 'Deleting…' : 'Delete project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={Boolean(deletingSession)}
        onOpenChange={(open) =>
          !open && !deletingConversation && setDeletingSession(null)
        }
      >
        <AlertDialogContent className="ws-delete-conversation-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('Delete this conversation?')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deletingSession?.id === chatSession && chatWorking
                ? 'Stop the current run before deleting this conversation.'
                : 'This permanently removes its messages, attachments, and generated artifacts from Steer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingConversation}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={
                deletingConversation ||
                (deletingSession?.id === chatSession && chatWorking)
              }
              onClick={(event) => {
                event.preventDefault();
                void deleteSelectedSession();
              }}
            >
              {deletingConversation ? t('Deleting…') : t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AgentDialog
        key={`agent:${editingAgent?.id || 'new'}:${agentDialog ? 'open' : 'closed'}`}
        open={agentDialog}
        creating={creatingAgent}
        error={formError}
        agent={editingAgent}
        runtime={agentRuntime}
        model={agentModel}
        choices={agentRuntimeChoices}
        skills={skillList}
        selectedSkillIDs={
          editingAgent ? agentSkillAssignments[editingAgent.id] || [] : []
        }
        selectedChoice={selectedRuntimeChoice}
        onOpen={(open) => {
          setAgentDialog(open);
          if (!open) setEditingAgent(null);
        }}
        onRuntime={(value) => {
          setAgentRuntime(value);
          setAgentModel('Runtime default');
        }}
        onModel={setAgentModel}
        onSubmit={saveAgent}
      />
      <AlertDialog
        open={Boolean(deletingAgent)}
        onOpenChange={(open) =>
          !open && !deletingAgentBusy && setDeletingAgent(null)
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingAgent?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the Agent and its Skill assignments. Agents used by a
              conversation, integration, or workspace setting must be
              disconnected before deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingAgentBusy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingAgentBusy}
              onClick={(event) => {
                event.preventDefault();
                void deleteSelectedAgent();
              }}
            >
              {deletingAgentBusy ? 'Deleting…' : 'Delete Agent'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <RuntimeDialog
        key={`runtime:${relayEnrollmentNodeID || 'existing'}:${runtimeDialog ? 'open' : 'closed'}`}
        open={runtimeDialog}
        connected={relayConnected}
        error={relayError}
        discoveryError={runtimeDiscoveryError}
        publicURL={relayPublicURL}
        nodes={availableRuntimeNodes}
        selectedRuntimeIDs={selectedRuntimeIDs}
        discovering={runtimeDiscoveryLoading}
        claiming={runtimeClaiming}
        enrollmentToken={relayEnrollmentToken}
        enrollmentNodeToken={relayEnrollmentNodeToken}
        enrollmentNodeID={relayEnrollmentNodeID}
        steerAPIURL={steerAPIBaseURL}
        onOpen={setRuntimeDialog}
        onURL={setRelayPublicURL}
        onRefresh={() => void discoverRuntimes()}
        onSelect={setSelectedRuntimeIDs}
        onClaim={() => void claimSelectedRuntimes()}
        onCreateEnrollment={createRelayEnrollment}
        onRemoveNode={setDeletingRelayNode}
      />
      <AlertDialog
        open={Boolean(deletingRelayNode)}
        onOpenChange={(open) =>
          !open && !deletingRelayNodeBusy && setDeletingRelayNode(null)
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {deletingRelayNode?.labels?.name || 'this Relay Node'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'This removes the offline Node and its unused Runtime bindings from Steer. Conversation history is preserved and will select an available Runtime on its next turn. If an Agent or Project still uses this Node, migrate it first.',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingRelayNodeBusy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletingRelayNodeBusy}
              onClick={(event) => {
                event.preventDefault();
                void deleteSelectedRelayNode();
              }}
            >
              {deletingRelayNodeBusy ? 'Removing…' : 'Remove Node'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {notice && (
        <output className="ws-toast" aria-live="polite">
          <Check aria-hidden="true" />
          {notice}
          <button
            onClick={() => setNotice('')}
            aria-label="Dismiss notification"
          >
            <X />
          </button>
        </output>
      )}
    </SidebarProvider>
  );
}

function AuthScreen({
  mode,
  error,
  submitting,
  onMode,
  onSubmit,
}: {
  mode: 'login' | 'register';
  error: string;
  submitting: boolean;
  onMode: (mode: 'login' | 'register') => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const { t } = useI18n();
  return (
    <main className="ws-auth-shell">
      <section className="ws-auth-card">
        <div className="ws-auth-brand">
          <span className="ws-logo">S</span>
          <div>
            <strong>Steer</strong>
            <small>{t('Agent workspace')}</small>
          </div>
        </div>
        <div className="ws-auth-heading">
          <h1>
            {mode === 'login' ? t('Welcome back') : t('Create your account')}
          </h1>
          <p>
            {mode === 'login'
              ? t('Sign in to open your workspaces.')
              : t('Your first private workspace will be ready immediately.')}
          </p>
        </div>
        <form onSubmit={onSubmit}>
          {mode === 'register' && (
            <label>
              {t('Display name')}
              <input
                name="displayName"
                autoComplete="name"
                placeholder="Your name"
                required
              />
            </label>
          )}
          <label>
            {t('Email')}
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </label>
          <label>
            {t('Password')}
            <input
              name="password"
              type="password"
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              minLength={8}
              placeholder="At least 8 characters"
              required
            />
          </label>
          {error && (
            <p className="ws-auth-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="ws-auth-submit"
            type="submit"
            disabled={submitting}
          >
            {submitting
              ? t('Please wait…')
              : mode === 'login'
                ? t('Sign in')
                : t('Create account')}
          </button>
        </form>
        <p className="ws-auth-switch">
          {mode === 'login'
            ? t('New to Steer?')
            : t('Already have an account?')}
          <button
            type="button"
            onClick={() => onMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? t('Create an account') : t('Sign in')}
          </button>
        </p>
      </section>
    </main>
  );
}

// Resolve the left navigation context before ChatView creates its review sidebar.
function WorkspaceChatView(
  props: Omit<ComponentProps<typeof ChatView>, 'onToggleSidebar'>,
) {
  const { toggleSidebar } = useSidebar();
  return <ChatView {...props} onToggleSidebar={toggleSidebar} />;
}

function ChatView({
  messageFocus,
  collaborationMembers = [],
  sharingUser = null,
  publicShareAllowed = true,
  showHumanAuthors = false,
  readOnly = false,
  readOnlyReason,
  executionLocked = false,
  agentSelectionLocked = executionLocked,
  sharingLabel,
  onManageSharing,
  sessionId,
  agents,
  agent,
  projectRuntimeChoices,
  projects,
  project,
  artifacts,
  messages,
  sessionTitle,
  parentConversationId,
  runtimeLabel,
  sessionLoading,
  input,
  inputRevision,
  readDraftInput,
  onDraftInput,
  images,
  working,
  onAgent,
  onDelegationSession,
  onProject,
  onAddProject,
  onInput,
  onImages,
  onRemoveImage,
  onSend,
  onRetry,
  onStop,
  onNotice,
  onArtifact,
  onToggleSidebar,
}: {
  collaborationMembers?: ResourceShare[];
  sharingUser?: AuthUser | null;
  publicShareAllowed?: boolean;
  showHumanAuthors?: boolean;
  readOnly?: boolean;
  readOnlyReason?: string;
  executionLocked?: boolean;
  agentSelectionLocked?: boolean;
  sharingLabel?: string;
  onManageSharing?: () => void;
  messageFocus?: { id: string; revision: number } | null;
  sessionId: string;
  agents: AgentItem[];
  agent?: AgentItem;
  projectRuntimeChoices?: RuntimeChoice[];
  projects: ProjectRecord[];
  project: string;
  artifacts: Artifact[];
  messages: ChatMessage[];
  sessionTitle?: string;
  parentConversationId?: string | null;
  runtimeLabel: string;
  sessionLoading: boolean;
  input: string;
  inputRevision: number;
  readDraftInput: () => string;
  onDraftInput: (text: string) => void;
  images: PendingImage[];
  working: boolean;
  onAgent: (id: string) => void;
  onDelegationSession: (id: string) => void;
  onProject: (id: string) => void;
  onAddProject: () => void;
  onInput: (value: string) => void;
  onImages: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
  onSend: (options?: TaskMessageOptions) => Promise<boolean>;
  onRetry: (prompt: string, options?: TaskMessageOptions) => void;
  onStop: () => void;
  onNotice: (message: string) => void;
  onArtifact: (id: string) => void;
  onToggleSidebar: () => void;
}) {
  const { t } = useI18n();
  const hasMessages = messages.length > 0;
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewWidth, setReviewWidth] = useState(() => {
    if (typeof window === 'undefined') return 520;
    const saved = Number.parseInt(
      window.localStorage.getItem('steer.reviewWidth') || '',
      10,
    );
    return Number.isFinite(saved) ? Math.max(320, saved) : 520;
  });
  const [reviewResizing, setReviewResizing] = useState(false);
  const [previewID, setPreviewID] = useState('');
  const [preview, setPreview] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [reviewTab, setReviewTab] = useState<
    'home' | 'changes' | 'documents' | 'files'
  >('home');
  const [reviewRunID, setReviewRunID] = useState('');
  const [workspaceTabs, setWorkspaceTabs] = useState<
    Array<{
      id: string;
      kind: 'changes' | 'documents' | 'files';
      runId: string;
      path: string;
      title: string;
      snapshot?: string;
    }>
  >([]);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState('');
  const [selectedChange, setSelectedChange] = useState('');
  const [previewSource, setPreviewSource] = useState(false);
  const reviewRounds = useMemo(
    () =>
      messages.filter((message) => message.role === 'agent' && message.runId),
    [messages],
  );
  const reviewMessage =
    reviewRounds.find((message) => message.runId === reviewRunID) ||
    reviewRounds.at(-1);
  const changes = reviewMessage?.changes || [];
  const currentChange =
    changes.find((change) => change.path === selectedChange) || changes[0];
  const [copiedMessage, setCopiedMessage] = useState('');
  const [sharing, setSharing] = useState('');
  const [shared, setShared] = useState('');
  const [publicShareDialog, setPublicShareDialog] = useState(false);
  const [publicShareURL, setPublicShareURL] = useState('');
  const [publicShareError, setPublicShareError] = useState('');
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [draggingImages, setDraggingImages] = useState(false);
  const [composerPreviewID, setComposerPreviewID] = useState('');
  const [expandedActivity, setExpandedActivity] = useState<
    Record<string, boolean>
  >({});
  const startReviewResize = useCallback(
    (event: ReactPointerEvent<HTMLHRElement>) => {
      if (event.button !== 0 || !reviewOpen) return;
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = reviewWidth;
      const listeners = new AbortController();
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      setReviewResizing(true);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const widthAt = (clientX: number) =>
        Math.max(
          320,
          Math.min(window.innerWidth * 0.7, startWidth + startX - clientX),
        );
      const onPointerMove = (moveEvent: PointerEvent) =>
        setReviewWidth(widthAt(moveEvent.clientX));
      const onPointerUp = (upEvent: PointerEvent) => {
        const next = widthAt(upEvent.clientX);
        setReviewWidth(next);
        window.localStorage.setItem(
          'steer.reviewWidth',
          String(Math.round(next)),
        );
        setReviewResizing(false);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        listeners.abort();
      };

      window.addEventListener('pointermove', onPointerMove, {
        signal: listeners.signal,
      });
      window.addEventListener('pointerup', onPointerUp, {
        signal: listeners.signal,
      });
      window.addEventListener('pointercancel', onPointerUp, {
        signal: listeners.signal,
      });
    },
    [reviewOpen, reviewWidth],
  );
  const selectedProject = projects.find((item) => item.id === project);
  const workspaceBranch = selectedProject
    ? configuredProjectBranch(selectedProject)
    : '';
  const firstUserMessage = messages.find((message) => message.role === 'user');
  const conversationTitle =
    (sessionTitle
      ? sessionDisplayTitle({ title: sessionTitle, parentConversationId })
      : '') ||
    (firstUserMessage
      ? (
          firstUserMessage.text.trim().replace(/\s+/g, ' ') ||
          firstUserMessage.attachments?.[0]?.name ||
          'Image'
        ).slice(0, 72)
      : t('New chat'));
  const composerPreview = images.find(
    (image) => image.id === composerPreviewID,
  );
  const projectLabel =
    selectedProject?.workspaceSource || t('No project selected');
  const scrollArea = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLSpanElement>(null);
  const [quotedMessage, setQuotedMessage] = useState<ChatMessage>();
  const [delegationTarget, setDelegationTarget] = useState<AgentItem>();
  const [referenceRemoved, setReferenceRemoved] = useState(false);
  const eligibleDelegates = (executionLocked ? [] : agents).filter(
    (item) =>
      Boolean(
        sessionId && (selectedProject || agent?.workspaceKind === 'local'),
      ) &&
      item.id !== agent?.id &&
      projectRuntimeChoices?.some(
        (runtime) =>
          runtime.provider === item.runtimeProvider &&
          (!item.runtimeId || item.runtimeId === runtime.runtimeId),
      ),
  );
  const quoteMessage = (message: ChatMessage) => {
    setQuotedMessage((current) =>
      current?.id === message.id ? undefined : message,
    );
    setReferenceRemoved(quotedMessage?.id === message.id);
    requestAnimationFrame(() => focusInlineComposer(composer.current));
  };
  const selectDelegate = (target?: AgentItem) => {
    setDelegationTarget(target);
    if (target && !quotedMessage && !referenceRemoved)
      setQuotedMessage(
        messages.findLast(
          (message) =>
            message.role === 'agent' &&
            (message.status === 'succeeded' || message.status === 'complete') &&
            Boolean(message.text),
        ),
      );
  };
  const submitMessage = async (draft: string) => {
    if (readOnly || working || (!draft.trim() && images.length === 0)) return;
    if (
      delegationTarget &&
      !eligibleDelegates.some((item) => item.id === delegationTarget.id)
    ) {
      onNotice(
        t(
          'This Agent is unavailable on the conversation machine. Choose another Agent.',
        ),
      );
      return;
    }
    const accepted = await onSend({
      targetAgentId: delegationTarget?.id,
      referencedMessageId: quotedMessage?.id,
      referenceMode: quotedMessage ? 'explicit' : 'none',
    });
    if (accepted) {
      setQuotedMessage(undefined);
      setDelegationTarget(undefined);
      setReferenceRemoved(false);
    }
  };
  const imageDragDepth = useRef(0);
  const followBottom = useRef(true);
  const chatViewportRef = useChatViewport(() => {
    const area = scrollArea.current;
    if (area && followBottom.current) area.scrollTop = area.scrollHeight;
  });
  const thread = useRef<HTMLDivElement>(null);
  const previousPrompts = useMemo(() => {
    let prompt: string | undefined;
    const prompts: Array<string | undefined> = [];
    for (const message of messages) {
      prompts.push(prompt);
      if (message.role === 'user') prompt = message.text;
    }
    return prompts;
  }, [messages]);
  const openWorkspaceTab = useCallback(
    (
      kind: 'changes' | 'documents' | 'files',
      runId = '',
      path = '',
      snapshot?: string,
    ) => {
      const resolvedRunId = runId || reviewRounds.at(-1)?.runId || '';
      const id =
        kind === 'changes'
          ? `review:${resolvedRunId || 'latest'}`
          : kind === 'files' && path
            ? `file:${resolvedRunId || 'latest'}:${path}`
            : kind;
      const title =
        kind === 'changes'
          ? `Review · Turn ${reviewRounds.findIndex((message) => message.runId === resolvedRunId) + 1}`
          : kind === 'files'
            ? path.split(/[\\/]/).filter(Boolean).at(-1) || 'Files'
            : 'Documents';
      setWorkspaceTabs((tabs) =>
        tabs.some((tab) => tab.id === id)
          ? tabs.map((tab) =>
              tab.id === id
                ? { ...tab, path, runId: resolvedRunId, title, snapshot }
                : tab,
            )
          : [
              ...tabs,
              { id, kind, runId: resolvedRunId, path, title, snapshot },
            ],
      );
      setActiveWorkspaceTab(id);
      setReviewTab(kind);
      setReviewRunID(resolvedRunId);
      setSelectedChange(path);
      setReviewOpen(true);
    },
    [reviewRounds],
  );
  // Keep this callback stable while typing so memoized Markdown replies do not
  // reparse and highlight the entire conversation for every input event.
  const openWorkspaceFile = useCallback(
    (path: string, runId?: string) => {
      openWorkspaceTab('files', runId || '', path);
    },
    [openWorkspaceTab],
  );
  const activateWorkspaceTab = (tab: (typeof workspaceTabs)[number]) => {
    setActiveWorkspaceTab(tab.id);
    setReviewTab(tab.kind);
    setReviewRunID(tab.runId);
    setSelectedChange(tab.path);
  };
  const closeWorkspaceTab = (id: string) => {
    const remaining = workspaceTabs.filter((tab) => tab.id !== id);
    setWorkspaceTabs(remaining);
    if (activeWorkspaceTab === id) {
      const next = remaining.at(-1);
      if (next) activateWorkspaceTab(next);
      else {
        setActiveWorkspaceTab('');
        setReviewTab('home');
      }
    }
  };
  const selectPreview = (id: string) => {
    openWorkspaceTab('documents');
    setPreviewSource(false);
    if (id === previewID) return;
    setPreviewID(id);
    setPreview('');
    setPreviewError('');
  };
  const preparePublicShare = async () => {
    if (!sessionId || !publicShareAllowed || sharing) return;
    setPublicShareDialog(true);
    setPublicShareURL('');
    setPublicShareError('');
    setSharing('conversation');
    try {
      const result = await steer.shareSession(sessionId);
      const url = new URL('/share', window.location.origin);
      url.searchParams.set('token', result.token);
      setPublicShareURL(url.toString());
    } catch (error) {
      setPublicShareError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSharing('');
    }
  };

  const copyShareLink = async (
    kind: 'conversation' | 'message',
    id: string,
    key: string,
  ) => {
    if (!id || sharing) return;
    setSharing(key);
    try {
      const result =
        kind === 'conversation'
          ? await steer.shareSession(id)
          : await steer.shareMessage(id);
      const url = new URL('/share', window.location.origin);
      url.searchParams.set('token', result.token);
      const copied = await writeClipboard(url.toString());
      setShared(key);
      onNotice(
        copied
          ? kind === 'conversation'
            ? 'Conversation share link copied.'
            : 'Message share link copied.'
          : `Share link: ${url.toString()}`,
      );
      window.setTimeout(
        () => setShared((current) => (current === key ? '' : current)),
        1800,
      );
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : 'Could not create share link.',
      );
    } finally {
      setSharing('');
    }
  };
  useEffect(() => {
    const area = scrollArea.current;
    if (!area || !followBottom.current) return;
    const frame = window.requestAnimationFrame(() => {
      if (followBottom.current) area.scrollTop = area.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, working]);
  useEffect(() => {
    const area = scrollArea.current;
    const content = thread.current;
    if (!area || !content) return;
    // Images, wrapping after a panel resize, and expanded tools can change
    // height without a new message. Follow only while the reader is at bottom.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (followBottom.current) area.scrollTop = area.scrollHeight;
      });
    });
    observer.observe(content);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [hasMessages, sessionLoading]);
  useEffect(() => {
    if (!messageFocus || sessionLoading || !hasMessages) return;
    followBottom.current = false;
    const frame = requestAnimationFrame(() => {
      const element = Array.from(
        thread.current?.querySelectorAll<HTMLElement>('[data-message-id]') ||
          [],
      ).find((node) => node.dataset.messageId === messageFocus.id);
      if (!element) return;
      element.scrollIntoView({ block: 'center', behavior: 'instant' });
      element.classList.remove('ws-message-search-hit');
      void element.offsetWidth;
      element.classList.add('ws-message-search-hit');
    });
    return () => cancelAnimationFrame(frame);
  }, [messageFocus, sessionLoading, hasMessages]);
  useEffect(() => {
    if (!reviewOpen || !previewID) return;
    let cancelled = false;
    steer
      .artifactContent(previewID)
      .then((result) => {
        if (!cancelled) setPreview(result.content);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setPreviewError(
            error instanceof Error ? error.message : 'Preview unavailable.',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [previewID, reviewOpen]);
  if (!agent)
    return (
      <section className="ws-chat-page is-empty">
        <Empty
          icon={<Bot />}
          title={t('Create an Agent to start')}
          text={t('Connect a Runtime through Relay, then create an Agent.')}
        />
      </section>
    );
  return (
    <SidebarProvider
      ref={chatViewportRef}
      className="ws-chat-split"
      open={reviewOpen}
      onOpenChange={setReviewOpen}
      style={{ '--sidebar-width': `${reviewWidth}px` } as CSSProperties}
    >
      <SidebarInset className="ws-conversation-panel">
        <section
          className={`ws-chat-page ${hasMessages || sessionLoading ? 'has-messages' : 'is-empty'}`}
        >
          <header className="ws-chat-appbar">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('Toggle sidebar')}
              onClick={onToggleSidebar}
            >
              <PanelLeft aria-hidden="true" />
            </Button>
            <div className="ws-chat-appbar-context">
              <strong title={conversationTitle}>{conversationTitle}</strong>
              <span title={projectLabel}>
                <Folder aria-hidden="true" />
                <small>
                  {sharingLabel
                    ? `${sharingLabel} · ${selectedProject?.name || projectLabel}`
                    : projectLabel}
                </small>
              </span>
            </div>
            <div className="ws-grow" />
            <CollaborationAvatars
              members={collaborationMembers}
              user={sharingUser}
              onClick={() => onManageSharing?.()}
            />
            <Button
              variant="ghost"
              size="icon"
              className="ws-chat-collaboration-trigger"
              aria-label={t(
                !publicShareAllowed
                  ? 'Conversation access'
                  : 'Invite collaboration',
              )}
              title={t(
                !publicShareAllowed
                  ? 'Conversation access'
                  : 'Invite collaboration',
              )}
              disabled={!sessionId || !onManageSharing}
              onClick={onManageSharing}
            >
              <Users aria-hidden="true" />
            </Button>
            {publicShareAllowed && (
              <Button
                variant="ghost"
                size="icon"
                className="ws-chat-share-trigger"
                aria-label={t('Share view-only link')}
                title={t('Share view-only link')}
                disabled={!sessionId || working || sharing === 'conversation'}
                onClick={() => void preparePublicShare()}
              >
                <Share2 aria-hidden="true" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="ws-chat-review-trigger"
              aria-label={t('Open review panel')}
              aria-expanded={reviewOpen}
              onClick={() => {
                setReviewOpen((open) => !open);
              }}
            >
              <PanelLeft className="ws-panel-toggle-right" aria-hidden="true" />
            </Button>
          </header>
          <Dialog open={publicShareDialog} onOpenChange={setPublicShareDialog}>
            <DialogContent className="ws-sharing-dialog ws-view-link-dialog">
              <DialogTitle>{t('Share view-only link')}</DialogTitle>
              <DialogDescription>
                {t('Share a read-only snapshot of this conversation.')}
              </DialogDescription>
              <div className="ws-view-link-row">
                <input
                  aria-label={t('View-only link')}
                  value={publicShareURL}
                  readOnly
                  placeholder={t('Creating link…')}
                />
                <Button
                  disabled={!publicShareURL}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(publicShareURL);
                      onNotice(t('Share link copied'));
                    } catch {
                      onNotice(t('Copy the link from the field.'));
                    }
                  }}
                >
                  <Copy />
                  {t('Copy')}
                </Button>
              </div>
              {publicShareError && (
                <p role="alert" className="ws-form-error">
                  {publicShareError}
                </p>
              )}
              <p className="ws-sharing-note">
                {t(
                  'Anyone with this link can view the snapshot. Invite collaborators separately.',
                )}
              </p>
            </DialogContent>
          </Dialog>

          <Dialog
            open={Boolean(composerPreview)}
            onOpenChange={(open) => !open && setComposerPreviewID('')}
          >
            <DialogContent className="ws-image-preview-dialog">
              <DialogTitle className="sr-only">Image preview</DialogTitle>
              <DialogDescription className="sr-only">
                Full-size preview of the image attached to this message.
              </DialogDescription>
              {composerPreview && (
                // oxlint-disable-next-line next/no-img-element -- local object URL preview
                <img
                  src={composerPreview.url}
                  alt={composerPreview.file.name || 'Attached image'}
                />
              )}
            </DialogContent>
          </Dialog>
          <div
            className="ws-chat-center"
            ref={scrollArea}
            onScroll={() => {
              const area = scrollArea.current;
              if (area) {
                followBottom.current =
                  area.scrollHeight - area.scrollTop - area.clientHeight < 100;
                setShowScrollToBottom(!followBottom.current);
              }
            }}
          >
            {sessionLoading && (
              <output className="ws-chat-session-loading" aria-live="polite">
                <span />
                <span />
                <span />
                {t('Loading conversation…')}
              </output>
            )}
            {!sessionLoading && !hasMessages && (
              <div className="ws-chat-welcome">
                <h1>{t('What would you like to work on?')}</h1>
                <p>
                  {selectedProject
                    ? `Work with ${agent.name} directly in ${selectedProject.name}. Relay runs on the machine where this project path exists.`
                    : `Choose a project, then work with ${agent.name} on its local or remote Runtime.`}
                </p>
              </div>
            )}
            {!sessionLoading && hasMessages && (
              <div className="ws-chat-thread" ref={thread}>
                {messages.map((message, index) => {
                  const messageKey = message.id || `${message.role}-${index}`;
                  const previousPrompt = previousPrompts[index];
                  const terminal = isTerminalStatus(message.status);
                  const delegatedElsewhere = Boolean(
                    message.context?.delegationSessionId &&
                    message.context.delegationSessionId !== sessionId,
                  );
                  const finalOutputStarted =
                    message.role === 'agent' &&
                    !terminal &&
                    Boolean(message.text);
                  const processCollapsible = terminal || finalOutputStarted;
                  const activityExpanded =
                    expandedActivity[messageKey] ?? !processCollapsible;
                  const activityItems = message.activityLog?.length
                    ? message.activityLog
                    : [
                        {
                          id: 'working',
                          label: message.activity || 'Working',
                        },
                      ];
                  const processActivityItems = activityItems.filter(
                    (item) =>
                      item.kind === 'update' ||
                      item.kind === 'action' ||
                      item.kind === 'action-active',
                  );
                  const visibleProcessItems = processActivityItems.length
                    ? processActivityItems
                    : activityItems.slice(-1);
                  const hasActiveTool =
                    visibleProcessItems.at(-1)?.kind === 'action-active';
                  return (
                    <div
                      className={`ws-chat-message ${message.role}`}
                      data-message-id={message.id}
                      key={messageKey}
                    >
                      {showHumanAuthors &&
                        message.role === 'user' &&
                        message.context?.userName && (
                          <span className="ws-shared-user-name">
                            {message.context.userName}
                          </span>
                        )}
                      <span className="ws-agent-avatar">
                        {message.role === 'user'
                          ? 'K'
                          : (message.context?.agentName || agent.name)[0]}
                      </span>
                      <div>
                        <strong>
                          {message.role === 'user'
                            ? 'You'
                            : message.context?.agentName || agent.name}
                        </strong>
                        {message.role === 'agent' && !delegatedElsewhere && (
                          <div
                            className={`ws-chat-response-process${processCollapsible ? '' : ' is-live'}`}
                          >
                            {processCollapsible ? (
                              <button
                                type="button"
                                className={`ws-chat-response-meta ${terminal ? 'is-complete' : 'is-running'}`}
                                aria-expanded={activityExpanded}
                                onClick={() =>
                                  setExpandedActivity((current) => ({
                                    ...current,
                                    [messageKey]: !activityExpanded,
                                  }))
                                }
                              >
                                {message.context?.delegated && (
                                  <span className="ws-delegated-author">
                                    {message.context.agentName} |
                                  </span>
                                )}
                                <ResponseStatus message={message} />
                                <ChevronRight aria-hidden="true" />
                              </button>
                            ) : (
                              <div className="ws-chat-response-meta is-running">
                                {message.context?.delegated && (
                                  <span className="ws-delegated-author">
                                    {message.context.agentName} |
                                  </span>
                                )}
                                <ResponseStatus message={message} />
                              </div>
                            )}
                            <div
                              className="ws-chat-response-divider"
                              aria-hidden="true"
                            />
                            {(activityExpanded || !processCollapsible) && (
                              <ProcessTranscript
                                items={visibleProcessItems}
                                live={!processCollapsible}
                              />
                            )}
                            {!processCollapsible && !hasActiveTool && (
                              <div
                                className="ws-chat-current-status"
                                aria-live="polite"
                              >
                                {message.activity || 'Thinking'}
                              </div>
                            )}
                          </div>
                        )}
                        {message.role === 'agent' &&
                          delegatedElsewhere &&
                          (terminal ? (
                            <div className="ws-chat-response-process">
                              <button
                                type="button"
                                className={`ws-chat-response-meta ws-delegation-meta ${terminal ? 'is-complete' : 'is-running'}`}
                                title={t('Open delegated conversation')}
                                aria-label={t('Open delegated conversation')}
                                onClick={() =>
                                  message.context?.delegationSessionId &&
                                  onDelegationSession(
                                    message.context.delegationSessionId,
                                  )
                                }
                              >
                                <span className="ws-delegation-agent">
                                  {message.context?.agentName}
                                </span>
                                <span
                                  className="ws-delegation-separator"
                                  aria-hidden="true"
                                >
                                  |
                                </span>
                                <ResponseStatus message={message} />
                                <ChevronRight aria-hidden="true" />
                              </button>
                              <div
                                className="ws-chat-response-divider"
                                aria-hidden="true"
                              />
                            </div>
                          ) : (
                            <DelegationProgress
                              message={message}
                              onOpen={() =>
                                message.context?.delegationSessionId &&
                                onDelegationSession(
                                  message.context.delegationSessionId,
                                )
                              }
                            />
                          ))}
                        {message.role === 'user' &&
                          message.context?.reference && (
                            <div className="ws-message-reference">
                              <details>
                                <summary title={t('View quotation')}>
                                  <span>
                                    {quotationSummary(
                                      message.context.reference.content,
                                      180,
                                    )}
                                  </span>
                                </summary>
                                <div>{message.context.reference.content}</div>
                              </details>
                            </div>
                          )}
                        {message.role === 'agent' ? (
                          message.text && (!delegatedElsewhere || terminal) ? (
                            <div aria-live={terminal ? undefined : 'polite'}>
                              <Markdown
                                workspaceRunId={message.runId}
                                onOpenWorkspaceFile={openWorkspaceFile}
                              >
                                {message.text}
                              </Markdown>
                            </div>
                          ) : null
                        ) : (
                          <>
                            {!!message.attachments?.length && (
                              <div className="ws-chat-image-grid">
                                {message.attachments.map((image) => (
                                  <a
                                    href={image.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    key={image.id}
                                    aria-label={`Open ${image.name}`}
                                  >
                                    {/* oxlint-disable-next-line next/no-img-element -- authenticated and blob attachment URLs are not compatible with an image optimizer */}
                                    <img src={image.url} alt={image.name} />
                                  </a>
                                ))}
                              </div>
                            )}
                            {(message.text || message.context?.delegated) && (
                              <p>
                                {message.context?.delegated && (
                                  <span className="ws-sent-mention">
                                    @{message.context.agentName}
                                  </span>
                                )}
                                {message.text}
                              </p>
                            )}
                          </>
                        )}
                        {message.error && (
                          <p className="ws-form-error">{message.error}</p>
                        )}
                        {message.role === 'user' &&
                          message.id &&
                          message.text && (
                            <div className="ws-chat-message-actions ws-user-message-actions">
                              <button
                                type="button"
                                aria-label={
                                  shared === `message:${message.id}`
                                    ? 'Message share link copied'
                                    : 'Share message'
                                }
                                title={
                                  shared === `message:${message.id}`
                                    ? 'Share link copied'
                                    : 'Share message'
                                }
                                disabled={Boolean(sharing)}
                                onClick={() =>
                                  void copyShareLink(
                                    'message',
                                    message.id!,
                                    `message:${message.id}`,
                                  )
                                }
                              >
                                {shared === `message:${message.id}` ? (
                                  <Check aria-hidden="true" />
                                ) : (
                                  <Share2 aria-hidden="true" />
                                )}
                              </button>
                            </div>
                          )}
                        {terminal &&
                          !delegatedElsewhere &&
                          !!message.changes?.length && (
                            <div className="ws-message-changes">
                              <div className="ws-message-changes-header">
                                <span className="ws-message-changes-icon">
                                  <FileText aria-hidden="true" />
                                </span>
                                <button
                                  type="button"
                                  className="ws-message-changes-summary"
                                  onClick={() =>
                                    openWorkspaceTab(
                                      'changes',
                                      message.runId,
                                      message.changes?.[0]?.path,
                                    )
                                  }
                                >
                                  <strong>
                                    Edited {message.changes.length}{' '}
                                    {message.changes.length === 1
                                      ? 'file'
                                      : 'files'}
                                  </strong>
                                  <DiffStats
                                    change={{
                                      id: 'total',
                                      path: '',
                                      diff: message.changes
                                        .map((change) => change.diff)
                                        .join('\n'),
                                    }}
                                  />
                                </button>
                                <Button
                                  className="ws-review-message-link"
                                  variant="outline"
                                  onClick={() =>
                                    openWorkspaceTab(
                                      'changes',
                                      message.runId,
                                      message.changes?.[0]?.path,
                                    )
                                  }
                                >
                                  Review
                                </Button>
                              </div>
                              <div className="ws-message-changes-files">
                                {message.changes.map((change) => (
                                  <Button
                                    key={change.path}
                                    variant="ghost"
                                    title={change.path}
                                    onClick={() =>
                                      openWorkspaceTab(
                                        'changes',
                                        message.runId,
                                        change.path,
                                      )
                                    }
                                  >
                                    <span>{change.path}</span>
                                    <DiffStats change={change} />
                                  </Button>
                                ))}
                              </div>
                            </div>
                          )}
                        {message.role === 'agent' &&
                          terminal &&
                          message.text && (
                            <div className="ws-chat-message-actions">
                              {(message.status === 'succeeded' ||
                                message.status === 'complete') &&
                                message.id && (
                                  <button
                                    type="button"
                                    aria-label={t('Quote reply')}
                                    title={t('Quote reply')}
                                    aria-pressed={
                                      quotedMessage?.id === message.id
                                    }
                                    disabled={working || readOnly}
                                    className={
                                      quotedMessage?.id === message.id
                                        ? 'is-quoted'
                                        : undefined
                                    }
                                    onClick={() => quoteMessage(message)}
                                  >
                                    <Quote aria-hidden="true" />
                                  </button>
                                )}
                              {message.context?.delegated &&
                                message.context.agentId !== agent.id &&
                                message.status === 'succeeded' && (
                                  <button
                                    type="button"
                                    aria-label={t('Hand back to {agent}', {
                                      agent: agent.name,
                                    })}
                                    title={t('Hand back to {agent}', {
                                      agent: agent.name,
                                    })}
                                    disabled={working || readOnly}
                                    onClick={() => {
                                      setDelegationTarget(undefined);
                                      setQuotedMessage(message);
                                      setReferenceRemoved(false);
                                      onInput(
                                        t(
                                          "Continue based on {agent}'s result.",
                                          {
                                            agent:
                                              message.context?.agentName ||
                                              'Agent',
                                          },
                                        ),
                                      );
                                      requestAnimationFrame(() =>
                                        focusInlineComposer(composer.current),
                                      );
                                    }}
                                  >
                                    <Reply aria-hidden="true" />
                                  </button>
                                )}
                              <button
                                type="button"
                                aria-label={
                                  copiedMessage === messageKey
                                    ? 'Response copied'
                                    : 'Copy response'
                                }
                                title={
                                  copiedMessage === messageKey
                                    ? 'Copied'
                                    : 'Copy response'
                                }
                                onClick={() => {
                                  void writeClipboard(message.text).then(
                                    (copied) => {
                                      if (!copied) return;
                                      setCopiedMessage(messageKey);
                                      window.setTimeout(
                                        () =>
                                          setCopiedMessage((current) =>
                                            current === messageKey
                                              ? ''
                                              : current,
                                          ),
                                        1800,
                                      );
                                    },
                                  );
                                }}
                              >
                                {copiedMessage === messageKey ? (
                                  <Check aria-hidden="true" />
                                ) : (
                                  <Copy aria-hidden="true" />
                                )}
                              </button>
                              <button
                                type="button"
                                aria-label="Run again"
                                title="Run again"
                                disabled={working || !previousPrompt}
                                onClick={() =>
                                  previousPrompt &&
                                  onRetry(previousPrompt, {
                                    targetAgentId: message.context?.delegated
                                      ? message.context.agentId
                                      : undefined,
                                    referencedMessageId:
                                      message.context?.reference?.messageId,
                                    referenceMode: message.context?.reference
                                      ? 'explicit'
                                      : 'none',
                                  })
                                }
                              >
                                <RefreshCw aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                aria-label="Download response"
                                title="Download response"
                                onClick={() =>
                                  downloadText(
                                    message.text,
                                    `agent-response-${index + 1}.md`,
                                  )
                                }
                              >
                                <Download aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                aria-label={
                                  shared === `message:${message.id}`
                                    ? 'Message share link copied'
                                    : 'Share message'
                                }
                                title={
                                  shared === `message:${message.id}`
                                    ? 'Share link copied'
                                    : 'Share message'
                                }
                                disabled={!message.id || Boolean(sharing)}
                                onClick={() =>
                                  message.id &&
                                  void copyShareLink(
                                    'message',
                                    message.id,
                                    `message:${message.id}`,
                                  )
                                }
                              >
                                {shared === `message:${message.id}` ? (
                                  <Check aria-hidden="true" />
                                ) : (
                                  <Share2 aria-hidden="true" />
                                )}
                              </button>
                              {(message.updatedAt || message.createdAt) && (
                                <time
                                  className="ws-chat-message-time"
                                  dateTime={
                                    message.updatedAt || message.createdAt
                                  }
                                  title={formatDate(
                                    message.updatedAt || message.createdAt,
                                  )}
                                >
                                  {formatMessageTime(
                                    message.updatedAt || message.createdAt,
                                  )}
                                </time>
                              )}
                            </div>
                          )}
                      </div>
                    </div>
                  );
                })}
                {working && messages.at(-1)?.role !== 'agent' && (
                  <p className="ws-chat-working">
                    <span />
                    <span />
                    <span />
                    Starting Agent
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="ws-chatbox-wrap">
            {showScrollToBottom && hasMessages && (
              <button
                type="button"
                className="ws-scroll-to-bottom"
                aria-label="Scroll to latest message"
                title="Scroll to latest message"
                onClick={() => {
                  followBottom.current = true;
                  setShowScrollToBottom(false);
                  scrollArea.current?.scrollTo({
                    top: scrollArea.current.scrollHeight,
                    behavior: 'instant',
                  });
                }}
              >
                <ArrowDown aria-hidden="true" />
              </button>
            )}
            <ComposerDraft
              input={input}
              revision={inputRevision}
              readInput={readDraftInput}
              onInput={onDraftInput}
            >
              {(draftInput, setDraftInput) => (
                <form
                  className={`ws-chatbox${draggingImages ? ' is-dragging' : ''}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    followBottom.current = true;
                    void submitMessage(draftInput);
                  }}
                >
                  {!!images.length && (
                    <div className="ws-chatbox-images">
                      {images.map((image) => (
                        <div key={image.id}>
                          <button
                            type="button"
                            className="ws-chatbox-image-preview"
                            aria-label={`Preview ${image.file.name}`}
                            onClick={() => setComposerPreviewID(image.id)}
                          >
                            {/* oxlint-disable-next-line next/no-img-element -- local object URL preview */}
                            <img src={image.url} alt="" />
                          </button>
                          <button
                            type="button"
                            className="ws-chatbox-image-remove"
                            aria-label={`Remove ${image.file.name}`}
                            onClick={() => onRemoveImage(image.id)}
                          >
                            <X aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div
                    onDragEnter={(event) => {
                      if (!event.dataTransfer.types.includes('Files')) return;
                      event.preventDefault();
                      imageDragDepth.current += 1;
                      setDraggingImages(true);
                    }}
                    onDragOver={(event) => {
                      if (!event.dataTransfer.types.includes('Files')) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'copy';
                    }}
                    onDragLeave={(event) => {
                      if (!event.dataTransfer.types.includes('Files')) return;
                      event.preventDefault();
                      imageDragDepth.current = Math.max(
                        0,
                        imageDragDepth.current - 1,
                      );
                      if (imageDragDepth.current === 0)
                        setDraggingImages(false);
                    }}
                    onDrop={(event) => {
                      if (!event.dataTransfer.types.includes('Files')) return;
                      event.preventDefault();
                      imageDragDepth.current = 0;
                      setDraggingImages(false);
                      onImages(Array.from(event.dataTransfer.files));
                    }}
                  >
                    <InlineComposer
                      input={draftInput}
                      onInput={setDraftInput}
                      reference={quotedMessage}
                      target={delegationTarget}
                      agents={eligibleDelegates}
                      disabled={working || readOnly}
                      onReferenceRemove={() => {
                        setQuotedMessage(undefined);
                        setReferenceRemoved(true);
                      }}
                      onTarget={selectDelegate}
                      onSend={() => void submitMessage(draftInput)}
                      onImages={onImages}
                      editorRef={composer}
                      placeholder={t(
                        readOnly
                          ? readOnlyReason ||
                              'This conversation is shared with view permission.'
                          : 'Ask a question or describe a task…',
                      )}
                    />
                  </div>
                  <footer className="ws-chatbox-footer">
                    <div className="ws-chatbox-context">
                      <Select
                        value={agent.id}
                        disabled={working || readOnly || agentSelectionLocked}
                        onValueChange={(value) => {
                          setDelegationTarget(undefined);
                          onAgent(value ?? agent.id);
                        }}
                      >
                        <SelectTrigger
                          className="ws-composer-agent"
                          aria-label={t('Select Agent')}
                          title={agent.name}
                        >
                          <span className="ws-agent-avatar" aria-hidden="true">
                            {agent.name[0]}
                          </span>
                          <span>{agent.name}</span>
                        </SelectTrigger>
                        <SelectContent
                          className="ws-select-popup"
                          alignItemWithTrigger={false}
                        >
                          {agents.map((item) => {
                            const runtimeMismatch = Boolean(
                              projectRuntimeChoices &&
                              !projectRuntimeChoices.some(
                                (runtime) =>
                                  runtime.provider === item.runtimeProvider &&
                                  (!item.runtimeId ||
                                    item.runtimeId === runtime.runtimeId),
                              ),
                            );
                            return (
                              <SelectItem
                                value={item.id}
                                key={item.id}
                                disabled={runtimeMismatch}
                                title={
                                  runtimeMismatch
                                    ? t(
                                        'This Agent is unavailable on the conversation machine',
                                      )
                                    : undefined
                                }
                              >
                                {item.name}
                                {runtimeMismatch
                                  ? ` · ${t('Different machine')}`
                                  : ''}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      <Select
                        value={project}
                        disabled={
                          working || hasMessages || executionLocked || readOnly
                        }
                        onValueChange={(value) => onProject(value ?? 'none')}
                      >
                        <SelectTrigger
                          className="ws-composer-project"
                          aria-label={t('Select Project')}
                          title={projectLabel}
                        >
                          <Folder aria-hidden="true" />
                          <span>
                            {selectedProject
                              ? `${selectedProject.name}${selectedProject.deletedAt ? ' (deleted)' : ''}`
                              : t('Select project')}
                          </span>
                        </SelectTrigger>
                        <SelectContent
                          className="ws-select-popup"
                          alignItemWithTrigger={false}
                        >
                          <SelectItem value="none">
                            {t('No project')}
                          </SelectItem>
                          {projects
                            .filter((item) => !item.deletedAt)
                            .map((item) => (
                              <SelectItem value={item.id} key={item.id}>
                                {item.name} · {item.workspaceSource}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      {!hasMessages && !executionLocked && (
                        <button
                          type="button"
                          className="ws-add-project"
                          onClick={onAddProject}
                        >
                          <Plus aria-hidden="true" />
                          {t('Add project')}
                        </button>
                      )}
                    </div>
                    <button
                      className="ws-chat-send"
                      type={working ? 'button' : 'submit'}
                      aria-label={
                        working ? t('Stop generating') : t('Send message')
                      }
                      disabled={
                        readOnly ||
                        (!working && !draftInput.trim() && images.length === 0)
                      }
                      onClick={() => working && onStop()}
                    >
                      {working ? (
                        <Square
                          aria-hidden="true"
                          fill="currentColor"
                          strokeWidth={0}
                        />
                      ) : (
                        <Send aria-hidden="true" />
                      )}
                    </button>
                  </footer>
                </form>
              )}
            </ComposerDraft>
            <p className="ws-chat-mode-note">
              {readOnly
                ? t(
                    readOnlyReason ||
                      'This conversation is shared with view permission.',
                  )
                : `${agent.name} · ${runtimeLabel} · ${agent.model}`}
            </p>
          </div>
        </section>
      </SidebarInset>
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className={`ws-review-sidebar ${reviewResizing ? 'is-resizing' : ''}`}
      >
        <aside className="ws-review-panel" aria-label="Conversation review">
          <header className="ws-review-header">
            <div className="ws-browser-tabs" aria-label="Workspace tabs">
              {workspaceTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={
                    activeWorkspaceTab === tab.id && reviewTab !== 'home'
                      ? 'is-active'
                      : ''
                  }
                >
                  <Button
                    variant="ghost"
                    aria-pressed={
                      activeWorkspaceTab === tab.id && reviewTab !== 'home'
                    }
                    onClick={() => activateWorkspaceTab(tab)}
                  >
                    <FileText aria-hidden="true" />
                    <span>{tab.title}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Close ${tab.title}`}
                    onClick={() => closeWorkspaceTab(tab.id)}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                size="icon"
                aria-label="New workspace tab"
                onClick={() => setReviewTab('home')}
              >
                <Plus aria-hidden="true" />
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close review panel"
              onClick={() => setReviewOpen(false)}
            >
              <PanelLeft className="ws-panel-toggle-right" aria-hidden="true" />
            </Button>
          </header>
          <div className="ws-review-body">
            {reviewTab === 'home' ? (
              <div className="ws-review-launcher">
                <Button
                  variant="ghost"
                  onClick={() => openWorkspaceTab('files')}
                >
                  <Folder aria-hidden="true" />
                  <span>
                    Files
                    <small>Browse the actual session workspace</small>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => openWorkspaceTab('changes')}
                >
                  <FileText aria-hidden="true" />
                  <span>
                    Code review
                    <small>Inspect files changed in each agent turn</small>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => openWorkspaceTab('documents')}
                >
                  <Folder aria-hidden="true" />
                  <span>
                    Documents
                    <small>Preview outputs attached to this conversation</small>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            ) : reviewTab === 'files' ? (
              <WorkspaceFiles
                key={`${reviewRunID}:${activeWorkspaceTab}`}
                runId={reviewRunID}
                initialPath={
                  workspaceTabs.find((tab) => tab.id === activeWorkspaceTab)
                    ?.path || ''
                }
                fallbackSnapshot={
                  workspaceTabs.find((tab) => tab.id === activeWorkspaceTab)
                    ?.snapshot
                }
                branch={workspaceBranch}
                onPathChange={(path) =>
                  setWorkspaceTabs((tabs) =>
                    tabs.map((tab) =>
                      tab.id === activeWorkspaceTab ? { ...tab, path } : tab,
                    ),
                  )
                }
              />
            ) : reviewTab === 'changes' ? (
              <CodeReview
                key={reviewMessage?.runId}
                runId={reviewMessage?.runId || ''}
                reportedChanges={changes}
                selectedPath={selectedChange || currentChange?.path || ''}
                turn={reviewRounds.indexOf(reviewMessage!) + 1}
                branch={workspaceBranch}
                rounds={reviewRounds}
                onTurn={(runId) => openWorkspaceTab('changes', runId)}
                onSelect={(path) => {
                  setSelectedChange(path);
                  setWorkspaceTabs((tabs) =>
                    tabs.map((tab) =>
                      tab.id === activeWorkspaceTab ? { ...tab, path } : tab,
                    ),
                  );
                }}
              />
            ) : (
              <>
                <div className="ws-chat-review-list">
                  {artifacts.map((artifact) => (
                    <button
                      key={artifact.id}
                      className={previewID === artifact.id ? 'selected' : ''}
                      onClick={() => selectPreview(artifact.id)}
                    >
                      <FileText aria-hidden="true" />
                      <span>
                        <strong>{artifact.title}</strong>
                        <small>
                          {artifact.type}
                          {artifact.size
                            ? ` · ${formatSize(artifact.size)}`
                            : ''}
                        </small>
                      </span>
                      <ChevronRight aria-hidden="true" />
                    </button>
                  ))}
                </div>
                {!artifacts.length && (
                  <p className="ws-review-empty">
                    Documents and durable outputs will appear here.
                  </p>
                )}
                {previewID && (
                  <div className="ws-chat-artifact-preview">
                    <div className="ws-review-document-actions">
                      <Button
                        variant="ghost"
                        aria-pressed={!previewSource}
                        onClick={() => setPreviewSource(false)}
                      >
                        Preview
                      </Button>
                      <Button
                        variant="ghost"
                        aria-pressed={previewSource}
                        onClick={() => setPreviewSource(true)}
                      >
                        Source
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Open full document review"
                        onClick={() => onArtifact(previewID)}
                      >
                        <ExternalLink aria-hidden="true" />
                      </Button>
                    </div>
                    {previewError ? (
                      <p role="alert">{previewError}</p>
                    ) : preview ? (
                      previewSource ? (
                        <pre className="ws-review-source">{preview}</pre>
                      ) : (
                        <Markdown>{preview}</Markdown>
                      )
                    ) : (
                      <output>Loading preview…</output>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </aside>
        <hr
          className="ws-review-resize"
          aria-label="Resize review panel"
          aria-orientation="vertical"
          onPointerDown={startReviewResize}
        />
      </Sidebar>
    </SidebarProvider>
  );
}

function workspaceRelativePath(path: string, root: string) {
  const normalizedPath = path.replace(/^file:\/\//, '').replace(/\\/g, '/');
  const normalizedRoot = root.replace(/\/$/, '').replace(/\\/g, '/');
  if (normalizedPath === normalizedRoot) return '';
  if (normalizedPath.startsWith(`${normalizedRoot}/`))
    return normalizedPath.slice(normalizedRoot.length + 1);
  // Preserve absolute paths outside the prepared workspace so Relay can reject
  // them explicitly instead of accidentally treating them as relative paths.
  if (normalizedPath.startsWith('/')) return normalizedPath;
  return normalizedPath.replace(/^\.\//, '').replace(/^\//, '');
}

function WorkspaceFiles({
  runId,
  initialPath,
  fallbackSnapshot,
  branch,
  onPathChange,
}: {
  runId: string;
  initialPath: string;
  fallbackSnapshot?: string;
  branch: string;
  onPathChange: (path: string) => void;
}) {
  const { t } = useI18n();
  const directoryID = useId();
  const [fileBrowserOverride, setFileBrowserOverride] = useState<
    boolean | null
  >(null);
  const [fileFilter, setFileFilter] = useState('');
  const [data, setData] = useState<{
    root: string;
    path: string;
    content: string;
    entries: Array<{ name: string; directory: boolean; size: number }>;
  } | null>(null);
  const [directory, setDirectory] = useState('');
  const [filePath, setFilePath] = useState('');
  const [content, setContent] = useState<string | null>(null);
  const [imageSource, setImageSource] = useState('');
  const [listing, setListing] = useState(true);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [snapshotNotice, setSnapshotNotice] = useState('');
  const [gitStatus, setGitStatus] = useState<WorkspaceGitStatus>();
  const listSequence = useRef(0);
  const readSequence = useRef(0);
  const loadList = useCallback(
    (path: string) => {
      const current = ++listSequence.current;
      setListing(true);
      setError('');
      void steer
        .inspectWorkspace(runId, 'list', path)
        .then((result) => {
          if (current !== listSequence.current) return;
          setData(result);
          setDirectory(path);
        })
        .catch((err) => {
          if (current === listSequence.current)
            setError(
              err instanceof Error ? err.message : 'Workspace unavailable',
            );
        })
        .finally(() => {
          if (current === listSequence.current) setListing(false);
        });
    },
    [runId],
  );
  const loadFile = useCallback(
    (path: string) => {
      const current = ++readSequence.current;
      setReading(true);
      setFilePath(path);
      setContent(null);
      setImageSource('');
      setError('');
      setSnapshotNotice('');
      void steer
        .inspectWorkspace(runId, 'read', path)
        .then((result) => {
          if (current !== readSequence.current) return;
          setContent(result.content);
          setImageSource(workspaceImageSource(result));
          setSnapshotNotice('');
        })
        .catch((err) => {
          if (current !== readSequence.current) return;
          if (
            path === workspaceRelativePath(initialPath, data?.root || '') &&
            fallbackSnapshot !== undefined
          ) {
            setContent(fallbackSnapshot);
            setSnapshotNotice(
              'The live file is unavailable. Showing the content captured during the agent run.',
            );
            return;
          }
          setError(
            err instanceof Error ? err.message : 'Workspace unavailable',
          );
        })
        .finally(() => {
          if (current === readSequence.current) setReading(false);
        });
    },
    [data?.root, fallbackSnapshot, initialPath, runId],
  );
  useEffect(() => {
    if (!runId) return;
    const current = ++listSequence.current;
    let cancelled = false;
    void steer
      .inspectWorkspace(runId, 'git-status')
      .then((result) => {
        if (!cancelled) setGitStatus(result.git);
      })
      .catch(() => undefined);
    void steer
      .inspectWorkspace(runId, 'list')
      .then((result) => {
        if (current !== listSequence.current) return;
        setData(result);
        setDirectory('');
      })
      .catch((err) => {
        if (current === listSequence.current)
          setError(
            err instanceof Error ? err.message : 'Workspace unavailable',
          );
      })
      .finally(() => {
        if (current === listSequence.current) setListing(false);
      });
    return () => {
      cancelled = true;
      listSequence.current += 1;
      readSequence.current += 1;
    };
  }, [runId]);
  useEffect(() => {
    if (!data || !initialPath) return;
    const normalizedPath = workspaceRelativePath(initialPath, data.root);
    if (!normalizedPath || normalizedPath === filePath) return;
    const current = ++readSequence.current;
    void steer
      .inspectWorkspace(runId, 'read', normalizedPath)
      .then((result) => {
        if (current !== readSequence.current) return;
        setFilePath(normalizedPath);
        setContent(result.content);
        setImageSource(workspaceImageSource(result));
        setError('');
        setSnapshotNotice('');
      })
      .catch((err) => {
        if (current !== readSequence.current) return;
        setFilePath(normalizedPath);
        if (fallbackSnapshot !== undefined) {
          setContent(fallbackSnapshot);
          setError('');
          setSnapshotNotice(
            'The live file is unavailable. Showing the content captured during the agent run.',
          );
          return;
        }
        setError(err instanceof Error ? err.message : 'Workspace unavailable');
        setContent(null);
        setImageSource('');
        setSnapshotNotice('');
      });
  }, [data, fallbackSnapshot, filePath, initialPath, runId]);
  const loading = listing || reading;
  const previewingImage =
    Boolean(imageSource) ||
    /\.(png|jpe?g|gif|webp)$/i.test(filePath || initialPath);
  const fileBrowserOpen = fileBrowserOverride ?? !previewingImage;
  if (!runId)
    return (
      <p className="ws-review-empty">
        Start a project conversation to browse its prepared workspace.
      </p>
    );
  return (
    <div className="ws-workspace-files">
      <div className="ws-workspace-toolbar">
        <nav
          className="ws-workspace-breadcrumbs"
          aria-label="Current file path"
          title={[data?.root, filePath || directory].filter(Boolean).join('/')}
        >
          <span className="ws-workspace-root">
            {data?.root?.split('/').filter(Boolean).pop() || 'Workspace'}
          </span>
          {(filePath || directory) && (
            <>
              <ChevronRight aria-hidden="true" />
              <span className="ws-workspace-current-file">
                {filePath || directory}
              </span>
            </>
          )}
        </nav>
        <GitBranchLabel branch={gitStatusBranch(gitStatus) || branch} />
        <Button
          variant="ghost"
          size="icon"
          className="ws-workspace-directory-toggle"
          aria-label={t(
            fileBrowserOpen ? 'Hide file browser' : 'Show file browser',
          )}
          title={t(fileBrowserOpen ? 'Hide file browser' : 'Show file browser')}
          aria-expanded={fileBrowserOpen}
          aria-controls={directoryID}
          onClick={() => setFileBrowserOverride(!fileBrowserOpen)}
        >
          {fileBrowserOpen ? (
            <PanelRightClose aria-hidden="true" />
          ) : (
            <PanelRightOpen aria-hidden="true" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="ws-workspace-refresh"
          aria-label="Refresh files"
          title="Refresh files"
          disabled={loading}
          onClick={() => {
            loadList(directory);
            void steer
              .inspectWorkspace(runId, 'git-status')
              .then((result) => setGitStatus(result.git))
              .catch(() => setGitStatus(undefined));
          }}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </div>
      {error && (
        <p className="ws-form-error" role="alert">
          {error}
        </p>
      )}
      {snapshotNotice && (
        <output className="ws-workspace-snapshot-notice">
          {snapshotNotice}
        </output>
      )}
      {loading && <output>Loading…</output>}
      <div
        className={`ws-workspace-columns${fileBrowserOpen ? '' : ' is-directory-collapsed'}`}
      >
        <section className="ws-workspace-preview" aria-label="File preview">
          {content !== null ? (
            imageSource ? (
              <WorkspaceImagePreview source={imageSource} path={filePath} />
            ) : filePath.toLowerCase().endsWith('.md') ? (
              <Markdown>{content}</Markdown>
            ) : (
              <HighlightedFile path={filePath} content={content} />
            )
          ) : (
            <p className="ws-review-empty">
              {loading && filePath
                ? 'Loading file…'
                : 'Select a file from the directory to preview its contents.'}
            </p>
          )}
        </section>
        <nav
          id={directoryID}
          className="ws-workspace-directory"
          aria-label="Directory navigation"
          hidden={!fileBrowserOpen}
        >
          <input
            className="ws-workspace-filter"
            aria-label="Filter files"
            placeholder="Filter files…"
            value={fileFilter}
            onChange={(event) => setFileFilter(event.target.value)}
          />
          <div className="ws-workspace-file-list">
            {[...(data?.entries || [])]
              .filter((entry) =>
                entry.name.toLowerCase().includes(fileFilter.toLowerCase()),
              )
              .sort(
                (a, b) =>
                  Number(b.directory) - Number(a.directory) ||
                  a.name.localeCompare(b.name),
              )
              .map((entry) => (
                <WorkspaceTreeEntry
                  key={`${entry.name}:${data?.root}`}
                  runId={runId}
                  entry={entry}
                  path={entry.name}
                  depth={0}
                  selected={filePath}
                  onSelect={(path) => {
                    onPathChange(path);
                    loadFile(path);
                  }}
                />
              ))}
          </div>
        </nav>
      </div>
    </div>
  );
}
type WorkspaceEntry = { name: string; directory: boolean; size: number };
function workspaceImageSource(result: {
  content: string;
  encoding?: string;
  content_type?: string;
}) {
  return result.encoding === 'base64' &&
    /^image\/(png|jpeg|gif|webp)$/.test(result.content_type || '')
    ? `data:${result.content_type};base64,${result.content}`
    : '';
}

function WorkspaceImagePreview({
  source,
  path,
}: {
  source: string;
  path: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const name = path.split('/').at(-1) || 'Image';
  return (
    <div className="ws-workspace-image-preview">
      <div className="ws-workspace-image-actions">
        <Button variant="ghost" onClick={() => setExpanded(true)}>
          View full image
        </Button>
        <a href={source} download={name}>
          <Download aria-hidden="true" />
          Download
        </a>
      </div>
      <button
        type="button"
        aria-label={`Expand ${name}`}
        onClick={() => setExpanded(true)}
      >
        {/* oxlint-disable-next-line next/no-img-element -- authenticated image read from the remote workspace */}
        <img src={source} alt={name} />
      </button>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="ws-image-preview-dialog">
          <DialogTitle className="sr-only">{name}</DialogTitle>
          <DialogDescription className="sr-only">
            Full-size workspace image preview.
          </DialogDescription>
          {/* oxlint-disable-next-line next/no-img-element -- image data already loaded from the remote workspace */}
          <img src={source} alt={name} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
function FileTypeIcon({ path }: { path: string }) {
  const ext = path.split('.').at(-1)?.toLowerCase() || '';
  if (['json', 'yaml', 'yml', 'toml'].includes(ext))
    return <FileJson className="is-config" aria-hidden="true" />;
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext))
    return <FileImage className="is-image" aria-hidden="true" />;
  if (
    [
      'ts',
      'tsx',
      'js',
      'jsx',
      'go',
      'py',
      'rs',
      'java',
      'c',
      'cpp',
      'h',
      'css',
      'html',
      'sh',
    ].includes(ext)
  )
    return <FileCode className="is-code" aria-hidden="true" />;
  return <FileText aria-hidden="true" />;
}
function WorkspaceTreeEntry({
  runId,
  entry,
  path,
  depth,
  selected,
  onSelect,
}: {
  runId: string;
  entry: WorkspaceEntry;
  path: string;
  depth: number;
  selected: string;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<WorkspaceEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="ws-file-tree-entry">
      <Button
        variant="ghost"
        style={{ paddingLeft: 8 + depth * 14 }}
        aria-expanded={entry.directory ? expanded : undefined}
        aria-current={
          !entry.directory && selected === path ? 'true' : undefined
        }
        onClick={() => {
          if (!entry.directory) {
            onSelect(path);
            return;
          }
          setExpanded(!expanded);
          if (!expanded && children === null && !busy) {
            setBusy(true);
            setError('');
            void steer
              .inspectWorkspace(runId, 'list', path)
              .then((result) => setChildren(result.entries))
              .catch((err) => setError(err.message))
              .finally(() => setBusy(false));
          }
        }}
      >
        {entry.directory ? (
          <>
            <ChevronRight
              className={expanded ? 'is-expanded' : ''}
              aria-hidden="true"
            />
            <Folder aria-hidden="true" />
          </>
        ) : (
          <>
            <span className="ws-tree-spacer" />
            <FileTypeIcon path={path} />
          </>
        )}
        <span title={path}>{entry.name}</span>
      </Button>
      {expanded && (
        <div>
          {busy && <small>Loading…</small>}
          {error && <small role="alert">{error}</small>}
          {children?.length === 0 && <small>Empty directory</small>}
          {[...(children || [])]
            .sort(
              (a, b) =>
                Number(b.directory) - Number(a.directory) ||
                a.name.localeCompare(b.name),
            )
            .map((child) => (
              <WorkspaceTreeEntry
                key={child.name}
                runId={runId}
                entry={child}
                path={`${path}/${child.name}`}
                depth={depth + 1}
                selected={selected}
                onSelect={onSelect}
              />
            ))}
        </div>
      )}
    </div>
  );
}
const HighlightedFile = memo(function HighlightedFile({
  path,
  content,
}: {
  path: string;
  content: string;
}) {
  const ext = path.split('.').at(-1)?.toLowerCase() || '';
  const languages: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    html: 'xml',
    svg: 'xml',
    css: 'css',
    go: 'go',
    py: 'python',
    rs: 'rust',
    sh: 'bash',
    sql: 'sql',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    md: 'markdown',
  };
  const language = languages[ext];
  if (!language || !hljs.getLanguage(language) || content.length > 200000)
    return <pre className="ws-review-source">{content}</pre>;
  // Only escaped HTML produced by the highlighter is inserted, never raw file content.
  const html = hljs.highlight(content, {
    language,
    ignoreIllegals: true,
  }).value;
  return (
    <pre className="ws-review-source">
      <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
});
type ReviewChange = {
  id: string;
  path: string;
  diff: string;
  snapshot?: string;
};

function mergeWorkspaceChanges(
  liveChanges: ReviewChange[],
  reportedChanges: ReviewChange[],
  root: string,
) {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '');
  const relativePath = (path: string) => {
    const normalized = path.replace(/^file:\/\//, '').replace(/\\/g, '/');
    return normalizedRoot && normalized.startsWith(`${normalizedRoot}/`)
      ? normalized.slice(normalizedRoot.length + 1)
      : normalized;
  };
  const changes = new Map<string, ReviewChange>();
  for (const change of reportedChanges) {
    const path = relativePath(change.path);
    changes.set(path, { ...change, id: path, path });
  }
  for (const change of liveChanges) changes.set(change.path, change);
  return [...changes.values()];
}

function changeStats(change: ReviewChange) {
  return change.diff.split('\n').reduce(
    (stats, line) => {
      if (line.startsWith('+') && !line.startsWith('+++')) stats.additions += 1;
      if (line.startsWith('-') && !line.startsWith('---')) stats.deletions += 1;
      return stats;
    },
    { additions: 0, deletions: 0 },
  );
}

function CodeReview({
  runId,
  reportedChanges,
  selectedPath,
  turn,
  branch,
  rounds,
  onTurn,
  onSelect,
}: {
  runId: string;
  reportedChanges: ReviewChange[];
  selectedPath: string;
  turn: number;
  branch: string;
  rounds: ChatMessage[];
  onTurn: (runId: string) => void;
  onSelect: (path: string) => void;
}) {
  const [workspaceChanges, setWorkspaceChanges] = useState<
    ReviewChange[] | null
  >(null);
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [filesVisible, setFilesVisible] = useState(true);
  const [loading, setLoading] = useState(Boolean(runId));
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [gitStatus, setGitStatus] = useState<WorkspaceGitStatus>();
  const load = useCallback(() => {
    if (!runId) return;
    setLoading(true);
    setError('');
    void steer
      .inspectWorkspace(runId, 'git-status')
      .then((result) => setGitStatus(result.git))
      .catch(() => setGitStatus(undefined));
    void steer
      .inspectWorkspace(runId, 'diff')
      .then((result) => {
        setWorkspaceRoot(result.root);
        setWorkspaceChanges(
          mergeWorkspaceChanges(
            splitWorkspaceDiff(result.content),
            reportedChanges,
            result.root,
          ),
        );
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [reportedChanges, runId]);
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    void steer
      .inspectWorkspace(runId, 'git-status')
      .then((result) => {
        if (!cancelled) setGitStatus(result.git);
      })
      .catch(() => undefined);
    void steer
      .inspectWorkspace(runId, 'diff')
      .then((result) => {
        if (!cancelled) {
          setWorkspaceRoot(result.root);
          setWorkspaceChanges(
            mergeWorkspaceChanges(
              splitWorkspaceDiff(result.content),
              reportedChanges,
              result.root,
            ),
          );
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reportedChanges, runId]);
  const changes = workspaceChanges?.length ? workspaceChanges : reportedChanges;
  const current =
    changes.find(
      (change) =>
        change.path === selectedPath ||
        change.path === workspaceRelativePath(selectedPath, workspaceRoot),
    ) || changes[0];
  const totals = changes.reduce(
    (value, change) => {
      const stats = changeStats(change);
      value.additions += stats.additions;
      value.deletions += stats.deletions;
      return value;
    },
    { additions: 0, deletions: 0 },
  );
  return (
    <div className="ws-code-review">
      <div className="ws-code-review-toolbar">
        <details className="ws-review-turn-picker">
          <summary>
            Turn {turn} <ChevronDown aria-hidden="true" />
          </summary>
          <div>
            {rounds.map((message, index) => (
              <Button
                key={message.runId}
                variant="ghost"
                onClick={(event) => {
                  onTurn(message.runId || '');
                  event.currentTarget
                    .closest('details')
                    ?.removeAttribute('open');
                }}
              >
                Turn {index + 1}
                <small>{message.status}</small>
              </Button>
            ))}
          </div>
        </details>
        <GitBranchLabel branch={gitStatusBranch(gitStatus) || branch} />
        <div className="ws-code-review-summary">
          <span>{changes.length} files</span>
          <strong>+{totals.additions}</strong>
          <em>−{totals.deletions}</em>
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              filesVisible ? 'Hide changed files' : 'Show changed files'
            }
            title={filesVisible ? 'Hide changed files' : 'Show changed files'}
            aria-expanded={filesVisible}
            onClick={() => setFilesVisible((visible) => !visible)}
          >
            {filesVisible ? (
              <PanelRightClose aria-hidden="true" />
            ) : (
              <PanelRightOpen aria-hidden="true" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Refresh workspace diff"
            title="Refresh workspace diff"
            disabled={!runId || loading}
            onClick={load}
          >
            <RefreshCw
              className={loading ? 'is-spinning' : ''}
              aria-hidden="true"
            />
          </Button>
        </div>
      </div>
      {error && (
        <output className="ws-code-review-notice">
          <strong>Live workspace diff is unavailable.</strong>
          <span>{error}</span>
          <small>Showing the agent turn patch.</small>
        </output>
      )}
      {changes.length ? (
        <div
          className={`ws-code-review-columns${filesVisible ? '' : ' is-files-hidden'}`}
        >
          <section className="ws-code-review-preview" aria-label="Code diff">
            {current ? (
              <>
                <header>
                  <FileTypeIcon path={current.path} />
                  <span title={current.path}>{current.path}</span>
                  <DiffStats change={current} />
                </header>
                {current.diff ? (
                  <DiffPreview diff={current.diff} path={current.path} />
                ) : (
                  <p className="ws-review-empty">
                    Diff content was not reported for this file.
                  </p>
                )}
              </>
            ) : null}
          </section>
          <nav
            className="ws-code-review-files"
            aria-label="Changed files"
            hidden={!filesVisible}
          >
            <input
              className="ws-workspace-filter"
              aria-label="Filter changed files"
              placeholder="Filter changed files…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <ChangedFilesTree
              changes={changes.filter((change) =>
                change.path.toLowerCase().includes(filter.toLowerCase()),
              )}
              selected={current?.path || ''}
              onSelect={onSelect}
            />
          </nav>
        </div>
      ) : (
        <p className="ws-review-empty">
          {loading
            ? 'Loading workspace diff…'
            : 'No file changes were reported.'}
        </p>
      )}
    </div>
  );
}

function DiffStats({ change }: { change: ReviewChange }) {
  const stats = changeStats(change);
  return (
    <span className="ws-diff-stats">
      <strong>+{stats.additions}</strong>
      <em>−{stats.deletions}</em>
    </span>
  );
}

type ChangeTreeNode = {
  name: string;
  path: string;
  children: Map<string, ChangeTreeNode>;
  change?: ReviewChange;
};

function ChangedFilesTree({
  changes,
  selected,
  onSelect,
}: {
  changes: ReviewChange[];
  selected: string;
  onSelect: (path: string) => void;
}) {
  const [collapsedDirectories, setCollapsedDirectories] = useState<Set<string>>(
    () => new Set(),
  );
  const root: ChangeTreeNode = {
    name: '',
    path: '',
    children: new Map(),
  };
  for (const change of changes) {
    let node = root;
    const parts = change.path.split('/').filter(Boolean);
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join('/');
      if (!node.children.has(name))
        node.children.set(name, { name, path, children: new Map() });
      node = node.children.get(name)!;
      if (index === parts.length - 1) node.change = change;
    });
  }
  const renderNode = (node: ChangeTreeNode, depth: number): ReactNode => {
    if (node.change)
      return (
        <Button
          key={node.path}
          variant="ghost"
          className={selected === node.path ? 'is-selected' : ''}
          style={{ paddingLeft: 8 + depth * 14 }}
          aria-current={selected === node.path ? 'true' : undefined}
          onClick={() => onSelect(node.path)}
        >
          <FileTypeIcon path={node.path} />
          <span title={node.path}>{node.name}</span>
          <DiffStats change={node.change} />
        </Button>
      );
    return (
      <div className="ws-change-directory" key={node.path || 'root'}>
        {node.path && (
          <Button
            variant="ghost"
            className="ws-change-directory-header"
            style={{ paddingLeft: 8 + depth * 14 }}
            aria-expanded={!collapsedDirectories.has(node.path)}
            onClick={() =>
              setCollapsedDirectories((current) => {
                const next = new Set(current);
                if (next.has(node.path)) next.delete(node.path);
                else next.add(node.path);
                return next;
              })
            }
          >
            {collapsedDirectories.has(node.path) ? (
              <ChevronRight aria-hidden="true" />
            ) : (
              <ChevronDown aria-hidden="true" />
            )}
            <Folder aria-hidden="true" />
            <span title={node.path}>{node.name}</span>
          </Button>
        )}
        {!collapsedDirectories.has(node.path) &&
          [...node.children.values()]
            .sort(
              (a, b) =>
                Number(Boolean(a.change)) - Number(Boolean(b.change)) ||
                a.name.localeCompare(b.name),
            )
            .map((child) => renderNode(child, node.path ? depth + 1 : depth))}
      </div>
    );
  };
  return <div className="ws-changed-files-tree">{renderNode(root, 0)}</div>;
}

function languageForPath(path: string) {
  const languages: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    html: 'xml',
    svg: 'xml',
    css: 'css',
    go: 'go',
    py: 'python',
    rs: 'rust',
    sh: 'bash',
    sql: 'sql',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    md: 'markdown',
  };
  return languages[path.split('.').at(-1)?.toLowerCase() || ''];
}

function parseDiffRows(diff: string) {
  let oldLine = 0;
  let newLine = 0;
  return diff.split('\n').map((line) => {
    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { line, old: '', next: '', type: 'hunk' };
    }
    if (line.startsWith('+') && !line.startsWith('+++'))
      return { line, old: '', next: String(newLine++), type: 'addition' };
    if (line.startsWith('-') && !line.startsWith('---'))
      return { line, old: String(oldLine++), next: '', type: 'deletion' };
    if (line.startsWith(' ') && oldLine && newLine)
      return {
        line,
        old: String(oldLine++),
        next: String(newLine++),
        type: 'context',
      };
    return { line, old: '', next: '', type: 'meta' };
  });
}

const DiffPreview = memo(function DiffPreview({
  diff,
  path,
}: {
  diff: string;
  path: string;
}) {
  const language = languageForPath(path);
  const rows = parseDiffRows(diff);
  return (
    <div className="ws-review-diff" aria-label="File diff">
      {rows.map((row, index) => {
        const source = ['addition', 'deletion', 'context'].includes(row.type)
          ? row.line.slice(1)
          : row.line;
        const html =
          language && hljs.getLanguage(language)
            ? hljs.highlight(source || ' ', { language, ignoreIllegals: true })
                .value
            : escapeHTML(source || ' ');
        return (
          <div key={index} className={`is-${row.type}`}>
            <span>{row.old}</span>
            <span>{row.next}</span>
            <code>
              <i aria-hidden="true">
                {row.type === 'addition'
                  ? '+'
                  : row.type === 'deletion'
                    ? '−'
                    : row.type === 'context'
                      ? ' '
                      : ''}
              </i>
              <span dangerouslySetInnerHTML={{ __html: html }} />
            </code>
          </div>
        );
      })}
    </div>
  );
});

function escapeHTML(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[character]!,
  );
}

function ArtifactsView({
  artifacts,
  selected,
  onSelect,
}: {
  artifacts: Artifact[];
  selected: number;
  onSelect: (value: number) => void;
}) {
  const [preview, setPreview] = useState({ id: '', content: '', error: '' });
  const artifact = artifacts[selected];
  useEffect(() => {
    if (!artifact) return;
    let cancelled = false;
    steer
      .artifactContent(artifact.id)
      .then((result) => {
        if (!cancelled)
          setPreview({ id: artifact.id, content: result.content, error: '' });
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setPreview({
            id: artifact.id,
            content: '',
            error:
              error instanceof Error
                ? error.message
                : 'Could not load this file.',
          });
      });
    return () => {
      cancelled = true;
    };
  }, [artifact]);
  if (!artifacts.length)
    return (
      <div className="ws-page ws-artifacts-empty-page">
        <PageIntro
          eyebrow="WORKSPACE"
          title="Artifacts"
          description="Review durable outputs created by conversation runs. Agent replies stay in their original conversation."
          action={<span className="ws-artifact-count">0 artifacts</span>}
        />
        <div className="ws-artifacts-empty-panel">
          <Empty
            icon={<FileText aria-hidden="true" />}
            title="No artifacts yet"
            text="Documents, code changes, and exports will appear here when an Agent produces a durable output."
          />
        </div>
      </div>
    );
  return (
    <div className="ws-artifact-layout">
      <section className="ws-artifact-list">
        <div className="ws-list-header">
          <div>
            <h1>Artifacts</h1>
            <span>{artifacts.length} durable outputs</span>
          </div>
          <FileText aria-hidden="true" />
        </div>
        {artifacts.length
          ? artifacts.map((item, index) => (
              <button
                type="button"
                className={selected === index ? 'selected' : ''}
                key={item.id}
                onClick={() => onSelect(index)}
              >
                <FileText aria-hidden="true" />
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.type} · {formatDate(item.createdAt)}
                  </small>
                </span>
                <span>
                  <small>{item.state}</small>
                </span>
              </button>
            ))
          : null}
      </section>
      <article className="ws-document">
        {artifact ? (
          <>
            <header>
              <span>Conversation artifact</span>
              <span className="ws-grow" />
              <a
                className="ws-download"
                href={steer.artifactDownloadURL(artifact.id)}
                download={artifact.fileName}
              >
                <Download aria-hidden="true" />
                Download
              </a>
            </header>
            <div className="ws-document-body">
              <span className="ws-eyebrow">{artifact.type}</span>
              <h1>{artifact.title}</h1>
              <p className="ws-file-meta">
                <FileText aria-hidden="true" />
                {artifact.fileName}
                <span>·</span>
                {formatDate(artifact.createdAt)}
              </p>
              <div className="ws-artifact-content">
                {preview.id !== artifact.id ? (
                  <output>Loading file…</output>
                ) : preview.error ? (
                  <p role="alert">{preview.error}</p>
                ) : artifact.contentType?.includes('markdown') ||
                  artifact.fileName?.endsWith('.md') ? (
                  <Markdown>{preview.content}</Markdown>
                ) : (
                  <pre className="ws-plain-file">{preview.content}</pre>
                )}
              </div>
              <details className="ws-file-provenance">
                <summary>File details</summary>
                <dl>
                  <dt>Source</dt>
                  <dd>{artifact.source}</dd>
                  <dt>Run</dt>
                  <dd>{artifact.relayRunId}</dd>
                </dl>
              </details>
            </div>
          </>
        ) : (
          <div className="ws-document-empty">
            <Empty
              icon={<FileText />}
              title="Select an artifact"
              text="Choose a durable output to preview and download it."
            />
          </div>
        )}
      </article>
    </div>
  );
}

function RuntimeCapacityStepper({
  node,
  onCapacity,
}: {
  node: RelayNode;
  onCapacity: (nodeID: string, capacity: number) => Promise<void>;
}) {
  const confirmedCapacity = node.desired_capacity ?? node.capacity;
  const [draft, setDraft] = useState<number | null>(null);
  const [state, setState] = useState<'idle' | 'waiting' | 'saving' | 'error'>(
    'idle',
  );
  const value = draft ?? confirmedCapacity;
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const changeCapacity = (delta: number) => {
    const next = Math.min(32, Math.max(1, value + delta));
    if (next === value) return;
    setDraft(next);
    setState('waiting');
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setState('saving');
      void onCapacity(node.id, next)
        .then(() => {
          setDraft(null);
          setState('idle');
        })
        .catch(() => {
          setDraft(null);
          setState('error');
        });
    }, 500);
  };

  const applying = confirmedCapacity !== node.capacity;
  const caption =
    state === 'waiting'
      ? 'Waiting for more changes…'
      : state === 'saving'
        ? 'Saving concurrency…'
        : state === 'error'
          ? 'Update failed · try again'
          : applying
            ? `Applying ${node.capacity} → ${confirmedCapacity}`
            : 'Maximum concurrent runs';

  return (
    <span className="ws-runtime-capacity-control">
      <span className="ws-runtime-capacity-stepper">
        <button
          type="button"
          aria-label={`Decrease concurrency for ${node.id}`}
          disabled={state === 'saving' || value <= 1}
          onClick={() => changeCapacity(-1)}
        >
          −
        </button>
        <output aria-live="polite">{value}</output>
        <button
          type="button"
          aria-label={`Increase concurrency for ${node.id}`}
          disabled={state === 'saving' || value >= 32}
          onClick={() => changeCapacity(1)}
        >
          +
        </button>
      </span>
      <small className={`is-${state}${applying ? ' is-applying' : ''}`}>
        {caption}
      </small>
    </span>
  );
}

function AgentsView({
  shares,
  sharingError,
  onShareAgent,
  onUseSharedAgent,
  onRefreshSharing,
  agents,
  runtimes,
  relayConnected,
  relayError,
  tab,
  onTab,
  onCreate,
  onEdit,
  onDelete,
  onAddRuntime,
  onCapacity,
  onDisconnect,
  onRemoveNode,
  onNotice,
  onChat,
}: {
  shares: ResourceShare[];
  sharingError: string;
  onShareAgent: (agent: AgentItem) => void;
  onUseSharedAgent: (share: ResourceShare) => Promise<void>;
  onRefreshSharing: () => Promise<void>;
  agents: AgentItem[];
  runtimes: RuntimeSummary[];
  relayConnected: boolean;
  relayError: string;
  tab: string;
  onTab: (value: string) => void;
  onCreate: () => void;
  onEdit: (agent: AgentItem) => void;
  onDelete: (agent: AgentItem) => void;
  onAddRuntime: () => void;
  onCapacity: (nodeID: string, capacity: number) => Promise<void>;
  onDisconnect: (bindingID: string) => Promise<void>;
  onRemoveNode: (node: RelayNode) => void;
  onNotice: (message: string) => void;
  onChat: (id: string) => void;
}) {
  const { language, t } = useI18n();
  const nodeStatus = (node: RelayNode) => {
    const lastSeen = new Date(node.last_seen);
    const heartbeat = Number.isNaN(lastSeen.getTime())
      ? t('unknown time')
      : new Intl.DateTimeFormat(language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(lastSeen);
    return node.state === 'offline'
      ? t('Offline · last heartbeat {time}', { time: heartbeat })
      : t('Online · last heartbeat {time}', { time: heartbeat });
  };
  const runtimeName = (agent: AgentItem) => {
    if (!agent.runtimeId) return agent.runtime;
    for (const [node] of runtimes) {
      const runtime = node.runtimes.find(
        (candidate) => candidate.id === agent.runtimeId,
      );
      if (runtime) {
        return `${node.labels?.name || node.id} / ${t(runtimeProviderName(runtime.provider))}`;
      }
    }
    return (
      t(runtimeProviderName(agent.runtimeProvider)) || t('Runtime unavailable')
    );
  };
  return (
    <div className="ws-page">
      <PageIntro
        eyebrow={t('System').toUpperCase()}
        title={tab !== 'runtimes' ? t('Agents') : t('Runtimes')}
        description={
          tab !== 'runtimes'
            ? t(
                'Configure reusable roles, models, and Runtime scheduling preferences.',
              )
            : t(
                'View execution nodes, Runtime versions, and capacity managed by Relay.',
              )
        }
        action={
          <button
            type="button"
            className="ws-primary-button"
            data-onboarding={tab === 'agents' ? 'agent' : 'runtime'}
            onClick={tab !== 'runtimes' ? onCreate : onAddRuntime}
          >
            <Plus />
            {tab !== 'runtimes' ? t('New Agent') : t('Add Runtime')}
          </button>
        }
      />
      <Tabs value={tab} onValueChange={(value) => onTab(String(value))}>
        <TabsList variant="line" className="ws-system-tabs">
          <TabsTrigger value="agents">
            {t('My Agents')} · {agents.length}
          </TabsTrigger>
          <TabsTrigger value="shared-agents">
            {t('Shared with me')} ·{' '}
            {
              shares.filter((share) => share.kind === 'agent' && !share.owned)
                .length
            }
          </TabsTrigger>
          <TabsTrigger value="runtimes">
            {t('Runtime nodes')} · {runtimes.length}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {sharingError && (
        <p role="alert" className="ws-form-error">
          {sharingError}
        </p>
      )}
      {tab === 'shared-agents' ? (
        <SharedAgentsList
          shares={shares}
          onUse={onUseSharedAgent}
          onRefresh={onRefreshSharing}
        />
      ) : tab === 'agents' ? (
        <AgentTable>
          {agents.map((agent) => (
            <div key={agent.id}>
              <span className="ws-agent-avatar">{agent.name[0]}</span>
              <span>
                <strong>{agent.name}</strong>
                <small>
                  {agent.role}
                  {shares.some(
                    (share) =>
                      share.owned &&
                      share.kind === 'agent' &&
                      share.resourceId === agent.id,
                  )
                    ? ` · ${t('Shared')}`
                    : ''}
                </small>
              </span>
              <span>{runtimeName(agent)}</span>
              <span>{agent.model}</span>
              <span className="ws-agent-state">
                <i />
                {agent.state}
              </span>
              <span className="ws-agent-actions">
                <button
                  type="button"
                  aria-label={t('Share Agent')}
                  title={t('Share Agent')}
                  onClick={() => onShareAgent(agent)}
                >
                  <Share2 aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={t('Edit Agent')}
                  title={t('Edit Agent')}
                  onClick={() => onEdit(agent)}
                >
                  <Pencil aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ws-agent-copy-id"
                  aria-label={t('Copy Agent ID')}
                  title={`${t('Copy Agent ID')} · ${agent.id}`}
                  onClick={() => {
                    void navigator.clipboard.writeText(agent.id);
                    onNotice(t('Agent ID copied.'));
                  }}
                >
                  <Copy aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={t('Chat')}
                  title={t('Chat')}
                  onClick={() => onChat(agent.id)}
                >
                  <MessageSquare aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={t('Delete Agent')}
                  title={t('Delete Agent')}
                  onClick={() => onDelete(agent)}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </span>
            </div>
          ))}
        </AgentTable>
      ) : runtimes.length ? (
        <div className="ws-runtime-table">
          <div className="ws-table-head">
            <span>{t('Node')}</span>
            <span>{t('Location')}</span>
            <span>{t('Runtime environments')}</span>
            <span>{t('Load')}</span>
            <span>{t('Concurrency')}</span>
          </div>
          {runtimes.map(([node, location]) => (
            <div key={node.id}>
              <Server />
              <span className="ws-runtime-node-identity">
                <span>
                  <strong title={node.id}>
                    {node.labels?.name || node.id}
                  </strong>
                  <small className={`is-${node.state || 'unknown'}`}>
                    {nodeStatus(node)}
                  </small>
                </span>
                {node.state === 'offline' && (
                  <button
                    type="button"
                    className="ws-runtime-remove-node"
                    aria-label={t('Remove offline Relay Node')}
                    title={t('Remove offline Relay Node')}
                    onClick={() => onRemoveNode(node)}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                )}
              </span>
              <span>{location}</span>
              <span className="ws-runtime-environments">
                {node.runtimes.map((runtime) => (
                  <span className="ws-runtime-environment" key={runtime.id}>
                    <strong>{t(runtimeProviderName(runtime.provider))}</strong>
                    <i />
                    <small>{runtime.version || t('Version unavailable')}</small>
                    <button
                      type="button"
                      aria-label={t('Disconnect Runtime from workspace')}
                      title={t('Disconnect Runtime from workspace')}
                      onClick={() => {
                        void onDisconnect(runtime.id).catch((error) => {
                          onNotice(
                            error instanceof Error
                              ? error.message
                              : t('Could not disconnect Runtime.'),
                          );
                        });
                      }}
                    >
                      <X aria-hidden="true" />
                    </button>
                  </span>
                ))}
              </span>
              <span>
                {node.active} / {node.capacity}
              </span>
              <RuntimeCapacityStepper node={node} onCapacity={onCapacity} />
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon={<Server />}
          title={t('No Runtime instances')}
          text={
            relayError ||
            t('Start Relay Server and connect at least one Relay Node.')
          }
        />
      )}
      <p className="ws-system-note">
        <Bot />
        {relayConnected ? t('Relay connected') : t('Relay not connected')}.{' '}
        {t(
          'Agents define reusable behavior; Runtimes are execution processes on local or remote machines.',
        )}
      </p>
    </div>
  );
}

function SystemSettingsView({
  agents,
  settings,
  onSettings,
  onNotice,
}: {
  agents: AgentItem[];
  settings: WorkspaceSettingsRecord | null;
  onSettings: (settings: WorkspaceSettingsRecord) => void;
  onNotice: (message: string) => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false);
  const [apiKeys, setAPIKeys] = useState<WorkspaceAPIKeyRecord[]>([]);
  const [apiKeysLoading, setAPIKeysLoading] = useState(true);
  const [apiKeyDialog, setAPIKeyDialog] = useState(false);
  const [apiKeyName, setAPIKeyName] = useState('');
  const [generatedToken, setGeneratedToken] = useState('');
  const [creatingAPIKey, setCreatingAPIKey] = useState(false);
  const [revokingAPIKey, setRevokingAPIKey] =
    useState<WorkspaceAPIKeyRecord | null>(null);
  const [apiKeyActionPending, setAPIKeyActionPending] = useState(false);
  const [integrations, setIntegrations] = useState<
    WorkspaceIntegrationRecord[]
  >([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [integrationDialog, setIntegrationDialog] = useState(false);
  const [editingIntegration, setEditingIntegration] =
    useState<WorkspaceIntegrationRecord | null>(null);
  const [integrationName, setIntegrationName] = useState('Feishu bot');
  const [integrationAppID, setIntegrationAppID] = useState('');
  const [integrationSecret, setIntegrationSecret] = useState('');
  const [integrationAgentID, setIntegrationAgentID] = useState('');
  const [integrationEnabled, setIntegrationEnabled] = useState(true);
  const [integrationSaving, setIntegrationSaving] = useState(false);
  const [deletingIntegration, setDeletingIntegration] =
    useState<WorkspaceIntegrationRecord | null>(null);
  const selected = agents.find((agent) => agent.id === settings?.systemAgentId);
  const selectedIntegrationAgent = agents.find(
    (agent) => agent.id === integrationAgentID,
  );
  const interfaceLanguage = settings?.interfaceLanguage || 'auto';
  const aiOutputLanguage = settings?.aiOutputLanguage || 'auto';

  useEffect(() => {
    let active = true;
    steer
      .apiKeys()
      .then((keys) => active && setAPIKeys(keys))
      .catch((error: unknown) => {
        if (active)
          onNotice(
            error instanceof Error ? error.message : 'Could not load API keys.',
          );
      })
      .finally(() => active && setAPIKeysLoading(false));
    return () => {
      active = false;
    };
  }, [onNotice, settings?.workspaceId]);

  const loadIntegrations = useCallback(() => {
    steer
      .integrations()
      .then(setIntegrations)
      .catch((error: unknown) =>
        onNotice(
          error instanceof Error
            ? error.message
            : 'Could not load integrations.',
        ),
      )
      .finally(() => setIntegrationsLoading(false));
  }, [onNotice]);

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations, settings?.workspaceId]);

  useEffect(() => {
    const timer = window.setInterval(loadIntegrations, 10000);
    return () => window.clearInterval(timer);
  }, [loadIntegrations]);

  const openIntegrationDialog = (item?: WorkspaceIntegrationRecord) => {
    setEditingIntegration(item || null);
    setIntegrationName(item?.name || 'Feishu bot');
    setIntegrationAppID(item?.appId || '');
    setIntegrationSecret('');
    setIntegrationAgentID(item?.agentId || agents[0]?.id || '');
    setIntegrationEnabled(item?.enabled ?? true);
    setIntegrationDialog(true);
  };

  const saveIntegration = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (integrationSaving) return;
    setIntegrationSaving(true);
    try {
      const input = {
        name: integrationName.trim(),
        appId: integrationAppID.trim(),
        ...(integrationSecret.trim()
          ? { appSecret: integrationSecret.trim() }
          : {}),
        agentId: integrationAgentID,
        enabled: integrationEnabled,
      };
      const saved = editingIntegration
        ? await steer.updateIntegration(editingIntegration.id, input)
        : await steer.createFeishuIntegration(input);
      setIntegrations((current) =>
        editingIntegration
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [...current, saved],
      );
      setIntegrationDialog(false);
      onNotice(t('Feishu integration saved.'));
      window.setTimeout(loadIntegrations, 1500);
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : 'Could not save integration.',
      );
    } finally {
      setIntegrationSaving(false);
    }
  };

  const removeIntegration = async () => {
    if (!deletingIntegration || integrationSaving) return;
    setIntegrationSaving(true);
    try {
      await steer.deleteIntegration(deletingIntegration.id);
      setIntegrations((current) =>
        current.filter((item) => item.id !== deletingIntegration.id),
      );
      setDeletingIntegration(null);
      onNotice(t('Feishu integration deleted.'));
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : 'Could not delete integration.',
      );
    } finally {
      setIntegrationSaving(false);
    }
  };

  const setIntegrationActive = async (
    item: WorkspaceIntegrationRecord,
    enabled: boolean,
  ) => {
    try {
      const saved = await steer.updateIntegration(item.id, {
        name: item.name,
        appId: item.appId,
        agentId: item.agentId,
        enabled,
      });
      setIntegrations((current) =>
        current.map((candidate) =>
          candidate.id === saved.id ? saved : candidate,
        ),
      );
      if (enabled) window.setTimeout(loadIntegrations, 1500);
    } catch (error) {
      onNotice(
        error instanceof Error
          ? error.message
          : 'Could not update integration.',
      );
    }
  };

  const createAPIKey = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = apiKeyName.trim();
    if (!name || creatingAPIKey) return;
    setCreatingAPIKey(true);
    try {
      const created = await steer.createAPIKey(name);
      setAPIKeys((current) => [created.apiKey, ...current]);
      setGeneratedToken(created.token);
      onNotice(t('API key generated.'));
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : 'Could not generate API key.',
      );
    } finally {
      setCreatingAPIKey(false);
    }
  };

  const revokeAPIKey = async () => {
    if (!revokingAPIKey || apiKeyActionPending) return;
    setAPIKeyActionPending(true);
    try {
      const revoked = await steer.revokeAPIKey(revokingAPIKey.id);
      setAPIKeys((current) =>
        current.map((key) => (key.id === revoked.id ? revoked : key)),
      );
      setRevokingAPIKey(null);
      onNotice(t('API key revoked.'));
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : 'Could not revoke API key.',
      );
    } finally {
      setAPIKeyActionPending(false);
    }
  };

  const openAPIKeyDialog = () => {
    setAPIKeyName('');
    setGeneratedToken('');
    setAPIKeyDialog(true);
  };

  const update = async (next: {
    systemAgentId?: string | null;
    interfaceLanguage?: WorkspaceSettingsRecord['interfaceLanguage'];
    aiOutputLanguage?: WorkspaceSettingsRecord['aiOutputLanguage'];
  }) => {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await steer.updateSystemSettings({
        systemAgentId:
          next.systemAgentId === undefined
            ? settings?.systemAgentId || null
            : next.systemAgentId,
        interfaceLanguage: next.interfaceLanguage || interfaceLanguage,
        aiOutputLanguage: next.aiOutputLanguage || aiOutputLanguage,
      });
      onSettings(saved);
      if (next.interfaceLanguage) setInterfaceLanguage(saved.interfaceLanguage);
      onNotice(t('Settings updated.'));
    } catch (error) {
      if (next.interfaceLanguage)
        setInterfaceLanguage(settings?.interfaceLanguage || 'auto');
      onNotice(
        error instanceof Error ? error.message : 'Could not update settings.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="ws-page ws-settings-page">
        <PageIntro
          eyebrow={t('System').toUpperCase()}
          title={t('Settings')}
          description={t('Manage how Steer works across this workspace.')}
          action={null}
        />
        <section className="ws-settings-group">
          <div className="ws-settings-heading">
            <h2>{t('General')}</h2>
            <p>{t('Basic preferences for Steer.')}</p>
          </div>
          <div className="ws-settings-list">
            <div className="ws-settings-row">
              <div className="ws-settings-copy">
                <label htmlFor="interface-language-select">
                  {t('Interface language')}
                </label>
                <p>{t('Language used throughout the Steer interface.')}</p>
              </div>
              <Select
                value={interfaceLanguage}
                onValueChange={(value) => {
                  const language = String(
                    value,
                  ) as WorkspaceSettingsRecord['interfaceLanguage'];
                  setInterfaceLanguage(language);
                  void update({ interfaceLanguage: language });
                }}
                disabled={saving}
              >
                <SelectTrigger
                  id="interface-language-select"
                  className="ws-settings-select"
                  aria-label={t('Interface language')}
                >
                  <span>
                    {interfaceLanguage === 'zh-CN'
                      ? t('Simplified Chinese')
                      : interfaceLanguage === 'en'
                        ? t('English')
                        : t('System default')}
                  </span>
                </SelectTrigger>
                <SelectContent className="ws-select-popup">
                  <SelectItem value="auto">{t('System default')}</SelectItem>
                  <SelectItem value="zh-CN">
                    {t('Simplified Chinese')}
                  </SelectItem>
                  <SelectItem value="en">{t('English')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="ws-settings-row">
              <div className="ws-settings-copy">
                <label htmlFor="ai-output-language-select">
                  {t('AI output language')}
                </label>
                <p>
                  {t(
                    'Language used by the System Agent for generated summaries.',
                  )}
                </p>
              </div>
              <Select
                value={aiOutputLanguage}
                onValueChange={(value) =>
                  void update({
                    aiOutputLanguage: String(
                      value,
                    ) as WorkspaceSettingsRecord['aiOutputLanguage'],
                  })
                }
                disabled={saving}
              >
                <SelectTrigger
                  id="ai-output-language-select"
                  className="ws-settings-select"
                  aria-label={t('AI output language')}
                >
                  <span>
                    {aiOutputLanguage === 'zh-CN'
                      ? t('Simplified Chinese')
                      : aiOutputLanguage === 'en'
                        ? t('English')
                        : t('System default')}
                  </span>
                </SelectTrigger>
                <SelectContent className="ws-select-popup">
                  <SelectItem value="auto">{t('System default')}</SelectItem>
                  <SelectItem value="zh-CN">
                    {t('Simplified Chinese')}
                  </SelectItem>
                  <SelectItem value="en">{t('English')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>
        <section className="ws-settings-group">
          <div className="ws-settings-heading">
            <h2>{t('AI & automation')}</h2>
            <p>{t('Choose how Steer handles workspace AI tasks.')}</p>
          </div>
          <div className="ws-settings-list">
            <div className="ws-settings-row">
              <div className="ws-settings-copy">
                <label htmlFor="system-agent-select">{t('System Agent')}</label>
                <p>
                  {t('Used for work log summaries and future AI features.')}
                </p>
              </div>
              <Select
                value={settings?.systemAgentId || 'none'}
                onValueChange={(value) =>
                  void update({
                    systemAgentId:
                      String(value) === 'none' ? null : String(value),
                  })
                }
                disabled={saving || agents.length === 0}
              >
                <SelectTrigger
                  id="system-agent-select"
                  className="ws-settings-select"
                  aria-label={t('System Agent')}
                >
                  <span>
                    {selected?.name ||
                      (agents.length
                        ? t('Not configured')
                        : t('No agents available'))}
                  </span>
                </SelectTrigger>
                <SelectContent className="ws-select-popup">
                  <SelectItem value="none">{t('Not configured')}</SelectItem>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>
        <section className="ws-settings-group">
          <div className="ws-settings-heading ws-settings-heading-action">
            <div>
              <h2>{t('Integrations')}</h2>
              <p>{t('Connect this workspace to messaging platforms.')}</p>
            </div>
            <Button
              onClick={() => openIntegrationDialog()}
              disabled={agents.length === 0}
            >
              <Bot aria-hidden="true" />
              {t('Connect Feishu')}
            </Button>
          </div>
          <div className="ws-settings-list ws-integration-list">
            {integrationsLoading ? (
              <div className="ws-api-key-empty">
                {t('Loading integrations…')}
              </div>
            ) : integrations.length === 0 ? (
              <div className="ws-api-key-empty">
                <Bot aria-hidden="true" />
                <span>{t('No integrations yet.')}</span>
              </div>
            ) : (
              integrations.map((item) => {
                const boundAgent = agents.find(
                  (agent) => agent.id === item.agentId,
                );
                return (
                  <div
                    className="ws-settings-row ws-integration-row"
                    key={item.id}
                  >
                    <div className="ws-api-key-identity">
                      <span className="ws-api-key-icon">
                        <Bot aria-hidden="true" />
                      </span>
                      <div className="ws-settings-copy">
                        <strong>{item.name}</strong>
                        <p>
                          {boundAgent?.name || t('Unknown Agent')}
                          <span aria-hidden="true"> · </span>
                          <span
                            className={`ws-integration-status is-${item.status}`}
                          >
                            {t(
                              item.status === 'connected'
                                ? 'Connected'
                                : item.status === 'connecting'
                                  ? 'Connecting…'
                                  : item.status === 'disabled'
                                    ? 'Disabled'
                                    : 'Needs attention',
                            )}
                          </span>
                        </p>
                        {item.lastError && (
                          <p className="ws-integration-error">
                            {item.lastError}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="ws-integration-actions">
                      {item.enabled && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('Reconnect')}
                          title={t('Reconnect')}
                          onClick={() => {
                            void steer
                              .reconnectIntegration(item.id)
                              .then(() => {
                                onNotice(t('Reconnecting Feishu…'));
                                window.setTimeout(loadIntegrations, 1500);
                              })
                              .catch((error: unknown) =>
                                onNotice(
                                  error instanceof Error
                                    ? error.message
                                    : 'Could not reconnect integration.',
                                ),
                              );
                          }}
                        >
                          <RefreshCw aria-hidden="true" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('Edit')}
                        title={t('Edit')}
                        onClick={() => openIntegrationDialog(item)}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void setIntegrationActive(item, !item.enabled)
                        }
                      >
                        {item.enabled ? t('Disable') : t('Enable')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('Delete')}
                        title={t('Delete')}
                        onClick={() => setDeletingIntegration(item)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
        <section className="ws-settings-group">
          <div className="ws-settings-heading ws-settings-heading-action">
            <div>
              <h2>{t('API access')}</h2>
              <p>{t('Use API keys to submit Agent tasks from other tools.')}</p>
            </div>
            <Button onClick={openAPIKeyDialog}>
              <KeyRound aria-hidden="true" />
              {t('Generate API key')}
            </Button>
          </div>
          <div className="ws-settings-list ws-api-key-list">
            {apiKeysLoading ? (
              <div className="ws-api-key-empty">{t('Loading API keys…')}</div>
            ) : apiKeys.length === 0 ? (
              <div className="ws-api-key-empty">
                <KeyRound aria-hidden="true" />
                <span>{t('No API keys yet.')}</span>
              </div>
            ) : (
              apiKeys.map((key) => (
                <div
                  className={`ws-settings-row ws-api-key-row${key.revokedAt ? ' is-revoked' : ''}`}
                  key={key.id}
                >
                  <div className="ws-api-key-identity">
                    <span className="ws-api-key-icon">
                      <KeyRound aria-hidden="true" />
                    </span>
                    <div className="ws-settings-copy">
                      <strong>{key.name}</strong>
                      <p>
                        <code>{key.prefix}…</code>
                        <span aria-hidden="true"> · </span>
                        {key.revokedAt
                          ? t('Revoked')
                          : key.lastUsedAt
                            ? `${t('Last used')} ${formatDate(key.lastUsedAt)}`
                            : t('Never used')}
                      </p>
                    </div>
                  </div>
                  {!key.revokedAt && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ws-api-key-revoke"
                      aria-label={`${t('Revoke')} ${key.name}`}
                      title={t('Revoke')}
                      onClick={() => setRevokingAPIKey(key)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
      <Dialog
        open={integrationDialog}
        onOpenChange={(open) => {
          setIntegrationDialog(open);
          if (!open) setEditingIntegration(null);
        }}
      >
        <DialogContent className="ws-workspace-dialog ws-integration-dialog">
          <DialogTitle>
            {editingIntegration
              ? t('Edit Feishu integration')
              : t('Connect Feishu')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Connect a Feishu app bot to an Agent in this workspace. Choose a Project later with bot commands.',
            )}
          </DialogDescription>
          <form onSubmit={(event) => void saveIntegration(event)}>
            <section className="ws-integration-panel">
              <div className="ws-integration-section-heading">
                <div>
                  <strong>{t('Bot configuration')}</strong>
                  <span>
                    {t(
                      'Enter the credentials from the Feishu developer console.',
                    )}
                  </span>
                </div>
              </div>
              <div className="ws-integration-fields">
                <label
                  className="ws-integration-name-field"
                  aria-label={t('Integration name')}
                >
                  <span className="ws-integration-field-label">
                    <span>{t('Integration name')}</span>
                    <small>{t('Shown only in Steer')}</small>
                  </span>
                  <input
                    required
                    maxLength={80}
                    value={integrationName}
                    onChange={(event) => setIntegrationName(event.target.value)}
                    placeholder={t('e.g. Engineering assistant')}
                  />
                </label>
                <label>
                  {t('Feishu App ID')}
                  <input
                    required
                    value={integrationAppID}
                    onChange={(event) =>
                      setIntegrationAppID(event.target.value)
                    }
                    placeholder="cli_…"
                    autoComplete="off"
                  />
                </label>
                <label aria-label={t('Feishu App Secret')}>
                  <span className="ws-integration-field-label">
                    <span>{t('Feishu App Secret')}</span>
                    {editingIntegration?.secretConfigured && (
                      <small className="is-configured">{t('Configured')}</small>
                    )}
                  </span>
                  <input
                    required={!editingIntegration?.secretConfigured}
                    type="password"
                    value={integrationSecret}
                    onChange={(event) =>
                      setIntegrationSecret(event.target.value)
                    }
                    placeholder={
                      editingIntegration?.secretConfigured ? '************' : ''
                    }
                    title={
                      editingIntegration?.secretConfigured
                        ? t('Leave blank to keep the current secret')
                        : undefined
                    }
                    autoComplete="new-password"
                  />
                </label>
              </div>
            </section>
            <section className="ws-integration-panel">
              <div className="ws-integration-section-heading">
                <div>
                  <strong>{t('Task routing')}</strong>
                  <span>
                    {t(
                      'Choose which Agent handles messages. Project is selected separately in Feishu.',
                    )}
                  </span>
                </div>
              </div>
              <label className="ws-integration-agent-field">
                {t('Agent')}
                <Select
                  value={integrationAgentID}
                  onValueChange={(value) =>
                    setIntegrationAgentID(String(value))
                  }
                >
                  <SelectTrigger className="ws-integration-select">
                    <span>
                      {selectedIntegrationAgent?.name || t('Select Agent')}
                    </span>
                  </SelectTrigger>
                  <SelectContent className="ws-select-popup">
                    {agents.map((agent) => (
                      <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <div className="ws-integration-project-note">
                <p>{t('Choose a Project after connecting')}</p>
                <div>
                  <span>
                    <code>/projects</code>
                    {t('List available Projects')}
                  </span>
                  <span>
                    <code>/project &lt;{t('Project name')}&gt;</code>
                    {t('Bind this chat or thread')}
                  </span>
                </div>
              </div>
            </section>
            <label
              className="ws-integration-enabled"
              aria-label={t('Enable after saving')}
            >
              <input
                type="checkbox"
                checked={integrationEnabled}
                onChange={(event) =>
                  setIntegrationEnabled(event.target.checked)
                }
              />
              <span>
                <strong>{t('Enable after saving')}</strong>
                <small>
                  {t('Start the bot connection immediately after saving.')}
                </small>
              </span>
            </label>
            <details className="ws-integration-guide">
              <summary>
                <span>
                  <strong>{t('Required Feishu setup')}</strong>
                  <small>
                    {t('View the three required configuration steps.')}
                  </small>
                </span>
                <ChevronDown aria-hidden="true" />
              </summary>
              <ol>
                <li>
                  {t('Enable Bot capability in the Feishu developer console.')}
                </li>
                <li>
                  {t(
                    'Grant private-message, group mention, send-as-bot, and message read permissions.',
                  )}
                </li>
                <li>
                  {t(
                    'Subscribe to im.message.receive_v1 using long connection mode, then publish the app.',
                  )}
                </li>
              </ol>
            </details>
            <div className="ws-form-actions">
              <button type="button" onClick={() => setIntegrationDialog(false)}>
                {t('Cancel')}
              </button>
              <button
                type="submit"
                disabled={
                  integrationSaving ||
                  !integrationName.trim() ||
                  !integrationAppID.trim() ||
                  !integrationAgentID ||
                  (!editingIntegration?.secretConfigured &&
                    !integrationSecret.trim())
                }
              >
                {integrationSaving ? t('Saving…') : t('Save')}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(deletingIntegration)}
        onOpenChange={(open) => !open && setDeletingIntegration(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('Delete Feishu integration?')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'The bot will disconnect immediately. Existing Steer conversations will be kept.',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={integrationSaving}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={integrationSaving}
              onClick={(event) => {
                event.preventDefault();
                void removeIntegration();
              }}
            >
              {integrationSaving ? t('Deleting…') : t('Delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={apiKeyDialog}
        onOpenChange={(open) => {
          setAPIKeyDialog(open);
          if (!open) {
            setAPIKeyName('');
            setGeneratedToken('');
          }
        }}
      >
        <DialogContent className="ws-workspace-dialog ws-api-key-dialog">
          <DialogTitle>
            {generatedToken ? t('API key ready') : t('Generate API key')}
          </DialogTitle>
          <DialogDescription>
            {generatedToken
              ? t('Copy this key now. You will not be able to see it again.')
              : t(
                  'This key can submit, read, and cancel tasks in this workspace.',
                )}
          </DialogDescription>
          {generatedToken ? (
            <div className="ws-api-key-token-panel">
              <code>{generatedToken}</code>
              <Button
                onClick={() => {
                  void navigator.clipboard.writeText(generatedToken);
                  onNotice(t('API key copied.'));
                }}
              >
                <Copy aria-hidden="true" />
                {t('Copy API key')}
              </Button>
            </div>
          ) : (
            <form onSubmit={(event) => void createAPIKey(event)}>
              <label>
                {t('Name')}
                <input
                  maxLength={80}
                  value={apiKeyName}
                  onChange={(event) => setAPIKeyName(event.target.value)}
                  placeholder={t('For example: Local automation')}
                />
              </label>
              <p className="ws-field-note">
                {t('Permissions: read, submit, and cancel Agent tasks.')}
              </p>
              <div className="ws-form-actions">
                <button type="button" onClick={() => setAPIKeyDialog(false)}>
                  {t('Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={!apiKeyName.trim() || creatingAPIKey}
                >
                  {creatingAPIKey ? t('Generating…') : t('Generate')}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(revokingAPIKey)}
        onOpenChange={(open) => !open && setRevokingAPIKey(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Revoke API key?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Any integration using this key will immediately lose access.',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={apiKeyActionPending}>
              {t('Cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={apiKeyActionPending}
              onClick={(event) => {
                event.preventDefault();
                void revokeAPIKey();
              }}
            >
              {apiKeyActionPending ? t('Revoking…') : t('Revoke')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ProjectDialog({
  open,
  creating,
  error,
  nodes,
  project,
  defaultRuntimeId,
  onOpen,
  onSubmit,
}: {
  open: boolean;
  creating: boolean;
  error: string;
  nodes: RelayNode[];
  project: ProjectRecord | null;
  defaultRuntimeId: string;
  onOpen: (open: boolean) => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const [projectType, setProjectType] = useState<'local' | 'git'>(
    project?.workspaceKind === 'git' ? 'git' : 'local',
  );
  const [projectRuntimeId, setProjectRuntimeId] = useState(
    project?.nodeId ||
      nodes.find((node) =>
        node.runtimes?.some(
          (runtime) => runtime.id === (project?.runtimeId || defaultRuntimeId),
        ),
      )?.id ||
      nodes[0]?.id ||
      '',
  );
  const selectedNode = nodes.find((node) => node.id === projectRuntimeId);
  const projectRuntimeLabel = selectedNode?.labels?.name || selectedNode?.id;
  return (
    <Dialog open={open} onOpenChange={(value) => !creating && onOpen(value)}>
      <DialogContent className="ws-agent-dialog ws-project-dialog">
        <DialogTitle>{project ? 'Edit Project' : 'Add Project'}</DialogTitle>
        <DialogDescription>
          {project
            ? 'Update the Project name or execution location.'
            : 'Use a directory on one machine, or let Relay prepare an isolated Git worktree for each conversation.'}
        </DialogDescription>
        <form
          key={`${project?.id || 'new'}:${project?.updatedAt || ''}`}
          onSubmit={onSubmit}
        >
          <input type="hidden" name="projectType" value={projectType} />
          <div
            className="ws-project-type"
            role="tablist"
            aria-label="Project source"
          >
            <button
              type="button"
              role="tab"
              aria-selected={projectType === 'local'}
              onClick={() => setProjectType('local')}
            >
              <Folder />
              <span>
                <strong>Existing directory</strong>
                <small>Work in place on one machine</small>
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={projectType === 'git'}
              onClick={() => setProjectType('git')}
            >
              <GitBranch />
              <span>
                <strong>Git repository</strong>
                <small>Managed, isolated worktree</small>
              </span>
            </button>
          </div>
          <label>
            Name
            <input
              name="name"
              defaultValue={project?.name || ''}
              autoComplete="off"
              placeholder="e.g. Relay"
              required
            />
          </label>
          {projectType === 'local' ? (
            <>
              <div className="ws-form-field">
                <span>Machine location</span>
                <Select
                  key={defaultRuntimeId}
                  name="nodeId"
                  value={projectRuntimeId}
                  onValueChange={(value) =>
                    setProjectRuntimeId(value == null ? '' : String(value))
                  }
                  required
                >
                  <SelectTrigger
                    className="ws-form-select"
                    aria-label="Machine location"
                  >
                    {projectRuntimeLabel || 'Select a machine'}
                  </SelectTrigger>
                  <SelectContent className="ws-select-popup">
                    {nodes.length ? (
                      nodes.map((node) => (
                        <SelectItem key={node.id} value={node.id}>
                          {node.labels?.name || node.id}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="__unavailable" disabled>
                        No machine available
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <label>
                Directory path
                <input
                  name="path"
                  defaultValue={
                    project?.workspaceKind === 'local'
                      ? project.workspaceSource
                      : ''
                  }
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="e.g. /home/dev/projects/relay"
                  required
                />
              </label>
              <p className="ws-field-note">
                Runs modify this directory directly. Use any Runtime on this
                machine that is assigned to the workspace.
              </p>
            </>
          ) : (
            <>
              <label>
                Repository URL
                <input
                  name="repositoryUrl"
                  defaultValue={
                    project?.workspaceKind === 'git'
                      ? project.workspaceSource
                      : ''
                  }
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="e.g. git@github.com:acme/project.git"
                  required
                />
              </label>
              <label>
                Default branch or ref
                <input
                  name="ref"
                  autoComplete="off"
                  defaultValue={project?.workspaceRef || ''}
                  placeholder="HEAD"
                />
              </label>
              <label>
                Subdirectory <small>Optional</small>
                <input
                  name="subdir"
                  defaultValue={project?.workspaceSubdir || ''}
                  autoComplete="off"
                  placeholder="e.g. apps/web"
                />
              </label>
              <p className="ws-field-note ws-project-worktree-note">
                Relay keeps one Git mirror per Runtime and gives each
                conversation a reusable worktree. An Agent on the selected
                machine is required for the first version.
              </p>
            </>
          )}
          {error && (
            <p className="ws-form-error" role="alert">
              {error}
            </p>
          )}
          <div className="ws-form-actions">
            <button
              type="button"
              disabled={creating}
              onClick={() => onOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" disabled={creating}>
              {creating
                ? project
                  ? 'Saving…'
                  : 'Adding…'
                : project
                  ? 'Save changes'
                  : 'Add Project'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AgentDialog({
  open,
  creating,
  error,
  agent,
  runtime,
  model,
  choices,
  skills,
  selectedSkillIDs,
  selectedChoice,
  onOpen,
  onRuntime,
  onModel,
  onSubmit,
}: {
  open: boolean;
  creating: boolean;
  error: string;
  agent: AgentItem | null;
  runtime: string;
  model: string;
  choices: RuntimeChoice[];
  skills: SkillRecord[];
  selectedSkillIDs: string[];
  selectedChoice?: RuntimeChoice;
  onOpen: (open: boolean) => void;
  onRuntime: (value: string) => void;
  onModel: (value: string) => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const { t } = useI18n();
  const models = [
    'Runtime default',
    ...new Set([
      ...(model !== 'Runtime default' ? [model] : []),
      ...(selectedChoice?.defaultModel ? [selectedChoice.defaultModel] : []),
      ...(selectedChoice?.models || []),
    ]),
  ];
  return (
    <Dialog open={open} onOpenChange={(value) => !creating && onOpen(value)}>
      <DialogContent className="ws-agent-dialog">
        <DialogTitle>{agent ? t('Edit Agent') : t('Create Agent')}</DialogTitle>
        <DialogDescription>
          {agent
            ? 'Update this Agent’s behavior and execution Runtime.'
            : 'Define reusable behavior and choose where Relay may run it.'}
        </DialogDescription>
        <form onSubmit={onSubmit}>
          <label>
            Name
            <input
              name="name"
              defaultValue={agent?.name || ''}
              autoComplete="off"
              placeholder="e.g. Security Reviewer"
              required
            />
          </label>
          <label>
            Role
            <input
              name="role"
              defaultValue={agent?.role || ''}
              autoComplete="off"
              placeholder="What should this Agent handle?"
            />
          </label>
          <div className="ws-form-field">
            <span>Runtime</span>
            <Select
              value={runtime}
              onValueChange={(value) => onRuntime(value ?? '')}
            >
              <SelectTrigger
                className="ws-form-select"
                aria-label="Agent Runtime"
              >
                {selectedChoice?.label || 'No Runtime available'}
              </SelectTrigger>
              <SelectContent className="ws-select-popup">
                {choices.map((choice) => (
                  <SelectItem
                    key={choice.value}
                    value={choice.value}
                    disabled={choice.unavailable}
                  >
                    {choice.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="ws-form-field">
            <span>Model</span>
            <Select
              value={model}
              onValueChange={(value) => onModel(value ?? 'Runtime default')}
            >
              <SelectTrigger
                className="ws-form-select"
                aria-label="Agent model"
              >
                {model}
              </SelectTrigger>
              <SelectContent className="ws-select-popup">
                {models.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label>
            Instructions
            <textarea
              name="instructions"
              defaultValue={agent?.instructions || ''}
              placeholder="Role, constraints, and output preferences…"
            />
          </label>
          {!!skills.length && (
            <fieldset className="ws-agent-skill-fieldset">
              <legend>Skills</legend>
              <p>
                Relay installs selected instructions into this Agent’s remote
                workspace for every run.
              </p>
              <div>
                {skills.map((skill) => (
                  <label key={skill.id} className="ws-agent-skill-checkbox">
                    <input
                      type="checkbox"
                      name="skills"
                      value={skill.id}
                      defaultChecked={selectedSkillIDs.includes(skill.id)}
                      aria-label={`Assign ${skill.name}`}
                    />
                    <span>
                      <strong>{skill.name}</strong>
                      <small>
                        {skill.description || 'Reusable instructions'}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {error && (
            <p className="ws-form-error" role="alert">
              {error}
            </p>
          )}
          <div className="ws-form-actions">
            <button
              type="button"
              disabled={creating}
              onClick={() => onOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" disabled={creating}>
              {creating
                ? agent
                  ? 'Saving…'
                  : 'Creating…'
                : agent
                  ? t('Save changes')
                  : t('Create Agent')}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RuntimeDialog({
  open,
  connected,
  error,
  discoveryError,
  publicURL,
  nodes,
  selectedRuntimeIDs,
  discovering,
  claiming,
  enrollmentToken,
  enrollmentNodeToken,
  enrollmentNodeID,
  steerAPIURL,
  onOpen,
  onURL,
  onRefresh,
  onSelect,
  onClaim,
  onCreateEnrollment,
  onRemoveNode,
}: {
  open: boolean;
  connected: boolean;
  error: string;
  discoveryError: string;
  publicURL: string;
  nodes: RelayNode[];
  selectedRuntimeIDs: string[];
  discovering: boolean;
  claiming: boolean;
  enrollmentToken: string;
  enrollmentNodeToken: string;
  enrollmentNodeID: string;
  steerAPIURL: string;
  onOpen: (open: boolean) => void;
  onURL: (value: string) => void;
  onRefresh: () => void;
  onSelect: (runtimeIDs: string[]) => void;
  onClaim: () => void;
  onCreateEnrollment: () => Promise<void>;
  onRemoveNode: (node: RelayNode) => void;
}) {
  const { t, language } = useI18n();
  const [commandCopied, setCommandCopied] = useState(false);
  const [creatingEnrollment, setCreatingEnrollment] = useState(false);
  const [editingPublicURL, setEditingPublicURL] = useState(false);
  const [publicURLDraft, setPublicURLDraft] = useState(publicURL);
  const [nodeView, setNodeView] = useState<'installed' | 'existing'>(
    'installed',
  );
  const refreshRef = useRef(onRefresh);
  const discoveringRef = useRef(discovering);
  const shellQuote = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`;
  const publicSteerAPIURL = (
    steerAPIURL.startsWith('http')
      ? steerAPIURL
      : typeof window !== 'undefined'
        ? new URL(steerAPIURL, window.location.origin).toString()
        : steerAPIURL
  ).replace(/\/$/, '');
  const command =
    enrollmentToken && enrollmentNodeID && enrollmentNodeToken
      ? `RELAY_NODE_ID=${shellQuote(enrollmentNodeID)}\nRELAY_MACHINE_NAME_JSON=$(hostname | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')\ncurl -fsSL https://raw.githubusercontent.com/KDF5000/relay/main/install.sh | RELAY_NODE_TOKEN=${shellQuote(enrollmentNodeToken)} sh -s -- --server ${shellQuote(publicURL || 'https://relay.example.com')} --node-id "$RELAY_NODE_ID" --force --install-service && \\\n  curl -fsS -X POST ${shellQuote(`${publicSteerAPIURL}/relay-node-enrollments/claim`)} -H 'Content-Type: application/json' --data-binary "{\\"token\\":\\"${enrollmentToken}\\",\\"nodeId\\":\\"$RELAY_NODE_ID\\",\\"name\\":\\"$RELAY_MACHINE_NAME_JSON\\",\\"capacity\\":2}"`
      : '';
  const installedNode = enrollmentNodeID
    ? nodes.find((node) => node.id === enrollmentNodeID)
    : undefined;
  const installedNodeReady =
    installedNode?.state === 'online' &&
    Boolean(installedNode.runtimes?.length);
  const existingNodes = nodes.filter((node) => node.id !== enrollmentNodeID);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    discoveringRef.current = discovering;
  }, [discovering]);

  useEffect(() => {
    if (
      !open ||
      nodeView !== 'installed' ||
      !enrollmentNodeID ||
      installedNodeReady
    )
      return;
    const refreshIfIdle = () => {
      if (!discoveringRef.current) refreshRef.current();
    };
    refreshIfIdle();
    const interval = window.setInterval(refreshIfIdle, 4_000);
    return () => window.clearInterval(interval);
  }, [enrollmentNodeID, installedNodeReady, nodeView, open]);

  async function copyInstallCommand() {
    const copied = await writeClipboard(command);
    if (!copied) return;
    setCommandCopied(true);
    window.setTimeout(() => setCommandCopied(false), 1600);
  }

  async function createEnrollment() {
    if (creatingEnrollment) return;
    setCreatingEnrollment(true);
    try {
      await onCreateEnrollment();
    } finally {
      setCreatingEnrollment(false);
    }
  }

  function savePublicURL() {
    const nextURL = publicURLDraft.trim();
    if (nextURL) onURL(nextURL);
    setEditingPublicURL(false);
  }

  function toggleRuntime(runtimeID: string) {
    const selectedNode = nodes.find((node) =>
      node.runtimes?.some((runtime) => runtime.id === runtimeID),
    );
    onSelect(
      selectedRuntimeIDs.includes(runtimeID)
        ? selectedRuntimeIDs.filter((id) => id !== runtimeID)
        : [
            ...selectedRuntimeIDs.filter((id) =>
              selectedNode?.runtimes?.some((runtime) => runtime.id === id),
            ),
            runtimeID,
          ],
    );
  }

  function renderNodes(displayNodes: RelayNode[]) {
    return (
      <div className="ws-runtime-discovery-list">
        {displayNodes.map((node) => (
          <section key={node.id}>
            <header>
              <Server aria-hidden="true" />
              <strong>{node.labels?.name || node.id}</strong>
              <small>{node.state || 'unknown'}</small>
              {node.state === 'offline' && (
                <button
                  type="button"
                  className="ws-runtime-remove-node"
                  onClick={() => onRemoveNode(node)}
                  aria-label={t('Remove offline Relay Node')}
                  title={t('Remove offline Relay Node')}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              )}
            </header>
            <div>
              {(node.runtimes ?? []).map((runtime) => (
                <label key={runtime.id}>
                  <input
                    type="checkbox"
                    checked={selectedRuntimeIDs.includes(runtime.id)}
                    disabled={claiming}
                    onChange={() => toggleRuntime(runtime.id)}
                  />
                  <span>
                    <strong>{t(runtimeProviderName(runtime.provider))}</strong>
                    <small>{runtime.id}</small>
                  </span>
                  {runtime.version && <em>{runtime.version}</em>}
                </label>
              ))}
              {!node.runtimes?.length && (
                <p className="ws-runtime-node-empty">
                  {node.state === 'online'
                    ? t('No Runtime CLI was discovered on this Node.')
                    : t(
                        'This Node is offline. Check the Relay Node service and refresh.',
                      )}
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpen}>
      <DialogContent className="ws-runtime-dialog">
        {nodeView === 'existing' && (
          <button
            type="button"
            className="ws-runtime-back"
            onClick={() => {
              onSelect([]);
              setNodeView('installed');
            }}
          >
            <ChevronLeft aria-hidden="true" />
            <span>{t('Back to adding a Runtime')}</span>
          </button>
        )}
        <DialogTitle>
          {nodeView === 'existing'
            ? t('Choose an existing Node')
            : t('Add Runtime')}
        </DialogTitle>
        <DialogDescription>
          {nodeView === 'existing'
            ? t(
                'Choose Runtime instances from Relay Nodes owned by your account.',
              )
            : t(
                'Connect a local or remote machine to Relay. Installed Runtime CLIs are discovered automatically.',
              )}
        </DialogDescription>
        {nodeView === 'installed' ? (
          <div className="ws-runtime-onboarding">
            <div
              className={`ws-runtime-connection ${connected ? 'is-connected' : ''}`}
            >
              <span className="ws-runtime-status-dot" />
              <strong>
                {connected ? t('Relay connected') : t('Relay not connected')}
              </strong>
              <small>{error || t('Steer Server can reach Relay.')}</small>
            </div>
            <section className="ws-runtime-step">
              <span>1</span>
              <div>
                <h3>{t('Public Relay address')}</h3>
                {editingPublicURL ? (
                  <div className="ws-runtime-address-editor">
                    <input
                      value={publicURLDraft}
                      onChange={(event) =>
                        setPublicURLDraft(event.target.value)
                      }
                      aria-label="Public Relay Server URL"
                      spellCheck={false}
                    />
                    <button type="button" onClick={savePublicURL}>
                      {t('Save')}
                    </button>
                  </div>
                ) : (
                  <div className="ws-runtime-address-summary">
                    <code>{publicURL}</code>
                    <button
                      type="button"
                      onClick={() => {
                        setPublicURLDraft(publicURL);
                        setEditingPublicURL(true);
                      }}
                    >
                      {t('Edit')}
                    </button>
                  </div>
                )}
              </div>
            </section>
            <section className="ws-runtime-step">
              <span>2</span>
              <div>
                <h3>{t('Install a new Relay Node')}</h3>
                <p className="ws-runtime-install-description">
                  {t(
                    'Install once on the machine where Codex, Trae, Qoder, QwenWork, or another Runtime is available,',
                  )}
                  {language === 'en' ? ' ' : ''}
                  <span>
                    {t('Already have a Relay Node?')}
                    {language === 'en' ? ' ' : ''}
                    <button
                      type="button"
                      onClick={() => {
                        onSelect([]);
                        setNodeView('existing');
                      }}
                    >
                      <span>{t('Choose an existing Node')}</span>
                    </button>
                  </span>
                </p>
                <div
                  className={`ws-runtime-command-reveal ${enrollmentToken ? 'is-revealed' : ''}`}
                >
                  <div className="ws-runtime-command-content">
                    <pre>
                      <code>
                        {command ||
                          'curl -fsSL https://raw.githubusercontent.com/KDF5000/relay/main/install.sh | …'}
                      </code>
                    </pre>
                    <button
                      type="button"
                      aria-label={
                        commandCopied
                          ? t('Relay Node install command copied')
                          : t('Copy Relay Node install command')
                      }
                      title={commandCopied ? t('Copied') : t('Copy command')}
                      className={commandCopied ? 'is-copied' : undefined}
                      onClick={() => void copyInstallCommand()}
                      disabled={!enrollmentToken}
                    >
                      {commandCopied ? <Check /> : <Copy />}
                    </button>
                  </div>
                  {!enrollmentToken && (
                    <button
                      type="button"
                      className="ws-runtime-command-cover"
                      disabled={creatingEnrollment}
                      onClick={() => void createEnrollment()}
                    >
                      <span>
                        {creatingEnrollment
                          ? t('Generating installation command…')
                          : t('Click to generate installation command')}
                      </span>
                    </button>
                  )}
                </div>
                <div className="ws-runtime-command-meta">
                  <small>
                    {enrollmentToken
                      ? t(
                          'This one-time enrollment token expires in 15 minutes.',
                        )
                      : t(
                          'The one-time enrollment token expires 15 minutes after it is generated.',
                        )}
                  </small>
                  <a
                    href="https://github.com/KDF5000/relay#deployment"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('Relay deployment guide')} <ExternalLink />
                  </a>
                </div>
                {!enrollmentToken && discoveryError && (
                  <p className="ws-form-error" role="alert">
                    {discoveryError}
                  </p>
                )}
              </div>
            </section>
            <section
              className={`ws-runtime-step ws-runtime-detection ${enrollmentToken ? 'is-active' : ''}`}
            >
              <span>3</span>
              <div>
                {!enrollmentToken ? (
                  <div className="ws-runtime-detection-pending">
                    <div>
                      <h3>{t('Detect the new Node')}</h3>
                      <p>
                        {t(
                          'Detection starts automatically after the installation command is generated.',
                        )}
                      </p>
                    </div>
                    <small>{t('Waiting for command')}</small>
                  </div>
                ) : (
                  <>
                    <div className="ws-runtime-discovery-heading">
                      <div>
                        <h3>{t('Detect the new Node')}</h3>
                        <p>
                          {t(
                            'Run the installation command. The new machine will appear here automatically.',
                          )}
                        </p>
                      </div>
                    </div>
                    {discoveryError && (
                      <p className="ws-form-error" role="alert">
                        {discoveryError}
                      </p>
                    )}
                    {!installedNode && !discoveryError && (
                      <div className="ws-runtime-empty">
                        {t('Waiting for the installed Node to connect…')}
                      </div>
                    )}
                    {installedNode && renderNodes([installedNode])}
                  </>
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="ws-runtime-existing">
            <div className="ws-runtime-existing-toolbar">
              <strong>{t('Available Relay Nodes')}</strong>
              <button
                type="button"
                onClick={onRefresh}
                disabled={discovering || claiming}
                aria-busy={discovering}
              >
                <RefreshCw className={discovering ? 'is-spinning' : ''} />
                {t('Refresh')}
              </button>
            </div>
            {discoveryError && (
              <p className="ws-form-error" role="alert">
                {discoveryError}
              </p>
            )}
            {!discoveryError && existingNodes.length === 0 && (
              <div className="ws-runtime-empty">
                {discovering
                  ? t('Refreshing…')
                  : t('No other Relay Nodes are available for this account.')}
              </div>
            )}
            {existingNodes.length > 0 && renderNodes(existingNodes)}
          </div>
        )}
        <div className="ws-form-actions ws-runtime-actions">
          <button type="button" onClick={() => onOpen(false)}>
            {t('Close')}
          </button>
          <button
            type="button"
            onClick={onClaim}
            disabled={!selectedRuntimeIDs.length || claiming}
          >
            {claiming
              ? t('Adding…')
              : `${t('Add to workspace')}${selectedRuntimeIDs.length ? ` · ${selectedRuntimeIDs.length}` : ''}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
function PageIntro({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <header className="ws-page-intro">
      <div>
        <span>{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </header>
  );
}
function Empty({
  icon,
  title,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="ws-empty">
      {icon}
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
function formatDate(value?: string) {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
}

function formatMessageTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(date);
}

function formatSize(value: number) {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`;
}

function isTerminalStatus(status?: string) {
  return ['succeeded', 'failed', 'cancelled'].includes(status || '');
}

function formatElapsed(start?: string, end?: string, now = Date.now()) {
  const startedAt = start ? new Date(start).getTime() : Number.NaN;
  const endedAt = end ? new Date(end).getTime() : now;
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt))
    return 'a moment';
  const totalSeconds = Math.max(1, Math.round((endedAt - startedAt) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function responseStatusLabel(message: ChatMessage, now: number) {
  const terminal = isTerminalStatus(message.status);
  const elapsed = formatElapsed(
    message.createdAt,
    terminal ? message.updatedAt : undefined,
    now,
  );
  if (message.status === 'succeeded') return `Completed in ${elapsed}`;
  if (message.status === 'failed') return `Failed after ${elapsed}`;
  if (message.status === 'cancelled') return `Stopped after ${elapsed}`;
  return `Working for ${elapsed}`;
}

function runActivity(events?: RelayEvent[] | null) {
  for (const event of withRuntimeToolEvents(events).reverse()) {
    const eventType = event.type.toLowerCase();
    const item = event.data?.item;
    const itemType =
      item && typeof item === 'object' && 'type' in item
        ? String(item.type)
            .toLowerCase()
            .replace(/[^a-z]/g, '')
        : '';
    const combined = `${eventType} ${itemType}`;
    if (combined.includes('agentmessage') || eventType.includes('assistant'))
      return 'Writing a response';
    if (combined.includes('command'))
      return eventType.endsWith('item.started')
        ? 'Running a command'
        : 'Thinking';
    if (combined.includes('filechange') || combined.includes('edit'))
      return eventType.endsWith('item.started') ? 'Updating files' : 'Thinking';
    if (combined.includes('websearch') || combined.includes('search'))
      return eventType.endsWith('item.started') ? 'Searching' : 'Thinking';
    if (combined.includes('mcp') || combined.includes('tool'))
      return eventType.endsWith('item.started') ? 'Using a tool' : 'Thinking';
    if (combined.includes('reasoning')) return 'Thinking';
    if (eventType.includes('hook')) return 'Preparing the workspace';
    if (eventType.includes('turn.started')) return 'Thinking';
    if (eventType.includes('runtime') && eventType.includes('started'))
      return 'Starting Runtime';
    if (eventType.includes('queued') || eventType.includes('leased'))
      return 'Waiting for a Runtime';
  }
  return 'Working';
}

function runActivityLog(
  events?: RelayEvent[] | null,
  excludeFinalMessage = false,
) {
  const activities: ProcessActivity[] = [];
  const streamedAgentMessages = runtimeAgentMessages(events);
  const streamedMessageByEndSequence = new Map(
    streamedAgentMessages.map((message) => [message.endSequence, message]),
  );
  const finalStreamedMessageID = excludeFinalMessage
    ? streamedAgentMessages.at(-1)?.id
    : undefined;
  const completedMessages = (events || []).filter(
    (event) =>
      event.type === 'assistant.message.completed' &&
      typeof event.data?.text === 'string' &&
      event.data.text.trim(),
  );
  const finalMessageSequence = excludeFinalMessage
    ? completedMessages.at(-1)?.sequence
    : undefined;
  const reasoningUpdates = runtimeReasoningUpdates(events);
  const reasoningByEndSequence = new Map(
    reasoningUpdates.map((update) => [update.endSequence, update]),
  );
  const hasPreparedWorkspaceEvent = (events || []).some(
    (event) => event.type.toLowerCase() === 'workspace.prepared',
  );
  const add = (
    id: string,
    label: string,
    detail?: unknown,
    kind: 'stage' | 'update' | 'action' | 'action-active' = 'stage',
  ) => {
    const normalizedDetail =
      typeof detail === 'string'
        ? kind === 'update'
          ? detail.trim().slice(0, 12000)
          : detail.replace(/\s+/g, ' ').trim().slice(0, 600)
        : '';
    const key = `${label}:${normalizedDetail}`;
    if (
      kind !== 'action' &&
      kind !== 'action-active' &&
      activities.some((item) => `${item.label}:${item.detail || ''}` === key)
    )
      return;
    activities.push({
      id,
      label,
      ...(normalizedDetail ? { detail: normalizedDetail } : {}),
      kind,
    });
  };

  for (const event of withRuntimeToolEvents(events)) {
    const eventType = event.type.toLowerCase();
    const data = event.data || {};
    const item =
      data.item && typeof data.item === 'object'
        ? (data.item as Record<string, unknown>)
        : {};
    const itemType = (typeof item.type === 'string' ? item.type : '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    const id = `${event.sequence}:${typeof item.id === 'string' ? item.id : ''}`;

    if (eventType === 'attempt.queued') add(id, 'Queued for a Runtime');
    else if (eventType === 'attempt.leased')
      add(id, 'Runtime reserved', data.node_id);
    else if (eventType === 'attempt.started') add(id, 'Execution started');
    else if (eventType === 'workspace.prepared')
      add(
        id,
        data.kind === 'git' ? 'Git worktree ready' : 'Workspace ready',
        data.work_dir,
      );
    else if (eventType.includes('runtime') && eventType.endsWith('.started'))
      add(id, 'Runtime started', event.type.split('.')[1]);
    else if (eventType.endsWith('hook.completed') && !hasPreparedWorkspaceEvent)
      add(id, 'Workspace prepared');
    else if (reasoningByEndSequence.has(event.sequence)) {
      const update = reasoningByEndSequence.get(event.sequence);
      if (update)
        add(
          `analysis-${update.id}`,
          update.complete ? 'Analysis' : 'Analyzing',
          update.summary,
          'update',
        );
    } else if (
      eventType.endsWith('item.started') ||
      eventType.endsWith('item.completed')
    ) {
      if (item.status === 'failed')
        add(
          id,
          itemType.includes('command')
            ? 'Command failed'
            : itemType.includes('filechange')
              ? 'File update failed'
              : itemType.includes('search')
                ? 'Search failed'
                : 'Tool failed',
          item.command || item.path || item.query || item.name,
          'action',
        );
      else if (itemType.includes('command'))
        add(
          id,
          eventType.endsWith('item.completed')
            ? 'Ran a command'
            : 'Running a command',
          commandActivityDetail(item),
          eventType.endsWith('item.completed') ? 'action' : 'action-active',
        );
      else if (itemType.includes('filechange') || itemType.includes('edit'))
        add(
          id,
          eventType.endsWith('item.completed')
            ? 'Updated files'
            : 'Updating files',
          item.path || item.filePath,
          eventType.endsWith('item.completed') ? 'action' : 'action-active',
        );
      else if (itemType.includes('websearch') || itemType.includes('search'))
        add(
          id,
          eventType.endsWith('item.completed')
            ? 'Searched for information'
            : 'Searching for information',
          item.query,
          eventType.endsWith('item.completed') ? 'action' : 'action-active',
        );
      else if (itemType.includes('mcp') || itemType.includes('tool'))
        add(
          id,
          eventType.endsWith('item.completed') ? 'Used a tool' : 'Using a tool',
          item.name || item.toolName,
          eventType.endsWith('item.completed') ? 'action' : 'action-active',
        );
    } else if (
      eventType === 'assistant.message.completed' &&
      event.sequence !== finalMessageSequence
    ) {
      add(id, 'Agent update', data.text, 'update');
    } else if (streamedMessageByEndSequence.has(event.sequence)) {
      const message = streamedMessageByEndSequence.get(event.sequence);
      if (message && message.id !== finalStreamedMessageID)
        add(`agent-${message.id}`, 'Agent update', message.text, 'update');
    } else if (eventType.includes('run.succeeded')) add(id, 'Run completed');
    else if (eventType.includes('run.failed')) add(id, 'Run failed');
    else if (eventType.includes('run.cancelled')) add(id, 'Run stopped');
  }

  return compactProcessActivities(activities);
}

function commandActivityDetail(item: Record<string, unknown>) {
  const command =
    typeof item.command === 'string'
      ? item.command
      : typeof item.commandLine === 'string'
        ? item.commandLine
        : '';
  if (!/^(read|write|edit)$/i.test(command)) return command;

  const action = Array.isArray(item.commandActions)
    ? item.commandActions.find(
        (candidate): candidate is Record<string, unknown> =>
          Boolean(candidate) && typeof candidate === 'object',
      )
    : undefined;
  const target =
    typeof action?.path === 'string'
      ? action.path
      : typeof action?.name === 'string'
        ? action.name
        : '';
  return target ? `${command} ${target}` : command;
}

function compactProcessActivities(items: ProcessActivity[]) {
  const compacted: ProcessActivity[] = [];
  let actions: ProcessActivity[] = [];

  const flushActions = () => {
    if (!actions.length) return;
    const completed = actions.filter((item) => item.kind === 'action');
    const completedKeys = new Set(
      completed.map(
        (item) => `${actionFamily(item.label)}:${item.detail || ''}`,
      ),
    );
    const active = [...actions]
      .reverse()
      .find(
        (item) =>
          item.kind === 'action-active' &&
          !completedKeys.has(
            `${actionFamily(item.label)}:${item.detail || ''}`,
          ),
      );

    if (completed.length) {
      compacted.push({
        id: `actions-${completed[0].id}-${completed.at(-1)?.id}`,
        label: summarizeCompletedActions(completed),
        kind: 'action',
        children: completed,
      });
    }
    if (active) compacted.push(active);
    actions = [];
  };

  for (const item of items) {
    if (item.kind === 'action' || item.kind === 'action-active') {
      actions.push(item);
      continue;
    }
    flushActions();
    compacted.push(item);
  }
  flushActions();
  return compacted;
}

function actionFamily(label: string) {
  const normalized = label.toLowerCase();
  if (normalized.includes('command')) return 'command';
  if (normalized.includes('file')) return 'file';
  if (normalized.includes('search')) return 'search';
  return 'tool';
}

function summarizeCompletedActions(items: ProcessActivity[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const family = actionFamily(item.label);
    counts.set(family, (counts.get(family) || 0) + 1);
  }
  const summaries: string[] = [];
  const commands = counts.get('command') || 0;
  const files = counts.get('file') || 0;
  const searches = counts.get('search') || 0;
  const tools = counts.get('tool') || 0;
  if (commands)
    summaries.push(
      commands === 1 ? 'Ran a command' : `Ran ${commands} commands`,
    );
  if (files)
    summaries.push(
      files === 1 ? 'Updated files' : `Updated files ${files} times`,
    );
  if (searches)
    summaries.push(
      searches === 1
        ? 'Searched for information'
        : `Searched ${searches} times`,
    );
  if (tools)
    summaries.push(tools === 1 ? 'Used a tool' : `Used ${tools} tools`);
  return summaries.join(' · ');
}

function runtimeAgentMessages(events?: RelayEvent[] | null) {
  const messages = new Map<
    string,
    { id: string; text: string; startSequence: number; endSequence: number }
  >();
  for (const event of events || []) {
    if (!event.type.toLowerCase().includes('.item.agentmessage.delta'))
      continue;
    const itemID =
      typeof event.data?.itemId === 'string'
        ? event.data.itemId
        : typeof event.data?.item_id === 'string'
          ? event.data.item_id
          : '';
    const delta = typeof event.data?.delta === 'string' ? event.data.delta : '';
    if (!itemID || !delta) continue;
    const current = messages.get(itemID);
    messages.set(itemID, {
      id: itemID,
      text: `${current?.text || ''}${delta}`,
      startSequence: current?.startSequence ?? event.sequence,
      endSequence: event.sequence,
    });
  }
  return [...messages.values()];
}

function runtimeReasoningUpdates(events?: RelayEvent[] | null) {
  const updates = new Map<
    string,
    {
      id: string;
      text: string;
      startSequence: number;
      endSequence: number;
      complete: boolean;
    }
  >();
  const completed = new Set<string>();

  for (const event of events || []) {
    const eventType = event.type.toLowerCase();
    const data = event.data || {};
    const item =
      data.item && typeof data.item === 'object'
        ? (data.item as Record<string, unknown>)
        : {};
    const itemID =
      typeof data.itemId === 'string'
        ? data.itemId
        : typeof data.item_id === 'string'
          ? data.item_id
          : typeof item.id === 'string'
            ? item.id
            : '';

    if (
      eventType.endsWith('item.completed') &&
      typeof item.type === 'string' &&
      item.type.toLowerCase() === 'reasoning' &&
      itemID
    ) {
      completed.add(itemID);
      const current = updates.get(itemID);
      if (current)
        updates.set(itemID, {
          ...current,
          endSequence: event.sequence,
          complete: true,
        });
      continue;
    }

    if (!eventType.includes('.item.reasoning.textdelta')) continue;
    const delta = typeof data.delta === 'string' ? data.delta : '';
    if (!itemID || !delta) continue;
    const current = updates.get(itemID);
    updates.set(itemID, {
      id: itemID,
      text: `${current?.text || ''}${delta}`,
      startSequence: current?.startSequence ?? event.sequence,
      endSequence: event.sequence,
      complete: completed.has(itemID),
    });
  }

  return [...updates.values()].map((update) => ({
    id: update.id,
    startSequence: update.startSequence,
    endSequence: update.endSequence,
    complete: update.complete,
    signalsFinalResponse: signalsFinalResponse(update.text),
    summary: reasoningSummary(update.text),
  }));
}

function liveFinalContent(events?: RelayEvent[] | null) {
  const latestMessage = runtimeAgentMessages(events).at(-1);
  if (!latestMessage) return '';

  const precedingAnalysis = runtimeReasoningUpdates(events)
    .filter((update) => update.endSequence < latestMessage.startSequence)
    .at(-1);

  return precedingAnalysis?.signalsFinalResponse ? latestMessage.text : '';
}

function signalsFinalResponse(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  const conclusion = normalized.slice(-360);
  return /(?:i (?:already )?have enough (?:info|information|context)|(?:let me|i(?:'ll| will)|ready to) (?:now )?(?:give|provide|write|compose|respond|answer|summarize)|(?:final|concise|complete|detailed) (?:answer|response|reply|summary|introduction)|(?:准备|开始)(?:给出|输出|回复|回答|总结)|最终(?:回答|答复|回复|总结))/.test(
    conclusion,
  );
}

function reasoningSummary(text: string) {
  const normalized = text.replace(/\s+/g, ' ').toLowerCase();
  if (signalsFinalResponse(text)) return 'Preparing the final response.';
  if (/test|build|lint|typecheck|verif/.test(normalized))
    return 'Checking build, test, and verification status.';
  if (/relay|runtime|event|stream/.test(normalized))
    return 'Reviewing the Relay execution path and Runtime events.';
  if (/database|store|data flow|migration|postgres/.test(normalized))
    return 'Tracing the application data flow and persistence layer.';
  if (/ui|frontend|page|component|css|layout/.test(normalized))
    return 'Reviewing the relevant interface implementation.';
  if (
    /project structure|codebase|architecture|key files|repository/.test(
      normalized,
    )
  )
    return 'Reviewing the project structure and key files.';
  if (/read|file|directory|folder/.test(normalized))
    return 'Inspecting relevant files and directories.';
  return 'Working through the next step.';
}

async function writeClipboard(content: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(content);
      return true;
    } catch {
      // HTTP deployments and restricted browser contexts can reject the
      // asynchronous Clipboard API. Fall through to the selection-based copy.
    }
  }

  const activeElement = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = content;
  textarea.setAttribute('readonly', '');
  textarea.setAttribute('aria-hidden', 'true');
  Object.assign(textarea.style, {
    position: 'fixed',
    top: '0',
    left: '-9999px',
    width: '1px',
    height: '1px',
    opacity: '0',
    pointerEvents: 'none',
  });
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  let copied = false;
  try {
    const legacyCopy = Reflect.get(document, 'execCommand') as
      | ((command: string) => boolean)
      | undefined;
    copied = legacyCopy?.call(document, 'copy') ?? false;
  } catch {
    copied = false;
  } finally {
    textarea.remove();
    if (activeElement instanceof HTMLElement) activeElement.focus();
  }

  return copied;
}

function downloadText(content: string, fileName: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: 'text/markdown;charset=utf-8' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function formValue(data: FormData, key: string) {
  const value = data.get(key);
  return typeof value === 'string' ? value.trim() : '';
}
