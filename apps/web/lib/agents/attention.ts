import type {
  AgentConnectionListItem,
  AgentSessionListItem,
} from "@overtchat/agent-bridge";
import type {
  AgentWorkspaceGroup,
  AgentWorkspaceSession,
} from "@/lib/agents/workspaces";

/**
 * What a session asks of its owner, most urgent first: a pending approval or
 * question, a failed turn not yet seen, active work, then a finished turn not
 * yet seen.
 */
export type AgentSessionState =
  | "approval"
  | "question"
  | "failed"
  | "working"
  | "unread"
  | "idle";

type AttentionFields = Pick<
  AgentSessionListItem,
  "runtimeStatus" | "attention" | "lastTurn" | "readTurnEndedAt"
>;

/** Whether the latest turn ended after the owner last saw the session. */
export function agentSessionHasUnseenTurn(session: AttentionFields): boolean {
  const turn = session.lastTurn;
  // Stopping is the owner's own action, so there is nothing new to see.
  if (!turn || turn.outcome === "stopped") return false;
  return turn.endedAt > (session.readTurnEndedAt ?? -Infinity);
}

export function agentSessionState(session: AttentionFields): AgentSessionState {
  if (session.attention) return session.attention.kind;
  const unseen = agentSessionHasUnseenTurn(session);
  if (unseen && session.lastTurn?.outcome === "failed") return "failed";
  if (session.runtimeStatus === "running") return "working";
  return unseen ? "unread" : "idle";
}

/** States shown under "Needs you". */
export function agentSessionNeedsOwner(state: AgentSessionState): boolean {
  return state === "approval" || state === "question" || state === "failed";
}

/** The most recent time anything happened in the session. */
export function agentSessionActivityAt(session: AgentSessionListItem): number {
  return Math.max(
    session.modifiedAt ?? 0,
    session.createdAt ?? 0,
    session.lastTurn?.endedAt ?? 0,
    session.turnStartedAt ?? 0,
    session.attention?.requestedAt ?? 0,
  );
}

export type AgentAttentionItem = {
  item: AgentWorkspaceSession;
  group: AgentWorkspaceGroup;
  state: AgentSessionState;
  /** When the session entered its current state. */
  since: number;
};

export type AgentAttentionSections = {
  needsYou: AgentAttentionItem[];
  working: AgentAttentionItem[];
  ready: AgentAttentionItem[];
};

function stateSince(
  session: AgentSessionListItem,
  state: AgentSessionState,
): number {
  if (session.attention) return session.attention.requestedAt;
  if (state === "working") return session.turnStartedAt ?? 0;
  return session.lastTurn?.endedAt ?? 0;
}

/** Sessions for the sidebar's attention sections, newest first. */
export function agentAttentionSections(
  groups: readonly AgentWorkspaceGroup[],
): AgentAttentionSections {
  const sections: AgentAttentionSections = {
    needsYou: [],
    working: [],
    ready: [],
  };
  for (const group of groups) {
    for (const item of group.sessions) {
      const state = agentSessionState(item.session);
      if (state === "idle") continue;
      const entry = {
        item,
        group,
        state,
        since: stateSince(item.session, state),
      };
      if (agentSessionNeedsOwner(state)) sections.needsYou.push(entry);
      else if (state === "working") sections.working.push(entry);
      else sections.ready.push(entry);
    }
  }
  for (const list of Object.values(sections)) {
    list.sort((left, right) => right.since - left.since);
  }
  return sections;
}

export type AgentAttentionCounts = { needsYou: number; unread: number };

/** Totals for the Agents mode toggle. */
export function agentAttentionCounts(
  connections: readonly AgentConnectionListItem[],
): AgentAttentionCounts {
  const counts = { needsYou: 0, unread: 0 };
  for (const connection of connections) {
    for (const workspace of connection.workspaces) {
      for (const session of workspace.sessions) {
        const state = agentSessionState(session);
        if (agentSessionNeedsOwner(state)) counts.needsYou += 1;
        else if (state === "unread") counts.unread += 1;
      }
    }
  }
  return counts;
}

const STATE_PRIORITY: readonly AgentSessionState[] = [
  "approval",
  "question",
  "failed",
  "working",
  "unread",
  "idle",
];

/** The most urgent state among sessions, as a collapsed workspace shows it. */
export function mostUrgentAgentSessionState(
  sessions: readonly AttentionFields[],
): AgentSessionState {
  let best = STATE_PRIORITY.length - 1;
  for (const session of sessions) {
    best = Math.min(best, STATE_PRIORITY.indexOf(agentSessionState(session)));
  }
  return STATE_PRIORITY[best]!;
}

/** A compact running time such as "45s", "12m" or "1h 5m". */
export function formatAgentWorkingTime(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}
