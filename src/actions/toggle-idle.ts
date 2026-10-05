// src/actions/toggle-idle.ts
import { action, SingletonAction, type WillAppearEvent, type KeyDownEvent } from "@elgato/streamdeck";
import type { AgentStore } from "../core/store";
import { renderToggleIdleSvg } from "../core/render";

// Idle agents are hidden by default so a small deck only shows what matters.
// With 32 keys there is room to see everything; this key flips that.
@action({ UUID: "dev.timvdhoorn.herdr-agents.toggle-idle" })
export class ToggleIdleAction extends SingletonAction {
  constructor(private readonly store: AgentStore) {
    super();
  }

  override onWillAppear(_ev: WillAppearEvent): void {
    this.renderAll();
  }

  override onKeyDown(_ev: KeyDownEvent): void {
    this.store.toggleShowIdle();
  }

  renderAll(): void {
    const svg = renderToggleIdleSvg({
      showIdle: this.store.getState().showIdle,
      idleCount: this.store.counts().idle,
    });
    this.actions.forEach((a) => {
      if (a.isKey()) void a.setImage(svg);
    });
  }
}
