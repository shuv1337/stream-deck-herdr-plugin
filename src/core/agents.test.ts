// src/core/agents.test.ts
import { test, expect } from "bun:test";
import {
  normalize,
  visibleAgents,
  orderForDisplay,
  labelFor,
  cleanWorkspaceLabel,
  countByStatus,
  parseDisplayMode,
  type RawAgent,
  type RawWorkspace,
} from "./agents";
import legacy from "../../tests/fixtures/agent-list.json";
import snapshot from "../../tests/fixtures/snapshot.json";
import { mk } from "../../tests/helpers";

const snapAgents = snapshot.result.snapshot.agents as RawAgent[];
const snapWorkspaces = snapshot.result.snapshot.workspaces as RawWorkspace[];

const raw = (
  status: string,
  paneId: string,
  extra: Partial<RawAgent> = {},
): RawAgent => ({
  agent: "claude",
  agent_status: status,
  cwd: `/x/${paneId}`,
  pane_id: paneId,
  workspace_id: paneId.split(":")[0],
  ...extra,
});

test("normalize maps the AgentInfo fields and sorts by workspace number then pane", () => {
  const agents = normalize(snapAgents, snapWorkspaces);
  expect(agents.map((a) => a.paneId)).toEqual(["w1Y2:p1", "w10F:p2", "w10J:p2", "w10P:p2", "w1YB:p1"]);
  expect(agents[0]).toMatchObject({
    kind: "shuvcode",
    displayKind: "OpenCode",
    name: null,
    title: "Session startup request",
    status: "done",
    cwd: "/home/shuv/repos/shuvbro",
    paneId: "w1Y2:p1",
    workspaceId: "w1Y2",
    workspaceNumber: 1,
    workspaceLabel: "shuvbro",
    focused: true,
    launchPending: false,
  });
  expect(agents[0].terminalTitle).toBe("OC | Session startup request");
  expect(agents[1].terminalTitle).toBe("");
  expect(agents[1].name).toBe("reviewer");
  expect(agents[1].foregroundCwd).toBe("/home/shuv/.treehouse/shuvbro-f12acf/2/shuvbro");
  expect(agents[4].launchPending).toBe(true);
});

test("normalize without workspaces falls back to id order and tolerates the old agent list", () => {
  const agents = normalize(legacy.result.agents as RawAgent[]);
  expect(agents.map((a) => a.paneId)).toEqual(["w5:p1", "w7:p2", "wG:p1", "wJ:p1"]);
  expect(agents[0].workspaceLabel).toBe("");
  expect(agents[0].displayKind).toBe("claude");
});

test("normalize coerces unknown status and drops entries without pane_id", () => {
  const agents = normalize([
    raw("weird", "w1:p1"),
    { agent: "y", agent_status: "idle", cwd: "/c" },
  ]);
  expect(agents).toHaveLength(1);
  expect(agents[0].status).toBe("unknown");
});

test("agents in unknown workspaces sink below ordered ones", () => {
  const agents = normalize(
    [raw("working", "wZ:p1"), raw("working", "w2:p1")],
    [{ workspace_id: "w2", number: 7, label: "two" }],
  );
  expect(agents.map((a) => a.paneId)).toEqual(["w2:p1", "wZ:p1"]);
});

test("cleanWorkspaceLabel strips herdr's tree prefix and metadata suffix", () => {
  expect(cleanWorkspaceLabel("└ sb-v2-qualify-shuv2 · p:0kSWdo0pXYEK27Di9W056Q")).toBe("sb-v2-qualify-shuv2");
  expect(cleanWorkspaceLabel("├ child")).toBe("child");
  expect(cleanWorkspaceLabel("shuvbro")).toBe("shuvbro");
  expect(cleanWorkspaceLabel("r1-pilot (gpt-6-sol)")).toBe("r1-pilot (gpt-6-sol)");
});

test("visibleAgents drops idle agents unless asked to show them", () => {
  const agents = normalize([
    raw("idle", "w1:p1"),
    raw("working", "w1:p2"),
    raw("blocked", "w1:p3"),
    raw("done", "w1:p4"),
    raw("weird", "w1:p5"),
  ]);
  expect(visibleAgents(agents).map((a) => a.status)).toEqual(["working", "blocked", "done", "unknown"]);
  expect(visibleAgents(agents, true)).toHaveLength(5);
});

test("orderForDisplay puts pinned first in pin order, keeps pinned idle visible", () => {
  const all = normalize([raw("working", "w1:p1"), raw("idle", "w1:p2"), raw("blocked", "w1:p3")]);
  // pin idle p2 then p1: both move to the front in pin order, idle p2 stays visible
  expect(orderForDisplay(all, ["w1:p2", "w1:p1"]).map((a) => a.paneId)).toEqual(["w1:p2", "w1:p1", "w1:p3"]);
  // no pins: idle dropped, rest keeps order
  expect(orderForDisplay(all, []).map((a) => a.paneId)).toEqual(["w1:p1", "w1:p3"]);
  // stale pin (agent gone) is skipped
  expect(orderForDisplay(all, ["gone"]).map((a) => a.paneId)).toEqual(["w1:p1", "w1:p3"]);
  // showIdle keeps idle in place after the pins
  expect(orderForDisplay(all, ["w1:p3"], true).map((a) => a.paneId)).toEqual(["w1:p3", "w1:p1", "w1:p2"]);
});

test("labelFor prefers agent name, then workspace label, then foreground cwd", () => {
  const agents = normalize(snapAgents, snapWorkspaces);
  const byPane = (id: string) => agents.find((a) => a.paneId === id)!;
  expect(labelFor(byPane("w10F:p2"), agents)).toBe("reviewer"); // renamed agent
  expect(labelFor(byPane("w10J:p2"), agents)).toBe("sb-v2-steer-wakes"); // cleaned workspace label
  expect(labelFor(byPane("w1Y2:p1"), agents)).toBe("shuvbro"); // workspace label
  const noWs = normalize(snapAgents); // no workspace list → cwd basenames
  expect(labelFor(noWs.find((a) => a.paneId === "w1YB:p1")!, noWs)).toBe("beckon");
});

test("labelFor truncates and disambiguates duplicates in sidebar order", () => {
  const long = normalize([raw("idle", "w7:p2", { cwd: "/a/LMManagementSystemWithAVeryLongName" })]);
  expect(labelFor(long[0], long)).toBe("LMManagementSystemWithA…");
  const dupA = mk("idle", "w2:p3", { cwd: "/y/app", foregroundCwd: "/y/app", workspaceNumber: 2 });
  const dupB = mk("idle", "w1:p1", { cwd: "/x/app", foregroundCwd: "/x/app", workspaceNumber: 1 });
  // peers passed in display order with A first, but numbering follows sidebar order
  expect(labelFor(dupA, [dupA, dupB])).toBe("app #2");
  expect(labelFor(dupB, [dupA, dupB])).toBe("app #1");
});

test("labelFor numbers long duplicate names so they differ", () => {
  const a = mk("idle", "w5:p1", { cwd: "/x/Loftware-Automation-Proxy", foregroundCwd: "/x/Loftware-Automation-Proxy" });
  const b = mk("idle", "w5:p9", { cwd: "/y/Loftware-Automation-Proxy", foregroundCwd: "/y/Loftware-Automation-Proxy" });
  const la = labelFor(a, [a, b]);
  const lb = labelFor(b, [a, b]);
  expect(la.endsWith("#1")).toBe(true);
  expect(lb.endsWith("#2")).toBe(true);
  expect(la).not.toBe(lb);
  expect(la.length).toBeLessThanOrEqual(24);
});

test("countByStatus tallies every status plus the total", () => {
  const agents = normalize(snapAgents, snapWorkspaces);
  expect(countByStatus(agents)).toEqual({ idle: 1, working: 2, blocked: 1, done: 1, unknown: 0, total: 5 });
});

test("labelFor display modes: project forces the cwd basename, title shows the tab title", () => {
  const agents = normalize(snapAgents, snapWorkspaces);
  const byPane = (id: string) => agents.find((a) => a.paneId === id)!;
  // project: worktree foreground cwd basename collides across clones → numbered in sidebar order
  expect(labelFor(byPane("w10F:p2"), agents, "project")).toBe("shuvbro #2");
  expect(labelFor(byPane("w1Y2:p1"), agents, "project")).toBe("shuvbro #1");
  // title: terminal title when present, else the auto chain
  expect(labelFor(byPane("w1Y2:p1"), agents, "title")).toBe("OC | Session startup re…");
  expect(labelFor(byPane("w10F:p2"), agents, "title")).toBe("reviewer");
  expect(parseDisplayMode("title")).toBe("title");
  expect(parseDisplayMode("project")).toBe("project");
  expect(parseDisplayMode(undefined)).toBe("auto");
  expect(parseDisplayMode("weird")).toBe("auto");
});
