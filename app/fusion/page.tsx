'use client';

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import {
  AlertCircle,
  ArrowDown,
  FileCode,
  FileJson,
  FileImage,
  Bot,
  Check,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  MoreHorizontal,
  PanelLeft,
  ChevronDown,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  Settings,
  Share2,
  LogOut,
  Library,
  NotebookPen,
  Square,
  SquarePen,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/github.css';
import ReactMarkdown from 'react-markdown';
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
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
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
  SelectValue,
} from '@/components/ui/select';
import { runFileChanges } from '@/lib/review';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type {
  AgentProfile as AgentItem,
  Artifact,
  ChatMessage,
  RelayEvent,
  RelayNode,
  RuntimeSummary,
} from '@/lib/domain';
import {
  steer,
  SteerHTTPError,
  type AuthUser,
  type AgentRecord,
  type ArtifactRecord,
  type ChatSessionRecord,
  type DocumentRecord,
  type ProjectRecord,
  type SkillRecord,
  type WorkspaceGitStatus,
  type WorkspaceSettingsRecord,
  type WorkspaceRecord,
} from '@/lib/steer-client';
import { AssetsView, WorkLogView } from './workspace-library';
import './fusion.css';

type View = 'chat' | 'artifacts' | 'agents' | 'assets' | 'notes' | 'settings';
const noProjectSessionGroup = '__no-project__';

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
    runtime: agent.runtimeId || `Automatic / ${agent.runtimeProvider}`,
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
  try {
    return decodeURIComponent(href.split(/[?#]/, 1)[0]);
  } catch {
    return href.split(/[?#]/, 1)[0];
  }
}

const Markdown = memo(function Markdown({
  children,
  onOpenWorkspaceFile,
}: {
  children: string;
  onOpenWorkspaceFile?: (path: string) => void;
}) {
  return (
    <div className="ws-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
                        onOpenWorkspaceFile(filePath);
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

function SessionNavigationItem({
  session,
  active,
  onOpen,
  onDelete,
}: {
  session: ChatSessionRecord;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <SidebarMenuItem className="ws-session-nav-item">
      <SidebarMenuButton isActive={active} onClick={onOpen}>
        <span>{session.title}</span>
      </SidebarMenuButton>
      <SidebarMenuAction
        className="ws-session-delete"
        aria-label={`Delete ${session.title}`}
        title="Delete conversation"
        onClick={onDelete}
      >
        <Trash2 aria-hidden="true" />
      </SidebarMenuAction>
    </SidebarMenuItem>
  );
}

export default function Fusion() {
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [workspaceList, setWorkspaceList] = useState<WorkspaceRecord[]>([]);
  const [workspaceID, setWorkspaceID] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 260;
    const saved = window.localStorage.getItem('steer.sidebarWidth');
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 200 && parsed <= 420
      ? parsed
      : 260;
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
  const [view, setView] = useState<View>('chat');
  const [agentTab, setAgentTab] = useState('agents');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
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
  const [relayConnected, setRelayConnected] = useState(false);
  const [relayError, setRelayError] = useState('');
  const [relayPublicURL, setRelayPublicURL] = useState('http://localhost:8787');
  const [chatAgent, setChatAgent] = useState('');
  const [chatProject, setChatProject] = useState('none');
  const [chatInput, setChatInput] = useState('');
  const [chatImages, setChatImages] = useState<PendingImage[]>([]);
  const [chatWorking, setChatWorking] = useState(false);
  const [chatSessionLoading, setChatSessionLoading] = useState(false);
  const [activeRunID, setActiveRunID] = useState('');
  const [chatSession, setChatSession] = useState('');
  const [chatSessions, setChatSessions] = useState<ChatSessionRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [agentDialog, setAgentDialog] = useState(false);
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
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [formError, setFormError] = useState('');
  const [agentRuntime, setAgentRuntime] = useState('');
  const [agentModel, setAgentModel] = useState('Runtime default');
  const activeRun = useRef('');
  const activeRunContext = useRef<{
    project?: ProjectRecord;
    executionRuntimeID: string | null;
  }>({ executionRuntimeID: null });
  const pollingRun = useRef('');
  const mounted = useRef(true);
  const gitStatusWorkspace = useRef('');
  const sessionLoadSequence = useRef(0);
  const routeReady = useRef(false);
  const skipRouteWrite = useRef(false);
  const createAgentLock = useRef(false);

  const currentAgent =
    agentList.find((agent) => agent.id === chatAgent) || agentList[0];
  const activeChatSession = chatSessions.find(
    (session) => session.id === chatSession,
  );
  const runtimeChoices = runtimeNodes.flatMap((node) =>
    (node.runtimes || []).map((runtime) => ({
      value: `${runtime.provider}::${runtime.id}`,
      label: `${node.id} / ${runtime.provider}`,
      provider: runtime.provider,
      runtimeId: runtime.id,
      models: runtime.models || [],
      defaultModel: runtime.default_model || '',
    })),
  );
  const selectedProject = projectList.find(
    (project) => project.id === chatProject,
  );
  const composerExecutionRuntimeId =
    activeChatSession?.executionRuntimeId || selectedProject?.runtimeId || null;
  const activeExecutionRuntime = runtimeChoices.find(
    (runtime) => runtime.runtimeId === composerExecutionRuntimeId,
  );
  const automaticChoices = [
    ...new Set(runtimeChoices.map((item) => item.provider)),
  ].map((provider) => ({
    value: `${provider}::`,
    label: `Automatic / ${provider}`,
    provider,
    runtimeId: '',
    models: runtimeChoices
      .filter((item) => item.provider === provider)
      .flatMap((item) => item.models),
    defaultModel:
      runtimeChoices.find((item) => item.provider === provider)?.defaultModel ||
      '',
  }));
  const allRuntimeChoices = [...automaticChoices, ...runtimeChoices];
  const selectedRuntimeChoice = allRuntimeChoices.find(
    (item) => item.value === agentRuntime,
  );
  const runtimeRows: RuntimeSummary[] = runtimeNodes.flatMap((node) =>
    (node.runtimes || []).map(
      (runtime) =>
        [
          node.id,
          node.labels?.location ||
            (node.id.includes('local') ? 'Local' : 'Remote'),
          runtime.provider,
          runtime.version || '—',
          `${node.active} / ${node.capacity}`,
        ] as RuntimeSummary,
    ),
  );

  const hydrateWorkspace = useCallback(async (id: string) => {
    gitStatusWorkspace.current = id;
    steer.setWorkspace(id);
    const data = await steer.bootstrap();
    const agents = data.agents.map(agentFromRecord);
    setAgentList(agents);
    setProjectList(data.projects || []);
    setProjectGitStatuses({});
    void Promise.all(
      (data.projects || []).map(async (project) => {
        const result = await steer
          .projectGitStatus(project.id)
          .catch(() => null);
        return result?.git ? ([project.id, result.git] as const) : null;
      }),
    ).then((results) => {
      if (!mounted.current || gitStatusWorkspace.current !== id) return;
      setProjectGitStatuses(
        Object.fromEntries(results.filter((item) => item !== null)),
      );
    });
    setArtifactList(data.artifacts.map(artifactFromRecord));
    setSkillList(data.skills || []);
    setDocumentList(data.documents || []);
    setAgentSkillAssignments(data.agentSkills || {});
    setWorkspaceSettings(data.settings || null);
    setChatSessions(data.sessions || []);
    setExpandedSessionGroups(new Set());
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

  const pollRun = useCallback(async (runID: string) => {
    if (
      activeRun.current !== runID ||
      !mounted.current ||
      pollingRun.current === runID
    )
      return null;
    pollingRun.current = runID;
    try {
      const result = await steer.run(runID);
      if (activeRun.current !== runID || !mounted.current) return;
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
        if (refreshed)
          setArtifactList(refreshed.artifacts.map(artifactFromRecord));
        const projectID = activeRunContext.current.project?.id;
        if (projectID) {
          const gitStatus = await steer
            .projectGitStatus(projectID)
            .catch(() => null);
          if (gitStatus?.git)
            setProjectGitStatuses((current) => ({
              ...current,
              [projectID]: gitStatus.git!,
            }));
        }
        activeRun.current = '';
        setActiveRunID('');
        setChatWorking(false);
        return result;
      }
      return result;
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Run status could not be loaded.',
      );
      return null;
    } finally {
      if (pollingRun.current === runID) pollingRun.current = '';
    }
  }, []);

  useEffect(() => {
    if (!activeRunID) return;
    const controller = new AbortController();
    let stopped = false;
    let retryTimer = 0;
    let renderTimer = 0;
    let renderFrame = 0;
    let events: RelayEvent[] = [];
    let lastSequence = 0;

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

    const connect = async () => {
      try {
        await steer.streamRunEvents(
          activeRunID,
          lastSequence,
          controller.signal,
          (event) => {
            if (event.sequence <= lastSequence) return;
            lastSequence = event.sequence;
            events.push(event);
            scheduleRender();
          },
        );
        if (!stopped) await pollRun(activeRunID);
      } catch {
        if (stopped || controller.signal.aborted) return;
        const latest = await pollRun(activeRunID);
        if (
          stopped ||
          !latest ||
          isTerminalStatus(latest.run.status) ||
          activeRun.current !== activeRunID
        )
          return;
        events = latest.events;
        lastSequence = events.at(-1)?.sequence || lastSequence;
        retryTimer = window.setTimeout(() => void connect(), 600);
      }
    };

    void pollRun(activeRunID).then((initial) => {
      if (
        stopped ||
        !initial ||
        isTerminalStatus(initial.run.status) ||
        activeRun.current !== activeRunID
      )
        return;
      events = initial.events;
      lastSequence = events.at(-1)?.sequence || 0;
      void connect();
    });

    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(retryTimer);
      window.clearTimeout(renderTimer);
      if (renderFrame) window.cancelAnimationFrame(renderFrame);
    };
  }, [activeRunID, pollRun]);

  const openChatSession = useCallback(
    async (sessionID: string) => {
      if (sessionID === chatSession) {
        setView('chat');
        return;
      }

      activeRun.current = '';
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
        setChatAgent(data.session.agentId);
        setChatProject(data.session.projectId || 'none');
        const group = data.session.projectId || noProjectSessionGroup;
        setExpandedSessionGroups((current) => {
          if (current.has(group)) return current;
          const next = new Set(current);
          next.add(group);
          return next;
        });
        if (data.project) {
          setProjectList((current) =>
            current.some((project) => project.id === data.project?.id)
              ? current
              : [...current, data.project!],
          );
        }
        const sessionMessages: ChatMessage[] = data.messages.map((message) => ({
          id: message.id,
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
      } catch (error) {
        if (loadSequence !== sessionLoadSequence.current || !mounted.current)
          return;
        setChatSessionLoading(false);
        setNotice(
          error instanceof Error
            ? error.message
            : 'Could not open this conversation.',
        );
      }
    },
    [chatImages, chatSession, chatSessions],
  );

  useEffect(() => {
    if (!loaded) return;
    const readRoute = () => {
      const [section, id] = window.location.hash.slice(1).split('/');
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
    if (!routeReady.current) {
      readRoute();
      routeReady.current = true;
    }
    window.addEventListener('hashchange', readRoute);
    return () => window.removeEventListener('hashchange', readRoute);
  }, [artifactList, loaded, openChatSession]);

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
    const hash = `#${section}${id ? `/${id}` : ''}`;
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }, [agentTab, artifactList, chatSession, selectedArtifact, view]);

  const startNewChat = (projectID = 'none') => {
    sessionLoadSequence.current += 1;
    activeRun.current = '';
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

  const send = async (override?: string) => {
    const text = (override ?? chatInput).trim();
    const images = override ? [] : chatImages;
    if ((!text && images.length === 0) || chatWorking || !currentAgent) return;
    const optimisticID = `local-${Date.now()}`;
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
      const result = await steer.chat({
        prompt: text,
        agentId: currentAgent.id,
        ...(chatProject !== 'none' ? { projectId: chatProject } : {}),
        ...(chatSession ? { sessionId: chatSession } : {}),
        images: images.map((image) => image.file),
      });
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
      setChatSessions((current) => {
        const now = new Date().toISOString();
        const session: ChatSessionRecord = {
          id: result.sessionId,
          title: (text || images[0]?.file.name || 'Image').slice(0, 72),
          agentId: currentAgent.id,
          projectId: chatProject === 'none' ? null : chatProject,
          executionRuntimeId:
            currentAgent.runtimeId ||
            projectList.find((item) => item.id === chatProject)?.runtimeId ||
            null,
          workspaceKey: null,
          createdAt: now,
          updatedAt: now,
        };
        return [session, ...current.filter((item) => item.id !== session.id)];
      });
      activeRun.current = result.runId;
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
                attachments: persistedAttachments || item.attachments,
              }
            : item,
        ),
        {
          id: result.assistantMessage.id,
          role: 'agent',
          text: '',
          status: result.status,
          runId: result.runId,
          createdAt: startedAt,
          activity: 'Starting Agent',
          activityLog: [{ id: 'starting-agent', label: 'Starting Agent' }],
        },
      ]);
    } catch (error) {
      setMessages((current) =>
        current.filter((message) => message.id !== optimisticID),
      );
      setChatInput(text);
      setNotice(
        error instanceof Error ? error.message : 'Could not submit the run.',
      );
      setChatWorking(false);
    }
  };

  const stop = async () => {
    if (!activeRun.current) return;
    try {
      await steer.cancelRun(activeRun.current);
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
    const runtimeId = formValue(data, 'runtimeId');
    if (!name || !workspaceSource) {
      setFormError(
        workspaceKind === 'git'
          ? 'Enter a project name and Git repository URL.'
          : 'Enter a project name and directory path.',
      );
      return;
    }
    if (workspaceKind === 'local' && !runtimeId) {
      setFormError('Choose the Runtime where this directory exists.');
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
        runtimeId: workspaceKind === 'local' ? runtimeId : null,
      } as const;
      const project = editingProject
        ? await steer.updateProject(editingProject.id, input)
        : await steer.createProject(input);
      setProjectList((current) =>
        editingProject
          ? current.map((item) => (item.id === project.id ? project : item))
          : [project, ...current],
      );
      if (!editingProject) startNewChat(project.id);
      setProjectDialog(false);
      setEditingProject(null);
      setNotice(
        editingProject
          ? 'Project updated.'
          : workspaceKind === 'git'
            ? 'Git project added. Each conversation gets an isolated worktree.'
            : 'Directory project added on the selected Runtime.',
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

  const createAgent = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createAgentLock.current) return;
    const data = new FormData(event.currentTarget);
    const name = formValue(data, 'name');
    if (!name || !selectedRuntimeChoice) {
      setFormError(
        name ? 'Connect Relay and select a Runtime.' : 'Enter an Agent name.',
      );
      return;
    }
    createAgentLock.current = true;
    setCreatingAgent(true);
    setFormError('');
    try {
      const created = await steer.createAgent({
        name,
        role: formValue(data, 'role') || 'General execution',
        instructions: formValue(data, 'instructions'),
        runtimeProvider: selectedRuntimeChoice.provider,
        runtimeId: selectedRuntimeChoice.runtimeId || null,
        model: agentModel === 'Runtime default' ? null : agentModel,
      });
      const selectedSkillIDs = data.getAll('skills').map(String);
      if (selectedSkillIDs.length) {
        await steer.setAgentSkills(created.id, selectedSkillIDs);
        setAgentSkillAssignments((current) => ({
          ...current,
          [created.id]: selectedSkillIDs,
        }));
      }
      setAgentList((current) => [...current, agentFromRecord(created)]);
      setChatAgent((current) => current || created.id);
      setAgentDialog(false);
      setNotice(
        selectedSkillIDs.length
          ? 'Agent created with assigned Skills.'
          : 'Agent created.',
      );
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Could not create Agent.',
      );
    } finally {
      createAgentLock.current = false;
      setCreatingAgent(false);
    }
  };

  const refreshRuntimes = async () => {
    try {
      await steer.claimAvailableRuntimes();
      const data = await steer.bootstrap();
      setRuntimeNodes(data.relay.nodes || []);
      setRelayConnected(data.relay.connected);
      setRelayError(data.relay.error || '');
      setNotice(
        data.relay.connected
          ? 'Runtime inventory refreshed.'
          : 'Relay is not connected.',
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : 'Could not refresh Relay.',
      );
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
    setLoaded(false);
    setLoadError('');
    setWorkspaceID(workspace.id);
    window.localStorage.setItem('steer.workspace', workspace.id);
    setView('chat');
    setChatSession('');
    setMessages([]);
    activeRun.current = '';
    setActiveRunID('');
    setChatWorking(false);
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
    await steer.logout().catch(() => undefined);
    steer.setWorkspace('');
    window.localStorage.removeItem('steer.workspace');
    setAuthUser(null);
    setWorkspaceList([]);
    setWorkspaceID('');
    gitStatusWorkspace.current = '';
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

  const conversationRunIDs = new Set(
    messages.map((message) => message.runId).filter(Boolean),
  );
  const conversationArtifacts = artifactList.filter((artifact) =>
    conversationRunIDs.has(artifact.relayRunId),
  );

  if (!authReady) {
    return <div className="ws-auth-loading">Loading Steer…</div>;
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
                  aria-label="Switch workspace"
                />
              }
            >
              <span className="ws-logo">S</span>
              <span>
                <strong>Steer</strong>
                <small>{currentWorkspace?.name || 'Workspace'}</small>
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
                Create workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button className="ws-search" onClick={() => setSearchOpen(true)}>
            <Search aria-hidden="true" /> Search <kbd>⌘ K</kbd>
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
                    <span>New chat</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="ws-project-navigation">
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {projectList
                  .filter((project) => !project.deletedAt)
                  .map((project) => {
                    const projectSessions = chatSessions.filter(
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
                          onClick={() => startNewChat(project.id)}
                          title={project.workspaceSource}
                        >
                          <Folder aria-hidden="true" />
                          <span className="ws-project-name">
                            {project.name}
                          </span>
                          <GitBranchLabel branch={branch} />
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
                            <DropdownMenuItem
                              className="h-9 gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 font-medium transition-colors hover:bg-[#f1f1f3]"
                              onClick={() => {
                                setFormError('');
                                setEditingProject(project);
                                setProjectDialog(true);
                              }}
                            >
                              <Pencil aria-hidden="true" />
                              Edit project
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              variant="destructive"
                              className="h-9 gap-2.5 whitespace-nowrap rounded-lg px-2.5 py-2 font-medium transition-colors hover:bg-[#fff0f1] hover:text-[#b3434d]"
                              onClick={() => setDeletingProject(project)}
                            >
                              <Trash2 aria-hidden="true" />
                              Delete project
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                        {!!projectSessions.length && sessionsExpanded && (
                          <SidebarMenuSub className="ws-session-list">
                            {projectSessions.map((session) => (
                              <SessionNavigationItem
                                key={session.id}
                                session={session}
                                active={
                                  view === 'chat' && chatSession === session.id
                                }
                                onOpen={() => void openChatSession(session.id)}
                                onDelete={() => setDeletingSession(session)}
                              />
                            ))}
                          </SidebarMenuSub>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                {!!chatSessions.filter(
                  (session) =>
                    !session.projectId ||
                    !projectList.some(
                      (project) =>
                        !project.deletedAt && project.id === session.projectId,
                    ),
                ).length && (
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
                      <span>No project</span>
                    </div>
                    {expandedSessionGroups.has(noProjectSessionGroup) && (
                      <SidebarMenuSub className="ws-session-list">
                        {chatSessions
                          .filter(
                            (session) =>
                              !session.projectId ||
                              !projectList.some(
                                (project) =>
                                  !project.deletedAt &&
                                  project.id === session.projectId,
                              ),
                          )
                          .map((session) => (
                            <SessionNavigationItem
                              key={session.id}
                              session={session}
                              active={
                                view === 'chat' && chatSession === session.id
                              }
                              onOpen={() => void openChatSession(session.id)}
                              onDelete={() => setDeletingSession(session)}
                            />
                          ))}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                )}
                <SidebarMenuItem>
                  <SidebarMenuButton
                    onClick={() => {
                      setFormError('');
                      setEditingProject(null);
                      setProjectDialog(true);
                    }}
                  >
                    <Plus aria-hidden="true" />
                    <span>Add project</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'assets'}
                    onClick={() => setView('assets')}
                  >
                    <Library aria-hidden="true" />
                    <span>Assets</span>
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
                    <span>Work log</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'artifacts'}
                    onClick={() => setView('artifacts')}
                  >
                    <FileText aria-hidden="true" />
                    <span>Artifacts</span>
                  </SidebarMenuButton>
                  <SidebarMenuBadge>{artifactList.length}</SidebarMenuBadge>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>System</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'settings'}
                    onClick={() => setView('settings')}
                  >
                    <Settings aria-hidden="true" />
                    <span>Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={view === 'agents' && agentTab === 'agents'}
                    onClick={() => {
                      setAgentTab('agents');
                      setView('agents');
                    }}
                  >
                    <Bot aria-hidden="true" />
                    <span>Agents</span>
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
                    <span>Runtimes</span>
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
                  aria-label="Account menu"
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
                Sign out
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
                ? 'Artifacts'
                : view === 'assets'
                  ? 'Assets'
                  : view === 'notes'
                    ? 'Work log'
                    : view === 'settings'
                      ? 'Settings'
                      : agentTab === 'agents'
                        ? 'Agents'
                        : 'Runtimes'}
            </span>
          </header>
        )}
        {!loaded ? (
          <div className="ws-page">
            {loadError ? (
              <div role="alert" className="ws-load-error">
                <AlertCircle />
                <h1>Workspace unavailable</h1>
                <p>{loadError}</p>
                <Button onClick={() => window.location.reload()}>
                  Try again
                </Button>
              </div>
            ) : (
              <output className="ws-content-state">Loading workspace…</output>
            )}
          </div>
        ) : view === 'chat' ? (
          <ChatView
            key={chatSession || 'new-chat'}
            sessionId={chatSession}
            agents={agentList}
            agent={currentAgent}
            executionRuntimeId={composerExecutionRuntimeId}
            executionRuntimeProvider={activeExecutionRuntime?.provider || null}
            projects={projectList}
            project={chatProject}
            artifacts={conversationArtifacts}
            messages={messages}
            sessionTitle={activeChatSession?.title}
            sessionLoading={chatSessionLoading}
            input={chatInput}
            images={chatImages}
            working={chatWorking}
            onAgent={setChatAgent}
            onProject={setChatProject}
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
            onSend={() => void send()}
            onRetry={(prompt) => void send(prompt)}
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
          <WorkLogView onNotice={setNotice} />
        ) : view === 'settings' ? (
          <SystemSettingsView
            agents={agentList}
            settings={workspaceSettings}
            onSettings={setWorkspaceSettings}
            onNotice={setNotice}
          />
        ) : (
          <AgentsView
            agents={agentList}
            runtimes={runtimeRows}
            relayConnected={relayConnected}
            relayError={relayError}
            tab={agentTab}
            onTab={setAgentTab}
            onCreate={() => setAgentDialog(true)}
            onAddRuntime={() => setRuntimeDialog(true)}
            onChat={(id) => {
              setChatAgent(id);
              startNewChat(chatProject);
            }}
          />
        )}
      </SidebarInset>

      <Dialog open={workspaceDialog} onOpenChange={setWorkspaceDialog}>
        <DialogContent className="ws-workspace-dialog">
          <DialogTitle>Create workspace</DialogTitle>
          <DialogDescription>
            Projects, conversations, Agents, and Runtimes stay isolated inside
            this workspace.
          </DialogDescription>
          <form onSubmit={createWorkspace}>
            <label>
              Name
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
                Cancel
              </button>
              <button type="submit" disabled={creatingWorkspace}>
                {creatingWorkspace ? 'Creating…' : 'Create workspace'}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <SearchDialog
        open={searchOpen}
        onOpen={setSearchOpen}
        projects={projectList}
        artifacts={artifactList}
        onProject={startNewChat}
        onArtifact={(index) => {
          setSelectedArtifact(index);
          setView('artifacts');
        }}
        onAgents={(tab) => {
          setAgentTab(tab);
          setView('agents');
        }}
      />
      <ProjectDialog
        key={`${editingProject?.id || 'new'}:${projectDialog ? 'open' : 'closed'}`}
        open={projectDialog}
        creating={creatingProject}
        error={formError}
        runtimes={runtimeChoices}
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
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingSession?.id === chatSession && chatWorking
                ? 'Stop the current run before deleting this conversation.'
                : 'This permanently removes its messages, attachments, and generated artifacts from Steer.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingConversation}>
              Cancel
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
              {deletingConversation ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AgentDialog
        open={agentDialog}
        creating={creatingAgent}
        error={formError}
        runtime={agentRuntime}
        model={agentModel}
        choices={allRuntimeChoices}
        skills={skillList}
        selectedChoice={selectedRuntimeChoice}
        onOpen={setAgentDialog}
        onRuntime={(value) => {
          setAgentRuntime(value);
          setAgentModel('Runtime default');
        }}
        onModel={setAgentModel}
        onSubmit={createAgent}
      />
      <RuntimeDialog
        open={runtimeDialog}
        connected={relayConnected}
        error={relayError}
        publicURL={relayPublicURL}
        onOpen={setRuntimeDialog}
        onURL={setRelayPublicURL}
        onRefresh={() => void refreshRuntimes()}
      />
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
  return (
    <main className="ws-auth-shell">
      <section className="ws-auth-card">
        <div className="ws-auth-brand">
          <span className="ws-logo">S</span>
          <div>
            <strong>Steer</strong>
            <small>Agent workspace</small>
          </div>
        </div>
        <div className="ws-auth-heading">
          <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p>
            {mode === 'login'
              ? 'Sign in to open your workspaces.'
              : 'Your first private workspace will be ready immediately.'}
          </p>
        </div>
        <form onSubmit={onSubmit}>
          {mode === 'register' && (
            <label>
              Name
              <input
                name="displayName"
                autoComplete="name"
                placeholder="Your name"
                required
              />
            </label>
          )}
          <label>
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </label>
          <label>
            Password
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
              ? 'Please wait…'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </button>
        </form>
        <p className="ws-auth-switch">
          {mode === 'login' ? 'New to Steer?' : 'Already have an account?'}
          <button
            type="button"
            onClick={() => onMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </section>
    </main>
  );
}

function ChatView({
  sessionId,
  agents,
  agent,
  executionRuntimeId,
  executionRuntimeProvider,
  projects,
  project,
  artifacts,
  messages,
  sessionTitle,
  sessionLoading,
  input,
  images,
  working,
  onAgent,
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
}: {
  sessionId: string;
  agents: AgentItem[];
  agent?: AgentItem;
  executionRuntimeId: string | null;
  executionRuntimeProvider: string | null;
  projects: ProjectRecord[];
  project: string;
  artifacts: Artifact[];
  messages: ChatMessage[];
  sessionTitle?: string;
  sessionLoading: boolean;
  input: string;
  images: PendingImage[];
  working: boolean;
  onAgent: (id: string) => void;
  onProject: (id: string) => void;
  onAddProject: () => void;
  onInput: (value: string) => void;
  onImages: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
  onSend: () => void;
  onRetry: (prompt: string) => void;
  onStop: () => void;
  onNotice: (message: string) => void;
  onArtifact: (id: string) => void;
}) {
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
  const reviewRounds = messages.filter(
    (message) => message.role === 'agent' && message.runId,
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
  const conversationTitle = firstUserMessage
    ? (
        firstUserMessage.text.trim().replace(/\s+/g, ' ') ||
        firstUserMessage.attachments?.[0]?.name ||
        'Image'
      ).slice(0, 72)
    : sessionTitle || 'New chat';
  const composerPreview = images.find(
    (image) => image.id === composerPreviewID,
  );
  const projectLabel =
    selectedProject?.workspaceSource || 'No project selected';
  const scrollArea = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const imageDragDepth = useRef(0);
  const followBottom = useRef(true);
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
  const openWorkspaceTab = (
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
        : [...tabs, { id, kind, runId: resolvedRunId, path, title, snapshot }],
    );
    setActiveWorkspaceTab(id);
    setReviewTab(kind);
    setReviewRunID(resolvedRunId);
    setSelectedChange(path);
    setReviewOpen(true);
  };
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
    const textarea = composer.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [input]);
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
          title="Create an Agent to start"
          text="Connect a Runtime through Relay, then create an Agent."
        />
      </section>
    );
  return (
    <div className="ws-chat-split">
      <div className="ws-conversation-panel">
        <section
          className={`ws-chat-page ${hasMessages || sessionLoading ? 'has-messages' : 'is-empty'}`}
        >
          <header className="ws-chat-appbar">
            <SidebarTrigger aria-label="Toggle sidebar" />
            <div className="ws-chat-appbar-context">
              <strong title={conversationTitle}>{conversationTitle}</strong>
              <span title={projectLabel}>
                <Folder aria-hidden="true" />
                <small>{projectLabel}</small>
              </span>
            </div>
            <div className="ws-grow" />
            <Button
              variant="ghost"
              size="icon"
              className="ws-chat-share-trigger"
              aria-label={
                shared === 'conversation'
                  ? 'Conversation share link copied'
                  : 'Share conversation'
              }
              title={
                shared === 'conversation'
                  ? 'Share link copied'
                  : 'Share conversation'
              }
              disabled={!sessionId || working || sharing === 'conversation'}
              onClick={() =>
                void copyShareLink('conversation', sessionId, 'conversation')
              }
            >
              {shared === 'conversation' ? (
                <Check aria-hidden="true" />
              ) : (
                <Share2 aria-hidden="true" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="ws-chat-review-trigger"
              aria-label="Open review panel"
              aria-expanded={reviewOpen}
              onClick={() => {
                setReviewOpen((open) => !open);
              }}
            >
              <PanelLeft className="ws-panel-toggle-right" aria-hidden="true" />
            </Button>
          </header>
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
                Loading conversation…
              </output>
            )}
            {!sessionLoading && !hasMessages && (
              <div className="ws-chat-welcome">
                <h1>What would you like to work on?</h1>
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
                      key={messageKey}
                    >
                      <span className="ws-agent-avatar">
                        {message.role === 'user' ? 'K' : agent.name[0]}
                      </span>
                      <div>
                        <strong>
                          {message.role === 'user' ? 'You' : agent.name}
                        </strong>
                        {message.role === 'agent' && (
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
                                <ResponseStatus message={message} />
                                <ChevronRight aria-hidden="true" />
                              </button>
                            ) : (
                              <div className="ws-chat-response-meta is-running">
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
                        {message.role === 'agent' ? (
                          message.text ? (
                            <div aria-live={terminal ? undefined : 'polite'}>
                              <Markdown
                                onOpenWorkspaceFile={(path) =>
                                  openWorkspaceTab(
                                    'files',
                                    message.runId || '',
                                    path,
                                  )
                                }
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
                            {message.text && <p>{message.text}</p>}
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
                        {terminal && !!message.changes?.length && (
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
                                      'files',
                                      message.runId,
                                      change.path,
                                      change.snapshot,
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
                                  previousPrompt && onRetry(previousPrompt)
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
            <form
              className={`ws-chatbox${draggingImages ? ' is-dragging' : ''}`}
              onSubmit={(event) => {
                event.preventDefault();
                followBottom.current = true;
                onSend();
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
              <textarea
                ref={composer}
                aria-label="Message Agent"
                rows={2}
                value={input}
                onChange={(event) => onInput(event.target.value)}
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
                  if (imageDragDepth.current === 0) setDraggingImages(false);
                }}
                onDrop={(event) => {
                  if (!event.dataTransfer.types.includes('Files')) return;
                  event.preventDefault();
                  imageDragDepth.current = 0;
                  setDraggingImages(false);
                  onImages(Array.from(event.dataTransfer.files));
                }}
                onPaste={(event) => {
                  const pastedImages = Array.from(event.clipboardData.items)
                    .filter(
                      (item) =>
                        item.kind === 'file' && item.type.startsWith('image/'),
                    )
                    .map((item) => item.getAsFile())
                    .filter((file): file is File => file !== null);

                  if (pastedImages.length > 0) {
                    onImages(pastedImages);
                  }
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    // Safari may clear isComposing before the IME confirmation Enter.
                    // oxlint-disable-next-line typescript/no-deprecated -- 229 is the compatibility signal for IME input
                    event.nativeEvent.keyCode !== 229
                  ) {
                    event.preventDefault();
                    followBottom.current = true;
                    onSend();
                  }
                }}
                placeholder="Ask a question or describe a task…"
              />
              <footer className="ws-chatbox-footer">
                <div className="ws-chatbox-context">
                  <Select
                    value={agent.id}
                    disabled={working}
                    onValueChange={(value) => onAgent(value ?? agent.id)}
                  >
                    <SelectTrigger
                      className="ws-composer-agent"
                      aria-label="Select Agent"
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
                          (executionRuntimeId &&
                            item.runtimeId &&
                            item.runtimeId !== executionRuntimeId) ||
                          (executionRuntimeProvider &&
                            item.runtimeProvider !== executionRuntimeProvider),
                        );
                        return (
                          <SelectItem
                            value={item.id}
                            key={item.id}
                            disabled={runtimeMismatch}
                            title={
                              runtimeMismatch
                                ? 'This conversation is pinned to another Runtime'
                                : undefined
                            }
                          >
                            {item.name}
                            {runtimeMismatch ? ' · Different Runtime' : ''}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <Select
                    value={project}
                    disabled={working || hasMessages}
                    onValueChange={(value) => onProject(value ?? 'none')}
                  >
                    <SelectTrigger
                      className="ws-composer-project"
                      aria-label="Select Project"
                      title={projectLabel}
                    >
                      <Folder aria-hidden="true" />
                      <span>
                        {selectedProject
                          ? `${selectedProject.name}${selectedProject.deletedAt ? ' (deleted)' : ''}`
                          : 'Select project'}
                      </span>
                    </SelectTrigger>
                    <SelectContent
                      className="ws-select-popup"
                      alignItemWithTrigger={false}
                    >
                      <SelectItem value="none">No project</SelectItem>
                      {projects
                        .filter((item) => !item.deletedAt)
                        .map((item) => (
                          <SelectItem value={item.id} key={item.id}>
                            {item.name} · {item.workspaceSource}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  {!hasMessages && (
                    <button
                      type="button"
                      className="ws-add-project"
                      onClick={onAddProject}
                    >
                      <Plus aria-hidden="true" />
                      Add project
                    </button>
                  )}
                </div>
                <button
                  className="ws-chat-send"
                  type={working ? 'button' : 'submit'}
                  aria-label={working ? 'Stop generating' : 'Send message'}
                  disabled={!working && !input.trim() && images.length === 0}
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
            <p className="ws-chat-mode-note">
              {agent.name} · {agent.runtime} · {agent.model}
            </p>
          </div>
        </section>
      </div>
      <hr
        className={`ws-review-resize ${reviewOpen ? '' : 'is-collapsed'}`}
        aria-label="Resize review panel"
        aria-orientation="vertical"
        onPointerDown={startReviewResize}
      />
      <div
        className={`ws-review-shell ${reviewOpen ? 'is-open' : 'is-collapsed'} ${reviewResizing ? 'is-resizing' : ''}`}
        style={
          {
            width: reviewOpen ? `${reviewWidth}px` : '0px',
            '--ws-review-width': `${reviewWidth}px`,
          } as CSSProperties
        }
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
      </div>
    </div>
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
      setError('');
      setSnapshotNotice('');
      void steer
        .inspectWorkspace(runId, 'read', path)
        .then((result) => {
          if (current !== readSequence.current) return;
          setContent(result.content);
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
        setSnapshotNotice('');
      });
  }, [data, fallbackSnapshot, filePath, initialPath, runId]);
  const loading = listing || reading;
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
      <div className="ws-workspace-columns">
        <section className="ws-workspace-preview" aria-label="File preview">
          {content !== null ? (
            filePath.toLowerCase().endsWith('.md') ? (
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
          className="ws-workspace-directory"
          aria-label="Directory navigation"
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

function splitWorkspaceDiff(diff: string): ReviewChange[] {
  const changes: ReviewChange[] = [];
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
      .then((result) =>
        setWorkspaceChanges(
          mergeWorkspaceChanges(
            splitWorkspaceDiff(result.content),
            reportedChanges,
            result.root,
          ),
        ),
      )
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
        if (!cancelled)
          setWorkspaceChanges(
            mergeWorkspaceChanges(
              splitWorkspaceDiff(result.content),
              reportedChanges,
              result.root,
            ),
          );
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
    changes.find((change) => change.path === selectedPath) || changes[0];
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
        <div className="ws-code-review-columns">
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
          <nav className="ws-code-review-files" aria-label="Changed files">
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
          <div
            className="ws-change-directory-header"
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <ChevronDown aria-hidden="true" />
            <Folder aria-hidden="true" />
            <span>{node.name}</span>
          </div>
        )}
        {[...node.children.values()]
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

function AgentsView({
  agents,
  runtimes,
  relayConnected,
  relayError,
  tab,
  onTab,
  onCreate,
  onAddRuntime,
  onChat,
}: {
  agents: AgentItem[];
  runtimes: RuntimeSummary[];
  relayConnected: boolean;
  relayError: string;
  tab: string;
  onTab: (value: string) => void;
  onCreate: () => void;
  onAddRuntime: () => void;
  onChat: (id: string) => void;
}) {
  return (
    <div className="ws-page">
      <PageIntro
        eyebrow="SYSTEM"
        title={tab === 'agents' ? 'Agents' : 'Runtimes'}
        description={
          tab === 'agents'
            ? 'Configure reusable roles, models, and Runtime scheduling preferences.'
            : 'View execution nodes, Runtime versions, and capacity managed by Relay.'
        }
        action={
          <button
            type="button"
            className="ws-primary-button"
            onClick={tab === 'agents' ? onCreate : onAddRuntime}
          >
            <Plus />
            {tab === 'agents' ? 'New Agent' : 'Add Runtime'}
          </button>
        }
      />
      <Tabs value={tab} onValueChange={(value) => onTab(String(value))}>
        <TabsList variant="line" className="ws-system-tabs">
          <TabsTrigger value="agents">Agents · {agents.length}</TabsTrigger>
          <TabsTrigger value="runtimes">
            Runtime instances · {runtimes.length}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'agents' ? (
        <div className="ws-agents-table">
          <div className="ws-table-head">
            <span>Agent</span>
            <span>Runtime</span>
            <span>Model</span>
            <span>Status</span>
            <span />
          </div>
          {agents.map((agent) => (
            <div key={agent.id}>
              <span className="ws-agent-avatar">{agent.name[0]}</span>
              <span>
                <strong>{agent.name}</strong>
                <small>{agent.role}</small>
              </span>
              <span>{agent.runtime}</span>
              <span>{agent.model}</span>
              <span className="ws-agent-state">
                <i />
                {agent.state}
              </span>
              <button type="button" onClick={() => onChat(agent.id)}>
                Chat
              </button>
            </div>
          ))}
        </div>
      ) : runtimes.length ? (
        <div className="ws-runtime-table">
          <div className="ws-table-head">
            <span>Node</span>
            <span>Location</span>
            <span>Runtime</span>
            <span>Version</span>
            <span>Load</span>
          </div>
          {runtimes.map(([node, location, runtime, version, load]) => (
            <div key={`${node}-${runtime}`}>
              <Server />
              <span>
                <strong>{node}</strong>
                <small>Online · heartbeat just now</small>
              </span>
              <span>{location}</span>
              <span>{runtime}</span>
              <span>{version}</span>
              <span>{load}</span>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          icon={<Server />}
          title="No Runtime instances"
          text={
            relayError ||
            'Start Relay Server and connect at least one Relay Node.'
          }
        />
      )}
      <p className="ws-system-note">
        <Bot />
        Relay {relayConnected ? 'connected' : 'not connected'}. Agents define
        reusable behavior; Runtimes are execution processes on local or remote
        machines.
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
  const [saving, setSaving] = useState(false);
  const selected = agents.find((agent) => agent.id === settings?.systemAgentId);
  const language = settings?.language || 'auto';

  const update = async (next: {
    systemAgentId?: string | null;
    language?: WorkspaceSettingsRecord['language'];
  }) => {
    if (saving) return;
    setSaving(true);
    try {
      const saved = await steer.updateSystemSettings({
        systemAgentId:
          next.systemAgentId === undefined
            ? settings?.systemAgentId || null
            : next.systemAgentId,
        language: next.language || language,
      });
      onSettings(saved);
      onNotice('Settings updated.');
    } catch (error) {
      onNotice(
        error instanceof Error ? error.message : 'Could not update settings.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ws-page ws-settings-page">
      <PageIntro
        eyebrow="SYSTEM"
        title="Settings"
        description="Manage how Steer works across this workspace."
        action={null}
      />
      <section className="ws-settings-group">
        <div className="ws-settings-heading">
          <h2>General</h2>
          <p>Basic preferences for Steer.</p>
        </div>
        <div className="ws-settings-row">
          <div className="ws-settings-copy">
            <label htmlFor="interface-language-select">Language</label>
            <p>Language used throughout the Steer interface.</p>
          </div>
          <Select
            value={language}
            onValueChange={(value) =>
              void update({
                language: String(value) as WorkspaceSettingsRecord['language'],
              })
            }
            disabled={saving}
          >
            <SelectTrigger
              id="interface-language-select"
              className="ws-settings-select"
              aria-label="Steer language"
            >
              <span>
                {language === 'zh-CN'
                  ? '简体中文'
                  : language === 'en'
                    ? 'English'
                    : 'System default'}
              </span>
            </SelectTrigger>
            <SelectContent className="ws-select-popup">
              <SelectItem value="auto">System default</SelectItem>
              <SelectItem value="zh-CN">简体中文</SelectItem>
              <SelectItem value="en">English</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>
      <section className="ws-settings-group">
        <div className="ws-settings-heading">
          <h2>AI &amp; automation</h2>
          <p>Choose how Steer handles workspace AI tasks.</p>
        </div>
        <div className="ws-settings-row">
          <div className="ws-settings-copy">
            <label htmlFor="system-agent-select">System Agent</label>
            <p>Used for work log summaries and future AI features.</p>
          </div>
          <Select
            value={settings?.systemAgentId || 'none'}
            onValueChange={(value) =>
              void update({
                systemAgentId: String(value) === 'none' ? null : String(value),
              })
            }
            disabled={saving || agents.length === 0}
          >
            <SelectTrigger
              id="system-agent-select"
              className="ws-settings-select"
              aria-label="System Agent"
            >
              <span>
                {selected?.name ||
                  (agents.length ? 'Not configured' : 'No agents available')}
              </span>
            </SelectTrigger>
            <SelectContent className="ws-select-popup">
              <SelectItem value="none">Not configured</SelectItem>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>
    </div>
  );
}

function SearchDialog({
  open,
  onOpen,
  projects,
  artifacts,
  onProject,
  onArtifact,
  onAgents,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  projects: ProjectRecord[];
  artifacts: Artifact[];
  onProject: (id: string) => void;
  onArtifact: (index: number) => void;
  onAgents: (tab: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpen}>
      <DialogContent className="ws-search-dialog">
        <DialogTitle className="sr-only">Search workspace</DialogTitle>
        <DialogDescription className="sr-only">
          Search projects, conversations, artifacts, and system pages
        </DialogDescription>
        <Command>
          <CommandInput placeholder="Search projects, artifacts, or pages…" />
          <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Projects">
              {projects
                .filter((project) => !project.deletedAt)
                .map((project) => (
                  <CommandItem
                    key={project.id}
                    onSelect={() => {
                      onProject(project.id);
                      onOpen(false);
                    }}
                  >
                    <Folder />
                    {project.name}
                  </CommandItem>
                ))}
            </CommandGroup>
            <CommandGroup heading="Workspace">
              {artifacts.map((artifact, index) => (
                <CommandItem
                  key={artifact.id}
                  onSelect={() => {
                    onArtifact(index);
                    onOpen(false);
                  }}
                >
                  <FileText />
                  {artifact.title}
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="System">
              <CommandItem
                onSelect={() => {
                  onAgents('agents');
                  onOpen(false);
                }}
              >
                <Bot />
                Agents
              </CommandItem>
              <CommandItem
                onSelect={() => {
                  onAgents('runtimes');
                  onOpen(false);
                }}
              >
                <Server />
                Runtimes
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function ProjectDialog({
  open,
  creating,
  error,
  runtimes,
  project,
  defaultRuntimeId,
  onOpen,
  onSubmit,
}: {
  open: boolean;
  creating: boolean;
  error: string;
  runtimes: RuntimeChoice[];
  project: ProjectRecord | null;
  defaultRuntimeId: string;
  onOpen: (open: boolean) => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const [projectType, setProjectType] = useState<'local' | 'git'>(
    project?.workspaceKind === 'git' ? 'git' : 'local',
  );
  return (
    <Dialog open={open} onOpenChange={(value) => !creating && onOpen(value)}>
      <DialogContent className="ws-agent-dialog ws-project-dialog">
        <DialogTitle>{project ? 'Edit Project' : 'Add Project'}</DialogTitle>
        <DialogDescription>
          {project
            ? 'Update the Project name or execution location.'
            : 'Use a directory on one Runtime, or let Relay prepare an isolated Git worktree for each conversation.'}
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
                <small>Work in place on one Runtime</small>
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
                <span>Runtime location</span>
                <Select
                  key={defaultRuntimeId}
                  name="runtimeId"
                  defaultValue={project?.runtimeId || defaultRuntimeId}
                  required
                >
                  <SelectTrigger
                    className="ws-form-select"
                    aria-label="Runtime location"
                  >
                    <SelectValue placeholder="Select a Runtime" />
                  </SelectTrigger>
                  <SelectContent className="ws-select-popup">
                    {runtimes.length ? (
                      runtimes.map((runtime) => (
                        <SelectItem
                          key={runtime.runtimeId}
                          value={runtime.runtimeId}
                        >
                          {runtime.label} · {runtime.runtimeId}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="__unavailable" disabled>
                        No Runtime available
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
                Runs modify this directory directly. Agents on another Runtime
                cannot use it without an explicit project location.
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
                conversation a reusable worktree. A fixed-Runtime Agent is
                required for the first version.
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
  runtime,
  model,
  choices,
  skills,
  selectedChoice,
  onOpen,
  onRuntime,
  onModel,
  onSubmit,
}: {
  open: boolean;
  creating: boolean;
  error: string;
  runtime: string;
  model: string;
  choices: RuntimeChoice[];
  skills: SkillRecord[];
  selectedChoice?: RuntimeChoice;
  onOpen: (open: boolean) => void;
  onRuntime: (value: string) => void;
  onModel: (value: string) => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}) {
  const models = [
    'Runtime default',
    ...new Set([
      ...(selectedChoice?.defaultModel ? [selectedChoice.defaultModel] : []),
      ...(selectedChoice?.models || []),
    ]),
  ];
  return (
    <Dialog open={open} onOpenChange={(value) => !creating && onOpen(value)}>
      <DialogContent className="ws-agent-dialog">
        <DialogTitle>Create Agent</DialogTitle>
        <DialogDescription>
          Define reusable behavior and choose where Relay may run it.
        </DialogDescription>
        <form onSubmit={onSubmit}>
          <label>
            Name
            <input
              name="name"
              autoComplete="off"
              placeholder="e.g. Security Reviewer"
              required
            />
          </label>
          <label>
            Role
            <input
              name="role"
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
                  <SelectItem key={choice.value} value={choice.value}>
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
              {creating ? 'Creating…' : 'Create Agent'}
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
  publicURL,
  onOpen,
  onURL,
  onRefresh,
}: {
  open: boolean;
  connected: boolean;
  error: string;
  publicURL: string;
  onOpen: (open: boolean) => void;
  onURL: (value: string) => void;
  onRefresh: () => void;
}) {
  const [commandCopied, setCommandCopied] = useState(false);
  const command = `curl -fsSL https://raw.githubusercontent.com/KDF5000/relay/main/install.sh | RELAY_NODE_TOKEN='YOUR_NODE_TOKEN' sh -s -- --server ${publicURL || 'https://relay.example.com'} --install-service`;

  async function copyInstallCommand() {
    const copied = await writeClipboard(command);
    if (!copied) return;
    setCommandCopied(true);
    window.setTimeout(() => setCommandCopied(false), 1600);
  }

  return (
    <Dialog open={open} onOpenChange={onOpen}>
      <DialogContent className="ws-runtime-dialog">
        <DialogTitle>Add Runtime</DialogTitle>
        <DialogDescription>
          Connect a local or remote machine to Relay. Installed Runtime CLIs are
          discovered automatically.
        </DialogDescription>
        <div className="ws-runtime-onboarding">
          <div
            className={`ws-runtime-connection ${connected ? 'is-connected' : ''}`}
          >
            <span className="ws-runtime-status-dot" />
            <div>
              <strong>
                {connected ? 'Relay connected' : 'Relay not connected'}
              </strong>
              <small>{error || 'Steer Server can reach Relay.'}</small>
            </div>
          </div>
          <section className="ws-runtime-step">
            <span>1</span>
            <div>
              <h3>Public Relay address</h3>
              <input
                value={publicURL}
                onChange={(event) => onURL(event.target.value)}
                aria-label="Public Relay Server URL"
                spellCheck={false}
              />
            </div>
          </section>
          <section className="ws-runtime-step">
            <span>2</span>
            <div>
              <h3>Install Relay Node</h3>
              <p>
                Run this on the machine where Codex, Trae, or another Runtime is
                installed.
              </p>
              <div className="ws-runtime-command">
                <pre>
                  <code>{command}</code>
                </pre>
                <button
                  type="button"
                  aria-label={
                    commandCopied
                      ? 'Relay Node install command copied'
                      : 'Copy Relay Node install command'
                  }
                  title={commandCopied ? 'Copied' : 'Copy command'}
                  className={commandCopied ? 'is-copied' : undefined}
                  onClick={() => void copyInstallCommand()}
                >
                  {commandCopied ? <Check /> : <Copy />}
                </button>
              </div>
              <a
                href="https://github.com/KDF5000/relay#deployment"
                target="_blank"
                rel="noreferrer"
              >
                Relay deployment guide <ExternalLink />
              </a>
            </div>
          </section>
        </div>
        <div className="ws-form-actions ws-runtime-actions">
          <button type="button" onClick={() => onOpen(false)}>
            Close
          </button>
          <button type="button" onClick={onRefresh}>
            <RefreshCw />
            Refresh Runtimes
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
  for (const event of [...(events || [])].reverse()) {
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

  for (const event of events || []) {
    const eventType = event.type.toLowerCase();
    const data = event.data || {};
    const item =
      data.item && typeof data.item === 'object'
        ? (data.item as Record<string, unknown>)
        : {};
    const itemType = (typeof item.type === 'string' ? item.type : '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    const id = String(event.sequence);

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
      if (itemType.includes('command'))
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
