"use client";

import { useId, useMemo, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { AgentConnectionListItem } from "@overtchat/agent-bridge";
import { agentProviderMetadata } from "@overtchat/agent-bridge";
import { formatUpdatedAt } from "@overtchat/shared";
import {
  AgentSessionReadToggle,
  AgentSessionStatusIcon,
  agentSessionStateLabel,
} from "@/components/agents/AgentSessionStatus";
import { useSidebar } from "@/components/sidebar-context";
import {
  agentAttentionSections,
  formatAgentWorkingTime,
  type AgentAttentionItem,
} from "@/lib/agents/attention";
import { agentSessionDisplayTitle } from "@/lib/agents/sidebar";
import { groupAgentWorkspaces } from "@/lib/agents/workspaces";
import { useSetAgentSessionRead } from "@/lib/queries/agentSessionRead";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

/** Finished sessions listed before "Show more". */
const READY_PREVIEW_COUNT = 5;

/** Sessions that need the owner, are working, or finished unseen. */
export function SidebarAgentAttention({
  connections,
}: {
  connections: AgentConnectionListItem[];
}) {
  const sections = useMemo(
    () => agentAttentionSections(groupAgentWorkspaces(connections)),
    [connections],
  );
  const setRead = useSetAgentSessionRead();
  const [showAllReady, setShowAllReady] = useState(false);
  const readyListId = useId();
  const working = sections.working.length > 0;
  // Running times tick each second; relative times only need the minute.
  const now = useNow(working ? 1_000 : 30_000);
  const ready = showAllReady
    ? sections.ready
    : sections.ready.slice(0, READY_PREVIEW_COUNT);
  const hiddenReady = sections.ready.length - ready.length;

  if (
    sections.needsYou.length === 0 &&
    !working &&
    sections.ready.length === 0
  ) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1 pb-1">
      <AttentionSection
        label="Needs you"
        count={sections.needsYou.length}
        items={sections.needsYou}
        now={now}
      />
      <AttentionSection
        label="Working"
        count={sections.working.length}
        items={sections.working}
        now={now}
      />
      <AttentionSection
        label="Ready to review"
        count={sections.ready.length}
        items={ready}
        now={now}
        listId={readyListId}
        action={
          <button
            type="button"
            onClick={() => {
              for (const { item } of sections.ready) {
                setRead.mutate({ sessionId: item.session.id, read: true });
              }
            }}
            className="rounded px-1 text-[11px] text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            Mark all read
          </button>
        }
        footer={
          sections.ready.length > READY_PREVIEW_COUNT && (
            <li>
              <button
                type="button"
                aria-expanded={showAllReady}
                aria-controls={readyListId}
                onClick={() => setShowAllReady((current) => !current)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground motion-colors hover:bg-sidebar-accent hover:text-foreground max-md:min-h-11"
              >
                {showAllReady ? (
                  <ChevronUp aria-hidden="true" className="size-3.5" />
                ) : (
                  <ChevronDown aria-hidden="true" className="size-3.5" />
                )}
                <span>{showAllReady ? "Show less" : `Show ${hiddenReady} more`}</span>
              </button>
            </li>
          )
        }
      />
    </div>
  );
}

function AttentionSection({
  label,
  count,
  items,
  now,
  action,
  footer,
  listId,
}: {
  label: string;
  count: number;
  items: AgentAttentionItem[];
  now: number;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  listId?: string;
}) {
  if (count === 0) return null;
  return (
    <section aria-label={label} className="group/section">
      <div className="mt-3 mb-0.5 flex min-h-6 items-center gap-1.5 px-2">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </h2>
        <span className="text-xs tabular-nums text-muted-foreground/70">{count}</span>
        {action && (
          <span className="ml-auto opacity-0 motion-opacity group-hover/section:opacity-100 group-focus-within/section:opacity-100 [@media(hover:none)]:opacity-100">
            {action}
          </span>
        )}
      </div>
      <ul id={listId} className="flex flex-col gap-0.5">
        {items.map((entry) => (
          <AttentionRow key={entry.item.session.id} entry={entry} now={now} />
        ))}
        {footer}
      </ul>
    </section>
  );
}

function AttentionRow({
  entry,
  now,
}: {
  entry: AgentAttentionItem;
  now: number;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { closeMobile } = useSidebar();
  const { item, group, state, since } = entry;
  const { session, provider } = item;
  const title = agentSessionDisplayTitle(session) || "New session";
  const active = pathname === `/agents/${session.id}`;
  const hostLabel = group.host.sshAlias || group.host.name || "This server";
  const detail =
    session.attention
      ? [session.attention.title, session.attention.detail]
          .filter(Boolean)
          .join(" · ")
      : state === "failed"
        ? session.lastTurn?.error || "The last turn failed."
        : state === "working"
          ? `${group.name} · ${hostLabel}`
          : session.lastTurn?.preview || "Finished";
  const time =
    state === "working"
      ? formatAgentWorkingTime(now - since)
      : formatUpdatedAt(since, now);
  return (
    <li className="group relative">
      <Link
        to="/agents/$id"
        params={{ id: session.id }}
        onClick={closeMobile}
        aria-current={active ? "page" : undefined}
        title={`${title} · ${agentProviderMetadata(provider).label} · ${group.name} · ${hostLabel}`}
        className={cn(
          // Room for the read toggle, which touch screens don't show.
          "flex min-w-0 items-start gap-2 rounded-md py-1.5 pr-7 pl-2 text-xs outline-none motion-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring [@media(hover:none)]:pr-2",
          active && "bg-sidebar-accent",
        )}
      >
        <span className="flex h-4 shrink-0 items-center" title={agentSessionStateLabel(state)}>
          <AgentSessionStatusIcon state={state} />
          <span className="sr-only">{agentSessionStateLabel(state)}:</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate leading-4 text-sidebar-foreground">
              {title}
            </span>
            <span className="shrink-0 text-[10px] leading-4 tabular-nums text-muted-foreground">
              {time}
            </span>
          </span>
          <span
            className={cn(
              "block truncate text-[11px] leading-4 text-muted-foreground",
              state === "failed" && "text-destructive/90",
            )}
          >
            {detail}
          </span>
        </span>
      </Link>
      <span className="absolute top-1 right-0.5 flex size-5 items-center justify-center max-md:size-7">
        <AgentSessionReadToggle session={session} state={state} title={title} />
      </span>
    </li>
  );
}
