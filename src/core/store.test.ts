// src/core/store.test.ts
import { test, expect } from "bun:test";
import { createAgentStore } from "./store";
import type { RawAgent, RawWorkspace } from "./agents";

const ten: RawAgent[] = Array.from({ length: 10 }, (_, i) => ({
  agent: "claude",
  agent_status: "working",
  cwd: `/x/p${i}`,
  pane_id: `w1:p${i}`,
  workspace_id: "w1",
}));

const six: RawAgent[] = ten.slice(0, 6);

const fetchOf = (agents: RawAgent[], workspaces: RawWorkspace[] = []) => async () => ({ agents, workspaces });

test("pollNow loads + normalizes agents and notifies subscribers", async () => {
  const store = createAgentStore({ fetch: fetchOf(six) });
  const seen: number[] = [];
  store.subscribe((s) => seen.push(s.agents.length)); // initial emit = 0
  await store.pollNow();
  expect(store.getState().agents).toHaveLength(6);
  expect(store.getState().connected).toBe(true);
  expect(seen).toEqual([0, 6]);
});

test("nextPage/prevPage wrap using pageCount", async () => {
  const store = createAgentStore({ fetch: fetchOf(ten), pageSize: 8 });
  await store.pollNow(); // 10 agents -> 2 pages
  store.nextPage();
  expect(store.getState().page).toBe(1);
  store.nextPage();
  expect(store.getState().page).toBe(0);
  store.prevPage();
  expect(store.getState().page).toBe(1);
});

test("setPageSize re-pages and clamps; page size follows the deck", async () => {
  const store = createAgentStore({ fetch: fetchOf(ten), pageSize: 8 });
  await store.pollNow();
  store.nextPage();
  expect(store.getState().page).toBe(1);
  store.setPageSize(24); // XL: everything fits on one page
  expect(store.getState().pageSize).toBe(24);
  expect(store.getState().page).toBe(0);
  store.setPageSize(0); // floor of 1
  expect(store.getState().pageSize).toBe(1);
});

test("revealAgent pages to the agent's page", async () => {
  const store = createAgentStore({ fetch: fetchOf(ten), pageSize: 4 });
  await store.pollNow();
  store.revealAgent("w1:p9");
  expect(store.getState().page).toBe(2);
  store.revealAgent("nope");
  expect(store.getState().page).toBe(2);
});

test("a single failure keeps last-good; a second failure empties and marks disconnected", async () => {
  let mode: "ok" | "fail" = "ok";
  const store = createAgentStore({
    fetch: async () => {
      if (mode === "fail") throw new Error("herdr down");
      return { agents: six };
    },
  });
  await store.pollNow();
  expect(store.getState().agents).toHaveLength(6);
  mode = "fail";
  await store.pollNow();
  expect(store.getState().agents).toHaveLength(6); // kept
  expect(store.getState().connected).toBe(true);
  await store.pollNow();
  expect(store.getState().agents).toHaveLength(0); // emptied
  expect(store.getState().connected).toBe(false);
});

const mixed: RawAgent[] = [
  { agent: "a", agent_status: "working", cwd: "/x/a", pane_id: "w1:p1", workspace_id: "w1" },
  { agent: "b", agent_status: "idle", cwd: "/x/b", pane_id: "w1:p2", workspace_id: "w1" },
  { agent: "c", agent_status: "blocked", cwd: "/x/c", pane_id: "w1:p3", workspace_id: "w1", focused: true },
  { agent: "d", agent_status: "idle", cwd: "/x/d", pane_id: "w1:p4", workspace_id: "w1" },
];

test("idle agents are filtered out of the display list but counted", async () => {
  const store = createAgentStore({ fetch: fetchOf(mixed) });
  await store.pollNow();
  expect(store.getState().agents.map((a) => a.paneId)).toEqual(["w1:p1", "w1:p3"]);
  expect(store.getState().all).toHaveLength(4);
  expect(store.counts()).toMatchObject({ working: 1, idle: 2, blocked: 1, total: 4 });
  expect(store.focusedAgent()?.paneId).toBe("w1:p3");
});

test("toggleShowIdle reveals idle agents in sidebar order", async () => {
  const store = createAgentStore({ fetch: fetchOf(mixed) });
  await store.pollNow();
  store.toggleShowIdle();
  expect(store.getState().showIdle).toBe(true);
  expect(store.getState().agents.map((a) => a.paneId)).toEqual(["w1:p1", "w1:p2", "w1:p3", "w1:p4"]);
  store.setShowIdle(false);
  expect(store.getState().agents.map((a) => a.paneId)).toEqual(["w1:p1", "w1:p3"]);
});

test("togglePin moves an agent to the front, keeps it when idle, cycles order", async () => {
  const three: RawAgent[] = [
    { agent: "a", agent_status: "working", cwd: "/x/a", pane_id: "w1:p1", workspace_id: "w1" },
    { agent: "b", agent_status: "idle", cwd: "/x/b", pane_id: "w1:p2", workspace_id: "w1" },
    { agent: "c", agent_status: "working", cwd: "/x/c", pane_id: "w1:p3", workspace_id: "w1" },
  ];
  const store = createAgentStore({ fetch: fetchOf(three) });
  await store.pollNow();
  // idle b hidden initially
  expect(store.getState().agents.map((a) => a.paneId)).toEqual(["w1:p1", "w1:p3"]);
  // pin the idle one -> resurfaces at slot 1
  store.togglePin("w1:p2");
  expect(store.isPinned("w1:p2")).toBe(true);
  expect(store.getState().agents.map((a) => a.paneId)).toEqual(["w1:p2", "w1:p1", "w1:p3"]);
  // second pin lands next to the first (pin order)
  store.togglePin("w1:p3");
  expect(store.getState().agents.map((a) => a.paneId)).toEqual(["w1:p2", "w1:p3", "w1:p1"]);
  // unpin -> drops out of the pinned block (and idle p2 hides again)
  store.togglePin("w1:p2");
  expect(store.isPinned("w1:p2")).toBe(false);
  expect(store.getState().agents.map((a) => a.paneId)).toEqual(["w1:p3", "w1:p1"]);
});

test("workspace order from the snapshot drives display order", async () => {
  const agents: RawAgent[] = [
    { agent: "a", agent_status: "working", cwd: "/x/a", pane_id: "wB:p1", workspace_id: "wB" },
    { agent: "b", agent_status: "working", cwd: "/x/b", pane_id: "wA:p1", workspace_id: "wA" },
  ];
  const workspaces: RawWorkspace[] = [
    { workspace_id: "wB", number: 1, label: "first" },
    { workspace_id: "wA", number: 2, label: "second" },
  ];
  const store = createAgentStore({ fetch: fetchOf(agents, workspaces) });
  await store.pollNow();
  expect(store.getState().agents.map((a) => a.workspaceLabel)).toEqual(["first", "second"]);
});

test("page clamps when the agent list shrinks", async () => {
  let agents = ten;
  const store = createAgentStore({ fetch: async () => ({ agents }), pageSize: 8 });
  await store.pollNow();
  store.nextPage();
  expect(store.getState().page).toBe(1);
  agents = ten.slice(0, 3); // now 1 page
  await store.pollNow();
  expect(store.getState().page).toBe(0);
});
