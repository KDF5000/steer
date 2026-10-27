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
  shared?: boolean;
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

export type RuntimeSummary = [node: RelayNode, location: string];

export type ActivitySummary = [
  time: string,
  agent: string,
  type: string,
  message: string,
];

export type ChatActivity = {
  id: string;
  label: string;
  detail?: string;
  kind?: 'stage' | 'update' | 'action' | 'action-active';
  children?: ChatActivity[];
};

export type MessageContext = {
  userId?: string;
  userName?: string;
  delegationSessionId?: string;
  parentConversationId?: string;
  taskId?: string;
  agentId: string;
  agentName: string;
  ownerAgentId: string;
  delegated?: boolean;
  reference?: { messageId: string; agentName: string; content: string };
};
export type TaskMessageOptions = {
  targetAgentId?: string;
  referencedMessageId?: string;
  referenceMode?: 'explicit' | 'latest' | 'none';
};
export type ChatMessage = {
  context?: MessageContext;
  id?: string;
  role: 'user' | 'agent';
  text: string;
  status?: string;
  runId?: string;
  error?: string;
  createdAt?: string;
  updatedAt?: string;
  activity?: string;
  activityLog?: ChatActivity[];
  changes?: Array<{
    id: string;
    path: string;
    diff: string;
    snapshot?: string;
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
  desired_capacity?: number;
  last_seen: string;
  labels?: Record<string, string>;
  runtimes: RelayRuntime[];
};

// Relay providers are stable lowercase IDs; products whose ID differs from the
// product name get a display name here. Unknown providers are shown as-is.
const runtimeProviderNames: Record<string, string> = {
  qoder: 'Qoder',
  qwenwork: 'QwenWork',
};

export function runtimeProviderName(provider?: string | null) {
  if (!provider) return '';
  return runtimeProviderNames[provider.toLowerCase()] || provider;
}
