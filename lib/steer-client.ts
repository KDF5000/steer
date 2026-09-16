import type { RelayEvent, RelayNode, RelayRun } from '@/lib/domain';

const baseURL =
  process.env.NEXT_PUBLIC_STEER_API_URL ?? 'http://localhost:8080/api/v1';

let selectedWorkspaceId = '';

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

export class SteerHTTPError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export type AgentRecord = {
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

export type ProjectRecord = {
  id: string;
  name: string;
  workspaceKind: string;
  workspaceSource: string;
  workspaceRef: string | null;
  workspaceSubdir: string | null;
  executionMode: 'in_place' | 'session_worktree';
  runtimeId: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessageRecord = {
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

export type Bootstrap = {
  workspace: { id: string; name: string };
  agents: AgentRecord[];
  projects: ProjectRecord[];
  artifacts: ArtifactRecord[];
  sessions: ChatSessionRecord[];
  relay: {
    connected: boolean;
    publicUrl: string;
    nodes: RelayNode[];
    error?: string;
  };
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

async function streamRunEvents(
  id: string,
  after: number,
  signal: AbortSignal,
  onEvent: (event: RelayEvent) => void,
) {
  const response = await fetch(
    `${baseURL}/runs/${encodeURIComponent(id)}/events/stream?after=${after}`,
    {
      headers: {
        Accept: 'text/event-stream',
        ...(selectedWorkspaceId
          ? { 'X-Steer-Workspace': selectedWorkspaceId }
          : {}),
      },
      credentials: 'include',
      signal,
    },
  );
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

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) consume(block);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  if (!completed) throw new Error('Run event stream ended unexpectedly.');
}

export const steer = {
  setWorkspace: (workspaceId: string) => {
    selectedWorkspaceId = workspaceId;
  },
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
  claimAvailableRuntimes: () =>
    request<RelayNode[]>('/runtimes/claim-available', { method: 'POST' }),
  bootstrap: () => request<Bootstrap>('/bootstrap'),
  inspectWorkspace: (
    runId: string,
    operation: 'list' | 'read' | 'diff',
    path = '',
  ) =>
    request<{
      root: string;
      path: string;
      content: string;
      entries: Array<{ name: string; directory: boolean; size: number }>;
    }>(
      `/runs/${encodeURIComponent(runId)}/workspace?operation=${operation}&path=${encodeURIComponent(path)}`,
    ),
  createAgent: (input: Partial<AgentRecord>) =>
    request<AgentRecord>('/agents', {
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
    `${baseURL}/artifacts/${encodeURIComponent(artifactId)}/download?workspaceId=${encodeURIComponent(selectedWorkspaceId)}`,
  session: (sessionId: string) =>
    request<{
      session: ChatSessionRecord;
      messages: ChatMessageRecord[];
      project?: ProjectRecord;
    }>(`/sessions/${encodeURIComponent(sessionId)}`),
  deleteSession: (sessionId: string) =>
    request<ChatSessionRecord>(`/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    }),
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
  messageAttachmentURL: (messageId: string, attachmentId: string) =>
    `${baseURL}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}?workspaceId=${encodeURIComponent(selectedWorkspaceId)}`,
  run: (id: string) =>
    request<{
      run: RelayRun;
      content: string;
      error?: string | null;
      events: RelayEvent[];
      artifacts: unknown[];
    }>(`/runs/${id}`),
  streamRunEvents,
  cancelRun: (id: string) =>
    request<RelayRun>(`/runs/${id}/cancel`, { method: 'POST' }),
};
