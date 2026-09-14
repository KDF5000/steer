'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import {
  AlertCircle,
  Bot,
  Check,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  MessageSquareText,
  MoreHorizontal,
  PanelRightOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Server,
  Square,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
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
  SidebarProvider,
  SidebarRail,
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
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
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
  type AgentRecord,
  type ArtifactRecord,
  type ChatSessionRecord,
  type ProjectRecord,
} from '@/lib/steer-client';
import './fusion.css';

type View = 'chat' | 'artifacts' | 'agents';

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

function Markdown({ children }: { children: string }) {
  return (
    <div className="ws-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

type ProcessActivity = NonNullable<ChatMessage['activityLog']>[number];

function ProcessTranscript({
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
        item.kind === 'update' && item.detail ? (
          <Markdown key={item.id}>{item.detail}</Markdown>
        ) : (
          <div className="ws-chat-process-action" key={item.id}>
            <strong>{item.label}</strong>
            {item.detail && <small>{item.detail}</small>}
          </div>
        ),
      )}
    </div>
  );
}

export default function Fusion() {
  const [view, setView] = useState<View>('chat');
  const [agentTab, setAgentTab] = useState('agents');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [agentList, setAgentList] = useState<AgentItem[]>([]);
  const [projectList, setProjectList] = useState<ProjectRecord[]>([]);
  const [artifactList, setArtifactList] = useState<Artifact[]>([]);
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
  const [deleting, setDeleting] = useState(false);
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
    steer
      .bootstrap()
      .then((data) => {
        const agents = data.agents.map(agentFromRecord);
        setAgentList(agents);
        setProjectList(data.projects || []);
        setArtifactList(data.artifacts.map(artifactFromRecord));
        setChatSessions(data.sessions || []);
        setRuntimeNodes(data.relay.nodes || []);
        setRelayConnected(data.relay.connected);
        setRelayError(data.relay.error || '');
        setRelayPublicURL(data.relay.publicUrl || 'http://localhost:8787');
        if (agents[0]) setChatAgent(agents[0].id);
        if (data.projects?.[0]) setChatProject(data.projects[0].id);
        const firstRuntime = data.relay.nodes?.flatMap(
          (node) => node.runtimes || [],
        )[0];
        if (firstRuntime) setAgentRuntime(`${firstRuntime.provider}::`);
        setLoaded(true);
      })
      .catch((error: unknown) =>
        setLoadError(
          error instanceof Error
            ? error.message
            : 'Steer Server is unavailable.',
        ),
      );
  }, []);

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
      return;
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
        activeRun.current = '';
        setActiveRunID('');
        setChatWorking(false);
        return;
      }
    } catch (error) {
      setNotice(
        error instanceof Error
          ? error.message
          : 'Run status could not be loaded.',
      );
    } finally {
      if (pollingRun.current === runID) pollingRun.current = '';
    }
  }, []);

  useEffect(() => {
    if (!activeRunID) return;
    void pollRun(activeRunID);
    const interval = window.setInterval(() => void pollRun(activeRunID), 700);
    return () => window.clearInterval(interval);
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
      try {
        const data = await steer.session(sessionID);
        chatImages.forEach((image) => URL.revokeObjectURL(image.url));
        setChatImages([]);
        setChatSession(data.session.id);
        setChatAgent(data.session.agentId);
        setChatProject(data.session.projectId || 'none');
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
              activityLog: runActivityLog(
                result.events,
                result.run.status === 'succeeded',
              ),
              createdAt: result.run.started_at || message.createdAt,
              updatedAt: result.run.completed_at || message.updatedAt,
            };
          }),
        );
        setMessages(enrichedMessages);
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
        setView('chat');
      } catch (error) {
        setNotice(
          error instanceof Error
            ? error.message
            : 'Could not open this conversation.',
        );
      }
    },
    [chatImages, chatSession],
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
    activeRun.current = '';
    pollingRun.current = '';
    activeRunContext.current = { executionRuntimeID: null };
    setActiveRunID('');
    setChatWorking(false);
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
      setAgentList((current) => [...current, agentFromRecord(created)]);
      setChatAgent((current) => current || created.id);
      setAgentDialog(false);
      setNotice('Agent created.');
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

  const conversationRunIDs = new Set(
    messages.map((message) => message.runId).filter(Boolean),
  );
  const conversationArtifacts = artifactList.filter((artifact) =>
    conversationRunIDs.has(artifact.relayRunId),
  );

  return (
    <SidebarProvider
      className="ws"
      style={{ '--sidebar-width': '238px' } as CSSProperties}
    >
      <Sidebar collapsible="offcanvas" className="ws-sidebar">
        <SidebarHeader className="ws-sidebar-header">
          <div className="ws-workspace-switcher">
            <span className="ws-logo">S</span>
            <span>
              <strong>Steer</strong>
              <small>Personal workspace</small>
            </span>
          </div>
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
          {!!chatSessions.length && (
            <SidebarGroup className="ws-recent-chats">
              <SidebarGroupLabel>Recent</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {chatSessions.slice(0, 12).map((session) => (
                    <SidebarMenuItem key={session.id}>
                      <SidebarMenuButton
                        isActive={view === 'chat' && chatSession === session.id}
                        onClick={() => void openChatSession(session.id)}
                      >
                        <MessageSquareText aria-hidden="true" />
                        <span>{session.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {projectList
                  .filter((project) => !project.deletedAt)
                  .map((project) => (
                    <SidebarMenuItem key={project.id}>
                      <SidebarMenuButton
                        isActive={
                          view === 'chat' &&
                          !chatSession &&
                          chatProject === project.id
                        }
                        onClick={() => startNewChat(project.id)}
                        title={project.workspaceSource}
                      >
                        <Folder aria-hidden="true" />
                        <span>{project.name}</span>
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
                    </SidebarMenuItem>
                  ))}
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
          <div>
            <span className="ws-avatar">K</span>
            <span>
              <strong>Kongdefei</strong>
              <small>Personal workspace</small>
            </span>
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="ws-main">
        {view !== 'chat' && (
          <header className="ws-topbar">
            <SidebarTrigger aria-label="Toggle sidebar" />
            <span>
              {view === 'artifacts'
                ? 'Artifacts'
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
            agents={agentList}
            agent={currentAgent}
            executionRuntimeId={composerExecutionRuntimeId}
            executionRuntimeProvider={activeExecutionRuntime?.provider || null}
            projects={projectList}
            project={chatProject}
            artifacts={conversationArtifacts}
            messages={messages}
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
      <AgentDialog
        open={agentDialog}
        creating={creatingAgent}
        error={formError}
        runtime={agentRuntime}
        model={agentModel}
        choices={allRuntimeChoices}
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

function ChatView({
  agents,
  agent,
  executionRuntimeId,
  executionRuntimeProvider,
  projects,
  project,
  artifacts,
  messages,
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
  onArtifact,
}: {
  agents: AgentItem[];
  agent?: AgentItem;
  executionRuntimeId: string | null;
  executionRuntimeProvider: string | null;
  projects: ProjectRecord[];
  project: string;
  artifacts: Artifact[];
  messages: ChatMessage[];
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
  onArtifact: (id: string) => void;
}) {
  const hasMessages = messages.length > 0;
  const [reviewOpen, setReviewOpen] = useState(false);
  const [previewID, setPreviewID] = useState('');
  const [preview, setPreview] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [copiedMessage, setCopiedMessage] = useState('');
  const [draggingImages, setDraggingImages] = useState(false);
  const [composerPreviewID, setComposerPreviewID] = useState('');
  const [expandedActivity, setExpandedActivity] = useState<
    Record<string, boolean>
  >({});
  const selectedProject = projects.find((item) => item.id === project);
  const firstUserMessage = messages.find((message) => message.role === 'user');
  const conversationTitle = firstUserMessage
    ? (
        firstUserMessage.text.trim().replace(/\s+/g, ' ') ||
        firstUserMessage.attachments?.[0]?.name ||
        'Image'
      ).slice(0, 72)
    : 'New chat';
  const composerPreview = images.find(
    (image) => image.id === composerPreviewID,
  );
  const projectLabel =
    selectedProject?.workspaceSource || 'No project selected';
  const scrollArea = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const imageDragDepth = useRef(0);
  const followBottom = useRef(true);
  const selectPreview = (id: string) => {
    setPreviewID(id);
    setPreview('');
    setPreviewError('');
  };
  useEffect(() => {
    const area = scrollArea.current;
    if (area && followBottom.current) area.scrollTop = area.scrollHeight;
  }, [messages, working]);
  useEffect(() => {
    if (!working) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [working]);
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
    <section
      className={`ws-chat-page ${hasMessages ? 'has-messages' : 'is-empty'}`}
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
        {!!artifacts.length && (
          <Button
            variant="ghost"
            size="icon"
            className="ws-chat-review-trigger"
            aria-label={`Review ${artifacts.length} artifacts`}
            onClick={() => {
              selectPreview(artifacts[0].id);
              setReviewOpen(true);
            }}
          >
            <PanelRightOpen aria-hidden="true" />
            <span>{artifacts.length}</span>
          </Button>
        )}
      </header>
      <Sheet open={reviewOpen} onOpenChange={setReviewOpen}>
        <SheetContent className="ws-chat-review-sheet">
          <SheetTitle>Artifacts</SheetTitle>
          <SheetDescription>
            Durable outputs from this conversation. Agent replies remain in the
            thread.
          </SheetDescription>
          <div className="ws-chat-review-list">
            {artifacts.map((artifact) => (
              <button
                type="button"
                className={previewID === artifact.id ? 'selected' : ''}
                key={artifact.id}
                onClick={() => selectPreview(artifact.id)}
              >
                <FileText aria-hidden="true" />
                <span>
                  <strong>{artifact.title}</strong>
                  <small>
                    {artifact.type}
                    {artifact.size ? ` · ${formatSize(artifact.size)}` : ''}
                  </small>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
            ))}
          </div>
          {previewID && (
            <div className="ws-chat-artifact-preview">
              {previewError ? (
                <p role="alert">{previewError}</p>
              ) : preview ? (
                <Markdown>{preview}</Markdown>
              ) : (
                <output>Loading preview…</output>
              )}
              <Button variant="outline" onClick={() => onArtifact(previewID)}>
                Open full review
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
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
          if (area)
            followBottom.current =
              area.scrollHeight - area.scrollTop - area.clientHeight < 100;
        }}
      >
        {!hasMessages && (
          <div className="ws-chat-welcome">
            <span className="ws-chat-mark">
              <MessageSquareText aria-hidden="true" />
            </span>
            <h1>What would you like to work on?</h1>
            <p>
              {selectedProject
                ? `Work with ${agent.name} directly in ${selectedProject.name}. Relay runs on the machine where this project path exists.`
                : `Choose a project, then work with ${agent.name} on its local or remote Runtime.`}
            </p>
          </div>
        )}
        {hasMessages && (
          <div className="ws-chat-thread">
            {messages.map((message, index) => {
              const messageKey = message.id || `${message.role}-${index}`;
              const previousPrompt = messages
                .slice(0, index)
                .reverse()
                .find((item) => item.role === 'user')?.text;
              const terminal = isTerminalStatus(message.status);
              const finalOutputStarted =
                message.role === 'agent' && !terminal && Boolean(message.text);
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
                (item) => item.kind === 'update' || item.kind === 'action',
              );
              const visibleProcessItems = processActivityItems.length
                ? processActivityItems
                : activityItems.slice(-1);
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
                      <div className="ws-chat-response-process">
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
                            <span aria-live={terminal ? undefined : 'polite'}>
                              {responseStatusLabel(message, now)}
                            </span>
                            <ChevronRight aria-hidden="true" />
                          </button>
                        ) : (
                          <div className="ws-chat-response-meta is-running">
                            <span aria-live="polite">
                              {responseStatusLabel(message, now)}
                            </span>
                          </div>
                        )}
                        {processCollapsible && activityExpanded && (
                          <ProcessTranscript items={visibleProcessItems} />
                        )}
                        {processCollapsible && (
                          <div
                            className="ws-chat-response-divider"
                            aria-hidden="true"
                          />
                        )}
                      </div>
                    )}
                    {message.role === 'agent' && !processCollapsible && (
                      <ProcessTranscript items={visibleProcessItems} live />
                    )}
                    {message.role === 'agent' ? (
                      message.text ? (
                        <div aria-live={terminal ? undefined : 'polite'}>
                          <Markdown>{message.text}</Markdown>
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
                    {message.role === 'agent' && terminal && message.text && (
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
                            void writeClipboard(message.text).then((copied) => {
                              if (!copied) return;
                              setCopiedMessage(messageKey);
                              window.setTimeout(
                                () =>
                                  setCopiedMessage((current) =>
                                    current === messageKey ? '' : current,
                                  ),
                                1800,
                              );
                            });
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
              imageDragDepth.current = Math.max(0, imageDragDepth.current - 1);
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
                !event.nativeEvent.isComposing
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
                <Square aria-hidden="true" />
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
              <label>
                Runtime location
                <select
                  key={defaultRuntimeId}
                  name="runtimeId"
                  className="ws-form-select"
                  defaultValue={project?.runtimeId || defaultRuntimeId}
                  required
                >
                  <option value="" disabled>
                    Select a Runtime
                  </option>
                  {runtimes.map((runtime) => (
                    <option key={runtime.runtimeId} value={runtime.runtimeId}>
                      {runtime.label} · {runtime.runtimeId}
                    </option>
                  ))}
                </select>
              </label>
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
  const elapsed = formatElapsed(message.createdAt, message.updatedAt, now);
  if (message.status === 'succeeded') return `Completed in ${elapsed}`;
  if (message.status === 'failed') return `Failed after ${elapsed}`;
  if (message.status === 'cancelled') return `Stopped after ${elapsed}`;
  return `${message.activity || 'Thinking'} · ${elapsed}`;
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
    if (combined.includes('command')) return 'Running a command';
    if (combined.includes('filechange') || combined.includes('edit'))
      return 'Updating files';
    if (combined.includes('websearch') || combined.includes('search'))
      return 'Searching';
    if (combined.includes('mcp') || combined.includes('tool'))
      return 'Using a tool';
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
  const activities: Array<{
    id: string;
    label: string;
    detail?: string;
    kind?: 'stage' | 'update' | 'action';
  }> = [];
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
  const add = (
    id: string,
    label: string,
    detail?: unknown,
    kind: 'stage' | 'update' | 'action' = 'stage',
  ) => {
    const normalizedDetail =
      typeof detail === 'string'
        ? kind === 'update'
          ? detail.trim().slice(0, 12000)
          : detail.replace(/\s+/g, ' ').trim().slice(0, 600)
        : '';
    const key = `${label}:${normalizedDetail}`;
    if (activities.some((item) => `${item.label}:${item.detail || ''}` === key))
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
    else if (eventType.includes('runtime') && eventType.endsWith('.started'))
      add(id, 'Runtime started', event.type.split('.')[1]);
    else if (eventType.endsWith('hook.completed'))
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
          item.command || item.commandLine,
          'action',
        );
      else if (itemType.includes('filechange') || itemType.includes('edit'))
        add(id, 'Updated files', item.path || item.filePath, 'action');
      else if (itemType.includes('websearch') || itemType.includes('search'))
        add(id, 'Searched for information', item.query, 'action');
      else if (itemType.includes('mcp') || itemType.includes('tool'))
        add(id, 'Used a tool', item.name || item.toolName, 'action');
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

  return activities;
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
