// src/actions/input.ts
import streamDeck, {
  action,
  SingletonAction,
  type WillAppearEvent,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
} from "@elgato/streamdeck";
import type { AgentStore } from "../core/store";
import type { HerdrClient } from "../herdr/client";
import { renderInputKeySvg } from "../core/render";

export type InputMode = "keys" | "prompt";

export type InputSettings = {
  mode?: InputMode;
  /** Logical keys, whitespace/comma separated: `enter`, `esc`, `y`, `ctrl+c`, `1`. */
  keys?: string;
  /** Prompt text submitted with `agent.prompt` (text + Enter as one submission). */
  text?: string;
  /** Key caption; defaults to the keys / first word of the prompt. */
  label?: string;
};

export type ResolvedInput =
  | { mode: "keys"; keys: string[]; label: string }
  | { mode: "prompt"; text: string; label: string };

// Pure: normalise Property Inspector settings into something sendable.
export function resolveInput(settings: InputSettings): ResolvedInput {
  const label = settings.label?.trim() ?? "";
  if (settings.mode === "prompt") {
    const text = settings.text?.trim() ?? "";
    return { mode: "prompt", text, label: label || text.split(/\s+/)[0] || "prompt" };
  }
  const keys = (settings.keys ?? "enter")
    .split(/[\s,]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  return { mode: "keys", keys, label: label || keys.join(" ") || "enter" };
}

// Sends input to the agent herdr currently has focused: logical keys via
// `agent.send_keys` (answer an approval, Esc out of a dialog, Ctrl+C) or a
// canned prompt via `agent.prompt`. The key is tinted with that agent's status
// so red means "there is a dialog waiting for this".
@action({ UUID: "dev.timvdhoorn.herdr-agents.input" })
export class AgentInputAction extends SingletonAction<InputSettings> {
  readonly #inputs = new Map<string, ResolvedInput>(); // action instance id -> resolved settings

  constructor(
    private readonly store: AgentStore,
    private readonly herdr: HerdrClient,
  ) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent<InputSettings>): void {
    this.#inputs.set(ev.action.id, resolveInput(ev.payload.settings));
    this.renderAll();
  }

  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<InputSettings>): void {
    this.#inputs.set(ev.action.id, resolveInput(ev.payload.settings));
    this.renderAll();
  }

  override async onKeyDown(ev: KeyDownEvent<InputSettings>): Promise<void> {
    const input = this.#inputs.get(ev.action.id) ?? resolveInput(ev.payload.settings);
    const target = this.store.focusedAgent();
    if (!target) {
      void ev.action.showAlert();
      return;
    }
    try {
      if (input.mode === "keys") {
        if (input.keys.length === 0) throw new Error("no keys configured");
        await this.herdr.sendKeys(target.paneId, input.keys);
      } else {
        if (!input.text) throw new Error("no prompt text configured");
        await this.herdr.prompt(target.paneId, input.text);
      }
      void ev.action.showOk();
      void this.store.pollNow();
    } catch (e) {
      // herdr refuses e.g. `agent.prompt` on a blocked agent (agent_blocked)
      // and malformed key names before writing any bytes.
      streamDeck.logger.error(`agent input to ${target.paneId} failed: ${String(e)}`);
      void ev.action.showAlert();
    }
  }

  renderAll(): void {
    const focused = this.store.focusedAgent();
    this.actions.forEach((a) => {
      if (!a.isKey()) return;
      const input = this.#inputs.get(a.id) ?? { mode: "keys", keys: ["enter"], label: "enter" };
      void a.setImage(
        renderInputKeySvg({
          label: input.label,
          hint: focused ? (focused.name ?? focused.kind) : "no focus",
          status: focused ? focused.status : null,
        }),
      );
    });
  }
}
