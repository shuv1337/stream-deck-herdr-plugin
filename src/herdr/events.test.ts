import { test, expect } from "bun:test";
import { parseAgentStatusEvent, parseErrorLine, buildSubscribe, samePaneSet, SUBSCRIPTIONS } from "./events";

test("parseAgentStatusEvent extracts the typed payload from a status event line", () => {
  const line = JSON.stringify({
    id: "sd-sub",
    event: "pane_agent_status_changed",
    data: { pane_id: "w1:p2", workspace_id: "w1", agent_status: "blocked", agent: "codex", title: null },
  });
  expect(parseAgentStatusEvent(line)).toEqual({
    paneId: "w1:p2",
    workspaceId: "w1",
    status: "blocked",
    agent: "codex",
  });
});

test("parseAgentStatusEvent ignores acks, other events and garbage", () => {
  expect(parseAgentStatusEvent('{"id":"sd-sub","result":{"type":"ok"}}')).toBeNull();
  expect(parseAgentStatusEvent('{"event":"pane_focused","data":{"pane_id":"w1:p1"}}')).toBeNull();
  expect(parseAgentStatusEvent("not json")).toBeNull();
});

test("buildSubscribe adds a per-pane agent-status subscription for each pane", () => {
  const req = JSON.parse(buildSubscribe(["w1:p1", "w2:p3"]));
  expect(req.method).toBe("events.subscribe");
  const subs = req.params.subscriptions as { type: string; pane_id?: string }[];
  expect(subs.filter((s) => s.type === "pane.agent_status_changed").map((s) => s.pane_id)).toEqual(["w1:p1", "w2:p3"]);
  expect(subs.filter((s) => s.type === "pane.agent_detected")).toHaveLength(1);
  // herdr rejects a bare pane.agent_status_changed (pane_id is required)
  expect(JSON.parse(buildSubscribe([])).params.subscriptions.every((s: { pane_id?: string }) => s.pane_id === undefined)).toBe(true);
});

test("parseErrorLine recognises the server's error envelope only", () => {
  expect(parseErrorLine('{"id":"sd-sub","error":{"code":"pane_not_found","message":"gone"}}')).toBe("pane_not_found: gone");
  expect(parseErrorLine('{"id":"sd-sub","result":{"type":"ok"}}')).toBeNull();
  expect(parseErrorLine("nope")).toBeNull();
});

test("samePaneSet ignores order", () => {
  expect(samePaneSet(["a", "b"], ["b", "a"])).toBe(true);
  expect(samePaneSet(["a"], ["a", "b"])).toBe(false);
  expect(samePaneSet([], [])).toBe(true);
});

test("subscriptions cover pane topology/focus and workspace order", () => {
  expect(SUBSCRIPTIONS).not.toContain("pane.agent_status_changed"); // per pane, see buildSubscribe
  expect(SUBSCRIPTIONS).toContain("pane.agent_detected");
  expect(SUBSCRIPTIONS).toContain("pane.focused");
  expect(SUBSCRIPTIONS).toContain("workspace.reordered");
  expect(SUBSCRIPTIONS).toContain("workspace.renamed");
  // deliberately chatty events stay out
  expect(SUBSCRIPTIONS).not.toContain("pane.updated");
  expect(SUBSCRIPTIONS).not.toContain("pane.output_changed");
});
