// src/os/terminal.ts
import { execFile } from "node:child_process";
import os from "node:os";

export type RunFn = (cmd: string, args: string[]) => Promise<string>;

// Absolute path so the call survives Stream Deck's minimal launch PATH (osascript
// is a fixed macOS system binary).
const OSASCRIPT = "/usr/bin/osascript";

// AppleScript application name the host terminal answers to. iTerm2 responds to
// "iTerm". Override via HERDR_DECK_TERMINAL_APP when herdr runs in another
// terminal (e.g. "Terminal", "Ghostty", "WezTerm").
export const DEFAULT_TERMINAL_APP = "iTerm";

// Hyprland (Linux): window class from `hyprctl clients` and optional title
// regex. herdr's default `ui.window_title` template is "{hostname}: {workspace}",
// so the TUI window is the one whose title starts with this machine's hostname.
// Hyprland matches window regexes against the whole title, hence the `.*`.
export const DEFAULT_HYPRLAND_CLASS = "com.mitchellh.ghostty";
export function defaultHyprlandTitle(hostname = os.hostname()): string {
  return `^${hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: .*`;
}

const defaultRun: RunFn = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 4000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args.join(" ")} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });

export type TerminalActivator = { activate(): Promise<void> };

async function activateHyprland(
  run: RunFn,
  opts: { windowClass?: string; windowTitle?: string },
): Promise<void> {
  const windowClass = opts.windowClass ?? process.env.HERDR_DECK_HYPRLAND_CLASS ?? DEFAULT_HYPRLAND_CLASS;
  const windowTitle = (opts.windowTitle ?? process.env.HERDR_DECK_HYPRLAND_TITLE ?? defaultHyprlandTitle()).trim();
  const hyprctl = process.env.HERDR_DECK_HYPRCTL ?? "hyprctl";
  // Hyprland 0.55+ (Lua config): legacy `focuswindow` via hyprctl is rejected; use hl.dsp.focus.
  const selector = windowTitle ? `title:${windowTitle}` : `class:${windowClass}`;
  // Lua double-quoted string: escape backslashes (regex classes like \s) and quotes.
  const luaString = selector.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const lua = `hl.dsp.focus({ window = "${luaString}" })`;
  await run(hyprctl, ["dispatch", lua]);
  await run(hyprctl, ["dispatch", "hl.dsp.window.bring_to_top()"]);
}

// Bring the host terminal app to the foreground. `activate` is idempotent: if the
// app is already frontmost it is a no-op, so this can be called on every focus
// without a separate "is it focused?" check. Focusing a herdr pane only switches
// the pane *inside* herdr; raising the GUI app is what puts it on screen when the
// terminal was in the background.
export function createTerminalActivator(
  opts: { run?: RunFn; app?: string; windowClass?: string; windowTitle?: string } = {},
): TerminalActivator {
  const run = opts.run ?? defaultRun;
  const app = opts.app ?? process.env.HERDR_DECK_TERMINAL_APP ?? DEFAULT_TERMINAL_APP;
  return {
    async activate() {
      if (process.platform === "darwin") {
        await run(OSASCRIPT, ["-e", `tell application "${app}" to activate`]);
        return;
      }
      if (process.platform === "linux") {
        await activateHyprland(run, opts);
        return;
      }
    },
  };
}
