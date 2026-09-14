export type Artifact = {
  id: string;
  title: string;
  source: string;
  type: string;
  version: string;
  state: string;
  summary: string;
  update: string;
  contentType?: string | null;
  size?: number | null;
  relayRunId?: string;
  fileName?: string;
  createdAt?: string;
};

export type AgentProfile = {
  id: string;
  name: string;
  role: string;
  runtime: string;
  model: string;
  state: string;
  runtimeProvider?: string;
  runtimeId?: string | null;
  instructions?: string;
  workspaceKind?: string | null;
  workspaceSource?: string | null;
  workspaceRef?: string | null;
};

export type RuntimeSummary = [
  node: string,
  location: string,
  provider: string,
  version: string,
  load: string,
];

export type ActivitySummary = [
  time: string,
  agent: string,
  type: string,
  message: string,
];

export type ChatMessage = {
  id?: string;
  role: 'user' | 'agent';
  text: string;
  status?: string;
  runId?: string;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  activity?: string;
  activityLog?: Array<{
    id: string;
    label: string;
    detail?: string;
    kind?: 'stage' | 'update' | 'action' | 'action-active';
  }>;
  attachments?: ChatAttachment[];
};

export type ChatAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  url: string;
};

export type RelayRunStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'succeeded'
  | 'failed';

export type RelayRun = {
  id: string;
  status: RelayRunStatus;
  result?: { summary?: string };
  error?: string;
  started_at?: string;
  completed_at?: string;
};

export type RelayEvent = {
  sequence: number;
  type: string;
  data?: Record<string, unknown> | null;
  created_at?: string;
};

export type RelayRuntime = {
  id: string;
  provider: string;
  version?: string;
  state?: string;
  default_model?: string;
  models?: string[];
};

export type RelayNode = {
  id: string;
  state: string;
  active: number;
  capacity: number;
  last_seen: string;
  labels?: Record<string, string>;
  runtimes: RelayRuntime[];
};
