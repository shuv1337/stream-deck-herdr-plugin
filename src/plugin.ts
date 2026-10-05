// src/plugin.ts
import streamDeck from "@elgato/streamdeck";
import { createHerdrClient } from "./herdr/client";
import { createTerminalActivator } from "./os/terminal";
import { createAgentStore } from "./core/store";
import { AgentSlotAction } from "./actions/slot";
import { PagerAction } from "./actions/pager";
import { SummaryAction } from "./actions/summary";
import { ToggleIdleAction } from "./actions/toggle-idle";
import { AgentInputAction } from "./actions/input";
import { createHerdrEvents } from "./herdr/events";
import { herdrSocketPath } from "./herdr/socket";
import { detectFlips } from "./core/transitions";
import { labelFor } from "./core/agents";
import type { Agent } from "./core/agents";

streamDeck.logger.setLevel(process.env.HERDR_DECK_LOG?.trim() === "debug" ? "debug" : "info");

const herdr = createHerdrClient();
// undefined app → default (iTerm); set HERDR_DECK_TERMINAL_APP to override.
const terminal = createTerminalActivator({ app: process.env.HERDR_DECK_TERMINAL_APP });
// One `session.snapshot` per refresh: agents + workspace order/labels together.
const store = createAgentStore({ fetch: () => herdr.snapshot() });

const slot = new AgentSlotAction(store, herdr, terminal);
const pager = new PagerAction(store, herdr, terminal);
const summary = new SummaryAction(store, herdr, terminal);
const toggleIdle = new ToggleIdleAction(store);
const input = new AgentInputAction(store, herdr);

// Debounce refreshes so a burst of socket events causes at most one poll.
let pending: ReturnType<typeof setTimeout> | null = null;
const refresh = (): void => {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    void store.pollNow();
  }, 150);
};

const events = createHerdrEvents({
  onChange: refresh,
  paneIds: () => store.getState().all.map((a) => a.paneId),
  onConnection: (connected) => {
    streamDeck.logger.info(`herdr event stream ${connected ? "connected" : "disconnected"} (${herdrSocketPath()})`);
    if (connected) refresh();
  },
  onError: (message) => streamDeck.logger.warn(`herdr event stream: ${message}`),
});

let prevAgents: Agent[] | null = null;

store.subscribe((s) => {
  // herdr streams agent status per pane, so the event subscription has to
  // follow the live pane set.
  events.resubscribe();

  slot.renderAll();
  pager.renderAll();
  summary.renderAll();
  toggleIdle.renderAll();
  input.renderAll();

  if (prevAgents === null) { prevAgents = s.all; return; } // prime, no alert on first snapshot
  const flips = detectFlips(prevAgents, s.all);
  prevAgents = s.all;
  for (const a of flips) {
    const sound = a.status === "blocked" ? "request" : "done";
    void herdr.notify(`${labelFor(a, s.all)} ${a.status}`, { body: a.title ?? a.displayKind, sound });
    slot.flash(a.paneId);
  }
});

streamDeck.actions.registerAction(slot);
streamDeck.actions.registerAction(pager);
streamDeck.actions.registerAction(summary);
streamDeck.actions.registerAction(toggleIdle);
streamDeck.actions.registerAction(input);

streamDeck.connect();
void herdr
  .ping()
  .then((info) => streamDeck.logger.info(`herdr ${info.version} (protocol ${info.protocol})`))
  .catch((e) => streamDeck.logger.warn(`herdr unreachable at startup: ${String(e)}`));
store.start(5000); // safety net; socket events drive the fast path
events.start();
