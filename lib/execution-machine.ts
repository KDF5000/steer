import type { ChatMessage, RelayEvent, RelayNode, RelayRun } from './domain';

type ExecutionLocation = NonNullable<ChatMessage['executionLocation']>;

export function runExecutionLocation(
  events?: RelayEvent[] | null,
  run?: RelayRun,
): ExecutionLocation | undefined {
  let location: ExecutionLocation = {};
  for (const event of events || []) {
    const data = event.data || {};
    if (event.type === 'attempt.leased') {
      // A retried task can move to another machine. Never pair its new Node
      // with a worktree path left over from the previous Attempt.
      location = {};
      if (typeof data.node_id === 'string' && data.node_id)
        location.nodeId = data.node_id;
    }
    if (
      (event.type === 'workspace.prepared' ||
        (event.type.startsWith('runtime.') &&
          event.type.endsWith('.started'))) &&
      typeof data.work_dir === 'string' &&
      data.work_dir
    )
      location.workDir = data.work_dir;
  }
  const output = run?.result?.output;
  if (
    !location.workDir &&
    typeof output?.work_dir === 'string' &&
    output.work_dir
  )
    location.workDir = output.work_dir;
  return location.nodeId || location.workDir ? location : undefined;
}

// The session's resolved Runtime identifies the machine actually used. Before
// the first execution, the project machine or a fixed Agent supplies the target.
export function executionMachineName(
  nodes: RelayNode[],
  sessionRuntimeId?: string | null,
  projectNodeId?: string | null,
  agentRuntimeId?: string | null,
  assignedNodeId?: string,
): string {
  const runtimeNode = (id: string) =>
    nodes.find((node) => node.runtimes?.some((runtime) => runtime.id === id));
  const node = assignedNodeId
    ? nodes.find((node) => node.id === assignedNodeId)
    : sessionRuntimeId
      ? runtimeNode(sessionRuntimeId)
      : projectNodeId
        ? nodes.find((node) => node.id === projectNodeId)
        : agentRuntimeId
          ? runtimeNode(agentRuntimeId)
          : undefined;
  return node?.labels?.name || node?.id || '';
}
