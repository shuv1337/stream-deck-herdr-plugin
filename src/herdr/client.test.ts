// src/herdr/client.test.ts
import { test, expect } from "bun:test";
import { createHerdrClient } from "./client";
import type { RequestFn } from "./socket";
import snapshot from "../../tests/fixtures/snapshot.json";
import legacy from "../../tests/fixtures/agent-list.json";

type Call = { method: string; params: Record<string, unknown> | undefined };

function recorder(reply: (method: string) => unknown): { calls: Call[]; request: RequestFn } {
  const calls: Call[] = [];
  return {
    calls,
    request: async (method, params) => {
      calls.push({ method, params });
      return reply(method);
    },
  };
}

test("snapshot calls session.snapshot and returns agents + workspaces", async () => {
  const r = recorder(() => snapshot.result);
  const client = createHerdrClient({ request: r.request });
  const snap = await client.snapshot();
  expect(r.calls[0]).toEqual({ method: "session.snapshot", params: undefined });
  expect(snap.agents).toHaveLength(5);
  expect(snap.workspaces).toHaveLength(5);
});

test("snapshot throws on malformed shape", async () => {
  const r = recorder(() => ({ type: "session_snapshot", snapshot: {} }));
  await expect(createHerdrClient({ request: r.request }).snapshot()).rejects.toThrow();
});

test("listAgents calls agent.list and returns the agents array", async () => {
  const r = recorder(() => legacy.result);
  const agents = await createHerdrClient({ request: r.request }).listAgents();
  expect(agents).toHaveLength(4);
  expect(r.calls[0].method).toBe("agent.list");
});

test("listAgents throws on malformed shape", async () => {
  const r = recorder(() => ({ type: "agent_list" }));
  await expect(createHerdrClient({ request: r.request }).listAgents()).rejects.toThrow();
});

test("focus calls agent.focus with the target", async () => {
  const r = recorder(() => ({ type: "ok" }));
  await createHerdrClient({ request: r.request }).focus("wJ:p1");
  expect(r.calls[0]).toEqual({ method: "agent.focus", params: { target: "wJ:p1" } });
});

test("notify calls notification.show with body + sound, omitting unset fields", async () => {
  const r = recorder(() => ({ type: "ok" }));
  const client = createHerdrClient({ request: r.request });
  await client.notify("proj blocked", { body: "claude", sound: "request" });
  expect(r.calls[0]).toEqual({
    method: "notification.show",
    params: { title: "proj blocked", body: "claude", sound: "request" },
  });
  await client.notify("plain");
  expect(r.calls[1].params).toEqual({ title: "plain" });
});

test("sendKeys and prompt target the agent surface", async () => {
  const r = recorder(() => ({ type: "ok" }));
  const client = createHerdrClient({ request: r.request });
  await client.sendKeys("reviewer", ["enter"]);
  await client.prompt("w1:p1", "continue");
  expect(r.calls[0]).toEqual({ method: "agent.send_keys", params: { target: "reviewer", keys: ["enter"] } });
  expect(r.calls[1]).toEqual({ method: "agent.prompt", params: { target: "w1:p1", text: "continue" } });
});

test("ping reports version + protocol", async () => {
  const r = recorder(() => ({ type: "pong", version: "0.9.1", protocol: 22 }));
  expect(await createHerdrClient({ request: r.request }).ping()).toEqual({ version: "0.9.1", protocol: 22 });
});
