import net from "node:net";
import { feedLines, herdrSocketPath } from "./socket";

export { feedLines, herdrSocketPath };

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

// Topology / ordering events that can change what the deck shows: new or
// closed panes, detected agents, focus, and workspace order/labels (slots
// follow sidebar order and labels can come from the workspace).
// pane.updated/pane.output_matched are deliberately excluded — they fire on
// every title/output change. Agent *status* is not broadcast globally in
// herdr's API: `pane.agent_status_changed` must be subscribed per pane, which
// buildSubscribe does for every pane id it is given.
export const SUBSCRIPTIONS: readonly string[] = [
  "pane.agent_detected",
  "pane.created",
  "pane.closed",
  "pane.exited",
  "pane.moved",
  "pane.focused",
  "workspace.created",
  "workspace.closed",
  "workspace.renamed",
  "workspace.moved",
  "workspace.reordered",
  "workspace.metadata_updated",
  "workspace.focused",
];

// Pure: the `events.subscribe` request line for the topology events plus a
// per-pane agent-status subscription for each given pane.
export function buildSubscribe(paneIds: readonly string[]): string {
  const subscriptions: Record<string, unknown>[] = SUBSCRIPTIONS.map((type) => ({ type }));
  for (const pane_id of paneIds) subscriptions.push({ type: "pane.agent_status_changed", pane_id });
  return `${JSON.stringify({ id: "sd-sub", method: "events.subscribe", params: { subscriptions } })}\n`;
}

export type AgentStatusEvent = {
  paneId: string;
  workspaceId: string;
  status: string;
  agent: string | null;
};

// Pure: pull the typed payload out of a `pane.agent_status_changed` event
// line; null for every other line (ack, other events, malformed JSON).
export function parseAgentStatusEvent(line: string): AgentStatusEvent | null {
  let env: { event?: string; data?: Record<string, unknown> };
  try {
    env = JSON.parse(line);
  } catch {
    return null;
  }
  if (env.event !== "pane_agent_status_changed" || !env.data) return null;
  const d = env.data;
  if (typeof d.pane_id !== "string" || typeof d.agent_status !== "string") return null;
  return {
    paneId: d.pane_id,
    workspaceId: typeof d.workspace_id === "string" ? d.workspace_id : "",
    status: d.agent_status,
    agent: typeof d.agent === "string" ? d.agent : null,
  };
}

// Pure: the server answers a rejected subscription (e.g. a pane that just
// closed) with an error envelope and then closes the stream.
export function parseErrorLine(line: string): string | null {
  try {
    const env = JSON.parse(line) as { error?: { code?: string; message?: string } };
    return env.error ? `${env.error.code ?? "error"}: ${env.error.message ?? ""}` : null;
  } catch {
    return null;
  }
}

export type EventsClient = {
  start(): void;
  stop(): void;
  isConnected(): boolean;
  /** Reconnect now if the pane set from `paneIds()` differs from the one subscribed. */
  resubscribe(): void;
};

export function samePaneSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

// Calls onChange() whenever herdr emits a subscribed event line (and once on the
// subscribe ack), and onAgentStatus() for typed status transitions.
// Auto-reconnects with exponential backoff. Never throws.
export function createHerdrEvents(opts: {
  onChange: () => void;
  /** Agent pane ids to watch for status changes; re-read on every (re)connect. */
  paneIds?: () => string[];
  onAgentStatus?: (ev: AgentStatusEvent) => void;
  onConnection?: (connected: boolean) => void;
  onError?: (message: string) => void;
  socketPath?: string;
}): EventsClient {
  let stopped = false;
  let conn: net.Socket | null = null;
  let connected = false;
  let subscribedPanes: string[] = [];
  let backoff = RECONNECT_MIN_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Set by resubscribe(): the next close is intentional, reconnect at once.
  let immediate = false;

  const setConnected = (next: boolean): void => {
    if (connected === next) return;
    connected = next;
    opts.onConnection?.(next);
  };

  const scheduleReconnect = (wait: number): void => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, wait);
  };

  const connect = (): void => {
    if (stopped || conn) return;
    const c = net.createConnection(opts.socketPath ?? herdrSocketPath());
    conn = c;
    let buffer = "";
    c.setEncoding("utf8");
    c.on("connect", () => {
      backoff = RECONNECT_MIN_MS;
      subscribedPanes = opts.paneIds?.() ?? [];
      c.write(buildSubscribe(subscribedPanes));
      setConnected(true);
    });
    c.on("data", (chunk: string) => {
      const fed = feedLines(buffer, chunk);
      buffer = fed.rest;
      if (fed.lines.length === 0) return;
      for (const line of fed.lines) {
        const error = parseErrorLine(line);
        if (error) {
          opts.onError?.(error);
          continue;
        }
        const ev = parseAgentStatusEvent(line);
        if (ev) opts.onAgentStatus?.(ev);
      }
      // Any line (ack, event, or error) means state may have moved; a poll
      // also refreshes the pane set before the next (re)subscribe.
      opts.onChange();
    });
    const reconnect = (): void => {
      c.removeAllListeners();
      if (conn === c) conn = null;
      setConnected(false);
      const wait = immediate ? 0 : backoff;
      immediate = false;
      backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
      scheduleReconnect(wait);
    };
    c.on("error", reconnect);
    c.on("close", reconnect);
  };

  return {
    start: () => {
      stopped = false;
      connect();
    },
    stop: () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      conn?.destroy();
      conn = null;
      setConnected(false);
    },
    isConnected: () => connected,
    resubscribe: () => {
      if (stopped || !conn || !connected) return;
      const wanted = opts.paneIds?.() ?? [];
      if (samePaneSet(wanted, subscribedPanes)) return;
      // Drop the stream; the close handler reconnects with the fresh pane set.
      immediate = true;
      conn.destroy();
    },
  };
}
