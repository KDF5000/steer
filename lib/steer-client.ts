import type { MessageContext, TaskMessageOptions } from './domain';
import type { RelayEvent, RelayNode, RelayRun } from '@/lib/domain';

export const steerAPIBaseURL =
  process.env.NEXT_PUBLIC_STEER_API_URL ?? '/api/v1';
const baseURL = steerAPIBaseURL;

let selectedWorkspaceId = '';
let collaborationScope = '';
function chatPath(path: string) {
  return collaborationScope &&
    /^\/(sessions\/[^/]+(?:$|\/approval-policy$)|runs\/|tasks\/|conversations\/|messages\/[^/]+\/attachments\/|artifacts\/)/.test(
      path,
    )
    ? `/collaboration-access/${encodeURIComponent(collaborationScope)}${path}`
    : path;
}
export type ResourceShare = {
  ownerId?: string;
  recipientName?: string;
  model?: string;
  agentRole?: string;
  id: string;
  kind: 'session' | 'agent' | 'workflow';
  workspaceName?: string;
  resourceId: string;
  ownerName: string;
  recipientEmail: string;
  permission: 'view' | 'execute';
  status: 'pending' | 'accepted' | 'revoked';
  projectId: string | null;
  maxConcurrency: number;
  resourceName: string;
  projectName: string;
  runtimeProvider: string;
  projectSource: string;
  projectKind: string;
  runtimeLabel: string;
  createdAt: string;
  updatedAt: string;
  owned?: boolean;
};

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
};

export type WorkspaceRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceAPIKeyRecord = {
  id: string;
  workspaceId: string;
  name: string;
  prefix: string;
  scopes: Array<'tasks:read' | 'tasks:write' | 'tasks:cancel'>;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type WorkspaceIntegrationRecord = {
  id: string;
  workspaceId: string;
  provider: 'feishu';
  name: string;
  appId: string;
  secretConfigured: boolean;
  agentId: string;
  projectId: string | null;
  enabled: boolean;
  streamReplies: boolean;
  status: 'connecting' | 'connected' | 'error' | 'disabled';
  lastError: string | null;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FeishuIntegrationInput = {
  name: string;
  appId: string;
  appSecret?: string;
  agentId: string;
  projectId?: string | null;
  streamReplies?: boolean;
  enabled: boolean;
};

export type CodebaseConnectionRecord = {
  workspaceId: string;
  baseUrl: string;
  appId: string;
  appSecretConfigured: boolean;
  remoteUsername: string;
  verifiedAt: string;
  updatedAt: string;
};

export type CodebaseConnectionInput = {
  baseUrl: string;
  appId: string;
  appSecret?: string;
};

export type CodebaseMergeRequestRecord = {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description: string;
  state: string;
  web_url: string;
  source_branch: string;
  target_branch: string;
  created_at: string;
  updated_at: string;
  draft: boolean;
  labels: string[];
  author: { name: string; username: string };
  references: { full: string };
};

export type CodebaseMergeRequestsRecord = {
  items: CodebaseMergeRequestRecord[];
  page: number;
  nextPage: number | null;
  total: number;
  syncedAt: string | null;
};

// CodebaseRepositoryEntry is the record returned when a repository is added.
export type CodebaseRepositoryEntry = {
  repoId: string;
  repoPath: string;
  repoName: string;
  createdAt: string;
};

// CodebaseRepositoryRecord is a managed repository with its sync state.
// Merge requests are stored per repository, so several workflows that review
// the same repository share one synced copy.
export type CodebaseRepositoryRecord = {
  repoId: string;
  repoPath: string;
  repoName: string;
  lastSyncedAt: string | null;
  lastMrUpdatedAt: string | null;
  lastCreated: number;
  lastUpdated: number;
  openCount: number;
  totalCount: number;
  lastError: string;
};

export type CodebaseSyncRecord = {
  repoId: string;
  repoPath: string;
  repoName: string;
  created: number;
  updated: number;
  unchanged: number;
  fetched: number;
  pages: number;
  syncedAt: string;
  openCount: number;
  totalCount: number;
};

export type CodebaseWorkflowRecord = {
  id: string;
  workspaceId: string;
  name: string;
  repoPath: string;
  repoId: string;
  repoName: string;
  agentId: string;
  reviewInstruction: string;
  model: string;
  reasoningEffort: string;
  skillIds: string[];
  triggerWebhook: boolean;
  reportEnabled: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SharedWorkflowRecord = {
  workflow: Pick<
    CodebaseWorkflowRecord,
    | 'id'
    | 'name'
    | 'repoId'
    | 'repoPath'
    | 'enabled'
    | 'triggerWebhook'
    | 'reportEnabled'
    | 'createdAt'
    | 'updatedAt'
  >;
  ownerName: string;
  workspaceName: string;
  permission: 'view';
};
export type SharedWorkflowRun = Pick<
  CodebaseRunRecord,
  | 'id'
  | 'mrIid'
  | 'mrTitle'
  | 'mrUrl'
  | 'trigger'
  | 'status'
  | 'summary'
  | 'error'
  | 'conversationId'
  | 'reportStatus'
  | 'reportError'
  | 'reportUrl'
  | 'startedAt'
  | 'finishedAt'
  | 'createdAt'
>;

export type CodebaseWorkflowInput = {
  name: string;
  repoPath: string;
  agentId: string;
  reviewInstruction?: string;
  model?: string;
  reasoningEffort?: string;
  skillIds?: string[];
  triggerWebhook?: boolean;
  reportEnabled?: boolean;
  enabled?: boolean;
};

export type CodebaseRunRecord = {
  id: string;
  workspaceId: string;
  workflowId: string;
  repoPath: string;
  repoId: string;
  mrIid: number;
  mrTitle: string;
  mrUrl: string;
  headSha?: string;
  round?: number;
  trigger: string;
  status: string;
  summary: string;
  riskLevel?: string;
  riskFloor?: string;
  reviewTrack?: string;
  disposition?: string;
  mergePolicy?: string;
  autoApproveStatus?: string;
  autoApproveError?: string;
  mergedHeadSha?: string;
  mrMergedAt?: string | null;
  error: string;
  taskId: string;
  conversationId: string;
  model: string;
  reasoningEffort: string;
  reportStatus: string;
  reportError: string;
  reportUrl: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

export type CodebaseCalibrationOverview = {
  totalRuns: number;
  succeededRuns: number;
  failedRuns: number;
  skippedRuns: number;
  structuredRuns: number;
  uniqueMrs: number;
  multiRoundMrs: number;
  fastTrackRuns: number;
  deepTrackRuns: number;
  autoApproveEligibleRuns: number;
  autoApproveMergedTotal: number;
  autoApproveMergedUnchanged: number;
  autoApproveModifiedBeforeMerge: number;
  blockedRuns: number;
  humanRequiredRuns: number;
  humanLightRuns: number;
  avgDurationSec: number;
  p50DurationSec: number;
  p95DurationSec: number;
};

export type CodebaseCalibrationMatrixRow = {
  riskLevel: string;
  mergePolicy: string;
  totalRuns: number;
  mergedTotal: number;
  mergedUnchanged: number;
  modifiedBeforeMerge: number;
  avgDurationSec: number;
};

export type CodebaseCalibrationRiskRow = {
  riskLevel: string;
  totalRuns: number;
  fastTrackRuns: number;
  deepTrackRuns: number;
  changesRequested: number;
  needsHumanReview: number;
  noConfirmedFindings: number;
  avgDurationSec: number;
};

export type CodebaseCalibrationDailyRow = {
  day: string;
  totalRuns: number;
  succeededRuns: number;
  autoApproveEligible: number;
  humanRequiredOrBlock: number;
};

export type CodebaseCalibrationDriftItem = {
  runId: string;
  workflowId: string;
  repoPath: string;
  mrIid: number;
  mrTitle: string;
  mrUrl: string;
  riskLevel: string;
  headSha: string;
  mergedHeadSha: string;
  mrMergedAt: string | null;
  createdAt: string;
};

export type CodebaseCalibrationStats = {
  days: number;
  overview: CodebaseCalibrationOverview;
  matrix: CodebaseCalibrationMatrixRow[];
  byRisk: CodebaseCalibrationRiskRow[];
  dailyTrend: CodebaseCalibrationDailyRow[];
  driftSamples: CodebaseCalibrationDriftItem[];
};

export type RelayNodeEnrollment = {
  nodeToken: string;
  token: string;
  nodeId: string;
  expiresAt: string;
};

export class SteerHTTPError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type AgentRecord = {
  shared?: boolean;
  id: string;
  workspaceId: string;
  name: string;
  role: string;
  instructions: string;
  runtimeProvider: string;
  runtimeId: string | null;
  model: string | null;
  workspaceKind: string | null;
  workspaceSource: string | null;
  workspaceRef: string | null;
};

export type ArtifactRecord = {
  id: string;
  name: string;
  type: string;
  ref: string;
  state: string;
  relayRunId: string;
  contentType: string | null;
  size: number | null;
  createdAt: string;
};

export type ChatSessionRecord = {
  autoApprove?: boolean;
  modelOverride?: string | null;
  reasoningEffort?: string | null;
  lastMessageAt?: string;
  pinned?: boolean;
  archived?: boolean;
  sharedAgentGrantId?: string | null;
  sharedAgentAccess?: 'pending' | 'accepted' | 'revoked' | 'unavailable' | null;
  parentConversationId?: string | null;
  id: string;
  title: string;
  agentId: string;
  projectId: string | null;
  executionRuntimeId: string | null;
  workspaceKey: string | null;
  workspaceKind?: string | null;
  workspaceSource?: string | null;
  workspaceRef?: string | null;
  workspaceSubdir?: string | null;
  executionMode?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SessionSearchResult = {
  id: string;
  title: string;
  projectId: string | null;
  projectName: string;
  updatedAt: string;
  pinned: boolean;
  shareId?: string;
  messageId?: string;
  snippet: string;
  matchCount: number;
};

export type ProjectRecord = {
  sharedSourceProjectId?: string | null;
  sharedAgentGrantIds?: string[];
  sharedAgentGrantId?: string | null;
  sharedAgentAccess?: 'pending' | 'accepted' | 'revoked' | 'unavailable' | null;
  id: string;
  name: string;
  workspaceKind: string;
  workspaceSource: string;
  workspaceRef: string | null;
  workspaceSubdir: string | null;
  executionMode: 'in_place' | 'session_worktree';
  runtimeId: string | null;
  nodeId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceGitStatus = {
  repository: boolean;
  branch?: string;
  commit?: string;
  detached?: boolean;
};

export type SkillFileRecord = {
  path: string;
  content: string;
  encoding: 'text' | 'base64';
  size?: number;
  executable?: boolean;
};

export type SkillRecord = {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  content: string;
  sourceKind: 'manual' | 'url' | 'agentbuddy';
  sourceUrl: string | null;
  files?: SkillFileRecord[];
  createdAt: string;
  updatedAt: string;
};

export type AgentBuddySkillRecord = {
  identifier: string;
  name: string;
  namespace: string;
  description: string;
  version: string;
};

export type DocumentRecord = {
  id: string;
  workspaceId: string;
  title: string;
  url: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

export type NoteRecord = {
  id: string;
  workspaceId: string;
  title: string;
  content: string;
  tags: string[];
  pinned: boolean;
  archived: boolean;
  reminderAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WorkLogEntryRecord = {
  id: string;
  workspaceId: string;
  content: string;
  occurredAt: string;
  sourceKind: 'manual' | 'agent_activity' | 'legacy_note';
  sourceSessionIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type WorkLogSummaryRecord = {
  id: string;
  workspaceId: string;
  periodKind: 'week';
  periodStart: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type AgentActivityRecord = {
  sessionId: string;
  title: string;
  agentName: string;
  messageCount: number;
  totalMessageCount: number;
  updatedAt: string;
};

export type WorkspaceSettingsRecord = {
  workspaceId: string;
  systemAgentId: string | null;
  interfaceLanguage: 'auto' | 'zh-CN' | 'en';
  aiOutputLanguage: 'auto' | 'zh-CN' | 'en';
};

export type SystemRunRecord = {
  runId: string;
  status: string;
};

export type WorkLogActivityRunRecord = {
  runId: string;
  status: string;
  summary: string | null;
  error: string | null;
  createdAt: string;
};

export type WorkLogWeeklyRunRecord = WorkLogActivityRunRecord;

export type FootprintSessionRecord = {
  sessionId: string;
  title: string;
  projectId: string | null;
  projectName: string;
  agentName: string;
  createdAt: string;
  lastActiveAt: string;
  userMessages: number;
  agentMessages: number;
  tokenCount: number | null;
  tokenCoverage: number;
  totalRuns: number;
  partialRuns: number;
  activeDays: string[];
};

export type FootprintDayRecord = {
  day: string;
  sessions: number;
  userMessages: number;
  agentMessages: number;
  tokenCount: number | null;
};

export type FootprintOverviewRecord = {
  from: string;
  to: string;
  timezone: string;
  totals: {
    activeSessions: number;
    newSessions: number;
    userMessages: number;
    agentMessages: number;
    tokenCount: number | null;
    tokenCoverage: number;
    totalRuns: number;
    partialRuns: number;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
  };
  sessions: FootprintSessionRecord[];
  days: FootprintDayRecord[];
};

export type FootprintReportRecord = {
  id: string;
  workspaceId: string;
  title: string;
  content: string;
  from: string;
  to: string;
  projectId: string | null;
  sourceSessionIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ChatMessageRecord = {
  context?: MessageContext;
  id: string;
  role: 'user' | 'agent';
  content: string;
  status: string;
  relayRunId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  attachments?: Array<{
    id: string;
    messageId: string;
    name: string;
    contentType: string;
    size: number;
    createdAt: string;
  }>;
};

export type SharedConversation = {
  version: number;
  scope: 'conversation' | 'message';
  title: string;
  messages: Array<{
    role: 'user' | 'agent';
    content: string;
    status?: string;
    createdAt: string;
    updatedAt?: string;
  }>;
  createdAt: string;
};

export type CodebaseWebhookRecord = {
  workspaceId: string;
  enabled: boolean;
  callbackPath: string;
  updatedAt: string;
};

export type Bootstrap = {
  workspace: { id: string; name: string };
  agents: AgentRecord[];
  projects: ProjectRecord[];
  artifacts: ArtifactRecord[];
  sessions: ChatSessionRecord[];
  skills: SkillRecord[];
  agentSkills: Record<string, string[]>;
  documents: DocumentRecord[];
  notes: NoteRecord[];
  settings: WorkspaceSettingsRecord;
  relay: {
    connected: boolean;
    publicUrl: string;
    nodes: RelayNode[];
    error?: string;
  };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  path = chatPath(path);
  const headers = new Headers(init?.headers);
  headers.set('Accept', 'application/json');
  if (selectedWorkspaceId)
    headers.set('X-Steer-Workspace', selectedWorkspaceId);
  if (init?.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(`${baseURL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new SteerHTTPError(
      body?.error || `Steer HTTP ${response.status}`,
      response.status,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function streamEvents(
  path: string,
  after: number,
  signal: AbortSignal,
  onEvent: (event: RelayEvent) => void,
) {
  path = chatPath(path);
  const response = await fetch(`${baseURL}${path}?after=${after}`, {
    headers: {
      Accept: 'text/event-stream',
      ...(selectedWorkspaceId
        ? { 'X-Steer-Workspace': selectedWorkspaceId }
        : {}),
    },
    credentials: 'include',
    signal,
  });
  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error || `Steer HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  const consume = (block: string) => {
    let eventType = 'message';
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventType = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
    if (eventType === 'steer.done') {
      completed = true;
      return;
    }
    if (!data.length) return;
    if (eventType === 'steer.error') {
      const payload = JSON.parse(data.join('\n')) as { error?: string };
      throw new Error(payload.error || 'Run event stream was interrupted.');
    }
    if (eventType === 'relay.event') {
      onEvent(JSON.parse(data.join('\n')) as RelayEvent);
    }
  };

  try {
    while (!completed) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done });
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() || '';
      for (const block of blocks) {
        signal.throwIfAborted();
        consume(block);
        if (completed) break;
      }
      if (done) {
        if (!completed && buffer.trim()) consume(buffer);
        break;
      }
    }
    if (!completed) throw new Error('Run event stream ended unexpectedly.');
  } finally {
    // Completion is a protocol event; a proxy may keep the body open after it.
    // Cancel on errors too so failed parses/callbacks do not leak connections.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

const streamRunEvents = (
  id: string,
  after: number,
  signal: AbortSignal,
  onEvent: (event: RelayEvent) => void,
) =>
  streamEvents(
    `/runs/${encodeURIComponent(id)}/events/stream`,
    after,
    signal,
    onEvent,
  );

export const steer = {
  setWorkspace: (workspaceId: string) => {
    selectedWorkspaceId = workspaceId;
    collaborationScope = '';
  },
  workspace: () => selectedWorkspaceId,
  setCollaboration: (id: string) => {
    collaborationScope = id;
  },
  collaboration: () => collaborationScope,
  sharedWorkflow: (id: string, signal?: AbortSignal) =>
    request<SharedWorkflowRecord>(
      `/workflow-shares/${encodeURIComponent(id)}`,
      { signal },
    ),
  sharedWorkflowRuns: (id: string, limit = 100, signal?: AbortSignal) =>
    request<{ items: SharedWorkflowRun[] }>(
      `/workflow-shares/${encodeURIComponent(id)}/runs?limit=${encodeURIComponent(String(limit))}`,
      { signal },
    ),
  sharedWorkflowMRs: (
    id: string,
    query: { state: string; search: string; page: number },
    signal?: AbortSignal,
  ) =>
    request<CodebaseMergeRequestsRecord & { latestRuns?: SharedWorkflowRun[] }>(
      `/workflow-shares/${encodeURIComponent(id)}/merge-requests?${new URLSearchParams({ state: query.state, search: query.search, page: String(query.page) })}`,
      { signal },
    ),
  resourceShares: () => request<ResourceShare[]>('/resource-shares'),
  inviteResource: (
    kind: 'session' | 'agent' | 'workflow',
    id: string,
    input: {
      email: string;
      permission: 'view' | 'execute';
      projectId?: string;
      maxConcurrency?: number;
    },
  ) =>
    request<ResourceShare>(
      `/resource-shares/${kind}/${encodeURIComponent(id)}`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  acceptResourceShare: (id: string) =>
    request<ResourceShare>(
      `/resource-shares/${encodeURIComponent(id)}/accept`,
      { method: 'POST' },
    ),
  revokeResourceShare: (id: string) =>
    request<void>(`/resource-shares/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  updateResourceShare: (id: string, permission: 'view' | 'execute') =>
    request<void>(`/resource-shares/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ permission }),
    }),
  sharedAgentConversation: (id: string) =>
    request<ChatSessionRecord>(
      `/resource-shares/${encodeURIComponent(id)}/conversations`,
      { method: 'POST' },
    ),
  me: () =>
    request<{ user: AuthUser; workspaces: WorkspaceRecord[] }>('/auth/me'),
  login: (input: { email: string; password: string }) =>
    request<{ user: AuthUser; workspaces: WorkspaceRecord[] }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  register: (input: { email: string; password: string; displayName: string }) =>
    request<{ user: AuthUser; workspaces: WorkspaceRecord[] }>(
      '/auth/register',
      { method: 'POST', body: JSON.stringify(input) },
    ),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  createWorkspace: (name: string) =>
    request<WorkspaceRecord>('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  apiKeys: () => request<WorkspaceAPIKeyRecord[]>('/api-keys'),
  createAPIKey: (name: string) =>
    request<{ apiKey: WorkspaceAPIKeyRecord; token: string }>('/api-keys', {
      method: 'POST',
      body: JSON.stringify({
        name,
        scopes: ['tasks:read', 'tasks:write', 'tasks:cancel'],
      }),
    }),
  revokeAPIKey: (id: string) =>
    request<WorkspaceAPIKeyRecord>(`/api-keys/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  integrations: () => request<WorkspaceIntegrationRecord[]>('/integrations'),
  codebaseConnection: (signal?: AbortSignal) =>
    request<CodebaseConnectionRecord | null>('/codebase/connection', {
      signal,
    }),
  codebaseWebhook: (signal?: AbortSignal) =>
    request<CodebaseWebhookRecord | null>('/codebase/webhook', { signal }),
  saveCodebaseWebhook: (
    enabled: boolean,
    rotateToken: boolean,
    signal?: AbortSignal,
  ) =>
    request<CodebaseWebhookRecord>('/codebase/webhook', {
      method: 'PUT',
      body: JSON.stringify({ enabled, rotateToken }),
      signal,
    }),
  saveCodebaseConnection: (
    input: CodebaseConnectionInput,
    signal?: AbortSignal,
  ) =>
    request<CodebaseConnectionRecord>('/codebase/connection', {
      method: 'PUT',
      body: JSON.stringify(input),
      signal,
    }),
  disconnectCodebase: (signal?: AbortSignal) =>
    request<void>('/codebase/connection', { method: 'DELETE', signal }),
  codebaseRepository: (path: string, signal?: AbortSignal) =>
    request<{ id: string; path: string; name: string }>(
      `/codebase/repository?${new URLSearchParams({ path })}`,
      { signal },
    ),
  codebaseRepositories: (signal?: AbortSignal) =>
    request<{ items: CodebaseRepositoryRecord[] }>('/codebase/repositories', {
      signal,
    }),
  addCodebaseRepository: (input: { repoPath: string }, signal?: AbortSignal) =>
    request<CodebaseRepositoryEntry>('/codebase/repositories', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    }),
  deleteCodebaseRepository: (repoId: string, signal?: AbortSignal) =>
    request<void>(`/codebase/repositories/${encodeURIComponent(repoId)}`, {
      method: 'DELETE',
      signal,
    }),
  codebaseMergeRequests: (
    query: { repoId: string; state: string; search: string; page: number },
    signal?: AbortSignal,
  ) =>
    request<CodebaseMergeRequestsRecord>(
      `/codebase/merge-requests?${new URLSearchParams({
        repoId: query.repoId,
        state: query.state,
        search: query.search,
        page: String(query.page),
      })}`,
      { signal },
    ),
  syncCodebaseMergeRequests: (
    input: { repoId: string; full?: boolean },
    signal?: AbortSignal,
  ) =>
    request<CodebaseSyncRecord>('/codebase/merge-requests/sync', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    }),
  codebaseMergeRequest: (
    projectID: number,
    iid: number,
    signal?: AbortSignal,
  ) =>
    request<CodebaseMergeRequestRecord>(
      `/codebase/merge-requests/${projectID}/${iid}`,
      { signal },
    ),
  codebaseWorkflows: (signal?: AbortSignal) =>
    request<{ items: CodebaseWorkflowRecord[] }>('/codebase/workflows', {
      signal,
    }),
  createCodebaseWorkflow: (
    input: CodebaseWorkflowInput,
    signal?: AbortSignal,
  ) =>
    request<CodebaseWorkflowRecord>('/codebase/workflows', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    }),
  updateCodebaseWorkflow: (
    id: string,
    input: CodebaseWorkflowInput,
    signal?: AbortSignal,
  ) =>
    request<CodebaseWorkflowRecord>(
      `/codebase/workflows/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(input), signal },
    ),
  deleteCodebaseWorkflow: (id: string, signal?: AbortSignal) =>
    request<void>(`/codebase/workflows/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      signal,
    }),
  createCodebaseRun: (
    workflowId: string,
    input: { mrIid: number },
    signal?: AbortSignal,
  ) =>
    request<CodebaseRunRecord>(
      `/codebase/workflows/${encodeURIComponent(workflowId)}/runs`,
      { method: 'POST', body: JSON.stringify(input), signal },
    ),
  codebaseRunPage: (
    query: {
      workflowId?: string;
      repoId?: string;
      status?: string;
      page: number;
      pageSize: number;
      sync?: boolean;
    },
    signal?: AbortSignal,
  ) =>
    request<{
      items: CodebaseRunRecord[];
      total: number;
      page: number;
      pageSize: number;
      nextPage: number | null;
    }>(
      `/codebase/runs?${new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), includeShared: 'true', status: query.status || 'all', ...(query.workflowId ? { workflowId: query.workflowId } : {}), ...(query.repoId ? { repoId: query.repoId } : {}), ...(query.sync ? { sync: 'true' } : {}) })}`,
      { signal },
    ),
  codebaseRuns: (
    query: {
      workflowId?: string;
      repoId?: string;
      limit?: number;
      sync?: boolean;
    },
    signal?: AbortSignal,
  ) =>
    request<{ items: CodebaseRunRecord[] }>(
      `/codebase/runs?${new URLSearchParams({
        ...(query.workflowId ? { workflowId: query.workflowId } : {}),
        ...(query.repoId ? { repoId: query.repoId } : {}),
        ...(query.limit ? { limit: String(query.limit) } : {}),
        ...(query.sync ? { sync: 'true' } : {}),
      })}`,
      { signal },
    ),
  syncCodebaseRun: (id: string, signal?: AbortSignal) =>
    request<CodebaseRunRecord>(
      `/codebase/runs/${encodeURIComponent(id)}/sync`,
      { method: 'POST', signal },
    ),
  reportCodebaseRun: (id: string, signal?: AbortSignal) =>
    request<CodebaseRunRecord>(
      `/codebase/runs/${encodeURIComponent(id)}/report`,
      { method: 'POST', signal },
    ),
  codebaseCalibration: (
    query: {
      workflowId?: string;
      repoId?: string;
      days?: number;
    },
    signal?: AbortSignal,
  ) =>
    request<CodebaseCalibrationStats>(
      `/codebase/calibration?${new URLSearchParams({
        ...(query.workflowId ? { workflowId: query.workflowId } : {}),
        ...(query.repoId ? { repoId: query.repoId } : {}),
        ...(query.days !== undefined ? { days: String(query.days) } : {}),
      })}`,
      { signal },
    ),
  createFeishuIntegration: (input: FeishuIntegrationInput) =>
    request<WorkspaceIntegrationRecord>('/integrations/feishu', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateIntegration: (id: string, input: FeishuIntegrationInput) =>
    request<WorkspaceIntegrationRecord>(
      `/integrations/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify(input) },
    ),
  deleteIntegration: (id: string) =>
    request<void>(`/integrations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  reconnectIntegration: (id: string) =>
    request<WorkspaceIntegrationRecord>(
      `/integrations/${encodeURIComponent(id)}/reconnect`,
      { method: 'POST' },
    ),
  createRelayNodeEnrollment: () =>
    request<RelayNodeEnrollment>('/relay-node-enrollments', {
      method: 'POST',
    }),
  relayNodes: (signal?: AbortSignal) =>
    request<RelayNode[]>('/relay-nodes', { signal }),
  deleteRelayNode: (nodeId: string) =>
    request<void>(`/relay-nodes/${encodeURIComponent(nodeId)}`, {
      method: 'DELETE',
    }),
  bindRelayNode: (nodeId: string, runtimeIds: string[]) =>
    request<RelayNode[]>(
      `/relay-nodes/${encodeURIComponent(nodeId)}/bindings`,
      {
        method: 'POST',
        body: JSON.stringify({ runtimeIds }),
      },
    ),
  disconnectRuntimeBinding: (bindingId: string) =>
    request<void>(`/runtime-bindings/${encodeURIComponent(bindingId)}`, {
      method: 'DELETE',
    }),
  updateNodeCapacity: (nodeId: string, capacity: number) =>
    request<RelayNode>(`/nodes/${encodeURIComponent(nodeId)}/capacity`, {
      method: 'PUT',
      body: JSON.stringify({ capacity }),
    }),
  bootstrap: () => request<Bootstrap>('/bootstrap'),
  inspectWorkspace: (
    runId: string,
    operation: 'list' | 'read' | 'diff' | 'git-status',
    path = '',
  ) =>
    request<{
      root: string;
      path: string;
      content: string;
      encoding?: string;
      content_type?: string;
      entries: Array<{ name: string; directory: boolean; size: number }>;
      git?: WorkspaceGitStatus;
    }>(
      `/runs/${encodeURIComponent(runId)}/workspace?operation=${operation}&path=${encodeURIComponent(path)}`,
    ),
  projectGitStatus: (projectId: string, signal?: AbortSignal) =>
    request<{ git?: WorkspaceGitStatus }>(
      `/projects/${encodeURIComponent(projectId)}/git-status`,
      { signal },
    ),
  createAgent: (input: Partial<AgentRecord>) =>
    request<AgentRecord>('/agents', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateAgent: (id: string, input: Partial<AgentRecord>) =>
    request<AgentRecord>(`/agents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteAgent: (id: string) =>
    request<AgentRecord>(`/agents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  systemSettings: () => request<WorkspaceSettingsRecord>('/system/settings'),
  updateSystemSettings: (settings: {
    systemAgentId: string | null;
    interfaceLanguage: WorkspaceSettingsRecord['interfaceLanguage'];
    aiOutputLanguage: WorkspaceSettingsRecord['aiOutputLanguage'];
  }) =>
    request<WorkspaceSettingsRecord>('/system/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  skills: () => request<SkillRecord[]>('/skills'),
  skill: (id: string) =>
    request<SkillRecord>(`/skills/${encodeURIComponent(id)}`),
  createSkill: (input: {
    name: string;
    description: string;
    content: string;
  }) =>
    request<SkillRecord>('/skills', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  importSkill: (url: string, identifier?: string) =>
    request<SkillRecord>('/skills/import', {
      method: 'POST',
      body: JSON.stringify(identifier ? { url, identifier } : { url }),
    }),
  searchAgentBuddySkills: (query: string, signal?: AbortSignal) =>
    request<{ items: AgentBuddySkillRecord[] }>(
      `/skills/agentbuddy/search?q=${encodeURIComponent(query)}`,
      { signal },
    ),
  updateSkill: (
    id: string,
    input: Pick<SkillRecord, 'name' | 'description' | 'content'>,
  ) =>
    request<SkillRecord>(`/skills/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  updateSkillFiles: (id: string, files: SkillFileRecord[]) =>
    request<SkillRecord>(`/skills/${encodeURIComponent(id)}/files`, {
      method: 'PUT',
      body: JSON.stringify({ files }),
    }),
  deleteSkill: (id: string) =>
    request<SkillRecord>(`/skills/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  agentSkills: (agentId: string) =>
    request<SkillRecord[]>(`/agents/${encodeURIComponent(agentId)}/skills`),
  setAgentSkills: (agentId: string, skillIds: string[]) =>
    request<SkillRecord[]>(`/agents/${encodeURIComponent(agentId)}/skills`, {
      method: 'PUT',
      body: JSON.stringify({ skillIds }),
    }),
  documents: () => request<DocumentRecord[]>('/documents'),
  createDocument: (
    input: Pick<DocumentRecord, 'title' | 'url' | 'description'>,
  ) =>
    request<DocumentRecord>('/documents', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateDocument: (
    id: string,
    input: Pick<DocumentRecord, 'title' | 'url' | 'description'>,
  ) =>
    request<DocumentRecord>(`/documents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteDocument: (id: string) =>
    request<DocumentRecord>(`/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  notes: () => request<NoteRecord[]>('/notes'),
  createNote: (
    input: Pick<
      NoteRecord,
      'title' | 'content' | 'tags' | 'pinned' | 'archived' | 'reminderAt'
    >,
  ) =>
    request<NoteRecord>('/notes', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateNote: (
    id: string,
    input: Pick<
      NoteRecord,
      'title' | 'content' | 'tags' | 'pinned' | 'archived' | 'reminderAt'
    >,
  ) =>
    request<NoteRecord>(`/notes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteNote: (id: string) =>
    request<NoteRecord>(`/notes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  workLog: (since: string) =>
    request<{
      entries: WorkLogEntryRecord[];
      summaries: WorkLogSummaryRecord[];
      hasEarlier: boolean;
    }>(`/work-log?since=${encodeURIComponent(since)}`),
  createWorkLogEntry: (input: {
    content: string;
    occurredAt?: string;
    sourceKind?: string;
    sourceSessionIds?: string[];
  }) =>
    request<WorkLogEntryRecord>('/work-log/entries', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateWorkLogEntry: (id: string, content: string) =>
    request<WorkLogEntryRecord>(`/work-log/entries/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  deleteWorkLogEntry: (id: string) =>
    request<WorkLogEntryRecord>(`/work-log/entries/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  workLogActivity: (from: string, to: string) =>
    request<{
      activities: AgentActivityRecord[];
      runId?: string;
      status?: string;
    }>('/work-log/activity', {
      method: 'POST',
      body: JSON.stringify({ from, to }),
    }),
  workLogActivityRun: (from: string, to: string) =>
    request<{
      run: WorkLogActivityRunRecord | null;
      activities: AgentActivityRecord[];
    }>(
      `/work-log/activity-run?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  dismissWorkLogActivityRun: (runId: string) =>
    request<void>(`/work-log/activity-run/${encodeURIComponent(runId)}`, {
      method: 'DELETE',
    }),
  generateWeeklySummary: (periodStart: string, from: string, to: string) =>
    request<SystemRunRecord>('/work-log/weekly-summary', {
      method: 'POST',
      body: JSON.stringify({ periodStart, from, to }),
    }),
  weeklySummaryRun: (periodStart: string) =>
    request<{ run: WorkLogWeeklyRunRecord | null }>(
      `/work-log/weekly-summary-run?periodStart=${encodeURIComponent(periodStart)}`,
    ),
  saveWorkLogSummary: (input: {
    periodKind: 'week';
    periodStart: string;
    content: string;
    runId?: string;
  }) =>
    request<WorkLogSummaryRecord>('/work-log/summaries', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  footprints: (from: string, to: string, timezone: string, projectId = '') =>
    request<FootprintOverviewRecord>(
      `/footprints?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&timezone=${encodeURIComponent(timezone)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`,
    ),
  footprintReports: () =>
    request<FootprintReportRecord[]>('/footprints/reports'),
  generateFootprintReport: (input: {
    from: string;
    to: string;
    projectId?: string;
    groupBy: 'project' | 'day';
    instructions?: string;
  }) =>
    request<{
      runId: string;
      status: string;
      sourceSessionIds: string[];
    }>('/footprints/reports/generate', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  saveFootprintReport: (input: {
    id?: string;
    title: string;
    content: string;
    from: string;
    to: string;
    projectId?: string | null;
    sourceSessionIds: string[];
    runId?: string;
  }) =>
    request<FootprintReportRecord>('/footprints/reports', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  createProject: (
    input: Pick<
      ProjectRecord,
      | 'name'
      | 'workspaceKind'
      | 'workspaceSource'
      | 'workspaceRef'
      | 'workspaceSubdir'
      | 'executionMode'
      | 'runtimeId'
      | 'nodeId'
    >,
  ) =>
    request<ProjectRecord>('/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateProject: (
    id: string,
    input: Pick<
      ProjectRecord,
      | 'name'
      | 'workspaceKind'
      | 'workspaceSource'
      | 'workspaceRef'
      | 'workspaceSubdir'
      | 'executionMode'
      | 'runtimeId'
      | 'nodeId'
    >,
  ) =>
    request<ProjectRecord>(`/projects/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  deleteProject: (id: string) =>
    request<ProjectRecord>(`/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  artifactContent: (artifactId: string) =>
    request<{
      id: string;
      name: string;
      contentType: string;
      content: string;
    }>(`/artifacts/${artifactId}/content`),
  artifactDownloadURL: (artifactId: string) =>
    `${baseURL}${chatPath(`/artifacts/${encodeURIComponent(artifactId)}/download`)}?workspaceId=${encodeURIComponent(selectedWorkspaceId)}`,
  session: (sessionId: string) =>
    request<{
      session: ChatSessionRecord;
      messages: ChatMessageRecord[];
      project?: ProjectRecord;
      agent?: AgentRecord;
      sharingPermission?: 'view' | 'execute';
    }>(`/sessions/${encodeURIComponent(sessionId)}`),
  updateSession: (id: string, update: { title?: string; pinned?: boolean }) =>
    request<ChatSessionRecord>(
      `/sessions/${encodeURIComponent(id)}/navigation`,
      { method: 'PATCH', body: JSON.stringify(update) },
    ),
  searchSessions: (query: URLSearchParams, signal?: AbortSignal) =>
    request<{ results: SessionSearchResult[]; hasMore: boolean }>(
      `/session-search?${query}`,
      { signal },
    ),
  deleteSession: (sessionId: string) =>
    request<ChatSessionRecord>(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    }),
  shareSession: (sessionId: string) =>
    request<{ token: string }>(
      `/sessions/${encodeURIComponent(sessionId)}/share`,
      { method: 'POST' },
    ),
  shareMessage: (messageId: string) =>
    request<{ token: string }>(
      `/messages/${encodeURIComponent(messageId)}/share`,
      { method: 'POST' },
    ),
  sharedConversation: (token: string) =>
    request<SharedConversation>(`/shares/${encodeURIComponent(token)}`),
  chat: (input: {
    prompt: string;
    agentId: string;
    projectId?: string;
    sessionId?: string;
    images?: File[];
  }) => {
    const body = new FormData();
    body.set('prompt', input.prompt);
    body.set('agentId', input.agentId);
    if (input.projectId) body.set('projectId', input.projectId);
    if (input.sessionId) body.set('sessionId', input.sessionId);
    input.images?.forEach((image) => body.append('images', image, image.name));
    return request<{
      sessionId: string;
      runId: string;
      status: string;
      userMessage: {
        id: string;
        attachments?: ChatMessageRecord['attachments'];
      };
      assistantMessage: { id: string };
    }>('/chat', { method: 'POST', body });
  },
  createTask: (
    input: TaskMessageOptions & {
      prompt: string;
      agentId: string;
      projectId?: string;
      conversationId?: string;
      model?: string;
      reasoningEffort?: string;
      images?: File[];
      idempotencyKey?: string;
    },
  ) => {
    const body = new FormData();
    body.set('prompt', input.prompt);
    body.set('agentId', input.agentId);
    if (input.targetAgentId) body.set('targetAgentId', input.targetAgentId);
    if (input.referencedMessageId)
      body.set('referencedMessageId', input.referencedMessageId);
    if (input.referenceMode) body.set('referenceMode', input.referenceMode);
    if (input.projectId) body.set('projectId', input.projectId);
    if (input.conversationId) body.set('conversationId', input.conversationId);
    if (input.model !== undefined) body.set('model', input.model);
    if (input.reasoningEffort !== undefined)
      body.set('reasoningEffort', input.reasoningEffort);
    input.images?.forEach((image) => body.append('images', image, image.name));
    const idempotencyKey =
      input.idempotencyKey ??
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    return request<{
      delegationSession?: ChatSessionRecord;
      taskId: string;
      conversationId: string;
      sessionId: string;
      runId: string;
      status: string;
      userMessage: {
        id: string;
        context?: MessageContext;
        attachments?: ChatMessageRecord['attachments'];
      };
      assistantMessage: { id: string; context?: MessageContext };
    }>(
      collaborationScope && input.conversationId
        ? `/conversations/${encodeURIComponent(input.conversationId)}/tasks`
        : '/tasks',
      {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body,
      },
    );
  },
  messageAttachmentURL: (messageId: string, attachmentId: string) =>
    `${baseURL}${chatPath(`/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`)}?workspaceId=${encodeURIComponent(selectedWorkspaceId)}`,
  run: (id: string) =>
    request<{
      run: RelayRun;
      content: string;
      error?: string | null;
      events: RelayEvent[];
      artifacts: unknown[];
    }>(`/runs/${id}`),
  task: (id: string) =>
    request<{
      task: {
        id: string;
        conversationId: string;
        runId: string;
        status: string;
      };
      run: RelayRun;
      content: string;
      error?: string | null;
      events: RelayEvent[];
      artifacts: unknown[];
    }>(`/tasks/${encodeURIComponent(id)}`),
  streamRunEvents,
  streamTaskEvents: async (
    id: string,
    after: number,
    signal: AbortSignal,
    onEvent: (event: RelayEvent) => void,
  ) =>
    streamEvents(
      `/tasks/${encodeURIComponent(id)}/events`,
      after,
      signal,
      onEvent,
    ),
  disableSessionAutoApproval: (sessionId: string) =>
    request<ChatSessionRecord>(
      `/sessions/${encodeURIComponent(sessionId)}/approval-policy`,
      {
        method: 'PATCH',
        body: JSON.stringify({ autoApprove: false }),
      },
    ),
  resolveRunApproval: (
    runId: string,
    interactionId: string,
    decision: 'allow_once' | 'allow_session' | 'reject',
  ) =>
    request(
      `/runs/${encodeURIComponent(runId)}/interactions/${encodeURIComponent(interactionId)}/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({ decision }),
      },
    ),
  cancelRun: (id: string) =>
    request<RelayRun>(`/runs/${id}/cancel`, { method: 'POST' }),
  cancelTask: (id: string) =>
    request<RelayRun>(`/tasks/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    }),
};
