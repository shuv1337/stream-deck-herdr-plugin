import type { Agent } from "../src/core/agents";

// Minimal normalized agent for unit tests; override any field via `extra`.
export const mk = (status: Agent["status"], paneId: string, extra: Partial<Agent> = {}): Agent => ({
  kind: "claude",
  displayKind: "claude",
  name: null,
  title: null,
  terminalTitle: "",
  status,
  cwd: "/x/proj",
  foregroundCwd: "/x/proj",
  paneId,
  workspaceId: paneId.split(":")[0] ?? "w1",
  workspaceNumber: 1,
  workspaceLabel: "",
  focused: false,
  launchPending: false,
  stateLabels: {},
  ...extra,
});
