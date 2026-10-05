// src/actions/slot.ts
import streamDeck, {
  action,
  SingletonAction,
  type WillAppearEvent,
  type WillDisappearEvent,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  type KeyUpEvent,
  type KeyAction,
  type DialAction,
} from "@elgato/streamdeck";
import type { AgentStore } from "../core/store";
import type { HerdrClient } from "../herdr/client";
import type { TerminalActivator } from "../os/terminal";
import { pageSlice, PAGE_SIZE } from "../core/pagination";
import { labelFor, parseDisplayMode, type DisplayMode } from "../core/agents";
import { renderKeySvg } from "../core/render";
import { assignSlots, pageSizeFor, parseSlotSetting, type SlotKey } from "../core/slots";
import { focusAgent } from "./focus";

type SlotSettings = { slotIndex?: number | string; display?: DisplayMode };

// Press-length threshold: below this a key press focuses the agent, at/above it
// the press toggles a pin.
const LONG_PRESS_MS = 400;

@action({ UUID: "dev.timvdhoorn.herdr-agents.slot" })
export class AgentSlotAction extends SingletonAction<SlotSettings> {
  readonly #keys = new Map<string, SlotKey>(); // action instance id -> placement
  readonly #displays = new Map<string, DisplayMode>(); // action instance id -> label source
  #assigned = new Map<string, number>(); // action instance id -> slot index
  readonly #pressStart = new Map<string, number>(); // action instance id -> keydown timestamp

  constructor(
    private readonly store: AgentStore,
    private readonly herdr: HerdrClient,
    private readonly terminal: TerminalActivator,
  ) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent<SlotSettings>): void {
    this.#track(ev.action, ev.payload.settings);
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<SlotSettings>): void {
    this.#track(ev.action, ev.payload.settings);
  }

  override onWillDisappear(ev: WillDisappearEvent<SlotSettings>): void {
    this.#keys.delete(ev.action.id);
    this.#displays.delete(ev.action.id);
    this.#reassign();
  }

  override onKeyDown(ev: KeyDownEvent<SlotSettings>): void {
    this.#pressStart.set(ev.action.id, Date.now());
  }

  override onKeyUp(ev: KeyUpEvent<SlotSettings>): void {
    const start = this.#pressStart.get(ev.action.id);
    this.#pressStart.delete(ev.action.id);
    const agent = this.#agentAt(ev.action.id);
    if (!agent) return;
    const longPress = start !== undefined && Date.now() - start >= LONG_PRESS_MS;
    if (longPress) {
      // Long-press pins: the agent jumps to slot 1 (next pin beside it) and
      // stays visible even when idle. The store emit re-renders all keys.
      this.store.togglePin(agent.paneId);
    } else {
      void focusAgent(this.herdr, this.terminal, agent.paneId);
    }
  }

  // Flash the key currently showing this agent, if it is on the visible page.
  flash(paneId: string): void {
    this.actions.forEach((a) => {
      if (a.isKey() && this.#agentAt(a.id)?.paneId === paneId) void a.showAlert();
    });
  }

  renderAll(): void {
    const { agents, page, pageSize } = this.store.getState();
    const visible = pageSlice(agents, page, pageSize);
    this.actions.forEach((a) => {
      if (!a.isKey()) return;
      const index = this.#assigned.get(a.id);
      const agent = index === undefined ? undefined : visible[index];
      void a.setTitle("");
      void a.setImage(
        renderKeySvg(
          agent
            ? {
                label: labelFor(agent, agents, this.#displays.get(a.id) ?? "auto"),
                status: agent.status,
                agent: agent.kind,
                pinned: this.store.isPinned(agent.paneId),
                focused: agent.focused,
                workspaceNumber:
                  agent.workspaceNumber === Number.MAX_SAFE_INTEGER ? undefined : agent.workspaceNumber,
                launchPending: agent.launchPending,
              }
            : null,
        ),
      );
    });
  }

  #agentAt(actionId: string) {
    const index = this.#assigned.get(actionId);
    if (index === undefined) return undefined;
    const { agents, page, pageSize } = this.store.getState();
    return pageSlice(agents, page, pageSize)[index];
  }

  #track(key: KeyAction<SlotSettings> | DialAction<SlotSettings>, settings: SlotSettings): void {
    const coords = key.isKey() ? key.coordinates : undefined;
    this.#displays.set(key.id, parseDisplayMode(settings.display));
    this.#keys.set(key.id, {
      id: key.id,
      device: key.device.id,
      row: coords?.row ?? 0,
      column: coords?.column ?? 0,
      explicit: parseSlotSetting(settings.slotIndex),
    });
    this.#reassign();
  }

  // Recompute slot numbering + page size from the keys on the deck. Setting the
  // page size emits from the store (which re-renders); otherwise render here.
  #reassign(): void {
    this.#assigned = assignSlots([...this.#keys.values()]);
    const before = this.store.getState().pageSize;
    streamDeck.logger.debug(
      `slots: ${[...this.#keys.values()]
        .map((k) => `${k.id}@${k.row},${k.column}${k.explicit !== null ? `=${k.explicit}` : ""}→${this.#assigned.get(k.id)}`)
        .join(" ")}`,
    );
    this.store.setPageSize(pageSizeFor(this.#assigned, PAGE_SIZE));
    if (this.store.getState().pageSize === before) this.renderAll();
  }
}
