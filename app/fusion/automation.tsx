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
  BarChart3,
  Check,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  Eye,
  ExternalLink,
  FileText,
  FolderGit2,
  GitBranch,
  History,
  Info,
  Loader2,
  LogOut,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  User,
  Share2,
  Workflow,
  X,
  XCircle,
} from 'lucide-react';
import { ReportMarkdown } from './report-markdown';
import { CodebaseWebhookSettings } from './codebase-webhook';
import { CodebaseCalibrationView } from './codebase-calibration';
import {
  LeaveSharedWorkflowDialog,
  SharedWorkflowInfoDialog,
  SharedWorkflowInvitations,
  sharedWorkflowIdFromKey,
  sharedWorkflowKey,
  toSharedRunRecord,
} from './workflow-sharing';
import { CollaborationAvatars } from './resource-sharing';
import { AgentSkillPicker } from './agent-skill-picker';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  type ResourceShare,
  type AuthUser,
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

type AutomationTab =
  | 'codebase'
  | 'repos'
  | 'mrs'
  | 'flows'
  | 'runs'
  | 'calibration';

const automationTabs = [
  { value: 'flows', label: 'Workflows', icon: Workflow },
  { value: 'mrs', label: 'Merge requests', icon: GitBranch },
  { value: 'runs', label: 'Run records', icon: History },
  { value: 'calibration', label: 'Calibration', icon: BarChart3 },
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
  user,
  shares,
  sharingError,
  onRefreshSharing,
  onShareWorkflow,
  onOpenSharedConversation,
  onNotice,
}: {
  scope: string;
  user: AuthUser;
  shares: ResourceShare[];
  sharingError?: string;
  onRefreshSharing: () => Promise<void>;
  onShareWorkflow: (workflow: CodebaseWorkflowRecord) => void;
  onOpenSharedConversation: (share: ResourceShare, id: string) => void;
  agents: AgentProfile[];
  runtimes?: WorkflowRuntime[];
  skills?: SkillRecord[];
  onRefreshRuntimes?: () => void;
  onNotice?: (message: string) => void;
}) {
  const { t, language } = useI18n();
  const [tab, setTab] = useState<AutomationTab>('flows');
  const [flowOwner, setFlowOwner] = useState<'all' | 'mine' | 'shared'>('all');
  const [mrPollWarning, setMRPollWarning] = useState('');
  const [infoShare, setInfoShare] = useState<ResourceShare | null>(null);
  const [leaveShare, setLeaveShare] = useState<ResourceShare | null>(null);
  const tabChosen = useRef(false);
  const incomingWorkflowShares = shares.filter(
    (share) => share.kind === 'workflow' && !share.owned,
  );
  const pendingWorkflowInvites = incomingWorkflowShares.filter(
    (share) => share.status === 'pending',
  );
  const acceptedSharedWorkflows = incomingWorkflowShares.filter(
    (share) => share.status === 'accepted',
  );
  const acceptedSharedKey = acceptedSharedWorkflows
    .map((share) => share.id)
    .join(',');
  const sharedRepoPaths = Array.from(
    new Set(
      acceptedSharedWorkflows
        .map((share) => share.projectSource || '')
        .filter(Boolean),
    ),
  );
  const incomingWorkflowAvailable = useRef(false);
  const acceptedSharedRef = useRef(acceptedSharedWorkflows);
  useEffect(() => {
    incomingWorkflowAvailable.current = incomingWorkflowShares.length > 0;
    acceptedSharedRef.current = acceptedSharedWorkflows;
  }, [incomingWorkflowShares.length, acceptedSharedWorkflows]);
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
  const hasMRPage = result !== null;
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
  const mrLoading = useRef(false);
  const activeMRQuery = useRef<MRQuery | null>(null);
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
  const [togglingWorkflows, setTogglingWorkflows] = useState<
    Record<string, boolean>
  >({});
  const [recentlyCreatedWorkflow, setRecentlyCreatedWorkflow] =
    useState<CodebaseWorkflowRecord | null>(null);
  const [webhookEnabled, setWebhookEnabled] = useState<boolean | null>(null);
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
  const runsTopRef = useRef<HTMLDivElement>(null);
  const renderedRunPage = useRef({ page: 1, pageSize: 25 });
  const [runClock, setRunClock] = useState(() => Date.now());
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState('');
  const [runsRepoFilter, setRunsRepoFilter] = useState('');
  const [runsWorkflowFilter, setRunsWorkflowFilter] = useState('');
  const [runsResultFilter, setRunsResultFilter] = useState('all');
  const [runsPage, setRunsPage] = useState(1);
  const [runsPageSize, setRunsPageSize] = useState(25);
  const [runsTotal, setRunsTotal] = useState(0);
  const [runsNextPage, setRunsNextPage] = useState<number | null>(null);
  const [lastStartedRun, setLastStartedRun] =
    useState<CodebaseRunRecord | null>(null);
  const [submittingRun, setSubmittingRun] = useState<number | null>(null);
  const [rerunningId, setRerunningId] = useState('');
  const [repoLatestRuns, setRepoLatestRuns] = useState<
    Record<number, CodebaseRunRecord>
  >({});
  const mrSearchSkipRef = useRef(true);
  const [detailRunSnapshot, setDetailRun] = useState<CodebaseRunRecord | null>(
    null,
  );
  const detailRun =
    runs.find((run) => run.id === detailRunSnapshot?.id) ?? detailRunSnapshot;
  const [detailCopied, setDetailCopied] = useState(false);
  const [reportingId, setReportingId] = useState('');
  const reportController = useRef<AbortController | null>(null);
  const detailDialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => reportController.current?.abort(), [scope]);

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
        setSelectedRepoId((current) => {
          if (!current) return '';
          const shareId = sharedWorkflowIdFromKey(current);
          if (shareId) {
            return acceptedSharedRef.current.some((item) => item.id === shareId)
              ? current
              : '';
          }
          return data.items.some((item) => item.repoId === current)
            ? current
            : '';
        });
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
    async (repoId: string, query: MRQuery, quiet = false) => {
      if (!repoId || (quiet && mrLoading.current)) return;
      mrController.current?.abort();
      const controller = new AbortController();
      mrController.current = controller;
      mrLoading.current = true;
      activeMRQuery.current = query;
      if (!quiet) {
        setFetching(true);
        setMRError('');
        setMRPollWarning('');
      }
      const shareId = sharedWorkflowIdFromKey(repoId);
      try {
        if (shareId) {
          const share = acceptedSharedRef.current.find(
            (item) => item.id === shareId,
          );
          const data = await steer.sharedWorkflowMRs(
            shareId,
            {
              state: query.state,
              search: query.search,
              page: query.page,
            },
            controller.signal,
          );
          if (!controller.signal.aborted) {
            setResult(data);
            setMRError('');
            setMRPollWarning('');
            if (share && data.latestRuns) {
              const latest: Record<number, CodebaseRunRecord> = {};
              for (const item of data.latestRuns) {
                if (!latest[item.mrIid]) {
                  latest[item.mrIid] = toSharedRunRecord(item, share);
                }
              }
              setRepoLatestRuns(latest);
            }
          }
        } else {
          const data = await steer.codebaseMergeRequests(
            {
              repoId,
              state: query.state,
              search: query.search,
              page: query.page,
            },
            controller.signal,
          );
          if (!controller.signal.aborted) {
            setResult(data);
            setMRError('');
            setMRPollWarning('');
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          if (quiet) {
            setMRPollWarning(errorText(error));
          } else {
            setResult(null);
            setMRError(errorText(error));
          }
          if (shareId) void onRefreshSharing();
        }
      } finally {
        if (mrController.current === controller) {
          mrLoading.current = false;
          if (!quiet) setFetching(false);
        }
      }
    },
    [errorText, onRefreshSharing],
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
      const controller = new AbortController();
      runsController.current = controller;
      if (!quiet) {
        setRunsLoading(true);
        setRunsError('');
      }
      try {
        const data = await steer.codebaseRunPage(
          {
            repoId: runsRepoFilter || undefined,
            workflowId: runsWorkflowFilter || undefined,
            status: runsResultFilter,
            page: runsPage,
            pageSize: runsPageSize,
            sync,
          },
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setRuns(data.items);
          if (
            renderedRunPage.current.page !== data.page ||
            renderedRunPage.current.pageSize !== data.pageSize
          )
            runsTopRef.current?.scrollIntoView({ block: 'start' });
          renderedRunPage.current = {
            page: data.page,
            pageSize: data.pageSize,
          };
          setRunsTotal(data.total);
          setRunsNextPage(data.nextPage);
          setRunsPage(data.page);
          setRunClock(Date.now());
          setRunsError('');
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setRunsError(errorText(error));
          // Keep already-loaded rows for temporary connection failures. The
          // server rechecks grants before returning every page.
          if (
            sharedWorkflowIdFromKey(runsWorkflowFilter) ||
            runsRepoFilter.startsWith('share-repo:')
          )
            void onRefreshSharing();
        }
      } finally {
        if (runsController.current === controller) setRunsLoading(false);
      }
    },
    [
      runsRepoFilter,
      runsWorkflowFilter,
      runsResultFilter,
      runsPage,
      runsPageSize,
      errorText,
      onRefreshSharing,
    ],
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
          if (
            !saved &&
            !tabChosen.current &&
            !incomingWorkflowAvailable.current
          )
            setTab('codebase');
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setConnectionError(
            error instanceof Error ? error.message : 'Request failed.',
          );
          if (!tabChosen.current && !incomingWorkflowAvailable.current)
            setTab('codebase');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    steer
      .codebaseWebhook(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setWebhookEnabled(Boolean(value?.enabled));
        }
      })
      .catch(() => {
        // Ignore webhook probe errors here; CodebaseWebhookSettings surfaces them.
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

  // Quietly load recent runs for the selected repository on the MR tab so each
  // MR row can display its latest review status without switching tabs.
  useEffect(() => {
    if (
      tab !== 'mrs' ||
      !selectedRepoId ||
      Boolean(sharedWorkflowIdFromKey(selectedRepoId))
    )
      return;
    const controller = new AbortController();
    steer
      .codebaseRuns({ repoId: selectedRepoId, limit: 100 }, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        const latest: Record<number, CodebaseRunRecord> = {};
        for (const item of data.items) {
          if (!latest[item.mrIid]) latest[item.mrIid] = item;
        }
        setRepoLatestRuns(latest);
      })
      .catch(() => {
        // Non-blocking enrichment for MR rows.
      });
    return () => controller.abort();
  }, [tab, selectedRepoId]);

  // Debounce MR search so typing filters automatically like the workflows tab.
  useEffect(() => {
    if (tab !== 'mrs' || !selectedRepoId) return;
    if (mrSearchSkipRef.current) {
      mrSearchSkipRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      void loadMRs(selectedRepoId, {
        state: mrState,
        search: search.trim(),
        page: 1,
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [tab, selectedRepoId, search, mrState, loadMRs]);

  useEffect(() => {
    void Promise.resolve().then(() => loadRuns(tab === 'runs', tab !== 'runs'));
  }, [tab, loadRuns, acceptedSharedKey]);

  // Refresh only visible, unfinished work. Settled history stays still.
  useEffect(() => {
    if (tab !== 'runs' || !runs.some(isLiveRun)) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !runsLoading)
        void loadRuns(true, true);
    }, 8000);
    return () => window.clearInterval(timer);
  }, [tab, runs, runsLoading, loadRuns]);

  // Webhooks update the local MR cache independently of reviews. Read only
  // that cache while this tab is visible; never run a full Codebase sync here.
  useEffect(() => {
    if (tab !== 'mrs' || !selectedRepoId || !hasMRPage) return;
    const controller = new AbortController();
    let refreshing = false;
    const refresh = () => {
      if (
        document.visibilityState !== 'visible' ||
        mrLoading.current ||
        refreshing
      )
        return;
      const query = activeMRQuery.current;
      if (!query) return;
      refreshing = true;
      const isShared = Boolean(sharedWorkflowIdFromKey(selectedRepoId));
      void Promise.all([
        loadMRs(selectedRepoId, query, true),
        ...(isShared ? [] : [loadRepositories(controller.signal, true)]),
      ]).finally(() => {
        refreshing = false;
      });
    };
    const timer = window.setInterval(refresh, 8000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [tab, selectedRepoId, hasMRPage, loadMRs, loadRepositories]);

  // Select the first bound repository or shared workflow when opening the MR tab.
  useEffect(() => {
    if (tab !== 'mrs' || selectedRepoId) return;
    const first =
      repositories[0]?.repoId ||
      (acceptedSharedWorkflows[0]
        ? sharedWorkflowKey(acceptedSharedWorkflows[0].id)
        : '');
    if (!first) return;
    void Promise.resolve().then(() => {
      setResult(null);
      setSelectedRepoId(first);
    });
  }, [tab, selectedRepoId, repositories, acceptedSharedWorkflows]);

  // A repository can disappear when its last workflow is deleted. Drop the
  // stale merge request page so it is not rendered under another repository.
  useEffect(() => {
    if (selectedRepoId) return;
    void Promise.resolve().then(() => {
      setResult(null);
      setMRError('');
      setMRPollWarning('');
    });
  }, [selectedRepoId]);

  // Load a repository or shared workflow once it becomes selected.
  useEffect(() => {
    if (!selectedRepoId) {
      loadedRepo.current = '';
      return;
    }
    const shareId = sharedWorkflowIdFromKey(selectedRepoId);
    if (shareId) {
      if (loadedRepo.current === selectedRepoId) return;
      loadedRepo.current = selectedRepoId;
      void Promise.resolve().then(() =>
        loadMRs(selectedRepoId, { state: 'all', search: '', page: 1 }),
      );
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
        setRecentlyCreatedWorkflow(saved);
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
      void loadRuns(false, true);
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
    if (togglingWorkflows[workflow.id]) return;
    const controller = new AbortController();
    workflowToggleController.current = controller;
    setTogglingWorkflows((prev) => ({ ...prev, [workflow.id]: true }));
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
      if (!controller.signal.aborted) {
        setTogglingWorkflows((prev) => {
          const next = { ...prev };
          delete next[workflow.id];
          return next;
        });
      }
    }
  };

  const showWorkflowRuns = (
    workflow: CodebaseWorkflowRecord,
    run?: CodebaseRunRecord,
  ) => {
    setRunsRepoFilter(workflow.repoId);
    setRunsWorkflowFilter(workflow.id);
    setRunsResultFilter('all');
    setRunsPage(1);
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
    mrSearchSkipRef.current = true;
    setSelectedRepoId(repoId);
    setRepoLatestRuns({});
    setResult(null);
    setMRError('');
    setMRPollWarning('');
    setSearch('');
    const isShared = Boolean(sharedWorkflowIdFromKey(repoId));
    const initialState = isShared ? 'all' : 'opened';
    setMRState(initialState);
    if (isShared) {
      loadedRepo.current = repoId;
      void loadMRs(repoId, { state: initialState, search: '', page: 1 });
      return;
    }
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
      setRunsPage(1);
      if (runsPage === 1) void loadRuns(false, true);
      setRepoLatestRuns((prev) => ({ ...prev, [run.mrIid]: run }));
      setLastStartedRun(run);
      setRunClock(Date.parse(run.startedAt || run.createdAt));
      setRunTarget(null);
    } catch (error) {
      if (!controller.signal.aborted) notice(errorText(error));
    } finally {
      if (!controller.signal.aborted) setSubmittingRun(null);
    }
  };

  const rerunReview = async (run: CodebaseRunRecord) => {
    if (rerunningId || !run.workflowId) return;
    const workflow = workflows.find((item) => item.id === run.workflowId);
    if (!workflow || !workflow.enabled) {
      notice('Create an enabled workflow for this repository first.');
      return;
    }
    const controller = new AbortController();
    runController.current?.abort();
    runController.current = controller;
    setRerunningId(run.id);
    try {
      const nextRun = await steer.createCodebaseRun(
        workflow.id,
        { mrIid: run.mrIid },
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const agent = agents.find((item) => item.id === workflow.agentId);
      if (nextRun.status === 'failed') {
        notice('Review could not start. Open the run record for details.');
      } else {
        notice(
          t('Review started with {agent}.', {
            agent: agent?.name || workflow.name,
          }),
        );
      }
      setRunsPage(1);
      if (runsPage === 1) void loadRuns(false, true);
      setRepoLatestRuns((prev) => ({ ...prev, [nextRun.mrIid]: nextRun }));
      setRunClock(Date.parse(nextRun.startedAt || nextRun.createdAt));
      if (detailRunSnapshot?.id === run.id) {
        setDetailCopied(false);
        setDetailRun(nextRun);
      }
    } catch (error) {
      if (!controller.signal.aborted) notice(errorText(error));
    } finally {
      if (!controller.signal.aborted) setRerunningId('');
    }
  };

  const reportReview = async (run: CodebaseRunRecord) => {
    if (reportController.current || sharedWorkflowIdFromKey(run.workflowId))
      return;
    const controller = new AbortController();
    reportController.current = controller;
    setReportingId(run.id);
    try {
      const updated = await steer.reportCodebaseRun(run.id, controller.signal);
      if (controller.signal.aborted) return;
      setRuns((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      );
      setDetailRun((current) =>
        current?.id === updated.id ? updated : current,
      );
      setRepoLatestRuns((items) =>
        Object.fromEntries(
          Object.entries(items).map(([key, item]) => [
            key,
            item.id === updated.id ? updated : item,
          ]),
        ),
      );
      notice(
        updated.reportStatus === 'sent'
          ? 'Review written back to MR.'
          : updated.reportStatus === 'failed'
            ? 'Writeback failed. Check the error and retry.'
            : 'Reporting to merge request…',
      );
    } catch (error) {
      if (!controller.signal.aborted) notice(errorText(error));
    } finally {
      if (reportController.current === controller) {
        reportController.current = null;
        setReportingId('');
      }
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
  const selectedMRShare =
    acceptedSharedWorkflows.find(
      (item) => sharedWorkflowKey(item.id) === selectedRepoId,
    ) || null;
  const selectedRunsShare =
    acceptedSharedWorkflows.find(
      (item) => sharedWorkflowKey(item.id) === runsWorkflowFilter,
    ) || null;
  const runStatusLabel = (value: string) => t(RUN_STATUS_LABEL[value] || value);
  const flowNeedle = flowSearch.trim().toLowerCase();
  const visibleWorkflows =
    flowOwner === 'shared'
      ? []
      : workflows.filter((workflow) => {
          const agent = agents.find((item) => item.id === workflow.agentId);
          return (
            (flowState === 'all' ||
              workflow.enabled === (flowState === 'enabled')) &&
            (!flowNeedle ||
              [workflow.name, workflow.repoPath, agent?.name || ''].some(
                (value) => value.toLowerCase().includes(flowNeedle),
              ))
          );
        });
  const visibleSharedWorkflows =
    flowOwner === 'mine'
      ? []
      : acceptedSharedWorkflows.filter(
          (share) =>
            !flowNeedle ||
            [
              share.resourceName,
              share.projectSource || '',
              share.ownerName,
              share.workspaceName || '',
            ].some((value) => value.toLowerCase().includes(flowNeedle)),
        );
  const totalVisibleWorkflows =
    visibleWorkflows.length + visibleSharedWorkflows.length;
  const hasAnyWorkflows =
    workflows.length > 0 || acceptedSharedWorkflows.length > 0;
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
  const detailShare = detailRun
    ? acceptedSharedWorkflows.find(
        (item) => sharedWorkflowKey(item.id) === detailRun.workflowId,
      ) || null
    : null;
  const detailLog = detailRun?.error ? cleanRunLog(detailRun.error) : '';
  const detailCanReport = Boolean(
    detailRun &&
    !sharedWorkflowIdFromKey(detailRun.workflowId) &&
    detailRun.status === 'succeeded' &&
    detailRun.summary.trim(),
  );
  const reportingDetailId =
    detailRun?.reportStatus === 'sending' &&
    !sharedWorkflowIdFromKey(detailRun.workflowId)
      ? detailRun.id
      : '';
  useEffect(() => {
    if (!reportingDetailId) return;
    const controller = new AbortController();
    let busy = false;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== 'visible' || busy) return;
      busy = true;
      try {
        const updated = await steer.syncCodebaseRun(
          reportingDetailId,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setRuns((items) =>
          items.map((item) => (item.id === updated.id ? updated : item)),
        );
        setDetailRun((current) =>
          current?.id === updated.id ? updated : current,
        );
        setRepoLatestRuns((items) =>
          Object.fromEntries(
            Object.entries(items).map(([key, item]) => [
              key,
              item.id === updated.id ? updated : item,
            ]),
          ),
        );
      } catch {
        // Keep the last known report state during a temporary disconnect.
      } finally {
        busy = false;
      }
    }, 3000);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [reportingDetailId]);
  const conversationURL = (conversationId: string) =>
    `${window.location.origin}${window.location.pathname}#chat/${conversationId}`;
  const activeRunCount = runs.filter(isLiveRun).length;
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
              title={
                !connection
                  ? t('Connect Codebase before creating a workflow.')
                  : undefined
              }
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
              {value === 'flows' && pendingWorkflowInvites.length > 0 && (
                <span className="ws-automation-tab-pill">
                  {pendingWorkflowInvites.length}
                </span>
              )}
              {value === 'runs' && activeRunCount > 0 && (
                <span className="ws-automation-tab-pill">{activeRunCount}</span>
              )}
              {value === 'codebase' &&
                !loading &&
                (!connection || webhookEnabled === false) && (
                  <span
                    className="ws-automation-tab-dot"
                    aria-label={t('Needs setup')}
                  />
                )}
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
                    type="button"
                    className="ws-automation-button"
                    onClick={openConnection}
                  >
                    {t(connection ? 'Edit connection' : 'Connect Codebase')}
                  </button>
                  {connection && (
                    <button
                      type="button"
                      className="ws-automation-button is-danger-outline"
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
            <CodebaseWebhookSettings onStatusChange={setWebhookEnabled} />
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
                <button
                  type="button"
                  className="ws-primary-button"
                  onClick={() => setTab('codebase')}
                >
                  {t('Go to connection settings')}
                </button>
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
            {!connection && acceptedSharedWorkflows.length === 0 ? (
              <div className="ws-automation-empty is-small">
                <Code2 aria-hidden="true" />
                <h2>{t('Connect Codebase first')}</h2>
                <p>
                  {t(
                    'Configure the Codebase connection, then create a workflow to bind a repository.',
                  )}
                </p>
                <button
                  type="button"
                  className="ws-primary-button"
                  onClick={() => setTab('codebase')}
                >
                  {t('Go to connection settings')}
                </button>
              </div>
            ) : reposLoading && acceptedSharedWorkflows.length === 0 ? (
              <output
                className="ws-automation-skeleton"
                aria-label={t('Loading…')}
              >
                <div />
                <div />
                <div />
              </output>
            ) : repositories.length === 0 &&
              acceptedSharedWorkflows.length === 0 ? (
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
                    <span>
                      {t(
                        acceptedSharedWorkflows.length > 0
                          ? 'Repository or shared workflow'
                          : 'Repository',
                      )}
                    </span>
                    <Select
                      value={selectedRepoId}
                      onValueChange={(value) => selectRepo(String(value))}
                    >
                      <SelectTrigger>
                        <span>
                          {selectedMRShare
                            ? `${selectedMRShare.resourceName} (${selectedMRShare.ownerName})`
                            : selectedRepo
                              ? selectedRepo.repoPath
                              : t('Select a repository')}
                        </span>
                      </SelectTrigger>
                      <SelectContent className="ws-select-popup">
                        {repositories.length > 0 && (
                          <SelectGroup>
                            {acceptedSharedWorkflows.length > 0 && (
                              <SelectLabel>{t('My repositories')}</SelectLabel>
                            )}
                            {repositories.map((repo) => (
                              <SelectItem key={repo.repoId} value={repo.repoId}>
                                {repo.repoPath} · {repo.openCount} {t('open')}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                        {acceptedSharedWorkflows.length > 0 && (
                          <SelectGroup>
                            <SelectLabel>{t('Shared workflows')}</SelectLabel>
                            {acceptedSharedWorkflows.map((share) => (
                              <SelectItem
                                key={share.id}
                                value={sharedWorkflowKey(share.id)}
                              >
                                {share.resourceName} ({share.ownerName})
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        )}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="ws-automation-mr-search">
                    <span>{t('Search')}</span>
                    <div className="ws-automation-search-input">
                      <Search aria-hidden="true" />
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
                      {search && (
                        <button
                          type="button"
                          aria-label={t('Clear search')}
                          onClick={() => applyFilters({ search: '' })}
                          disabled={!selectedRepoId}
                        >
                          <X aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </label>
                  {!selectedMRShare && runCandidates.length > 1 && (
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
                  {selectedMRShare ? (
                    <button
                      type="button"
                      className="ws-automation-button ws-automation-sync-button"
                      onClick={() =>
                        void loadMRs(selectedRepoId, {
                          state: mrState,
                          search: search.trim(),
                          page: result?.page || 1,
                        })
                      }
                      disabled={fetching}
                    >
                      <RefreshCw
                        aria-hidden="true"
                        className={fetching ? 'is-spinning' : undefined}
                      />
                      {t(fetching ? 'Refreshing…' : 'Refresh')}
                    </button>
                  ) : (
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
                      {t(
                        syncingRepoId === selectedRepoId ? 'Syncing…' : 'Sync',
                      )}
                    </button>
                  )}
                </div>

                {selectedMRShare && (
                  <div className="ws-workflow-readonly-strip">
                    <span className="ws-workflow-readonly-strip-copy">
                      <span className="ws-automation-badge">
                        <Eye aria-hidden="true" />
                        {t('Workflow read only')}
                      </span>
                      <span>
                        {t('Shared by {name}', {
                          name: selectedMRShare.ownerName,
                        })}
                        {selectedMRShare.projectSource
                          ? ` · ${selectedMRShare.projectSource}`
                          : ''}
                        {' · '}
                        {t('No Codebase connection required')}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="ws-automation-text-action"
                      onClick={() => setInfoShare(selectedMRShare)}
                    >
                      {t('Workflow information')}
                    </button>
                  </div>
                )}

                {mrPollWarning && (
                  <output className="ws-workflow-poll-warning">
                    <span>
                      <AlertCircle aria-hidden="true" />
                      {t(
                        'Auto-refresh failed temporarily. Showing the last loaded results.',
                      )}
                    </span>
                    <button
                      type="button"
                      className="ws-automation-text-action"
                      onClick={() =>
                        void loadMRs(selectedRepoId, {
                          state: mrState,
                          search: search.trim(),
                          page: result?.page || 1,
                        })
                      }
                    >
                      {t('Retry')}
                    </button>
                  </output>
                )}

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
                    {result.items.map((mr) => {
                      const latestRun = repoLatestRuns[mr.iid];
                      return (
                        <div key={mr.id} className="ws-automation-mr-row">
                          <GitBranch aria-hidden="true" />
                          <div className="ws-automation-mr-copy">
                            <div className="ws-automation-mr-title-line">
                              <button
                                type="button"
                                onClick={() => setSelectedMR(mr)}
                              >
                                {mr.draft && (
                                  <span className="ws-automation-state">
                                    {t('Draft')}
                                  </span>
                                )}
                                <span className="ws-automation-mono">
                                  !{mr.iid}
                                </span>{' '}
                                · {mr.title}
                              </button>
                              {latestRun && (
                                <button
                                  type="button"
                                  className={`ws-automation-run-status is-${latestRun.status} is-clickable`}
                                  onClick={() => {
                                    setDetailCopied(false);
                                    setDetailRun(latestRun);
                                  }}
                                  title={t('Latest review: {status}', {
                                    status: runStatusLabel(latestRun.status),
                                  })}
                                >
                                  {runStatusIcon(latestRun.status)}
                                  {t('Latest review: {status}', {
                                    status: runStatusLabel(latestRun.status),
                                  })}
                                </button>
                              )}
                            </div>
                            <p>
                              {mr.references.full ||
                                `${t('Project')} ${mr.project_id}`}{' '}
                              ·{' '}
                              <span className="ws-automation-mono">
                                {mr.source_branch} → {mr.target_branch}
                              </span>
                            </p>
                            <small>
                              {mr.author.name || mr.author.username} ·{' '}
                              {date(mr.updated_at)}
                            </small>
                          </div>
                          <span
                            className={`ws-automation-state is-${mr.state}`}
                          >
                            {stateName(mr.state)}
                          </span>
                          <div className="ws-automation-mr-actions">
                            {selectedMRShare ? (
                              latestRun ? (
                                <button
                                  type="button"
                                  className="ws-automation-button is-compact"
                                  onClick={() => {
                                    setDetailCopied(false);
                                    setDetailRun(latestRun);
                                  }}
                                >
                                  <FileText aria-hidden="true" />
                                  {t('View result')}
                                </button>
                              ) : (
                                <span className="ws-automation-no-review">
                                  {t('No review yet')}
                                </span>
                              )
                            ) : (
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
                            )}
                            {mr.web_url && (
                              <a
                                className="ws-automation-icon-action"
                                href={mr.web_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={t('Open in Codebase')}
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
                ) : (
                  !mrError &&
                  (selectedRepo || selectedMRShare) && (
                    <div className="ws-automation-empty is-small">
                      <GitBranch aria-hidden="true" />
                      <h2>{t('No matching merge requests')}</h2>
                      <p>
                        {selectedMRShare
                          ? t('No merge requests match the current filters.')
                          : selectedRepo?.lastSyncedAt
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

                {!fetching &&
                  result &&
                  (result.page > 1 || Boolean(result.nextPage)) && (
                    <div className="ws-automation-pagination">
                      <span>
                        {t('Page')} {result.page} · {result.total}{' '}
                        {t('merge requests')}
                      </span>
                      <div className="ws-automation-actions">
                        <button
                          type="button"
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
                          type="button"
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
          {sharingError && (
            <p className="ws-form-error" role="alert">
              {sharingError}
              <button
                type="button"
                className="ws-automation-text-action"
                onClick={() => void onRefreshSharing()}
              >
                {t('Retry')}
              </button>
            </p>
          )}
          <SharedWorkflowInvitations
            invitations={pendingWorkflowInvites}
            onRefresh={onRefreshSharing}
            onNotice={onNotice}
          />
          {recentlyCreatedWorkflow && (
            <output className="ws-automation-created-banner">
              <CheckCircle2 aria-hidden="true" />
              <span>
                {t('Workflow "{name}" created.', {
                  name: recentlyCreatedWorkflow.name,
                })}
              </span>
              <div className="ws-automation-created-actions">
                <button
                  type="button"
                  className="ws-automation-text-action"
                  onClick={() => {
                    const wf = recentlyCreatedWorkflow;
                    setRecentlyCreatedWorkflow(null);
                    setTab('mrs');
                    selectRepo(wf.repoId);
                    setPreferredWorkflowId(wf.id);
                  }}
                >
                  {t('Go to merge requests to run')}
                  <ArrowRight aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ws-automation-icon-action"
                  onClick={() => setRecentlyCreatedWorkflow(null)}
                  aria-label={t('Dismiss')}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            </output>
          )}
          {hasAnyWorkflows && (
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
                    placeholder={t(
                      acceptedSharedWorkflows.length > 0
                        ? 'Workflow, repository, agent, or owner'
                        : 'Workflow, repository, or agent',
                    )}
                    aria-label={t('Search workflows')}
                  />
                  {flowSearch && (
                    <button
                      type="button"
                      aria-label={t('Clear search')}
                      onClick={() => setFlowSearch('')}
                    >
                      <X aria-hidden="true" />
                    </button>
                  )}
                </search>
              </label>
              {acceptedSharedWorkflows.length > 0 && (
                <AutomationFilter
                  label={t('Ownership')}
                  value={flowOwner}
                  onChange={(value) =>
                    setFlowOwner(value as 'all' | 'mine' | 'shared')
                  }
                  options={[
                    { value: 'all', label: t('All workflows') },
                    { value: 'mine', label: t('My workflows') },
                    { value: 'shared', label: t('Shared with me') },
                  ]}
                />
              )}
              {flowOwner !== 'shared' && workflows.length > 0 && (
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
              )}
              <span className="ws-automation-filter-count">
                {t('{count} workflows', { count: totalVisibleWorkflows })}
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
          {(loading || workflowsLoading) && !hasAnyWorkflows ? (
            <output
              className="ws-automation-skeleton"
              aria-label={t('Loading…')}
            >
              <div />
              <div />
            </output>
          ) : !hasAnyWorkflows && !workflowsError ? (
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
          ) : totalVisibleWorkflows === 0 && hasAnyWorkflows ? (
            <div className="ws-automation-empty is-small">
              <Search aria-hidden="true" />
              <h2>{t('No matching workflows')}</h2>
              <button
                type="button"
                className="ws-automation-text-action"
                onClick={() => {
                  setFlowSearch('');
                  setFlowState('all');
                  setFlowOwner('all');
                }}
              >
                {t('Clear filters')}
              </button>
            </div>
          ) : (
            <div className="ws-automation-workflow-list">
              {visibleWorkflows.map((wf) => {
                const agent = agents.find((a) => a.id === wf.agentId);
                const isToggling = Boolean(togglingWorkflows[wf.id]);
                const members = shares.filter(
                  (s) =>
                    s.owned && s.kind === 'workflow' && s.resourceId === wf.id,
                );
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
                          disabled={isToggling}
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
                            {t('{count} Skills', {
                              count: wf.skillIds.length,
                            })}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ws-automation-workflow-actions">
                      {members.length > 0 ? (
                        <CollaborationAvatars
                          members={members}
                          user={user}
                          onClick={() => onShareWorkflow(wf)}
                        />
                      ) : (
                        <button
                          type="button"
                          className="ws-automation-icon-action"
                          onClick={() => onShareWorkflow(wf)}
                          aria-label={t('Share workflow')}
                          title={t('Share workflow')}
                        >
                          <Share2 aria-hidden="true" />
                        </button>
                      )}
                      <Switch
                        checked={wf.enabled}
                        disabled={isToggling}
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
                          tabChosen.current = true;
                          setTab('mrs');
                          selectRepo(wf.repoId);
                          setPreferredWorkflowId(wf.id);
                        }}
                      >
                        <Play aria-hidden="true" />
                        {t('Run review')}
                      </button>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className="ws-automation-icon-action"
                          aria-label={t('More actions')}
                          title={t('More actions')}
                        >
                          <MoreHorizontal aria-hidden="true" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => showWorkflowRuns(wf)}
                          >
                            <History aria-hidden="true" />
                            {t('Run records')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onShareWorkflow(wf)}>
                            <Share2 aria-hidden="true" />
                            {t('Share workflow')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={isToggling}
                            onClick={() => openWorkflowDialog(wf)}
                          >
                            <Pencil aria-hidden="true" />
                            {t('Edit')}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={isToggling}
                            onClick={() => setDeleteTarget(wf)}
                          >
                            <Trash2 aria-hidden="true" />
                            {t('Delete workflow')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
              {visibleSharedWorkflows.map((share) => (
                <div
                  key={sharedWorkflowKey(share.id)}
                  className="ws-automation-workflow-row"
                >
                  <div className="ws-automation-workflow-main">
                    <div className="ws-automation-workflow-title">
                      <button
                        type="button"
                        className="ws-automation-title-button"
                        onClick={() => {
                          tabChosen.current = true;
                          setTab('mrs');
                          selectRepo(sharedWorkflowKey(share.id));
                        }}
                      >
                        {share.resourceName}
                      </button>
                      <span className="ws-automation-badge">
                        <Eye aria-hidden="true" />
                        {t('Workflow read only')}
                      </span>
                    </div>
                    <p className="ws-automation-workflow-repo">
                      <GitBranch aria-hidden="true" />
                      {share.projectSource}
                    </p>
                    <div className="ws-automation-workflow-meta">
                      <span>
                        <Share2 aria-hidden="true" />
                        {t('Shared by {name}', { name: share.ownerName })}
                      </span>
                      {share.workspaceName && (
                        <span>{share.workspaceName}</span>
                      )}
                      <span>{t('Future runs are visible automatically')}</span>
                    </div>
                  </div>
                  <div className="ws-automation-workflow-actions">
                    <button
                      type="button"
                      className="ws-automation-button is-compact"
                      onClick={() => {
                        tabChosen.current = true;
                        setTab('mrs');
                        selectRepo(sharedWorkflowKey(share.id));
                      }}
                    >
                      <GitBranch aria-hidden="true" />
                      {t('View MRs')}
                    </button>
                    <button
                      type="button"
                      className="ws-automation-button is-compact"
                      onClick={() => {
                        tabChosen.current = true;
                        setRunsRepoFilter(
                          share.projectSource
                            ? `share-repo:${share.projectSource}`
                            : '',
                        );
                        setRunsWorkflowFilter(sharedWorkflowKey(share.id));
                        setRunsResultFilter('all');
                        setRunsPage(1);
                        setTab('runs');
                      }}
                    >
                      <History aria-hidden="true" />
                      {t('Run records')}
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="ws-automation-icon-action"
                        aria-label={t('More actions')}
                        title={t('More actions')}
                      >
                        <MoreHorizontal aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setInfoShare(share)}>
                          <Info aria-hidden="true" />
                          {t('Workflow information')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setLeaveShare(share)}
                        >
                          <LogOut aria-hidden="true" />
                          {t('Leave sharing')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Run records: filterable by repository */}
        <TabsContent value="runs" hidden={tab !== 'runs'}>
          <div ref={runsTopRef} className="ws-automation-filterbar">
            <label className="ws-automation-filter">
              <span>{t('Repository')}</span>
              <Select
                value={runsRepoFilter || allRepositoriesValue}
                onValueChange={(value) => {
                  const next = String(value);
                  setRunsRepoFilter(next === allRepositoriesValue ? '' : next);
                  setRunsWorkflowFilter('');
                  setRunsPage(1);
                }}
              >
                <SelectTrigger aria-label={t('Repository')}>
                  <span>
                    {runsRepoFilter.startsWith('share-repo:')
                      ? runsRepoFilter.slice('share-repo:'.length)
                      : repositories.find((r) => r.repoId === runsRepoFilter)
                          ?.repoPath || t('All repositories')}
                  </span>
                </SelectTrigger>
                <SelectContent className="ws-select-popup">
                  <SelectItem value={allRepositoriesValue}>
                    {t('All repositories')}
                  </SelectItem>
                  {repositories.length > 0 && (
                    <SelectGroup>
                      {sharedRepoPaths.length > 0 && (
                        <SelectLabel>{t('My repositories')}</SelectLabel>
                      )}
                      {repositories.map((repo) => (
                        <SelectItem key={repo.repoId} value={repo.repoId}>
                          {repo.repoPath}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {sharedRepoPaths.length > 0 && (
                    <SelectGroup>
                      <SelectLabel>{t('Shared workflows')}</SelectLabel>
                      {sharedRepoPaths.map((path) => (
                        <SelectItem key={path} value={`share-repo:${path}`}>
                          {path}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </label>
            <label className="ws-automation-filter">
              <span>{t('Workflow')}</span>
              <Select
                value={runsWorkflowFilter || allRepositoriesValue}
                onValueChange={(value) => {
                  const next = String(value);
                  setRunsWorkflowFilter(
                    next === allRepositoriesValue ? '' : next,
                  );
                  const nextShareId = sharedWorkflowIdFromKey(next);
                  if (nextShareId) {
                    const nextShare = acceptedSharedWorkflows.find(
                      (s) => s.id === nextShareId,
                    );
                    setRunsRepoFilter(
                      nextShare?.projectSource
                        ? `share-repo:${nextShare.projectSource}`
                        : '',
                    );
                  } else if (runsRepoFilter.startsWith('share-repo:')) {
                    setRunsRepoFilter('');
                  }
                  setRunsPage(1);
                }}
              >
                <SelectTrigger aria-label={t('Workflow')}>
                  <span>
                    {selectedRunsShare
                      ? `${selectedRunsShare.resourceName} (${selectedRunsShare.ownerName})`
                      : workflows.find((wf) => wf.id === runsWorkflowFilter)
                          ?.name || t('All workflows')}
                  </span>
                </SelectTrigger>
                <SelectContent className="ws-select-popup">
                  <SelectItem value={allRepositoriesValue}>
                    {t('All workflows')}
                  </SelectItem>
                  {workflows.filter(
                    (wf) =>
                      !runsRepoFilter ||
                      runsRepoFilter.startsWith('share-repo:') ||
                      wf.repoId === runsRepoFilter,
                  ).length > 0 && (
                    <SelectGroup>
                      {acceptedSharedWorkflows.length > 0 && (
                        <SelectLabel>{t('My workflows')}</SelectLabel>
                      )}
                      {workflows
                        .filter(
                          (wf) =>
                            !runsRepoFilter ||
                            runsRepoFilter.startsWith('share-repo:') ||
                            wf.repoId === runsRepoFilter,
                        )
                        .map((wf) => (
                          <SelectItem key={wf.id} value={wf.id}>
                            {wf.name}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  )}
                  {acceptedSharedWorkflows.filter(
                    (share) =>
                      !runsRepoFilter.startsWith('share-repo:') ||
                      share.projectSource ===
                        runsRepoFilter.slice('share-repo:'.length),
                  ).length > 0 && (
                    <SelectGroup>
                      <SelectLabel>{t('Shared workflows')}</SelectLabel>
                      {acceptedSharedWorkflows
                        .filter(
                          (share) =>
                            !runsRepoFilter.startsWith('share-repo:') ||
                            share.projectSource ===
                              runsRepoFilter.slice('share-repo:'.length),
                        )
                        .map((share) => (
                          <SelectItem
                            key={share.id}
                            value={sharedWorkflowKey(share.id)}
                          >
                            {share.resourceName} ({share.ownerName})
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </label>
            <AutomationFilter
              label={t('Run status')}
              value={runsResultFilter}
              onChange={(value) => {
                setRunsResultFilter(value);
                setRunsPage(1);
              }}
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
          {selectedRunsShare && (
            <div className="ws-workflow-readonly-strip">
              <span className="ws-workflow-readonly-strip-copy">
                <span className="ws-automation-badge">
                  <Eye aria-hidden="true" />
                  {t('Workflow read only')}
                </span>
                <span>
                  {t('Shared by {name}', {
                    name: selectedRunsShare.ownerName,
                  })}
                  {selectedRunsShare.projectSource
                    ? ` · ${selectedRunsShare.projectSource}`
                    : ''}
                </span>
              </span>
              <button
                type="button"
                className="ws-automation-text-action"
                onClick={() => setInfoShare(selectedRunsShare)}
              >
                {t('Workflow information')}
              </button>
            </div>
          )}
          {runs.length > 0 && (
            <div className="ws-automation-list-caption">
              <span>
                {t('Showing {count} of {total} runs', {
                  count: runs.length,
                  total: runsTotal,
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
              <h2>
                {t(
                  runsResultFilter === 'all'
                    ? 'No review runs'
                    : 'No matching runs',
                )}
              </h2>
              <p>
                {t(
                  runsResultFilter === 'all'
                    ? 'Run a review from the Merge requests tab to create a record.'
                    : 'No runs match the selected status.',
                )}
              </p>
              {runsResultFilter !== 'all' && (
                <button
                  type="button"
                  className="ws-automation-text-action"
                  onClick={() => {
                    setRunsResultFilter('all');
                    setRunsPage(1);
                  }}
                >
                  {t('Clear status filter')}
                </button>
              )}
            </div>
          ) : (
            <div className="ws-automation-run-table">
              {runs.map((run) => {
                const wf = workflows.find((w) => w.id === run.workflowId);
                const runShare =
                  acceptedSharedWorkflows.find(
                    (s) => sharedWorkflowKey(s.id) === run.workflowId,
                  ) || null;
                const canRerun = Boolean(
                  !runShare && wf && wf.enabled && !isLiveRun(run),
                );
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
                          <span className="ws-automation-mono">
                            !{run.mrIid}
                          </span>{' '}
                          · {run.mrTitle || t('Merge request')}
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
                        {runShare
                          ? `${runShare.resourceName} · ${t('Shared by {name}', { name: runShare.ownerName })}`
                          : wf
                            ? wf.name
                            : t('Workflow')}{' '}
                        ·{' '}
                        <span className="ws-automation-mono">
                          {run.repoPath}
                        </span>{' '}
                        · {t(run.trigger === 'webhook' ? 'Webhook' : 'Manual')}
                      </p>
                      <small>
                        {date(run.createdAt)} · {t('Duration')}:{' '}
                        <span className="ws-automation-mono">
                          {runDuration(run)}
                        </span>
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
                      {canRerun ? (
                        <button
                          type="button"
                          className="ws-automation-button is-compact"
                          onClick={() => void rerunReview(run)}
                          disabled={Boolean(rerunningId)}
                        >
                          {rerunningId === run.id ? (
                            <Loader2
                              aria-hidden="true"
                              className="is-spinning"
                            />
                          ) : (
                            <RotateCcw aria-hidden="true" />
                          )}
                          {t(rerunningId === run.id ? 'Re-running…' : 'Re-run')}
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ws-automation-button is-compact"
                          onClick={() => {
                            setDetailCopied(false);
                            setDetailRun(run);
                          }}
                        >
                          <FileText aria-hidden="true" />
                          {t('Details')}
                        </button>
                      )}
                      {run.conversationId &&
                        (runShare ? (
                          <button
                            type="button"
                            className="ws-automation-button is-compact"
                            onClick={() =>
                              onOpenSharedConversation(
                                runShare,
                                run.conversationId,
                              )
                            }
                          >
                            {t('Open conversation')}
                            <ExternalLink aria-hidden="true" />
                          </button>
                        ) : (
                          <a
                            className="ws-automation-button is-compact"
                            href={conversationURL(run.conversationId)}
                          >
                            {t('Open conversation')}
                            <ExternalLink aria-hidden="true" />
                          </a>
                        ))}
                      {run.mrUrl && (
                        <a
                          className="ws-automation-icon-action"
                          href={run.mrUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={t('Open in Codebase')}
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
          {!runsError && runsTotal > 0 && (
            <nav
              className="ws-automation-pagination"
              aria-label={t('Run records pagination')}
            >
              <span aria-live="polite">
                {t('Page {page} of {pages} · {count} runs', {
                  page: runsPage,
                  pages: Math.max(1, Math.ceil(runsTotal / runsPageSize)),
                  count: runsTotal,
                })}
              </span>
              <div className="ws-automation-actions">
                <label className="ws-automation-page-size">
                  <span>{t('Records per page')}</span>
                  <select
                    aria-label={t('Records per page')}
                    value={runsPageSize}
                    disabled={runsLoading}
                    onChange={(e) => {
                      setRunsPageSize(Number(e.target.value));
                      setRunsPage(1);
                    }}
                  >
                    {[10, 25, 50, 100].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="ws-automation-button"
                  disabled={runsLoading || runsPage <= 1}
                  onClick={() => setRunsPage((page) => page - 1)}
                >
                  {t('Previous')}
                </button>
                <button
                  type="button"
                  className="ws-automation-button"
                  disabled={runsLoading || !runsNextPage}
                  onClick={() => setRunsPage(runsNextPage || runsPage)}
                >
                  {t('Next')}
                </button>
              </div>
            </nav>
          )}
        </TabsContent>

        <TabsContent value="calibration" hidden={tab !== 'calibration'}>
          <CodebaseCalibrationView
            active={tab === 'calibration'}
            repositories={repositories}
            workflows={workflows}
          />
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
              type="button"
              onClick={() => setDisconnectOpen(false)}
              disabled={disconnecting}
            >
              {t('Cancel')}
            </button>
            <button
              type="button"
              className="ws-danger-button"
              onClick={() => void disconnect()}
              disabled={disconnecting}
            >
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
          <form
            onSubmit={(event) => void saveWorkflow(event)}
            className="ws-workflow-dialog-form"
          >
            <header className="ws-workflow-dialog-head">
              <DialogTitle>
                {t(editingWorkflow ? 'Edit workflow' : 'New workflow')}
              </DialogTitle>
              <DialogDescription>
                {t(
                  'Pick a managed repository and a reviewer agent. Repositories are added to the workspace once and shared by every workflow.',
                )}
              </DialogDescription>
            </header>
            <div className="ws-workflow-dialog-body ws-codebase-form">
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
              <label>
                {t('Review instruction')}
                <textarea
                  ref={instructionRef}
                  className="ws-workflow-instruction"
                  rows={5}
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
              <details
                className="ws-workflow-advanced"
                open={Boolean(editingWorkflow)}
              >
                <summary>
                  <span>{t('Model, Skills & trigger options')}</span>
                  <span className="ws-workflow-advanced-summary">
                    {wfModel || t('Runtime default')}
                    {wfSkillIds.length > 0
                      ? ` · ${t('{count} Skills', { count: wfSkillIds.length })}`
                      : ''}
                    {` · ${t(wfTriggerWebhook ? 'Webhook + manual' : 'Manual only')}`}
                  </span>
                </summary>
                <div className="ws-workflow-advanced-body">
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
                            <SelectItem value="default">
                              {t('Default')}
                            </SelectItem>
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
                    {wfTriggerWebhook && webhookEnabled === false ? (
                      <div
                        className="ws-automation-warn-inline"
                        id="wf-trigger-hint"
                      >
                        <AlertCircle aria-hidden="true" />
                        <span>
                          {t(
                            'Webhook is currently disabled in this workspace. Enable it in Connection settings to trigger reviews automatically.',
                          )}
                        </span>
                        <button
                          type="button"
                          className="ws-automation-text-action"
                          onClick={() => {
                            setWorkflowOpen(false);
                            setTab('codebase');
                          }}
                        >
                          {t('Go to connection settings')}
                        </button>
                      </div>
                    ) : (
                      <small id="wf-trigger-hint">
                        {t(
                          'Requires a configured Codebase webhook. Turn off for manual reviews only.',
                        )}
                      </small>
                    )}
                    <div className="ws-codebase-webhook-toggle">
                      <label htmlFor="wf-report-enabled">
                        {t('Automatically write back to MR')}
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
                        'When disabled, review the result in Steer and manually write it back from run details.',
                      )}
                    </small>
                    <div className="ws-codebase-webhook-toggle">
                      <label htmlFor="wf-enabled">
                        {t('Workflow enabled')}
                      </label>
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
                </div>
              </details>
            </div>
            <footer className="ws-workflow-dialog-foot ws-form-actions">
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
            </footer>
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
          <DialogTitle>
            {deleteTarget
              ? t('Delete workflow "{name}"?', { name: deleteTarget.name })
              : t('Delete workflow?')}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Remove this workflow and its run records. The repository and its synced merge requests are kept.',
            )}
          </DialogDescription>
          <div className="ws-form-actions">
            <button
              type="button"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              {t('Cancel')}
            </button>
            <button
              type="button"
              className="ws-danger-button"
              onClick={() => void deleteWorkflow()}
              disabled={deleting}
            >
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
                  <ReportMarkdown>
                    {selectedMR.description || t('No MR description.')}
                  </ReportMarkdown>
                </div>
              </div>
              <footer className="ws-codebase-mr-footer">
                {!selectedMRShare && (
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
                )}
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
                  {detailShare
                    ? `${detailShare.resourceName} · ${t('Shared by {name}', { name: detailShare.ownerName })}`
                    : detailWorkflow
                      ? detailWorkflow.name
                      : t('Workflow')}{' '}
                  · {detailRun.repoPath}
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
                      <ReportMarkdown>{detailRun.summary}</ReportMarkdown>
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
                {detailCanReport && detailRun.reportStatus !== 'sent' && (
                  <p className="ws-run-detail-note">
                    {t(
                      'After checking the result, write this review to MR. This updates the existing comment from this workflow when present.',
                    )}
                  </p>
                )}
              </div>
              {(detailRun.conversationId ||
                detailRun.mrUrl ||
                detailCanReport ||
                (detailWorkflow &&
                  detailWorkflow.enabled &&
                  !isLiveRun(detailRun))) && (
                <footer className="ws-codebase-mr-footer">
                  <div className="ws-automation-actions">
                    {detailCanReport && (
                      <button
                        type="button"
                        className="ws-automation-button is-compact"
                        disabled={
                          Boolean(reportingId) ||
                          ['sent', 'sending'].includes(detailRun.reportStatus)
                        }
                        onClick={() => void reportReview(detailRun)}
                      >
                        {reportingId === detailRun.id ||
                        detailRun.reportStatus === 'sending' ? (
                          <Loader2 aria-hidden="true" className="is-spinning" />
                        ) : detailRun.reportStatus === 'sent' ? (
                          <Check aria-hidden="true" />
                        ) : (
                          <Upload aria-hidden="true" />
                        )}
                        {t(
                          reportingId === detailRun.id ||
                            detailRun.reportStatus === 'sending'
                            ? 'Reporting to merge request…'
                            : detailRun.reportStatus === 'sent'
                              ? 'Reported to merge request'
                              : detailRun.reportStatus === 'failed'
                                ? 'Retry writeback'
                                : 'Write back to MR',
                        )}
                      </button>
                    )}
                    {detailWorkflow &&
                      detailWorkflow.enabled &&
                      !isLiveRun(detailRun) && (
                        <button
                          type="button"
                          className="ws-automation-button is-compact"
                          onClick={() => void rerunReview(detailRun)}
                          disabled={Boolean(rerunningId)}
                        >
                          {rerunningId === detailRun.id ? (
                            <Loader2
                              aria-hidden="true"
                              className="is-spinning"
                            />
                          ) : (
                            <RotateCcw aria-hidden="true" />
                          )}
                          {t(
                            rerunningId === detailRun.id
                              ? 'Re-running…'
                              : 'Re-run',
                          )}
                        </button>
                      )}
                  </div>
                  <div className="ws-run-detail-links">
                    {detailRun.conversationId &&
                      (detailShare ? (
                        <button
                          type="button"
                          className="ws-codebase-open-link"
                          onClick={() => {
                            const targetShare = detailShare;
                            const convId = detailRun.conversationId;
                            setDetailRun(null);
                            onOpenSharedConversation(targetShare, convId);
                          }}
                        >
                          {t('Open conversation')}
                          <ExternalLink aria-hidden="true" />
                        </button>
                      ) : (
                        <a
                          className="ws-codebase-open-link"
                          href={conversationURL(detailRun.conversationId)}
                        >
                          {t('Open conversation')}
                          <ExternalLink aria-hidden="true" />
                        </a>
                      ))}
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
                  </div>
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
              type="button"
              onClick={() => setRepoDeleteTarget(null)}
              disabled={repoDeleting}
            >
              {t('Cancel')}
            </button>
            <button
              type="button"
              className="ws-danger-button"
              onClick={() => void deleteRepository()}
              disabled={repoDeleting}
            >
              {t(repoDeleting ? 'Removing…' : 'Remove')}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <SharedWorkflowInfoDialog
        share={infoShare}
        onClose={() => setInfoShare(null)}
      />
      <LeaveSharedWorkflowDialog
        share={leaveShare}
        onClose={() => setLeaveShare(null)}
        onLeft={(shareId) => {
          const key = sharedWorkflowKey(shareId);
          if (selectedRepoId === key) setSelectedRepoId('');
          if (runsWorkflowFilter === key) {
            setRunsWorkflowFilter('');
            if (runsRepoFilter.startsWith('share-repo:')) setRunsRepoFilter('');
          }
        }}
        onRefresh={onRefreshSharing}
        onNotice={onNotice}
      />
    </div>
  );
}
