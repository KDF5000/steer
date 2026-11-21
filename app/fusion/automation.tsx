'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  FolderGit2,
  GitBranch,
  History,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  User,
  Workflow,
  XCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { CodebaseWebhookSettings } from './codebase-webhook';
import { AgentSkillPicker } from './agent-skill-picker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useI18n } from '@/lib/i18n';
import type { AgentProfile, RuntimeModel } from '@/lib/domain';
import {
  steer,
  type CodebaseConnectionRecord,
  type CodebaseMergeRequestRecord,
  type CodebaseMergeRequestsRecord,
  type CodebaseRepositoryRecord,
  type CodebaseRunRecord,
  type CodebaseWorkflowRecord,
  type SkillRecord,
} from '@/lib/steer-client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

type AutomationTab = 'codebase' | 'repos' | 'mrs' | 'flows' | 'runs';

const automationTabs = [
  { value: 'flows', label: 'Workflows', icon: Workflow },
  { value: 'mrs', label: 'Merge requests', icon: GitBranch },
  { value: 'runs', label: 'Run records', icon: History },
  { value: 'repos', label: 'Repositories', icon: FolderGit2 },
  { value: 'codebase', label: 'Connection settings', icon: Code2 },
] as const;

type VerifiedRepo = { id: string; path: string; name: string };

// Subset of the workbench RuntimeChoice needed to configure a reviewer. The
// reviewer runs on the machine that owns the Agent, so model/effort options
// come from that Runtime's reported catalog.
type WorkflowRuntime = {
  provider: string;
  runtimeId: string;
  models: string[];
  defaultModel: string;
  modelCatalog?: RuntimeModel[];
  supportsReasoningEffort?: boolean;
};

// Select components treat an empty string as "no value", so the repository
// filter uses an explicit sentinel for "all repositories".
const allRepositoriesValue = '__all__';

type MRQuery = { state: string; search: string; page: number };

const RUN_STATUS_LABEL: Record<string, string> = {
  pending: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
  skipped: 'Skipped',
};

// Pipeline logs carry ANSI colour escapes and Windows line endings. The list
// only needs a readable one-line hint; the detail dialog shows the full log.
const ansiColor = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
const cleanRunLog = (value: string) =>
  value
    .replace(ansiColor, '')
    .replace(/\[[0-9;]*m/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();

const runLogPreview = (value: string) => {
  const text = cleanRunLog(value).replace(/\s+/g, ' ').trim();
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
};

const isLiveRun = (run: CodebaseRunRecord) =>
  ['pending', 'running'].includes(run.status) ||
  run.reportStatus === 'sending' ||
  (run.status === 'succeeded' && !run.reportStatus);

function AutomationFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="ws-automation-filter">
      <span>{label}</span>
      <Select value={value} onValueChange={(next) => onChange(String(next))}>
        <SelectTrigger aria-label={label}>
          <span>
            {options.find((item) => item.value === value)?.label || label}
          </span>
        </SelectTrigger>
        <SelectContent className="ws-select-popup">
          {options.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function AutomationView({
  scope,
  agents,
  runtimes = [],
  skills = [],
  onRefreshRuntimes,
  onNotice,
}: {
  scope: string;
  agents: AgentProfile[];
  runtimes?: WorkflowRuntime[];
  skills?: SkillRecord[];
  onRefreshRuntimes?: () => void;
  onNotice?: (message: string) => void;
}) {
  const { t, language } = useI18n();
  const [tab, setTab] = useState<AutomationTab>('flows');
  const tabChosen = useRef(false);
  const [connection, setConnection] = useState<CodebaseConnectionRecord | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [formError, setFormError] = useState('');

  // Repositories bound to at least one review workflow. Merge requests are
  // stored per repository, so this is the entry point of the review flow.
  const [repositories, setRepositories] = useState<CodebaseRepositoryRecord[]>(
    [],
  );
  const [reposLoading, setReposLoading] = useState(true);
  const [reposError, setReposError] = useState('');
  // Repositories are first-class records: users add them explicitly and
  // workflows then pick from this list.
  const [repoOpen, setRepoOpen] = useState(false);
  const [repoPath, setRepoPath] = useState('');
  const [repoSaving, setRepoSaving] = useState(false);
  const [repoFormError, setRepoFormError] = useState('');
  const [repoDeleteTarget, setRepoDeleteTarget] =
    useState<CodebaseRepositoryRecord | null>(null);
  const [repoDeleteError, setRepoDeleteError] = useState('');
  const [repoDeleting, setRepoDeleting] = useState(false);

  // Merge requests read from the database. Syncing is the only operation that
  // calls Codebase and it only fetches updates newer than the stored cursor.
  const [selectedRepoId, setSelectedRepoId] = useState('');
  const [search, setSearch] = useState('');
  const [mrState, setMRState] = useState('opened');
  const [result, setResult] = useState<CodebaseMergeRequestsRecord | null>(
    null,
  );
  const [fetching, setFetching] = useState(false);
  const [syncingRepoId, setSyncingRepoId] = useState('');
  const [mrError, setMRError] = useState('');
  const [selectedMR, setSelectedMR] =
    useState<CodebaseMergeRequestRecord | null>(null);
  const [runTarget, setRunTarget] = useState<CodebaseMergeRequestRecord | null>(
    null,
  );
  const [preferredWorkflowId, setPreferredWorkflowId] = useState('');
  const mrController = useRef<AbortController | null>(null);
  const syncController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const runController = useRef<AbortController | null>(null);
  const runsController = useRef<AbortController | null>(null);
  const workflowToggleController = useRef<AbortController | null>(null);
  const loadedRepo = useRef('');

  // Workflows
  const [workflows, setWorkflows] = useState<CodebaseWorkflowRecord[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const [workflowsError, setWorkflowsError] = useState('');
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] =
    useState<CodebaseWorkflowRecord | null>(null);
  const [wfName, setWfName] = useState('');
  const [wfRepo, setWfRepo] = useState<VerifiedRepo | null>(null);
  const [wfAgentId, setWfAgentId] = useState('');
  const [wfInstruction, setWfInstruction] = useState('');
  const [wfModel, setWfModel] = useState('');
  const [wfEffort, setWfEffort] = useState('');
  const [wfSkillIds, setWfSkillIds] = useState<string[]>([]);
  const [wfEnabled, setWfEnabled] = useState(true);
  const [wfReportEnabled, setWfReportEnabled] = useState(true);
  const [wfTriggerWebhook, setWfTriggerWebhook] = useState(true);
  const [flowSearch, setFlowSearch] = useState('');
  const [flowState, setFlowState] = useState('all');
  const [togglingWorkflow, setTogglingWorkflow] = useState('');
  const [wfNewRepoOpen, setWfNewRepoOpen] = useState(false);
  const [wfNewRepoPath, setWfNewRepoPath] = useState('');
  const [wfAddingRepo, setWfAddingRepo] = useState(false);
  const [wfError, setWfError] = useState('');
  const [wfSaving, setWfSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] =
    useState<CodebaseWorkflowRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Runs
  const [runs, setRuns] = useState<CodebaseRunRecord[]>([]);
  const [runClock, setRunClock] = useState(() => Date.now());
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState('');
  const [runsRepoFilter, setRunsRepoFilter] = useState('');
  const [runsWorkflowFilter, setRunsWorkflowFilter] = useState('');
  const [runsResultFilter, setRunsResultFilter] = useState('all');
  const [runsLimit, setRunsLimit] = useState(100);
  const [lastStartedRun, setLastStartedRun] =
    useState<CodebaseRunRecord | null>(null);
  const [submittingRun, setSubmittingRun] = useState<number | null>(null);
  const [detailRunSnapshot, setDetailRun] = useState<CodebaseRunRecord | null>(
    null,
  );
  const detailRun =
    runs.find((run) => run.id === detailRunSnapshot?.id) ?? detailRunSnapshot;
  const [detailCopied, setDetailCopied] = useState(false);
  const detailDialogRef = useRef<HTMLDivElement | null>(null);

  // Reviewer execution settings follow the selected Agent's Runtime.
  const instructionRef = useRef<HTMLTextAreaElement | null>(null);
  const wfAgent = agents.find((agent) => agent.id === wfAgentId);
  const wfRuntime = wfAgent
    ? runtimes.find(
        (runtime) =>
          runtime.runtimeId === wfAgent.runtimeId &&
          (!wfAgent.runtimeProvider ||
            runtime.provider === wfAgent.runtimeProvider),
      )
    : undefined;
  const wfModelOptions = wfRuntime
    ? Array.from(
        new Set(
          [wfRuntime.defaultModel, ...wfRuntime.models].filter(
            (model): model is string => Boolean(model),
          ),
        ),
      )
    : [];
  const wfModelInfo = wfRuntime?.modelCatalog?.find(
    (model) => model.id === (wfModel || wfRuntime?.defaultModel),
  );
  const wfEffortOptions =
    wfModelInfo?.supported_reasoning_efforts?.map((item) => item.effort) ?? [];

  // Grow the review guidance box with its content instead of forcing users to
  // scroll inside a three-line field.
  useLayoutEffect(() => {
    const element = instructionRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, Math.round(window.innerHeight * 0.42))}px`;
  }, [wfInstruction, workflowOpen]);

  const errorText = useCallback(
    (error: unknown) =>
      t(error instanceof Error ? error.message : 'Request failed.'),
    [t],
  );
  const notice = useCallback(
    (message: string) => onNotice?.(t(message)),
    [onNotice, t],
  );

  const loadRepositories = useCallback(
    async (signal?: AbortSignal, quiet = false) => {
      if (!quiet) {
        setReposLoading(true);
        setReposError('');
      }
      try {
        const data = await steer.codebaseRepositories(signal);
        if (signal?.aborted) return;
        setRepositories(data.items);
        setSelectedRepoId((current) =>
          current && data.items.some((item) => item.repoId === current)
            ? current
            : '',
        );
      } catch (error) {
        if (!signal?.aborted) setReposError(errorText(error));
      } finally {
        if (!signal?.aborted && !quiet) setReposLoading(false);
      }
    },
    [errorText],
  );

  const loadWorkflows = useCallback(
    async (signal?: AbortSignal) => {
      setWorkflowsLoading(true);
      setWorkflowsError('');
      try {
        const data = await steer.codebaseWorkflows(signal);
        if (!signal?.aborted) setWorkflows(data.items);
      } catch (error) {
        if (!signal?.aborted) setWorkflowsError(errorText(error));
      } finally {
        if (!signal?.aborted) setWorkflowsLoading(false);
      }
    },
    [errorText],
  );

  const loadMRs = useCallback(
    async (repoId: string, query: MRQuery) => {
      if (!repoId) return;
      mrController.current?.abort();
      const controller = new AbortController();
      mrController.current = controller;
      setFetching(true);
      setMRError('');
      try {
        const data = await steer.codebaseMergeRequests(
          {
            repoId,
            state: query.state,
            search: query.search,
            page: query.page,
          },
          controller.signal,
        );
        if (!controller.signal.aborted) setResult(data);
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult(null);
          setMRError(errorText(error));
        }
      } finally {
        if (!controller.signal.aborted) setFetching(false);
      }
    },
    [errorText],
  );

  const syncRepo = useCallback(
    async (
      repoId: string,
      options?: { initial?: boolean; loadList?: boolean },
    ) => {
      if (!repoId) return;
      syncController.current?.abort();
      const controller = new AbortController();
      syncController.current = controller;
      setSyncingRepoId(repoId);
      setMRError('');
      try {
        const synced = await steer.syncCodebaseMergeRequests(
          { repoId },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        void loadRepositories(controller.signal, true);
        if (options?.loadList !== false) {
          const query: MRQuery = options?.initial
            ? { state: 'opened', search: '', page: 1 }
            : { state: mrState, search: search.trim(), page: 1 };
          if (options?.initial) {
            setMRState('opened');
            setSearch('');
          }
          await loadMRs(repoId, query);
        }
        if (controller.signal.aborted) return;
        if (synced.created || synced.updated) {
          notice(
            t('Synced {created} new and {updated} updated merge requests.', {
              created: synced.created,
              updated: synced.updated,
            }),
          );
        } else {
          notice('Merge requests are up to date.');
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setMRError(errorText(error));
          // The server records the failure on the sync row; refresh so the
          // repository picker shows the same last error after a reload.
          void loadRepositories(undefined, true);
        }
      } finally {
        // Selecting another repository aborts this sync; reset the button even
        // when the request was superseded.
        if (syncController.current === controller) setSyncingRepoId('');
      }
    },
    [mrState, search, loadMRs, loadRepositories, notice, t, errorText],
  );

  const loadRuns = useCallback(
    async (sync = false, quiet = false) => {
      runsController.current?.abort();
      workflowToggleController.current?.abort();
      const controller = new AbortController();
      runsController.current = controller;
      if (!quiet) {
        setRunsLoading(true);
        setRunsError('');
      }
      try {
        const data = await steer.codebaseRuns(
          {
            repoId: runsRepoFilter || undefined,
            workflowId: runsWorkflowFilter || undefined,
            limit: runsLimit,
            sync,
          },
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setRuns(data.items);
          setRunClock(Date.now());
          setRunsError('');
        }
      } catch (error) {
        if (!controller.signal.aborted) setRunsError(errorText(error));
      } finally {
        // Switching the repository filter aborts the previous request; only the
        // latest request owns the loading state.
        if (runsController.current === controller) setRunsLoading(false);
      }
    },
    [runsRepoFilter, runsWorkflowFilter, runsLimit, errorText],
  );

  useEffect(() => {
    const controller = new AbortController();
    try {
      localStorage.removeItem(`steer-review-preview-maintenance:${scope}`);
      localStorage.removeItem(`steer-review-preview:${scope}:c`);
    } catch {
      // Browser storage is optional for the real Codebase integration.
    }
    steer
      .codebaseConnection(controller.signal)
      .then((saved) => {
        if (!controller.signal.aborted) {
          setConnection(saved);
          if (!saved && !tabChosen.current) setTab('codebase');
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setConnectionError(
            error instanceof Error ? error.message : 'Request failed.',
          );
          if (!tabChosen.current) setTab('codebase');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      mrController.current?.abort();
      syncController.current?.abort();
      actionController.current?.abort();
      runController.current?.abort();
      runsController.current?.abort();
    };
  }, [scope]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      void loadWorkflows();
      void loadRepositories();
    });
  }, [loadWorkflows, loadRepositories]);

  useEffect(() => {
    if (tab === 'runs') void Promise.resolve().then(() => loadRuns(true));
  }, [tab, loadRuns]);

  // Refresh only visible, unfinished work. Settled history stays still.
  useEffect(() => {
    if (tab !== 'runs' || !runs.some(isLiveRun)) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !runsLoading)
        void loadRuns(true, true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [tab, runs, runsLoading, loadRuns]);

  // Select the first bound repository when opening the merge request tab.
  useEffect(() => {
    if (tab !== 'mrs' || selectedRepoId || repositories.length === 0) return;
    const first = repositories[0].repoId;
    void Promise.resolve().then(() => {
      setResult(null);
      setSelectedRepoId(first);
    });
  }, [tab, selectedRepoId, repositories]);

  // A repository can disappear when its last workflow is deleted. Drop the
  // stale merge request page so it is not rendered under another repository.
  useEffect(() => {
    if (selectedRepoId) return;
    void Promise.resolve().then(() => {
      setResult(null);
      setMRError('');
    });
  }, [selectedRepoId]);

  // Load a repository once it becomes selected. Repositories without a sync
  // cursor are synced first so the list is never silently empty.
  useEffect(() => {
    if (!selectedRepoId) {
      loadedRepo.current = '';
      return;
    }
    const repo = repositories.find((item) => item.repoId === selectedRepoId);
    if (!repo || loadedRepo.current === selectedRepoId) return;
    loadedRepo.current = selectedRepoId;
    if (!repo.lastSyncedAt) {
      void Promise.resolve().then(() =>
        syncRepo(selectedRepoId, { initial: true }),
      );
    } else {
      void Promise.resolve().then(() =>
        loadMRs(selectedRepoId, { state: 'opened', search: '', page: 1 }),
      );
    }
  }, [selectedRepoId, repositories, syncRepo, loadMRs]);

  const openConnection = () => {
    setBaseUrl(connection?.baseUrl || 'https://codebase-api.byted.org');
    setAppId(connection?.appId || '');
    setAppSecret('');
    setFormError('');
    setConnectionOpen(true);
  };

  const saveConnection = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const controller = new AbortController();
    actionController.current?.abort();
    actionController.current = controller;
    setSaving(true);
    setFormError('');
    try {
      const saved = await steer.saveCodebaseConnection(
        {
          baseUrl: baseUrl.trim(),
          appId: appId.trim(),
          ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      mrController.current?.abort();
      setConnection(saved);
      setConnectionError('');
      setResult(null);
      setMRError('');
      setFetching(false);
      setSelectedMR(null);
      setAppSecret('');
      setConnectionOpen(false);
      if (!connection) setTab('repos');
      void loadWorkflows();
      void loadRepositories();
    } catch (error) {
      if (!controller.signal.aborted) setFormError(errorText(error));
    } finally {
      if (!controller.signal.aborted) setSaving(false);
    }
  };

  const disconnect = async () => {
    if (disconnecting) return;
    const controller = new AbortController();
    actionController.current?.abort();
    actionController.current = controller;
    setDisconnecting(true);
    try {
      await steer.disconnectCodebase(controller.signal);
      if (controller.signal.aborted) return;
      mrController.current?.abort();
      setConnection(null);
      setResult(null);
      setRepositories([]);
      setSelectedRepoId('');
      loadedRepo.current = '';
      setMRError('');
      setConnectionError('');
      setFetching(false);
      setSelectedMR(null);
      setDisconnectOpen(false);
      void loadWorkflows();
    } catch (error) {
      if (!controller.signal.aborted) setConnectionError(errorText(error));
    } finally {
      if (!controller.signal.aborted) setDisconnecting(false);
    }
  };

  const openWorkflowDialog = (
    workflow?: CodebaseWorkflowRecord,
    repoId?: string,
  ) => {
    setEditingWorkflow(workflow || null);
    setWfName(workflow?.name || '');
    const preferred = workflow
      ? repositories.find((item) => item.repoId === workflow.repoId)
      : repositories.find(
          (item) => item.repoId === (repoId || selectedRepoId),
        ) || repositories[0];
    setWfRepo(
      preferred
        ? {
            id: preferred.repoId,
            path: preferred.repoPath,
            name: preferred.repoName,
          }
        : workflow
          ? {
              id: workflow.repoId,
              path: workflow.repoPath,
              name: workflow.repoName,
            }
          : null,
    );
    setWfNewRepoOpen(repositories.length === 0);
    setWfNewRepoPath('');
    setWfAgentId(workflow?.agentId || agents.find((a) => !a.shared)?.id || '');
    setWfInstruction(workflow?.reviewInstruction || '');
    setWfModel(workflow?.model || '');
    setWfEffort(workflow?.reasoningEffort || '');
    setWfSkillIds(workflow?.skillIds || []);
    setWfEnabled(workflow?.enabled ?? true);
    setWfReportEnabled(workflow?.reportEnabled ?? true);
    setWfTriggerWebhook(workflow?.triggerWebhook ?? true);
    setWfError('');
    setWorkflowOpen(true);
    // Model and effort options come from the reviewer's Runtime, so refresh the
    // catalog each time the dialog opens instead of using a stale snapshot.
    onRefreshRuntimes?.();
  };

  const addRepository = async (
    path: string,
    options?: { selectForWorkflow?: boolean },
  ) => {
    const trimmed = path.trim();
    const inDialog = options?.selectForWorkflow === true;
    if (!trimmed || repoSaving || wfAddingRepo) return;
    const controller = new AbortController();
    actionController.current?.abort();
    actionController.current = controller;
    if (inDialog) setWfAddingRepo(true);
    else {
      setRepoSaving(true);
      setRepoFormError('');
    }
    try {
      const saved = await steer.addCodebaseRepository(
        { repoPath: trimmed },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      await loadRepositories(undefined, true);
      if (controller.signal.aborted) return;
      if (inDialog) {
        setWfRepo({
          id: saved.repoId,
          path: saved.repoPath,
          name: saved.repoName,
        });
        setWfNewRepoPath('');
        setWfNewRepoOpen(false);
        setWfError('');
      } else {
        setRepoOpen(false);
        setRepoPath('');
      }
      notice('Repository added.');
    } catch (error) {
      if (controller.signal.aborted) return;
      if (inDialog) setWfError(errorText(error));
      else setRepoFormError(errorText(error));
    } finally {
      if (!controller.signal.aborted) {
        if (inDialog) setWfAddingRepo(false);
        else setRepoSaving(false);
      }
    }
  };

  const deleteRepository = async () => {
    if (!repoDeleteTarget || repoDeleting) return;
    const controller = new AbortController();
    actionController.current?.abort();
    actionController.current = controller;
    setRepoDeleting(true);
    setRepoDeleteError('');
    try {
      const removed = repoDeleteTarget.repoId;
      await steer.deleteCodebaseRepository(removed, controller.signal);
      if (controller.signal.aborted) return;
      setRepositories((prev) => prev.filter((item) => item.repoId !== removed));
      if (selectedRepoId === removed) {
        mrController.current?.abort();
        loadedRepo.current = '';
        setSelectedRepoId('');
        setResult(null);
      }
      setRuns((prev) => prev.filter((run) => run.repoId !== removed));
      setRepoDeleteTarget(null);
      notice('Repository removed.');
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : '';
      setRepoDeleteError(
        /review workflow/i.test(message)
          ? t(
              'This repository is used by a review workflow. Delete that workflow first.',
            )
          : errorText(error),
      );
    } finally {
      if (!controller.signal.aborted) setRepoDeleting(false);
    }
  };

  const saveWorkflow = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (wfSaving) return;
    if (!wfRepo) {
      setWfError(t('Add or select a repository before saving.'));
      return;
    }
    if (!wfAgentId) {
      setWfError(t('Select a reviewer agent.'));
      return;
    }
    const controller = new AbortController();
    actionController.current?.abort();
    actionController.current = controller;
    setWfSaving(true);
    setWfError('');
    try {
      const input = {
        name: wfName.trim(),
        repoPath: wfRepo.path,
        agentId: wfAgentId,
        reviewInstruction: wfInstruction.trim(),
        model: wfModel,
        reasoningEffort: wfEffort,
        skillIds: wfSkillIds,
        enabled: wfEnabled,
        reportEnabled: wfReportEnabled,
        triggerWebhook: wfTriggerWebhook,
      };
      const saved = editingWorkflow
        ? await steer.updateCodebaseWorkflow(
            editingWorkflow.id,
            input,
            controller.signal,
          )
        : await steer.createCodebaseWorkflow(input, controller.signal);
      if (controller.signal.aborted) return;
      setWorkflows((prev) =>
        editingWorkflow
          ? prev.map((item) => (item.id === saved.id ? saved : item))
          : [saved, ...prev],
      );
      setWorkflowOpen(false);
      if (!editingWorkflow) {
        setTab('mrs');
        setSelectedRepoId(saved.repoId);
      }
      void loadRepositories(undefined, true);
      notice(editingWorkflow ? 'Workflow updated.' : 'Workflow created.');
    } catch (error) {
      if (!controller.signal.aborted) setWfError(errorText(error));
    } finally {
      if (!controller.signal.aborted) setWfSaving(false);
    }
  };

  const deleteWorkflow = async () => {
    if (!deleteTarget || deleting) return;
    const controller = new AbortController();
    actionController.current?.abort();
    actionController.current = controller;
    setDeleting(true);
    try {
      await steer.deleteCodebaseWorkflow(deleteTarget.id, controller.signal);
      if (controller.signal.aborted) return;
      setWorkflows((prev) =>
        prev.filter((item) => item.id !== deleteTarget.id),
      );
      // The server removes this workflow's run records with it.
      setRuns((prev) =>
        prev.filter((run) => run.workflowId !== deleteTarget.id),
      );
      if (selectedRepoId === deleteTarget.repoId) {
        setResult(null);
      }
      if (runsWorkflowFilter === deleteTarget.id) setRunsWorkflowFilter('');
      if (preferredWorkflowId === deleteTarget.id) setPreferredWorkflowId('');
      setDeleteTarget(null);
      void loadRepositories(undefined, true);
      notice('Workflow deleted.');
    } catch (error) {
      if (!controller.signal.aborted) setWorkflowsError(errorText(error));
    } finally {
      if (!controller.signal.aborted) setDeleting(false);
    }
  };

  const toggleWorkflow = async (
    workflow: CodebaseWorkflowRecord,
    enabled: boolean,
  ) => {
    if (togglingWorkflow) return;
    const controller = new AbortController();
    workflowToggleController.current = controller;
    setTogglingWorkflow(workflow.id);
    try {
      const saved = await steer.updateCodebaseWorkflow(
        workflow.id,
        {
          name: workflow.name,
          repoPath: workflow.repoPath,
          agentId: workflow.agentId,
          reviewInstruction: workflow.reviewInstruction,
          model: workflow.model,
          reasoningEffort: workflow.reasoningEffort,
          skillIds: workflow.skillIds,
          triggerWebhook: workflow.triggerWebhook,
          reportEnabled: workflow.reportEnabled,
          enabled,
        },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setWorkflows((items) =>
          items.map((item) => (item.id === saved.id ? saved : item)),
        );
        if (!enabled && preferredWorkflowId === workflow.id)
          setPreferredWorkflowId('');
        notice(enabled ? 'Workflow enabled.' : 'Workflow paused.');
      }
    } catch (error) {
      if (!controller.signal.aborted) notice(errorText(error));
    } finally {
      if (!controller.signal.aborted) setTogglingWorkflow('');
    }
  };

  const showWorkflowRuns = (
    workflow: CodebaseWorkflowRecord,
    run?: CodebaseRunRecord,
  ) => {
    setRunsRepoFilter(workflow.repoId);
    setRunsWorkflowFilter(workflow.id);
    setRunsResultFilter('all');
    setRunsLimit(100);
    setTab('runs');
    if (run) {
      setDetailCopied(false);
      setDetailRun(run);
    }
  };

  const selectRepo = (repoId: string) => {
    setPreferredWorkflowId('');
    mrController.current?.abort();
    syncController.current?.abort();
    setSelectedRepoId(repoId);
    setResult(null);
    setMRError('');
    setSearch('');
    setMRState('opened');
    const repo = repositories.find((item) => item.repoId === repoId);
    if (!repo) {
      // The repository list is still refreshing; the selection effect loads it
      // once it appears.
      loadedRepo.current = '';
      return;
    }
    // Mark it as loaded so the selection effect does not fetch it twice.
    loadedRepo.current = repoId;
    if (!repo.lastSyncedAt) {
      void syncRepo(repoId, { initial: true });
    } else {
      void loadMRs(repoId, { state: 'opened', search: '', page: 1 });
    }
  };

  const applyFilters = (next?: { state?: string; search?: string }) => {
    if (!selectedRepoId) return;
    const nextState = next?.state ?? mrState;
    const nextSearch = next?.search ?? search;
    if (next?.state !== undefined) setMRState(next.state);
    if (next?.search !== undefined) setSearch(next.search);
    void loadMRs(selectedRepoId, {
      state: nextState,
      search: nextSearch.trim(),
      page: 1,
    });
  };

  const runCandidates = workflows.filter(
    (item) => item.repoId === selectedRepoId && item.enabled,
  );

  const requestRun = (mr: CodebaseMergeRequestRecord) => {
    if (runCandidates.length === 0) {
      notice('Create an enabled workflow for this repository first.');
      return;
    }
    const preferred = runCandidates.find(
      (workflow) => workflow.id === preferredWorkflowId,
    );
    if (preferred) {
      void runReview(mr, preferred);
      return;
    }
    if (runCandidates.length === 1) {
      void runReview(mr, runCandidates[0]);
      return;
    }
    setRunTarget(mr);
  };

  const runReview = async (
    mr: CodebaseMergeRequestRecord,
    workflow: CodebaseWorkflowRecord,
  ) => {
    if (submittingRun !== null) return;
    const controller = new AbortController();
    runController.current?.abort();
    runController.current = controller;
    setSubmittingRun(mr.iid);
    try {
      const run = await steer.createCodebaseRun(
        workflow.id,
        { mrIid: mr.iid },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const agent = agents.find((item) => item.id === workflow.agentId);
      if (run.status === 'failed') {
        notice('Review could not start. Open the run record for details.');
      } else {
        notice(
          t('Review started with {agent}.', {
            agent: agent?.name || workflow.name,
          }),
        );
      }
      setRuns((prev) => [run, ...prev]);
      setLastStartedRun(run);
      setRunClock(Date.parse(run.startedAt || run.createdAt));
      setRunTarget(null);
    } catch (error) {
      if (!controller.signal.aborted) notice(errorText(error));
    } finally {
      if (!controller.signal.aborted) setSubmittingRun(null);
    }
  };

  const date = (value: string | null) => {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? '—'
      : new Intl.DateTimeFormat(language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(parsed);
  };
  const stateName = (value: string) =>
    t(
      {
        opened: 'Open',
        open: 'Open',
        merged: 'Merged',
        closed: 'Closed',
        all: 'All',
      }[value] || value,
    );
  const selectedRepo = repositories.find(
    (item) => item.repoId === selectedRepoId,
  );
  const runStatusLabel = (value: string) => t(RUN_STATUS_LABEL[value] || value);
  const visibleWorkflows = workflows.filter((workflow) => {
    const needle = flowSearch.trim().toLowerCase();
    const agent = agents.find((item) => item.id === workflow.agentId);
    return (
      (flowState === 'all' || workflow.enabled === (flowState === 'enabled')) &&
      (!needle ||
        [workflow.name, workflow.repoPath, agent?.name || ''].some((value) =>
          value.toLowerCase().includes(needle),
        ))
    );
  });
  const visibleRuns = runs.filter(
    (run) =>
      runsResultFilter === 'all' ||
      (runsResultFilter === 'active'
        ? ['pending', 'running'].includes(run.status)
        : runsResultFilter === 'report-failed'
          ? run.reportStatus === 'failed'
          : run.status === runsResultFilter),
  );
  const runDuration = (run: CodebaseRunRecord) => {
    if (!run.finishedAt && !['pending', 'running'].includes(run.status))
      return '—';
    const started = new Date(run.startedAt || run.createdAt).getTime();
    const finished = run.finishedAt
      ? new Date(run.finishedAt).getTime()
      : runClock;
    if (!Number.isFinite(started) || !Number.isFinite(finished)) return '—';
    const seconds = Math.max(0, Math.floor((finished - started) / 1000));
    return seconds >= 60
      ? t('{minutes}m {seconds}s', {
          minutes: Math.floor(seconds / 60),
          seconds: seconds % 60,
        })
      : t('{seconds}s', { seconds });
  };
  const runStatusIcon = (status: string) => {
    if (status === 'running') {
      return <Loader2 aria-hidden="true" className="is-spinning" />;
    }
    if (status === 'succeeded') return <CheckCircle2 aria-hidden="true" />;
    if (status === 'failed') return <XCircle aria-hidden="true" />;
    return <Clock aria-hidden="true" />;
  };
  const copyRunLog = (value: string) => {
    void navigator.clipboard.writeText(value).then(
      () => {
        setDetailCopied(true);
        window.setTimeout(() => setDetailCopied(false), 2000);
      },
      () => notice('Copy failed.'),
    );
  };
  const detailWorkflow = detailRun
    ? workflows.find((item) => item.id === detailRun.workflowId)
    : undefined;
  const detailLog = detailRun?.error ? cleanRunLog(detailRun.error) : '';
  const conversationURL = (conversationId: string) =>
    `${window.location.origin}${window.location.pathname}#chat/${conversationId}`;
  const repoWorkflows = (repoId: string) =>
    workflows.filter((item) => item.repoId === repoId);

  return (
    <div className="ws-page ws-automation-page">
      <div className="ws-page-intro">
        <div>
          <span>{t('System').toUpperCase()}</span>
          <h1>{t('Automation')}</h1>
          <p>
            {t(
              'Configure reviews, track merge requests, and inspect run results.',
            )}
          </p>
        </div>
        <div className="ws-page-actions">
          {(tab === 'repos' || tab === 'mrs') && (
            <button
              type="button"
              className="ws-primary-button"
              onClick={() => {
                setRepoPath('');
                setRepoFormError('');
                setRepoOpen(true);
              }}
              disabled={!connection}
              title={
                !connection
                  ? t('Connect Codebase before adding a repository.')
                  : undefined
              }
            >
              <Plus aria-hidden="true" />
              {t('Add repository')}
            </button>
          )}
          {tab === 'flows' && (
            <button
              type="button"
              className="ws-primary-button"
              onClick={() => openWorkflowDialog()}
              disabled={!connection || workflowsLoading}
            >
              <Plus aria-hidden="true" />
              {t('New workflow')}
            </button>
          )}
        </div>
      </div>
      <Tabs
        className="flex-col"
        value={tab}
        onValueChange={(value) => {
          tabChosen.current = true;
          setTab(String(value) as AutomationTab);
        }}
      >
        <TabsList variant="line" className="ws-system-tabs">
          {automationTabs.map(({ value, label }) => (
            <TabsTrigger key={value} value={value}>
              {t(label)}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* Codebase connection: capability only */}
        <TabsContent value="codebase" hidden={tab !== 'codebase'}>
          <div className="ws-automation-settings">
            <section className="ws-automation-setting-row">
              <div className="ws-automation-setting-icon">
                <Code2 aria-hidden="true" />
              </div>
              <div className="ws-automation-connection-copy">
                <div className="ws-automation-connection-heading">
                  <strong>{t('Codebase connection')}</strong>
                  {!loading && (
                    <span
                      className={`ws-automation-connection-status${connection ? ' is-connected' : ''}`}
                    >
                      {t(
                        connection
                          ? 'Connected'
                          : connectionError
                            ? 'Connection unavailable'
                            : 'Not configured',
                      )}
                    </span>
                  )}
                </div>
                <p>
                  {loading
                    ? t('Loading…')
                    : connection
                      ? `${connection.baseUrl} · ${connection.remoteUsername}`
                      : t('No Codebase connection configured.')}
                </p>
                {connection && (
                  <small>
                    {t('Connection verified')} · {date(connection.verifiedAt)}
                  </small>
                )}
              </div>
              {!loading && (
                <div className="ws-automation-actions">
                  <button
                    className="ws-automation-button"
                    onClick={openConnection}
                  >
                    {t(connection ? 'Edit connection' : 'Connect Codebase')}
                  </button>
                  {connection && (
                    <button
                      className="ws-automation-button"
                      onClick={() => {
                        setConnectionError('');
                        setDisconnectOpen(true);
                      }}
                    >
                      {t('Disconnect')}
                    </button>
                  )}
                </div>
              )}
            </section>
            {connectionError && (
              <p className="ws-automation-error" role="alert">
                <AlertCircle aria-hidden="true" />
                {t(connectionError)}
              </p>
            )}
            <CodebaseWebhookSettings />
          </div>
        </TabsContent>

        {/* Repositories: managed independently of workflows */}
        <TabsContent value="repos" hidden={tab !== 'repos'}>
          <section className="ws-automation-repos">
            {!connection ? (
              <div className="ws-automation-empty is-small">
                <Code2 aria-hidden="true" />
                <h2>{t('Connect Codebase first')}</h2>
                <p>
                  {t(
                    'Configure the Codebase connection before adding repositories.',
                  )}
                </p>
              </div>
            ) : reposLoading ? (
              <output
                className="ws-automation-skeleton"
                aria-label={t('Loading…')}
              >
                <div />
                <div />
                <div />
              </output>
            ) : reposError ? (
              <p className="ws-automation-error" role="alert">
                <AlertCircle aria-hidden="true" />
                {reposError}
              </p>
            ) : repositories.length === 0 ? (
              <div className="ws-automation-empty is-small">
                <FolderGit2 aria-hidden="true" />
                <h2>{t('No repositories yet')}</h2>
                <p>
                  {t(
                    'Add a repository to sync its merge requests and bind it to review workflows.',
                  )}
                </p>
                <button
                  className="ws-primary-button"
                  onClick={() => {
                    setRepoPath('');
                    setRepoFormError('');
                    setRepoOpen(true);
                  }}
                >
                  <Plus aria-hidden="true" />
                  {t('Add repository')}
                </button>
              </div>
            ) : (
              <div className="ws-automation-repo-list">
                {repositories.map((repo) => {
                  const repoFlows = repoWorkflows(repo.repoId);
                  return (
                    <div key={repo.repoId} className="ws-automation-repo-row">
                      <div className="ws-automation-repo-main">
                        <div className="ws-automation-repo-title">
                          <strong>{repo.repoName || repo.repoPath}</strong>
                          {repoFlows.length > 0 ? (
                            <span className="ws-automation-badge is-muted">
                              {repoFlows.length} {t('workflows')}
                            </span>
                          ) : (
                            <span className="ws-automation-badge is-muted">
                              {t('No workflow')}
                            </span>
                          )}
                        </div>
                        <p className="ws-automation-repo-path">
                          {repo.repoPath}
                        </p>
                        <small>
                          {repo.lastSyncedAt
                            ? `${t('Last synced')} ${date(repo.lastSyncedAt)} · ${repo.openCount} ${t('open')} · ${repo.totalCount} ${t('total')}`
                            : t('Not synced yet')}
                        </small>
                        {repo.lastError && (
                          <p className="ws-automation-repo-error">
                            <AlertCircle aria-hidden="true" />
                            {repo.lastError}
                          </p>
                        )}
                      </div>
                      <div className="ws-automation-repo-actions">
                        <button
                          type="button"
                          className="ws-automation-button"
                          onClick={() => {
                            if (repoFlows.length) {
                              setFlowSearch(repo.repoPath);
                              setFlowState('all');
                              setTab('flows');
                            } else openWorkflowDialog(undefined, repo.repoId);
                          }}
                        >
                          <Workflow aria-hidden="true" />
                          {t(
                            repoFlows.length
                              ? 'View workflows'
                              : 'New workflow',
                          )}
                        </button>
                        <button
                          type="button"
                          className="ws-automation-button"
                          onClick={() => {
                            setTab('mrs');
                            selectRepo(repo.repoId);
                          }}
                        >
                          <GitBranch aria-hidden="true" />
                          {t('View MRs')}
                        </button>
                        <button
                          type="button"
                          className="ws-automation-button"
                          onClick={() =>
                            void syncRepo(repo.repoId, { loadList: false })
                          }
                          disabled={Boolean(syncingRepoId)}
                        >
                          <RefreshCw
                            aria-hidden="true"
                            className={
                              syncingRepoId === repo.repoId
                                ? 'is-spinning'
                                : undefined
                            }
                          />
                          {t(
                            syncingRepoId === repo.repoId ? 'Syncing…' : 'Sync',
                          )}
                        </button>
                        <button
                          type="button"
                          className="ws-automation-button is-danger"
                          onClick={() => {
                            setRepoDeleteError('');
                            setRepoDeleteTarget(repo);
                          }}
                          disabled={repoFlows.length > 0}
                          aria-label={t('Remove repository')}
                          title={t(
                            repoFlows.length > 0
                              ? 'Remove associated workflows before removing this repository.'
                              : 'Remove repository',
                          )}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </TabsContent>

        {/* Merge requests: repository-centric, database-backed */}
        <TabsContent value="mrs" hidden={tab !== 'mrs'}>
          <section className="ws-automation-mrs">
            {!connection ? (
              <div className="ws-automation-empty is-small">
                <Code2 aria-hidden="true" />
                <h2>{t('Connect Codebase first')}</h2>
                <p>
                  {t(
                    'Configure the Codebase connection, then create a workflow to bind a repository.',
                  )}
                </p>
              </div>
            ) : reposLoading ? (
              <output
                className="ws-automation-skeleton"
                aria-label={t('Loading…')}
              >
                <div />
                <div />
                <div />
              </output>
            ) : repositories.length === 0 ? (
              reposError ? (
                <p className="ws-automation-error" role="alert">
                  <AlertCircle aria-hidden="true" />
                  {reposError}
                </p>
              ) : (
                <div className="ws-automation-empty is-small">
                  <FolderGit2 aria-hidden="true" />
                  <h2>{t('No repositories yet')}</h2>
                  <p>
                    {t(
                      'Add a repository to sync its merge requests. Every workflow that reviews it shares the same synced list.',
                    )}
                  </p>
                  <button
                    className="ws-primary-button"
                    onClick={() => {
                      setRepoPath('');
                      setRepoFormError('');
                      setRepoOpen(true);
                    }}
                  >
                    <Plus aria-hidden="true" />
                    {t('Add repository')}
                  </button>
                </div>
              )
            ) : (
              <>
                <div className="ws-automation-mr-toolbar">
                  <label className="ws-automation-repo-picker">
                    <span>{t('Repository')}</span>
                    <Select
                      value={selectedRepoId}
                      onValueChange={(value) => selectRepo(String(value))}
                    >
                      <SelectTrigger>
                        <span>
                          {selectedRepo
                            ? selectedRepo.repoPath
                            : t('Select a repository')}
                        </span>
                      </SelectTrigger>
                      <SelectContent className="ws-select-popup">
                        {repositories.map((repo) => (
                          <SelectItem key={repo.repoId} value={repo.repoId}>
                            {repo.repoPath} · {repo.openCount} {t('open')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="ws-automation-mr-search">
                    <span>{t('Search')}</span>
                    <div className="ws-automation-search-input">
                      <input
                        type="search"
                        aria-label={t('MR title')}
                        maxLength={200}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        onKeyDown={(event) => {
                          if (
                            event.key === 'Enter' &&
                            !event.nativeEvent.isComposing
                          ) {
                            event.preventDefault();
                            applyFilters();
                          }
                        }}
                        placeholder={t('MR title')}
                        disabled={!selectedRepoId}
                      />
                      <button
                        type="button"
                        aria-label={t('Search')}
                        onClick={() => applyFilters()}
                        disabled={!selectedRepoId}
                      >
                        <Search aria-hidden="true" />
                      </button>
                    </div>
                  </label>
                  {runCandidates.length > 1 && (
                    <AutomationFilter
                      label={t('Review workflow')}
                      value={
                        runCandidates.some(
                          (wf) => wf.id === preferredWorkflowId,
                        )
                          ? preferredWorkflowId
                          : allRepositoriesValue
                      }
                      onChange={(value) =>
                        setPreferredWorkflowId(
                          value === allRepositoriesValue ? '' : value,
                        )
                      }
                      options={[
                        {
                          value: allRepositoriesValue,
                          label: t('Choose when starting'),
                        },
                        ...runCandidates.map((wf) => ({
                          value: wf.id,
                          label: wf.name,
                        })),
                      ]}
                    />
                  )}
                  <label className="ws-automation-mr-state">
                    <span>{t('Status')}</span>
                    <Select
                      value={mrState}
                      onValueChange={(value) =>
                        applyFilters({ state: String(value) })
                      }
                      disabled={!selectedRepoId}
                    >
                      <SelectTrigger>
                        <span>{stateName(mrState)}</span>
                      </SelectTrigger>
                      <SelectContent className="ws-select-popup">
                        {['opened', 'merged', 'closed', 'all'].map((value) => (
                          <SelectItem key={value} value={value}>
                            {stateName(value)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <button
                    type="button"
                    className="ws-automation-button ws-automation-sync-button"
                    onClick={() => void syncRepo(selectedRepoId)}
                    disabled={Boolean(syncingRepoId) || !selectedRepoId}
                    title={t(
                      'Fetch new updates from Codebase. Known merge requests are not re-imported.',
                    )}
                  >
                    <RefreshCw
                      aria-hidden="true"
                      className={
                        syncingRepoId === selectedRepoId
                          ? 'is-spinning'
                          : undefined
                      }
                    />
                    {t(syncingRepoId === selectedRepoId ? 'Syncing…' : 'Sync')}
                  </button>
                </div>

                {lastStartedRun && lastStartedRun.repoId === selectedRepoId && (
                  <output className="ws-automation-started-notice">
                    {lastStartedRun.status === 'failed' ? (
                      <AlertCircle aria-hidden="true" />
                    ) : (
                      <CheckCircle2 aria-hidden="true" />
                    )}
                    <span>
                      {t(
                        lastStartedRun.status === 'failed'
                          ? 'Review could not start.'
                          : 'Review submitted.',
                      )}{' '}
                      · !{lastStartedRun.mrIid}
                    </span>
                    <button
                      type="button"
                      className="ws-automation-text-action"
                      onClick={() => {
                        const wf = workflows.find(
                          (item) => item.id === lastStartedRun.workflowId,
                        );
                        if (wf) showWorkflowRuns(wf, lastStartedRun);
                      }}
                    >
                      {t('View run')}
                    </button>
                  </output>
                )}
                {selectedRepo && (
                  <div className="ws-automation-sync-status">
                    <span>
                      {selectedRepo.lastSyncedAt
                        ? `${t('Last synced')} ${date(selectedRepo.lastSyncedAt)}`
                        : t('Not synced yet')}
                    </span>
                    {selectedRepo.lastSyncedAt && (
                      <span>
                        {selectedRepo.openCount} {t('open')} ·{' '}
                        {selectedRepo.totalCount} {t('total')}
                      </span>
                    )}
                    {selectedRepo.lastError && (
                      <span className="is-error">
                        <AlertCircle aria-hidden="true" />
                        {selectedRepo.lastError}
                      </span>
                    )}
                  </div>
                )}

                {reposError && (
                  <p className="ws-automation-error" role="alert">
                    <AlertCircle aria-hidden="true" />
                    {reposError}
                  </p>
                )}

                {selectedRepo &&
                  !workflowsLoading &&
                  runCandidates.length === 0 && (
                    <p className="ws-automation-hint">
                      <Workflow aria-hidden="true" />
                      {t(
                        'No enabled workflow reviews this repository. Create one to start reviews from this list.',
                      )}
                      <button
                        type="button"
                        className="ws-automation-text-action"
                        onClick={() =>
                          openWorkflowDialog(undefined, selectedRepoId)
                        }
                      >
                        {t('New workflow')}
                      </button>
                    </p>
                  )}

                {mrError && (
                  <p className="ws-automation-error" role="alert">
                    <AlertCircle aria-hidden="true" />
                    {mrError}
                  </p>
                )}

                {fetching ? (
                  <output
                    className="ws-automation-skeleton"
                    aria-label={t('Loading merge requests')}
                  >
                    <div />
                    <div />
                    <div />
                  </output>
                ) : result?.items.length ? (
                  <div className="ws-automation-mr-list">
                    {result.items.map((mr) => (
                      <div key={mr.id} className="ws-automation-mr-row">
                        <GitBranch aria-hidden="true" />
                        <div className="ws-automation-mr-copy">
                          <button onClick={() => setSelectedMR(mr)}>
                            {mr.draft && (
                              <span className="ws-automation-state">
                                {t('Draft')}
                              </span>
                            )}
                            !{mr.iid} · {mr.title}
                          </button>
                          <p>
                            {mr.references.full ||
                              `${t('Project')} ${mr.project_id}`}{' '}
                            · {mr.source_branch} → {mr.target_branch}
                          </p>
                          <small>
                            {mr.author.name || mr.author.username} ·{' '}
                            {date(mr.updated_at)}
                          </small>
                        </div>
                        <span className={`ws-automation-state is-${mr.state}`}>
                          {stateName(mr.state)}
                        </span>
                        <div className="ws-automation-mr-actions">
                          <button
                            type="button"
                            className="ws-automation-button is-compact"
                            onClick={() => requestRun(mr)}
                            disabled={
                              submittingRun !== null ||
                              runCandidates.length === 0
                            }
                            title={
                              runCandidates.length === 0
                                ? t(
                                    'Create an enabled workflow for this repository first.',
                                  )
                                : t('Run review')
                            }
                          >
                            {submittingRun === mr.iid ? (
                              <Loader2
                                aria-hidden="true"
                                className="is-spinning"
                              />
                            ) : (
                              <Play aria-hidden="true" />
                            )}
                            {t('Run review')}
                          </button>
                          {mr.web_url && (
                            <a
                              href={mr.web_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={t('Open in Codebase')}
                            >
                              <ExternalLink aria-hidden="true" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  !mrError &&
                  selectedRepo && (
                    <div className="ws-automation-empty is-small">
                      <GitBranch aria-hidden="true" />
                      <h2>{t('No matching merge requests')}</h2>
                      <p>
                        {selectedRepo.lastSyncedAt
                          ? t(
                              'No merge requests match the current filters. Sync to check for updates.',
                            )
                          : t(
                              'Sync this repository to import its merge requests.',
                            )}
                      </p>
                    </div>
                  )
                )}

                {!fetching && result && (
                  <div className="ws-automation-pagination">
                    <span>
                      {t('Page')} {result.page} · {result.total}{' '}
                      {t('merge requests')}
                    </span>
                    <div className="ws-automation-actions">
                      <button
                        className="ws-automation-button"
                        disabled={result.page <= 1}
                        onClick={() =>
                          void loadMRs(selectedRepoId, {
                            state: mrState,
                            search: search.trim(),
                            page: result.page - 1,
                          })
                        }
                      >
                        {t('Previous')}
                      </button>
                      <button
                        className="ws-automation-button"
                        disabled={!result.nextPage}
                        onClick={() =>
                          void loadMRs(selectedRepoId, {
                            state: mrState,
                            search: search.trim(),
                            page: result.nextPage || result.page + 1,
                          })
                        }
                      >
                        {t('Next')}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </TabsContent>

        {/* Workflows are the daily entry point; connection setup is separate. */}
        <TabsContent value="flows" hidden={tab !== 'flows'}>
          {workflows.length > 0 && (
            <div className="ws-automation-filterbar">
              <label className="ws-automation-filter ws-automation-filter-search">
                <span>{t('Search workflows')}</span>
                <search className="ws-automation-search-input">
                  <Search aria-hidden="true" />
                  <input
                    type="search"
                    maxLength={200}
                    value={flowSearch}
                    onChange={(event) => setFlowSearch(event.target.value)}
                    placeholder={t('Workflow, repository, or agent')}
                    aria-label={t('Search workflows')}
                  />
                </search>
              </label>
              <AutomationFilter
                label={t('Status')}
                value={flowState}
                onChange={setFlowState}
                options={[
                  { value: 'all', label: t('All workflows') },
                  { value: 'enabled', label: t('Enabled') },
                  { value: 'disabled', label: t('Paused') },
                ]}
              />
              <span className="ws-automation-filter-count">
                {t('{count} workflows', { count: visibleWorkflows.length })}
              </span>
            </div>
          )}
          {workflowsError && (
            <p className="ws-automation-error" role="alert">
              <AlertCircle aria-hidden="true" />
              {workflowsError}
              <button
                type="button"
                className="ws-automation-text-action"
                onClick={() => void loadWorkflows()}
              >
                {t('Retry')}
              </button>
            </p>
          )}
          {loading || workflowsLoading ? (
            <output
              className="ws-automation-skeleton"
              aria-label={t('Loading…')}
            >
              <div />
              <div />
            </output>
          ) : workflows.length === 0 && !workflowsError ? (
            <div className="ws-automation-empty">
              <Workflow aria-hidden="true" />
              <h2>{t('No review workflows')}</h2>
              <p>
                {t(
                  connection
                    ? 'Create a workflow to bind a repository and reviewer agent.'
                    : 'Connect Codebase before creating a workflow.',
                )}
              </p>
              <button
                type="button"
                className="ws-primary-button"
                onClick={() =>
                  connection ? openWorkflowDialog() : setTab('codebase')
                }
              >
                <Plus aria-hidden="true" />
                {t(connection ? 'New workflow' : 'Connect Codebase')}
              </button>
            </div>
          ) : visibleWorkflows.length === 0 && workflows.length > 0 ? (
            <div className="ws-automation-empty is-small">
              <Search aria-hidden="true" />
              <h2>{t('No matching workflows')}</h2>
              <button
                type="button"
                className="ws-automation-text-action"
                onClick={() => {
                  setFlowSearch('');
                  setFlowState('all');
                }}
              >
                {t('Clear filters')}
              </button>
            </div>
          ) : (
            <div className="ws-automation-workflow-list">
              {visibleWorkflows.map((wf) => {
                const agent = agents.find((a) => a.id === wf.agentId);
                return (
                  <div
                    key={wf.id}
                    className={`ws-automation-workflow-row${wf.enabled ? '' : ' is-paused'}`}
                  >
                    <div className="ws-automation-workflow-main">
                      <div className="ws-automation-workflow-title">
                        <button
                          type="button"
                          className="ws-automation-title-button"
                          onClick={() => openWorkflowDialog(wf)}
                          disabled={togglingWorkflow === wf.id}
                        >
                          {wf.name}
                        </button>
                        <span
                          className={`ws-automation-badge${wf.enabled ? ' is-on' : ' is-muted'}`}
                        >
                          {t(wf.enabled ? 'Enabled' : 'Paused')}
                        </span>
                      </div>
                      <p className="ws-automation-workflow-repo">
                        <GitBranch aria-hidden="true" />
                        {wf.repoPath}
                      </p>
                      <div className="ws-automation-workflow-meta">
                        <span>
                          <User aria-hidden="true" />
                          {agent?.name || t('Not assigned')}
                        </span>
                        <span>
                          {wf.model || agent?.model || t('Runtime default')}
                          {wf.reasoningEffort ? ` · ${wf.reasoningEffort}` : ''}
                        </span>
                        <span>
                          {t(
                            wf.triggerWebhook
                              ? 'Webhook + manual'
                              : 'Manual only',
                          )}
                        </span>
                        <span>
                          {t(
                            wf.reportEnabled
                              ? 'MR writeback on'
                              : 'Steer results only',
                          )}
                        </span>
                        {!!wf.skillIds?.length && (
                          <span>
                            {t('{count} Skills', { count: wf.skillIds.length })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ws-automation-workflow-actions">
                      <Switch
                        checked={wf.enabled}
                        disabled={!!togglingWorkflow}
                        onCheckedChange={(enabled) =>
                          void toggleWorkflow(wf, enabled)
                        }
                        aria-label={t('Enable workflow {name}', {
                          name: wf.name,
                        })}
                      />
                      <button
                        type="button"
                        className="ws-automation-button is-compact"
                        onClick={() => {
                          setTab('mrs');
                          selectRepo(wf.repoId);
                          setPreferredWorkflowId(wf.id);
                        }}
                      >
                        <Play aria-hidden="true" />
                        {t('Run review')}
                      </button>
                      <button
                        type="button"
                        className="ws-automation-icon-action"
                        onClick={() => showWorkflowRuns(wf)}
                        title={t('Run records')}
                        aria-label={t('Run records')}
                      >
                        <History aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="ws-automation-icon-action"
                        onClick={() => openWorkflowDialog(wf)}
                        disabled={togglingWorkflow === wf.id}
                        title={t('Edit')}
                        aria-label={t('Edit')}
                      >
                        <Pencil aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="ws-automation-icon-action is-danger"
                        onClick={() => setDeleteTarget(wf)}
                        disabled={togglingWorkflow === wf.id}
                        title={t('Delete workflow')}
                        aria-label={t('Delete workflow')}
                      >
                        <Trash2 aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Run records: filterable by repository */}
        <TabsContent value="runs" hidden={tab !== 'runs'}>
          <div className="ws-automation-filterbar">
            <AutomationFilter
              label={t('Repository')}
              value={runsRepoFilter || allRepositoriesValue}
              options={[
                { value: allRepositoriesValue, label: t('All repositories') },
                ...repositories.map((repo) => ({
                  value: repo.repoId,
                  label: repo.repoPath,
                })),
              ]}
              onChange={(value) => {
                setRunsRepoFilter(value === allRepositoriesValue ? '' : value);
                setRunsWorkflowFilter('');
                setRunsLimit(100);
              }}
            />
            <AutomationFilter
              label={t('Workflow')}
              value={runsWorkflowFilter || allRepositoriesValue}
              options={[
                { value: allRepositoriesValue, label: t('All workflows') },
                ...workflows
                  .filter(
                    (wf) => !runsRepoFilter || wf.repoId === runsRepoFilter,
                  )
                  .map((wf) => ({ value: wf.id, label: wf.name })),
              ]}
              onChange={(value) => {
                setRunsWorkflowFilter(
                  value === allRepositoriesValue ? '' : value,
                );
                setRunsLimit(100);
              }}
            />
            <AutomationFilter
              label={t('Run status')}
              value={runsResultFilter}
              onChange={setRunsResultFilter}
              options={[
                { value: 'all', label: t('All results') },
                { value: 'active', label: t('In progress') },
                { value: 'succeeded', label: t('Review succeeded') },
                { value: 'failed', label: t('Review failed') },
                { value: 'report-failed', label: t('Report failed') },
              ]}
            />
            <button
              type="button"
              className="ws-automation-button"
              onClick={() => void loadRuns(true)}
              disabled={runsLoading}
            >
              <RefreshCw
                aria-hidden="true"
                className={runsLoading ? 'is-spinning' : undefined}
              />
              {t(runsLoading ? 'Refreshing…' : 'Refresh')}
            </button>
          </div>
          {runs.length > 0 && (
            <div className="ws-automation-list-caption">
              <span>
                {t('{matched} of {count} loaded runs', {
                  matched: visibleRuns.length,
                  count: runs.length,
                })}
              </span>
              <span>
                {t('Newest first')}
                {runs.some(isLiveRun)
                  ? ` · ${t('Live updates while running')}`
                  : ''}
              </span>
            </div>
          )}
          {runsError && (
            <p className="ws-automation-error" role="alert">
              <AlertCircle aria-hidden="true" />
              {runsError}
            </p>
          )}
          {runsLoading && runs.length === 0 ? (
            <output
              className="ws-automation-skeleton"
              aria-label={t('Loading…')}
            >
              <div />
              <div />
              <div />
            </output>
          ) : runs.length === 0 && !runsError ? (
            <div className="ws-automation-empty">
              <History aria-hidden="true" />
              <h2>{t('No review runs')}</h2>
              <p>
                {t(
                  'Run a review from the Merge requests tab to create a record.',
                )}
              </p>
            </div>
          ) : visibleRuns.length === 0 && runs.length > 0 ? (
            <div className="ws-automation-empty is-small">
              <History aria-hidden="true" />
              <h2>{t('No matching runs')}</h2>
              <button
                type="button"
                className="ws-automation-text-action"
                onClick={() => setRunsResultFilter('all')}
              >
                {t('Clear status filter')}
              </button>
            </div>
          ) : (
            <div className="ws-automation-run-table">
              {visibleRuns.map((run) => {
                const wf = workflows.find((w) => w.id === run.workflowId);
                return (
                  <div key={run.id} className="ws-automation-run-row">
                    <div className="ws-automation-run-main">
                      <div className="ws-automation-run-title">
                        <span
                          className={`ws-automation-run-status is-${run.status}`}
                        >
                          {run.status === 'running' && (
                            <Loader2
                              aria-hidden="true"
                              className="is-spinning"
                            />
                          )}
                          {run.status === 'succeeded' && (
                            <CheckCircle2 aria-hidden="true" />
                          )}
                          {run.status === 'failed' && (
                            <XCircle aria-hidden="true" />
                          )}
                          {(run.status === 'pending' ||
                            run.status === 'skipped') && (
                            <Clock aria-hidden="true" />
                          )}
                          {runStatusLabel(run.status)}
                        </span>
                        <button
                          type="button"
                          className="ws-automation-title-button"
                          onClick={() => {
                            setDetailCopied(false);
                            setDetailRun(run);
                          }}
                        >
                          !{run.mrIid} · {run.mrTitle || t('Merge request')}
                        </button>
                        {run.status === 'succeeded' && run.reportStatus && (
                          <span
                            className={`ws-automation-run-report is-${run.reportStatus}`}
                            title={run.reportError || undefined}
                          >
                            {run.reportStatus === 'sent'
                              ? t('Reported to merge request')
                              : run.reportStatus === 'sending'
                                ? t('Reporting to merge request…')
                                : run.reportStatus === 'failed'
                                  ? t('Report failed')
                                  : t('Report skipped')}
                          </span>
                        )}
                      </div>
                      <p>
                        {wf ? wf.name : t('Workflow')} · {run.repoPath} ·{' '}
                        {t(run.trigger === 'webhook' ? 'Webhook' : 'Manual')}
                      </p>
                      <small>
                        {date(run.createdAt)} · {t('Duration')}:{' '}
                        {runDuration(run)}
                        {run.model ? ` · ${run.model}` : ''}
                      </small>
                      {run.error && (
                        <p
                          className="ws-automation-run-error-preview"
                          title={cleanRunLog(run.error).slice(0, 400)}
                        >
                          {runLogPreview(run.error)}
                        </p>
                      )}
                    </div>
                    <div className="ws-automation-run-actions">
                      <button
                        type="button"
                        className="ws-automation-button"
                        onClick={() => {
                          setDetailCopied(false);
                          setDetailRun(run);
                        }}
                      >
                        <FileText aria-hidden="true" />
                        {t('Details')}
                      </button>
                      {run.conversationId && (
                        <a
                          className="ws-automation-button"
                          href={conversationURL(run.conversationId)}
                        >
                          {t('Open conversation')}
                          <ExternalLink aria-hidden="true" />
                        </a>
                      )}
                      {run.mrUrl && (
                        <a
                          href={run.mrUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={t('Open in Codebase')}
                        >
                          <ExternalLink aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {runs.length === runsLimit && runsLimit < 500 && (
            <div className="ws-automation-load-more">
              <button
                type="button"
                className="ws-automation-button"
                disabled={runsLoading}
                onClick={() =>
                  setRunsLimit((limit) => Math.min(limit + 100, 500))
                }
              >
                {t('Load more records')}
              </button>
            </div>
          )}
          {runs.length >= 500 && (
            <p className="ws-automation-list-caption">
              {t(
                'Showing the latest 500 runs. Select a repository or workflow to narrow the history.',
              )}
            </p>
          )}
        </TabsContent>
      </Tabs>

      {/* Connection dialog */}
      <Dialog
        open={connectionOpen}
        onOpenChange={(open) => {
          if (saving) return;
          setConnectionOpen(open);
          if (!open) setAppSecret('');
        }}
      >
        <DialogContent className="ws-workspace-dialog ws-codebase-dialog">
          <DialogTitle>
            {t(connection ? 'Edit Codebase connection' : 'Connect Codebase')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Use a Codebase App to connect. The server verifies the credential and stores it encrypted.',
            )}
          </DialogDescription>
          <form
            onSubmit={(event) => void saveConnection(event)}
            className="ws-codebase-form"
          >
            <label>
              {t('Codebase API address')}
              <input
                type="url"
                required
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                disabled={saving}
              />
              <small>
                {t(
                  'Codebase OpenAPI endpoint. Usually the default address works.',
                )}
              </small>
            </label>
            <label>
              {t('App ID')}
              <input
                type="text"
                required
                value={appId}
                onChange={(event) => setAppId(event.target.value)}
                disabled={saving}
                autoComplete="off"
              />
              <small>
                {t(
                  'Create a Codebase App and install it to target repositories to get the App ID.',
                )}
              </small>
            </label>
            <label>
              {t('App Secret')}
              <input
                type="password"
                required={!connection?.appSecretConfigured}
                value={appSecret}
                onChange={(event) => setAppSecret(event.target.value)}
                placeholder={
                  connection?.appSecretConfigured ? '************' : ''
                }
                autoComplete="new-password"
                disabled={saving}
              />
              <small>
                {t(
                  connection?.appSecretConfigured
                    ? 'Leave blank to keep the saved App Secret. Changing the address or App ID requires a new secret.'
                    : 'App Secret is paired with the App ID. Grant repository and merge request read permissions.',
                )}
              </small>
            </label>
            {formError && (
              <p className="ws-automation-error" role="alert">
                {formError}
              </p>
            )}
            <div className="ws-form-actions">
              <button
                type="button"
                onClick={() => {
                  setConnectionOpen(false);
                  setAppSecret('');
                }}
                disabled={saving}
              >
                {t('Cancel')}
              </button>
              <button type="submit" disabled={saving}>
                {t(saving ? 'Verifying…' : 'Verify and save')}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Disconnect dialog */}
      <Dialog
        open={disconnectOpen}
        onOpenChange={(open) => {
          if (!disconnecting) setDisconnectOpen(open);
        }}
      >
        <DialogContent className="ws-workspace-dialog">
          <DialogTitle>{t('Disconnect Codebase?')}</DialogTitle>
          <DialogDescription>
            {t(
              'Remove the saved connection and App credential from this workspace. The Codebase App itself is not deleted.',
            )}
          </DialogDescription>
          {connectionError && (
            <p className="ws-automation-error" role="alert">
              {t(connectionError)}
            </p>
          )}
          <div className="ws-form-actions">
            <button
              onClick={() => setDisconnectOpen(false)}
              disabled={disconnecting}
            >
              {t('Cancel')}
            </button>
            <button onClick={() => void disconnect()} disabled={disconnecting}>
              {t(disconnecting ? 'Disconnecting…' : 'Disconnect')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Workflow create/edit dialog */}
      <Dialog
        open={workflowOpen}
        onOpenChange={(open) => {
          if (!wfSaving) setWorkflowOpen(open);
        }}
      >
        <DialogContent className="ws-workspace-dialog ws-codebase-dialog ws-codebase-dialog-wide">
          <DialogTitle>
            {t(editingWorkflow ? 'Edit workflow' : 'New workflow')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Pick a managed repository and a reviewer agent. Repositories are added to the workspace once and shared by every workflow.',
            )}
          </DialogDescription>
          <form
            onSubmit={(event) => void saveWorkflow(event)}
            className="ws-codebase-form"
          >
            <label>
              {t('Workflow name')}
              <input
                type="text"
                required
                maxLength={120}
                value={wfName}
                onChange={(event) => setWfName(event.target.value)}
                disabled={wfSaving}
                placeholder={t('e.g. Frontend review')}
              />
            </label>
            <div className="ws-automation-repo-field">
              <label>
                {t('Repository')}
                <Select
                  value={wfRepo?.id || ''}
                  onValueChange={(value) => {
                    const repo = repositories.find(
                      (item) => item.repoId === String(value),
                    );
                    setWfRepo(
                      repo
                        ? {
                            id: repo.repoId,
                            path: repo.repoPath,
                            name: repo.repoName,
                          }
                        : null,
                    );
                    setWfError('');
                  }}
                  disabled={wfSaving || repositories.length === 0}
                >
                  <SelectTrigger>
                    <span>{wfRepo?.path || t('Select a repository')}</span>
                  </SelectTrigger>
                  <SelectContent className="ws-select-popup">
                    {repositories.map((repo) => (
                      <SelectItem key={repo.repoId} value={repo.repoId}>
                        {repo.repoPath}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {wfNewRepoOpen ? (
                <div className="ws-automation-repo-input">
                  <input
                    maxLength={300}
                    value={wfNewRepoPath}
                    onChange={(event) => {
                      setWfNewRepoPath(event.target.value);
                      setWfError('');
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void addRepository(wfNewRepoPath, {
                          selectForWorkflow: true,
                        });
                      }
                    }}
                    placeholder={t('e.g. org/repository')}
                    disabled={!connection || wfAddingRepo || wfSaving}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      void addRepository(wfNewRepoPath, {
                        selectForWorkflow: true,
                      })
                    }
                    disabled={
                      !connection ||
                      wfAddingRepo ||
                      !wfNewRepoPath.trim() ||
                      wfSaving
                    }
                  >
                    {t(wfAddingRepo ? 'Adding…' : 'Add')}
                  </button>
                  {repositories.length > 0 && (
                    <button
                      type="button"
                      className="is-quiet"
                      onClick={() => {
                        setWfNewRepoOpen(false);
                        setWfNewRepoPath('');
                      }}
                      disabled={wfAddingRepo}
                    >
                      {t('Cancel')}
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="ws-automation-repo-add-link"
                  onClick={() => setWfNewRepoOpen(true)}
                  disabled={!connection || wfSaving}
                >
                  <Plus aria-hidden="true" />
                  {t('Add another repository')}
                </button>
              )}
              {wfError && (
                <small className="ws-automation-error">{wfError}</small>
              )}
            </div>
            <label>
              {t('Reviewer agent')}
              <Select
                value={wfAgentId}
                onValueChange={(value) => {
                  setWfAgentId(String(value));
                  // Model and effort belong to the previous Agent's Runtime.
                  setWfModel('');
                  setWfEffort('');
                }}
                disabled={
                  wfSaving || agents.filter((a) => !a.shared).length === 0
                }
              >
                <SelectTrigger>
                  <span>
                    {agents.find((a) => a.id === wfAgentId)?.name ||
                      t('Select an agent')}
                  </span>
                </SelectTrigger>
                <SelectContent className="ws-select-popup">
                  {agents
                    .filter((a) => !a.shared)
                    .map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {agents.filter((a) => !a.shared).length === 0 && (
                <small className="ws-automation-error">
                  {t('Create an agent in this workspace first.')}
                </small>
              )}
            </label>
            <div className="ws-workflow-run-settings">
              <label>
                {t('Model')}
                <Select
                  value={wfModel || 'Runtime default'}
                  onValueChange={(value) => {
                    const next = String(value);
                    setWfModel(next === 'Runtime default' ? '' : next);
                    setWfEffort('');
                  }}
                  disabled={wfSaving || wfModelOptions.length === 0}
                >
                  <SelectTrigger>
                    <span>{wfModel || t('Runtime default')}</span>
                  </SelectTrigger>
                  <SelectContent className="ws-select-popup">
                    <SelectItem value="Runtime default">
                      {t('Runtime default')}
                    </SelectItem>
                    {wfModelOptions.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {wfEffortOptions.length > 0 && (
                <label>
                  {t('Effort')}
                  <Select
                    value={wfEffort || 'default'}
                    onValueChange={(value) => {
                      const next = String(value);
                      setWfEffort(next === 'default' ? '' : next);
                    }}
                    disabled={wfSaving}
                  >
                    <SelectTrigger>
                      <span>{wfEffort || t('Default')}</span>
                    </SelectTrigger>
                    <SelectContent className="ws-select-popup">
                      <SelectItem value="default">{t('Default')}</SelectItem>
                      {wfEffortOptions.map((effort) => (
                        <SelectItem key={effort} value={effort}>
                          {effort}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
              )}
            </div>
            <small>
              {t('Runs on the Runtime that owns the reviewer Agent.')}
            </small>
            <label>
              {t('Review instruction')}
              <textarea
                ref={instructionRef}
                className="ws-workflow-instruction"
                rows={6}
                value={wfInstruction}
                onChange={(event) => setWfInstruction(event.target.value)}
                disabled={wfSaving}
                placeholder={t(
                  'Optional guidance for the reviewer, e.g. focus on error handling and tests.',
                )}
              />
              <small>
                {t(
                  'Describe the review focus, checklist, and output format. Long instructions are supported.',
                )}
              </small>
            </label>
            <AgentSkillPicker
              skills={skills}
              initialSelectedIDs={[]}
              selectedIDs={wfSkillIds}
              onSelectionChange={setWfSkillIds}
              disabled={wfSaving}
              maxSelected={20}
              hint={t(
                'Selected Skills are added to this review only, alongside the Agent instructions.',
              )}
            />
            <fieldset className="ws-workflow-options">
              <legend>{t('Execution and output')}</legend>
              <div className="ws-codebase-webhook-toggle">
                <label htmlFor="wf-trigger-webhook">
                  {t('Trigger review from webhook')}
                </label>
                <Switch
                  id="wf-trigger-webhook"
                  checked={wfTriggerWebhook}
                  disabled={wfSaving}
                  onCheckedChange={setWfTriggerWebhook}
                  aria-describedby="wf-trigger-hint"
                />
              </div>
              <small id="wf-trigger-hint">
                {t(
                  'Requires a configured Codebase webhook. Turn off for manual reviews only.',
                )}
              </small>
              <div className="ws-codebase-webhook-toggle">
                <label htmlFor="wf-report-enabled">
                  {t('Write back to MR')}
                </label>
                <Switch
                  id="wf-report-enabled"
                  checked={wfReportEnabled}
                  disabled={wfSaving}
                  onCheckedChange={setWfReportEnabled}
                  aria-describedby="wf-report-hint"
                />
              </div>
              <small id="wf-report-hint">
                {t(
                  'When disabled, results stay in Steer and no MR comment is posted or updated.',
                )}
              </small>
              <div className="ws-codebase-webhook-toggle">
                <label htmlFor="wf-enabled">{t('Workflow enabled')}</label>
                <Switch
                  id="wf-enabled"
                  checked={wfEnabled}
                  disabled={wfSaving}
                  onCheckedChange={setWfEnabled}
                />
              </div>
              <small>
                {t(
                  'Paused workflows cannot start new reviews. Running reviews continue.',
                )}
              </small>
            </fieldset>
            <div className="ws-form-actions">
              <button
                type="button"
                onClick={() => setWorkflowOpen(false)}
                disabled={wfSaving}
              >
                {t('Cancel')}
              </button>
              <button type="submit" disabled={wfSaving || !wfRepo}>
                {t(
                  wfSaving
                    ? 'Saving…'
                    : editingWorkflow
                      ? 'Save'
                      : 'Create workflow',
                )}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete workflow dialog */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!deleting && !open) setDeleteTarget(null);
        }}
      >
        <DialogContent className="ws-workspace-dialog">
          <DialogTitle>{t('Delete workflow?')}</DialogTitle>
          <DialogDescription>
            {t(
              'Remove this workflow and its run records. The repository and its synced merge requests are kept.',
            )}
          </DialogDescription>
          <div className="ws-form-actions">
            <button onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {t('Cancel')}
            </button>
            <button onClick={() => void deleteWorkflow()} disabled={deleting}>
              {t(deleting ? 'Deleting…' : 'Delete')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Choose which workflow should review an MR */}
      <Dialog
        open={Boolean(runTarget)}
        onOpenChange={(open) => {
          if (!open && submittingRun === null) setRunTarget(null);
        }}
      >
        <DialogContent className="ws-workspace-dialog ws-codebase-dialog">
          <DialogTitle>{t('Choose a reviewer')}</DialogTitle>
          <DialogDescription>
            {t(
              'Several workflows review this repository. Choose which one should review this merge request.',
            )}
          </DialogDescription>
          <div className="ws-automation-runner-list">
            {runCandidates.map((wf) => {
              const agent = agents.find((item) => item.id === wf.agentId);
              return (
                <button
                  key={wf.id}
                  type="button"
                  className="ws-automation-runner"
                  onClick={() => {
                    if (runTarget) void runReview(runTarget, wf);
                  }}
                  disabled={submittingRun !== null}
                >
                  <Workflow aria-hidden="true" />
                  <span>
                    <strong>{wf.name}</strong>
                    <small>
                      {agent ? agent.name : wf.agentId || t('Not assigned')}
                    </small>
                  </span>
                  {submittingRun !== null ? (
                    <Loader2 aria-hidden="true" className="is-spinning" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="ws-form-actions">
            <button
              type="button"
              onClick={() => setRunTarget(null)}
              disabled={submittingRun !== null}
            >
              {t('Cancel')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* MR detail dialog: rendered from the synced record */}
      <Dialog
        open={Boolean(selectedMR)}
        onOpenChange={(open) => {
          if (!open) setSelectedMR(null);
        }}
      >
        <DialogContent className="ws-workspace-dialog ws-codebase-mr-dialog">
          {selectedMR ? (
            <>
              <header className="ws-codebase-mr-head">
                <div className="ws-codebase-mr-eyebrow">
                  <span className="ws-codebase-mr-ref">!{selectedMR.iid}</span>
                  <span
                    className={`ws-automation-state is-${selectedMR.state}`}
                  >
                    {stateName(selectedMR.state)}
                  </span>
                  {selectedMR.draft && (
                    <span className="ws-automation-state">{t('Draft')}</span>
                  )}
                </div>
                <DialogTitle
                  className="ws-codebase-mr-title"
                  title={selectedMR.title}
                >
                  {selectedMR.title}
                </DialogTitle>
                <DialogDescription className="ws-codebase-mr-branches">
                  <GitBranch aria-hidden="true" />
                  <code>{selectedMR.source_branch}</code>
                  <ArrowRight aria-hidden="true" />
                  <code>{selectedMR.target_branch}</code>
                </DialogDescription>
                <div className="ws-codebase-mr-meta">
                  <span className="ws-codebase-mr-meta-item">
                    <User aria-hidden="true" />
                    {selectedMR.author.name || selectedMR.author.username}
                  </span>
                  <span className="ws-codebase-mr-meta-item">
                    <Clock aria-hidden="true" />
                    {date(selectedMR.updated_at)}
                  </span>
                  <span className="ws-codebase-mr-meta-item">
                    <FolderGit2 aria-hidden="true" />
                    {selectedMR.references.full ||
                      `${t('Project')} ${selectedMR.project_id}`}
                  </span>
                  {selectedMR.labels.length > 0 && (
                    <span className="ws-codebase-mr-labels">
                      {selectedMR.labels.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </span>
                  )}
                </div>
              </header>
              <div className="ws-codebase-mr-body">
                <div className="ws-codebase-description">
                  <ReactMarkdown>
                    {selectedMR.description || t('No MR description.')}
                  </ReactMarkdown>
                </div>
              </div>
              <footer className="ws-codebase-mr-footer">
                <button
                  type="button"
                  className="ws-automation-button"
                  onClick={() => {
                    const mr = selectedMR;
                    setSelectedMR(null);
                    requestRun(mr);
                  }}
                  disabled={
                    submittingRun !== null || runCandidates.length === 0
                  }
                  title={
                    runCandidates.length === 0
                      ? t(
                          'Create an enabled workflow for this repository first.',
                        )
                      : undefined
                  }
                >
                  <Play aria-hidden="true" />
                  {t('Run review')}
                </button>
                {selectedMR.web_url && (
                  <a
                    className="ws-codebase-open-link"
                    href={selectedMR.web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink aria-hidden="true" />
                    {t('Open in Codebase')}
                  </a>
                )}
              </footer>
            </>
          ) : (
            <>
              <DialogTitle>{t('Merge request')}</DialogTitle>
              <DialogDescription />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Run detail dialog: keeps long failure logs out of the list */}
      <Dialog
        open={Boolean(detailRun)}
        onOpenChange={(open) => {
          if (!open) setDetailRun(null);
        }}
      >
        <DialogContent
          ref={detailDialogRef}
          tabIndex={-1}
          initialFocus={detailDialogRef}
          className="ws-workspace-dialog ws-run-detail-dialog"
        >
          {detailRun ? (
            <>
              <header className="ws-run-detail-head">
                <div className="ws-run-detail-eyebrow">
                  <span
                    className={`ws-automation-run-status is-${detailRun.status}`}
                  >
                    {runStatusIcon(detailRun.status)}
                    {runStatusLabel(detailRun.status)}
                  </span>
                  <span className="ws-codebase-mr-ref">!{detailRun.mrIid}</span>
                  {detailRun.reportStatus && (
                    <span
                      className={`ws-automation-run-report is-${detailRun.reportStatus}`}
                      title={detailRun.reportError || undefined}
                    >
                      {detailRun.reportStatus === 'sent'
                        ? t('Reported to merge request')
                        : detailRun.reportStatus === 'sending'
                          ? t('Reporting to merge request…')
                          : detailRun.reportStatus === 'failed'
                            ? t('Report failed')
                            : t('Report skipped')}
                    </span>
                  )}
                </div>
                <DialogTitle
                  className="ws-run-detail-title"
                  title={detailRun.mrTitle || undefined}
                >
                  {detailRun.mrTitle || t('Merge request')}
                </DialogTitle>
                <DialogDescription className="ws-run-detail-subtitle">
                  {detailWorkflow ? detailWorkflow.name : t('Workflow')} ·{' '}
                  {detailRun.repoPath}
                </DialogDescription>
              </header>
              <div className="ws-run-detail-body">
                <dl className="ws-run-detail-facts">
                  <div>
                    <dt>{t('Duration')}</dt>
                    <dd>{runDuration(detailRun)}</dd>
                  </div>
                  <div>
                    <dt>{t('Trigger')}</dt>
                    <dd>
                      {t(
                        detailRun.trigger === 'webhook' ? 'Webhook' : 'Manual',
                      )}
                    </dd>
                  </div>
                  {detailRun.model && (
                    <div>
                      <dt>{t('Model')}</dt>
                      <dd>{detailRun.model}</dd>
                    </div>
                  )}
                  {detailRun.reasoningEffort && (
                    <div>
                      <dt>{t('Reasoning effort')}</dt>
                      <dd>{detailRun.reasoningEffort}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{t('Started')}</dt>
                    <dd>{date(detailRun.startedAt || detailRun.createdAt)}</dd>
                  </div>
                  {detailRun.finishedAt && (
                    <div>
                      <dt>{t('Finished')}</dt>
                      <dd>{date(detailRun.finishedAt)}</dd>
                    </div>
                  )}
                </dl>
                {detailLog && (
                  <section className="ws-run-detail-section">
                    <div className="ws-run-detail-section-head">
                      <h3>{t('Failure details')}</h3>
                      <button
                        type="button"
                        className="ws-run-detail-copy"
                        onClick={() => copyRunLog(detailLog)}
                      >
                        {detailCopied ? (
                          <Check aria-hidden="true" />
                        ) : (
                          <Copy aria-hidden="true" />
                        )}
                        {t(detailCopied ? 'Copied' : 'Copy log')}
                      </button>
                    </div>
                    <pre className="ws-run-detail-log">{detailLog}</pre>
                  </section>
                )}
                {detailRun.summary && (
                  <section className="ws-run-detail-section">
                    <div className="ws-run-detail-section-head">
                      <h3>{t('Run summary')}</h3>
                    </div>
                    <div className="ws-run-detail-summary">
                      <ReactMarkdown>{detailRun.summary}</ReactMarkdown>
                    </div>
                  </section>
                )}
                {!detailLog && !detailRun.summary && (
                  <p className="ws-run-detail-empty">
                    {t('No output was recorded for this run.')}
                  </p>
                )}
                {detailRun.reportError && (
                  <p className="ws-run-detail-note">
                    <AlertCircle aria-hidden="true" />
                    {detailRun.reportError}
                  </p>
                )}
              </div>
              {(detailRun.conversationId || detailRun.mrUrl) && (
                <footer className="ws-codebase-mr-footer">
                  {detailRun.conversationId && (
                    <a
                      className="ws-codebase-open-link"
                      href={conversationURL(detailRun.conversationId)}
                    >
                      {t('Open conversation')}
                      <ExternalLink aria-hidden="true" />
                    </a>
                  )}
                  {detailRun.mrUrl && (
                    <a
                      className="ws-codebase-open-link"
                      href={detailRun.mrUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('Open in Codebase')}
                      <ExternalLink aria-hidden="true" />
                    </a>
                  )}
                </footer>
              )}
            </>
          ) : (
            <>
              <DialogTitle>{t('Run details')}</DialogTitle>
              <DialogDescription />
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Add repository dialog */}
      <Dialog
        open={repoOpen}
        onOpenChange={(open) => {
          if (repoSaving) return;
          setRepoOpen(open);
          if (!open) setRepoFormError('');
        }}
      >
        <DialogContent className="ws-workspace-dialog ws-codebase-dialog">
          <DialogTitle>{t('Add repository')}</DialogTitle>
          <DialogDescription>
            {t(
              'Enter a Codebase repository path. It is verified against the saved connection before it is added.',
            )}
          </DialogDescription>
          <form
            className="ws-codebase-form"
            onSubmit={(event) => {
              event.preventDefault();
              void addRepository(repoPath);
            }}
          >
            <label>
              {t('Repository path')}
              <input
                maxLength={300}
                value={repoPath}
                onChange={(event) => {
                  setRepoPath(event.target.value);
                  setRepoFormError('');
                }}
                placeholder={t('e.g. org/repository')}
                disabled={repoSaving}
              />
              <small>
                {t('Use the namespace/project path shown in Codebase.')}
              </small>
            </label>
            {repoFormError && (
              <p className="ws-automation-error" role="alert">
                <AlertCircle aria-hidden="true" />
                {repoFormError}
              </p>
            )}
            <div className="ws-form-actions">
              <button
                type="button"
                onClick={() => setRepoOpen(false)}
                disabled={repoSaving}
              >
                {t('Cancel')}
              </button>
              <button type="submit" disabled={repoSaving || !repoPath.trim()}>
                {t(repoSaving ? 'Adding…' : 'Add repository')}
              </button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Remove repository dialog */}
      <Dialog
        open={Boolean(repoDeleteTarget)}
        onOpenChange={(open) => {
          if (!repoDeleting && !open) setRepoDeleteTarget(null);
        }}
      >
        <DialogContent className="ws-workspace-dialog">
          <DialogTitle>{t('Remove repository?')}</DialogTitle>
          <DialogDescription>
            {t(
              'This removes the repository and its synced merge requests from Steer. Workflows that review it must be deleted first.',
            )}
          </DialogDescription>
          {repoDeleteTarget && (
            <p className="ws-automation-repo-path">
              {repoDeleteTarget.repoPath}
            </p>
          )}
          {repoDeleteError && (
            <p className="ws-automation-error" role="alert">
              <AlertCircle aria-hidden="true" />
              {repoDeleteError}
            </p>
          )}
          <div className="ws-form-actions">
            <button
              onClick={() => setRepoDeleteTarget(null)}
              disabled={repoDeleting}
            >
              {t('Cancel')}
            </button>
            <button
              onClick={() => void deleteRepository()}
              disabled={repoDeleting}
            >
              {t(repoDeleting ? 'Removing…' : 'Remove')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
