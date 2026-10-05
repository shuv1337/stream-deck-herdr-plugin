// src/actions/summary.ts
import { action, SingletonAction, type WillAppearEvent, type KeyDownEvent } from "@elgato/streamdeck";
import type { AgentStore } from "../core/store";
import type { HerdrClient } from "../herdr/client";
import type { TerminalActivator } from "../os/terminal";
import { renderSummarySvg } from "../core/render";
import { focusAgent } from "./focus";

// Dashboard key: live counts of working / blocked / done / idle across every
// agent (not just the visible page). Press raises the terminal on whatever
// herdr currently has focused and forces a refresh.
@action({ UUID: "dev.timvdhoorn.herdr-agents.summary" })
export class SummaryAction extends SingletonAction {
  constructor(
    private readonly store: AgentStore,
    private readonly herdr: HerdrClient,
    private readonly terminal: TerminalActivator,
  ) {
    super();
  }

  override onWillAppear(_ev: WillAppearEvent): void {
    this.renderAll();
  }

  override async onKeyDown(_ev: KeyDownEvent): Promise<void> {
    void this.store.pollNow();
    const focused = this.store.focusedAgent();
    if (focused) {
      await focusAgent(this.herdr, this.terminal, focused.paneId);
      return;
    }
    try {
      await this.terminal.activate();
    } catch {
      // Nothing to raise; the key still refreshed.
    }
  }

  renderAll(): void {
    const counts = this.store.counts();
    const svg = renderSummarySvg({
      working: counts.working,
      blocked: counts.blocked,
      done: counts.done,
      idle: counts.idle,
      connected: this.store.getState().connected,
    });
    this.actions.forEach((a) => {
      if (a.isKey()) void a.setImage(svg);
    });
  }
}
