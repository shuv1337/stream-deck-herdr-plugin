// src/actions/pager.ts
import {
  action,
  SingletonAction,
  type WillAppearEvent,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
} from "@elgato/streamdeck";
import type { AgentStore } from "../core/store";
import type { HerdrClient } from "../herdr/client";
import type { TerminalActivator } from "../os/terminal";
import {
  pageCount,
  attentionAgents,
  worstAttention,
  offPageWorstAttention,
  offPageAttentionCount,
} from "../core/pagination";
import { renderPagerSvg, renderNavSvg, renderAttentionSvg } from "../core/render";
import { focusAgent } from "./focus";

// `auto` is the original morphing key: when any agent is blocked or done it
// acts as "jump to the next agent needing attention" (focus + cycle on repeat
// presses); otherwise it pages through the agent grid. One key covers both
// jobs on a 6-key Mini. Larger decks can split the jobs across dedicated
// `next` / `prev` / `attention` keys instead.
export type PagerMode = "auto" | "next" | "prev" | "attention";

type PagerSettings = { mode?: PagerMode };

export function parseMode(value: unknown): PagerMode {
  return value === "next" || value === "prev" || value === "attention" ? value : "auto";
}

@action({ UUID: "dev.timvdhoorn.herdr-agents.pager" })
export class PagerAction extends SingletonAction<PagerSettings> {
  readonly #modes = new Map<string, PagerMode>(); // action instance id -> mode
  // paneId we last jumped to, so repeated presses cycle through attention agents.
  #cursor: string | null = null;

  constructor(
    private readonly store: AgentStore,
    private readonly herdr: HerdrClient,
    private readonly terminal: TerminalActivator,
  ) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent<PagerSettings>): void {
    this.#modes.set(ev.action.id, parseMode(ev.payload.settings.mode));
    this.renderAll();
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<PagerSettings>): void {
    this.#modes.set(ev.action.id, parseMode(ev.payload.settings.mode));
    this.renderAll();
  }

  override async onKeyDown(ev: KeyDownEvent<PagerSettings>): Promise<void> {
    const mode = this.#modes.get(ev.action.id) ?? parseMode(ev.payload.settings.mode);
    const attention = attentionAgents(this.store.getState().agents);
    switch (mode) {
      case "next":
        this.store.nextPage();
        return;
      case "prev":
        this.store.prevPage();
        return;
      case "attention":
        if (attention.length === 0) {
          void ev.action.showAlert();
          return;
        }
        await this.#jump(attention);
        return;
      default:
        if (attention.length === 0) this.store.nextPage();
        else await this.#jump(attention);
    }
  }

  async #jump(list: { paneId: string }[]): Promise<void> {
    const at = list.findIndex((a) => a.paneId === this.#cursor);
    const next = list[(at + 1) % list.length]; // at === -1 → starts at 0
    this.#cursor = next.paneId;
    // Page the grid to the agent too so the deck and the terminal agree.
    this.store.revealAgent(next.paneId);
    await focusAgent(this.herdr, this.terminal, next.paneId);
  }

  renderAll(): void {
    const { agents, page, pageSize } = this.store.getState();
    const attention = attentionAgents(agents);
    const total = pageCount(agents.length, pageSize);
    const attentionSvg = renderAttentionSvg({ count: attention.length, attention: worstAttention(agents) });
    const nav = (direction: "prev" | "next") =>
      renderNavSvg({
        direction,
        page,
        total,
        attention: offPageWorstAttention(agents, page, pageSize),
        count: offPageAttentionCount(agents, page, pageSize),
      });
    this.actions.forEach((a) => {
      if (!a.isKey()) return;
      const mode = this.#modes.get(a.id) ?? "auto";
      const svg =
        mode === "attention"
          ? attentionSvg
          : mode === "prev"
            ? nav("prev")
            : mode === "next"
              ? nav("next")
              : attention.length > 0
                ? attentionSvg
                : renderPagerSvg({ page, total, attention: null, count: 0 });
      void a.setImage(svg);
    });
  }
}
