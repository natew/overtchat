import { describe, expect, it } from "vitest";
import type {
  AgentConnectionListItem,
  AgentSessionListItem,
} from "@overtchat/agent-bridge";
import {
  agentAttentionCounts,
  agentAttentionSections,
  agentSessionHasUnseenTurn,
  agentSessionState,
  formatAgentWorkingTime,
  mostUrgentAgentSessionState,
} from "./attention";
import { recentAgentSetups } from "./setups";
import { sidebarModeForPath } from "./sidebarMode";
import { groupAgentWorkspaces } from "./workspaces";

function session(
  id: string,
  overrides: Partial<AgentSessionListItem> = {},
): AgentSessionListItem {
  return {
    id,
    providerSessionId: `provider-${id}`,
    name: id,
    firstMessage: null,
    messageCount: 1,
    createdAt: 1,
    modifiedAt: 1,
    runtimeStatus: "idle",
    ...overrides,
  };
}

const approval = {
  kind: "approval",
  id: "request",
  requestedAt: 50,
  title: "Allow Bash",
  detail: "npm ci",
} as const;
const question = { ...approval, kind: "question", title: "Route" } as const;
const completed = { outcome: "completed", startedAt: 10, endedAt: 40 } as const;
const failed = { ...completed, outcome: "failed", error: "Boom" } as const;
const stopped = { ...completed, outcome: "stopped" } as const;

describe("agent session state", () => {
  it.each([
    ["no turn yet", {}, "idle"],
    ["running", { runtimeStatus: "running" }, "working"],
    ["an approval while running", { runtimeStatus: "running", attention: approval }, "approval"],
    ["a question", { attention: question }, "question"],
    ["an unseen failure", { lastTurn: failed }, "failed"],
    ["a seen failure", { lastTurn: failed, readTurnEndedAt: 40 }, "idle"],
    ["an unseen failure while a new turn runs", { runtimeStatus: "running", lastTurn: failed }, "failed"],
    ["an unseen completion", { lastTurn: completed }, "unread"],
    ["a completion seen earlier", { lastTurn: completed, readTurnEndedAt: 39 }, "unread"],
    ["a seen completion", { lastTurn: completed, readTurnEndedAt: 40 }, "idle"],
    ["an unseen completion while a new turn runs", { runtimeStatus: "running", lastTurn: completed }, "working"],
    ["a stop", { lastTurn: stopped }, "idle"],
    ["an exited runtime", { runtimeStatus: "exited", lastTurn: completed, readTurnEndedAt: 40 }, "idle"],
  ] as const)("reports %s", (_name, overrides, state) => {
    expect(agentSessionState(session("s", overrides))).toBe(state);
  });

  it("treats only finished, unseen turns as unseen", () => {
    expect(agentSessionHasUnseenTurn(session("s"))).toBe(false);
    expect(agentSessionHasUnseenTurn(session("s", { lastTurn: completed, readTurnEndedAt: null }))).toBe(true);
    expect(agentSessionHasUnseenTurn(session("s", { lastTurn: stopped }))).toBe(false);
  });

  it("picks the most urgent state among sessions", () => {
    expect(mostUrgentAgentSessionState([])).toBe("idle");
    expect(
      mostUrgentAgentSessionState([
        session("a", { lastTurn: completed }),
        session("b", { runtimeStatus: "running" }),
        session("c", { attention: question }),
      ]),
    ).toBe("question");
    expect(
      mostUrgentAgentSessionState([
        session("a", { lastTurn: completed }),
        session("b", { runtimeStatus: "running" }),
      ]),
    ).toBe("working");
  });

  it.each([
    [-5_000, "0s"],
    [45_400, "45s"],
    [12 * 60_000 + 5_000, "12m"],
    [60 * 60_000, "1h"],
    [65 * 60_000, "1h 5m"],
  ])("formats %d ms of work as %s", (elapsed, label) => {
    expect(formatAgentWorkingTime(elapsed)).toBe(label);
  });
});

function connection(
  provider: "codex" | "claude",
  workspaces: { id: string; name: string; sessions: AgentSessionListItem[] }[],
  host: Partial<AgentConnectionListItem["host"]> = {},
): AgentConnectionListItem {
  return {
    id: provider,
    provider,
    executable: provider,
    detectedVersion: null,
    lastValidatedAt: null,
    host: {
      id: "host",
      connectorId: "connector",
      name: "This machine",
      transport: "local",
      sshAlias: null,
      ...host,
    },
    workspaces: workspaces.map((workspace) => ({
      ...workspace,
      path: `/work/${workspace.name}`,
    })),
  };
}

describe("agent attention sections", () => {
  const connections = [
    connection("codex", [
      {
        id: "codex-app",
        name: "app",
        sessions: [
          session("approval", { runtimeStatus: "running", attention: approval }),
          session("failed", { lastTurn: { ...failed, endedAt: 60 } }),
          session("working-old", { runtimeStatus: "running", turnStartedAt: 20 }),
          session("idle", { lastTurn: completed, readTurnEndedAt: 40 }),
        ],
      },
    ]),
    connection("claude", [
      {
        id: "claude-app",
        name: "app",
        sessions: [
          session("working-new", { runtimeStatus: "running", turnStartedAt: 30 }),
          session("ready-old", { lastTurn: completed }),
          session("ready-new", { lastTurn: { ...completed, endedAt: 70 } }),
          session("stopped", { lastTurn: stopped }),
        ],
      },
    ]),
  ];

  it("files sessions by what they need, newest first", () => {
    const sections = agentAttentionSections(groupAgentWorkspaces(connections));
    const ids = (list: typeof sections.needsYou) =>
      list.map((entry) => [entry.item.session.id, entry.state, entry.since]);
    expect(ids(sections.needsYou)).toEqual([
      ["failed", "failed", 60],
      ["approval", "approval", 50],
    ]);
    expect(ids(sections.working)).toEqual([
      ["working-new", "working", 30],
      ["working-old", "working", 20],
    ]);
    expect(ids(sections.ready)).toEqual([
      ["ready-new", "unread", 70],
      ["ready-old", "unread", 40],
    ]);
    expect(sections.ready[0]!.group.name).toBe("app");
  });

  it("counts sessions that need the owner and unseen results", () => {
    expect(agentAttentionCounts(connections)).toEqual({ needsYou: 2, unread: 2 });
    expect(agentAttentionCounts([])).toEqual({ needsYou: 0, unread: 0 });
  });
});

describe("recent agent setups", () => {
  it("orders setups by their latest activity, then list order", () => {
    const setups = recentAgentSetups([
      connection("codex", [
        { id: "codex-empty", name: "empty", sessions: [] },
        { id: "codex-app", name: "app", sessions: [session("a", { modifiedAt: 10 })] },
      ]),
      connection(
        "claude",
        [
          { id: "claude-api", name: "api", sessions: [session("b", { modifiedAt: 5, lastTurn: { ...completed, endedAt: 90 } })] },
          { id: "claude-empty", name: "other", sessions: [] },
        ],
        { transport: "ssh", sshAlias: "home-server", name: "home-server" },
      ),
    ]);
    expect(
      setups.map(({ workspaceId, provider, hostLabel, activityAt }) => [workspaceId, provider, hostLabel, activityAt]),
    ).toEqual([
      ["claude-api", "claude", "home-server", 90],
      ["codex-app", "codex", "This machine", 10],
      ["codex-empty", "codex", "This machine", 0],
      ["claude-empty", "claude", "home-server", 0],
    ]);
    expect(recentAgentSetups([])).toEqual([]);
  });
});

describe("sidebar mode", () => {
  it.each([
    ["/", "agents", "chat"],
    ["/chat/1", "agents", "chat"],
    ["/projects/1", "agents", "chat"],
    ["/library", "agents", "chat"],
    ["/activity/me", "agents", "chat"],
    ["/agents", "chat", "agents"],
    ["/agents/new", "chat", "agents"],
    ["/agents/123", "chat", "agents"],
    ["/agentsx", "agents", "chat"],
    ["/settings", "agents", "agents"],
    ["/settings/models", "chat", "chat"],
  ] as const)("shows %s from %s mode in %s mode", (path, current, mode) => {
    expect(sidebarModeForPath(path, current)).toBe(mode);
  });
});
