import type {
  AgentConnectionListItem,
  AgentProviderId,
} from "@overtchat/agent-bridge";
import { agentSessionActivityAt } from "@/lib/agents/attention";

/** An agent and workspace a new session can start with. */
export type AgentSetup = {
  workspaceId: string;
  provider: AgentProviderId;
  workspaceName: string;
  workspacePath: string;
  hostLabel: string;
  transport: AgentConnectionListItem["host"]["transport"];
  /** Latest activity of the setup's sessions; 0 when it has none. */
  activityAt: number;
};

/**
 * Every setup, most recently used first. Setups without sessions follow in
 * list order, so a fresh install still opens its first workspace.
 */
export function recentAgentSetups(
  connections: readonly AgentConnectionListItem[],
): AgentSetup[] {
  const setups: AgentSetup[] = [];
  for (const connection of connections) {
    for (const workspace of connection.workspaces) {
      setups.push({
        workspaceId: workspace.id,
        provider: connection.provider,
        workspaceName: workspace.name,
        workspacePath: workspace.path,
        hostLabel: connection.host.sshAlias || connection.host.name,
        transport: connection.host.transport,
        activityAt: Math.max(
          0,
          ...workspace.sessions.map(agentSessionActivityAt),
        ),
      });
    }
  }
  // Array sort is stable, so equal activity keeps list order.
  return setups.sort((left, right) => right.activityAt - left.activityAt);
}
