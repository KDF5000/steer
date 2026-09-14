import type { RelayEvent, RelayNode, RelayRun } from '@/lib/domain';

const baseURL =
  process.env.NEXT_PUBLIC_STEER_API_URL ?? 'http://localhost:8080/api/v1';

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
  if (init?.body && !(init.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  const response = await fetch(`${baseURL}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error || `Steer HTTP ${response.status}`);
  }
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
    { headers: { Accept: 'text/event-stream' }, signal },
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
  bootstrap: () => request<Bootstrap>('/bootstrap'),
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
    `${baseURL}/artifacts/${encodeURIComponent(artifactId)}/download`,
  session: (sessionId: string) =>
    request<{
      session: ChatSessionRecord;
      messages: ChatMessageRecord[];
      project?: ProjectRecord;
    }>(`/sessions/${encodeURIComponent(sessionId)}`),
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
    `${baseURL}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
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
