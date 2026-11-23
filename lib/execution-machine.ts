import type { RelayNode } from './domain';

// The session's resolved Runtime identifies the machine actually used. Before
// the first execution, the project machine or a fixed Agent supplies the target.
export function executionMachineIP(
  nodes: RelayNode[],
  sessionRuntimeId?: string | null,
  projectNodeId?: string | null,
  agentRuntimeId?: string | null,
): string {
  const runtimeNode = (id: string) =>
    nodes.find((node) => node.runtimes?.some((runtime) => runtime.id === id));
  const node = sessionRuntimeId
    ? runtimeNode(sessionRuntimeId)
    : projectNodeId
      ? nodes.find((node) => node.id === projectNodeId)
      : agentRuntimeId
        ? runtimeNode(agentRuntimeId)
        : undefined;
  return node?.labels?.['relay.node.ip'] || '';
}
