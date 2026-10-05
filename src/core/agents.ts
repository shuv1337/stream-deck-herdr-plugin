// src/core/agents.ts
import type { AgentStatus } from "./status";

// Subset of herdr's `AgentInfo` (protocol 22) that the deck uses.
export type RawAgent = {
  agent?: string | null;
  display_agent?: string | null;
  name?: string | null;
  title?: string | null;
  terminal_title_stripped?: string | null;
  agent_status?: string;
  cwd?: string | null;
  foreground_cwd?: string | null;
  focused?: boolean;
  pane_id?: string;
  workspace_id?: string;
  tab_id?: string;
  launch_pending?: boolean;
  interactive_ready?: boolean;
  state_labels?: Record<string, string>;
};

// Subset of herdr's `WorkspaceInfo` used for ordering and labelling.
export type RawWorkspace = {
  workspace_id?: string;
  number?: number;
  label?: string | null;
  focused?: boolean;
};

export type Agent = {
  /** Agent kind as detected by herdr (claude, codex, …). */
  kind: string;
  /** Human-facing kind label, falls back to `kind`. */
  displayKind: string;
  /** User-assigned live agent name (`herdr agent rename`), if any. */
  name: string | null;
  /** Agent-reported title (e.g. current task), if any. */
  title: string | null;
  /** Terminal tab title with herdr's decorations stripped, "" when unknown. */
  terminalTitle: string;
  status: AgentStatus;
  cwd: string;
  /** cwd of the foreground process — differs from `cwd` inside worktrees. */
  foregroundCwd: string;
  paneId: string;
  workspaceId: string;
  /** 1-based sidebar position of the workspace; large when unknown so unordered agents sink. */
  workspaceNumber: number;
  /** Workspace label with herdr's tree/metadata decorations stripped. */
  workspaceLabel: string;
  focused: boolean;
  /** `agent start` issued but the agent has not been detected yet. */
  launchPending: boolean;
  stateLabels: Record<string, string>;
};

const KNOWN: ReadonlySet<string> = new Set(["idle", "working", "blocked", "done", "unknown"]);
const UNORDERED = Number.MAX_SAFE_INTEGER;

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

// herdr decorates child-workspace labels ("└ name · p:<id>"); the deck wants
// just the name.
export function cleanWorkspaceLabel(label: string): string {
  return label
    .replace(/^[\s└├│─]+/u, "")
    .replace(/\s+·\s+p:[A-Za-z0-9_-]+\s*$/u, "")
    .trim();
}

export type WorkspaceIndex = Map<string, { number: number; label: string }>;

export function indexWorkspaces(workspaces: RawWorkspace[]): WorkspaceIndex {
  const index: WorkspaceIndex = new Map();
  workspaces.forEach((w, i) => {
    if (typeof w.workspace_id !== "string") return;
    index.set(w.workspace_id, {
      number: typeof w.number === "number" ? w.number : i + 1,
      label: cleanWorkspaceLabel(str(w.label) ?? ""),
    });
  });
  return index;
}

function toAgent(r: RawAgent, workspaces: WorkspaceIndex): Agent | null {
  if (!r || typeof r.pane_id !== "string") return null;
  const status: AgentStatus =
    typeof r.agent_status === "string" && KNOWN.has(r.agent_status)
      ? (r.agent_status as AgentStatus)
      : "unknown";
  const workspaceId = str(r.workspace_id) ?? "";
  const ws = workspaces.get(workspaceId);
  const kind = str(r.agent) ?? "agent";
  return {
    kind,
    displayKind: str(r.display_agent) ?? kind,
    name: str(r.name),
    title: str(r.title),
    terminalTitle: str(r.terminal_title_stripped) ?? "",
    status,
    cwd: str(r.cwd) ?? "",
    foregroundCwd: str(r.foreground_cwd) ?? str(r.cwd) ?? "",
    paneId: r.pane_id,
    workspaceId,
    workspaceNumber: ws?.number ?? UNORDERED,
    workspaceLabel: ws?.label ?? "",
    focused: r.focused === true,
    launchPending: r.launch_pending === true,
    stateLabels:
      r.state_labels && typeof r.state_labels === "object" ? { ...r.state_labels } : {},
  };
}

// Sort key: workspace in sidebar order, then pane id so panes within a
// workspace are stable.
function compareAgents(a: Agent, b: Agent): number {
  return (
    a.workspaceNumber - b.workspaceNumber ||
    a.workspaceId.localeCompare(b.workspaceId) ||
    a.paneId.localeCompare(b.paneId)
  );
}

export function normalize(raw: RawAgent[], workspaces: RawWorkspace[] = []): Agent[] {
  const index = indexWorkspaces(workspaces);
  return raw
    .map((r) => toAgent(r, index))
    .filter((a): a is Agent => a !== null)
    .sort(compareAgents);
}

// Statuses worth a slot on the deck. Idle agents are hidden by default — they
// need no attention and would otherwise consume the limited keys.
export function visibleAgents(agents: Agent[], showIdle = false): Agent[] {
  return showIdle ? agents : agents.filter((a) => a.status !== "idle");
}

// Display order for the deck: pinned agents first, in pin order (so the first
// pin lands on slot 1, the second next to it, …), kept visible even when idle;
// then the rest (idle hidden unless showIdle). `pinned` is a list of paneIds;
// stale pins (agent gone) are skipped.
export function orderForDisplay(all: Agent[], pinned: string[], showIdle = false): Agent[] {
  const pinnedSet = new Set(pinned);
  const pinnedAgents = pinned
    .map((id) => all.find((a) => a.paneId === id))
    .filter((a): a is Agent => a !== undefined);
  const rest = visibleAgents(
    all.filter((a) => !pinnedSet.has(a.paneId)),
    showIdle,
  );
  return [...pinnedAgents, ...rest];
}

export type StatusCounts = Record<AgentStatus, number> & { total: number };

export function countByStatus(agents: Agent[]): StatusCounts {
  const counts: StatusCounts = { idle: 0, working: 0, blocked: 0, done: 0, unknown: 0, total: 0 };
  for (const a of agents) {
    counts[a.status] += 1;
    counts.total += 1;
  }
  return counts;
}

function basename(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

// Base label, before de-duplication. A user-assigned name is the strongest
// signal; then the workspace label (herdr's own grouping — tells worktree
// clones of the same repo apart); then the foreground/working directory.
export function baseLabel(agent: Agent): string {
  return (
    agent.name ??
    (agent.workspaceLabel || null) ??
    basename(agent.foregroundCwd) ??
    basename(agent.cwd) ??
    agent.kind
  ) || agent.kind;
}

// Per-key label source. `auto` is baseLabel's name → workspace → cwd chain;
// `project` forces the working-directory basename; `title` shows the terminal
// tab title and falls back to `auto` when there is none.
export type DisplayMode = "auto" | "project" | "title";

export function parseDisplayMode(value: unknown): DisplayMode {
  return value === "project" || value === "title" ? value : "auto";
}

export function labelFor(agent: Agent, peers: Agent[], display: DisplayMode = "auto", max = 24): string {
  if (display === "title") {
    const title = agent.terminalTitle.trim();
    if (title) return truncate(title, max);
  }
  const labelOf = (a: Agent): string =>
    display === "project" ? basename(a.foregroundCwd) || basename(a.cwd) || a.kind : baseLabel(a);
  const base = labelOf(agent);
  // Agents whose label collides get a stable 1-based number (#1, #2, …) in
  // sidebar order (independent of pins/paging), so duplicates are told apart
  // at a glance and keep their number when the view reshuffles.
  const sameName = peers.filter((p) => labelOf(p) === base).sort(compareAgents);
  if (sameName.length <= 1) return truncate(base, max);
  const number = sameName.findIndex((p) => p.paneId === agent.paneId) + 1;
  const suffix = ` #${number}`;
  // Reserve room so the number always survives truncation.
  return `${truncate(base, Math.max(1, max - suffix.length))}${suffix}`;
}
