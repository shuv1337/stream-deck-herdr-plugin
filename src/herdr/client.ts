// src/herdr/client.ts
import type { RawAgent, RawWorkspace } from "../core/agents";
import { createSocketRequest, type RequestFn } from "./socket";

export type NotifyOpts = {
  body?: string;
  sound?: "none" | "done" | "request";
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
};

export type Snapshot = { agents: RawAgent[]; workspaces: RawWorkspace[] };

export type ServerInfo = { version: string; protocol: number };

export type HerdrClient = {
  /** `session.snapshot`: agents plus the ordered workspace list in one round trip. */
  snapshot(): Promise<Snapshot>;
  /** `agent.list` only (kept for callers that do not need workspace labels). */
  listAgents(): Promise<RawAgent[]>;
  /** `agent.focus`; target is a pane id or a unique live agent name. Marks the agent seen. */
  focus(target: string): Promise<void>;
  /** `notification.show` in the herdr TUI, optionally with a sound. */
  notify(title: string, opts?: NotifyOpts): Promise<void>;
  /** `agent.send_keys`: logical keys such as `enter`, `esc`, `y`, `ctrl+c`. */
  sendKeys(target: string, keys: string[]): Promise<void>;
  /** `agent.prompt`: submit text + Enter as one ordered submission. */
  prompt(target: string, text: string): Promise<void>;
  /** `ping`: server version + protocol, used for startup logging and feature checks. */
  ping(): Promise<ServerInfo>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function createHerdrClient(opts: { request?: RequestFn } = {}): HerdrClient {
  const request = opts.request ?? createSocketRequest();
  return {
    async snapshot() {
      const result = asRecord(await request("session.snapshot"));
      const snap = asRecord(result.snapshot);
      const agents = snap.agents;
      const workspaces = snap.workspaces;
      if (!Array.isArray(agents) || !Array.isArray(workspaces)) {
        throw new Error("unexpected `session.snapshot` shape");
      }
      return { agents: agents as RawAgent[], workspaces: workspaces as RawWorkspace[] };
    },
    async listAgents() {
      const result = asRecord(await request("agent.list"));
      if (!Array.isArray(result.agents)) throw new Error("unexpected `agent.list` shape");
      return result.agents as RawAgent[];
    },
    async focus(target) {
      await request("agent.focus", { target });
    },
    async notify(title, opts = {}) {
      const params: Record<string, unknown> = { title };
      if (opts.body !== undefined) params.body = opts.body;
      if (opts.sound !== undefined) params.sound = opts.sound;
      if (opts.position !== undefined) params.position = opts.position;
      await request("notification.show", params);
    },
    async sendKeys(target, keys) {
      await request("agent.send_keys", { target, keys });
    },
    async prompt(target, text) {
      await request("agent.prompt", { target, text });
    },
    async ping() {
      const result = asRecord(await request("ping"));
      return {
        version: typeof result.version === "string" ? result.version : "unknown",
        protocol: typeof result.protocol === "number" ? result.protocol : 0,
      };
    },
  };
}
