import { test, expect, afterEach } from "bun:test";
import { createTerminalActivator, DEFAULT_TERMINAL_APP, defaultHyprlandTitle, type RunFn } from "./terminal";

const origPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, "platform", { value: origPlatform });
});

test("activate runs osascript to activate the configured app on darwin", async () => {
  Object.defineProperty(process, "platform", { value: "darwin" });
  const calls: string[][] = [];
  const run: RunFn = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return "";
  };
  await createTerminalActivator({ run, app: "Ghostty" }).activate();
  expect(calls[0]).toEqual(["/usr/bin/osascript", "-e", 'tell application "Ghostty" to activate']);
});

test("defaults to iTerm on darwin", async () => {
  Object.defineProperty(process, "platform", { value: "darwin" });
  const calls: string[][] = [];
  const run: RunFn = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return "";
  };
  await createTerminalActivator({ run }).activate();
  expect(calls[0][2]).toBe(`tell application "${DEFAULT_TERMINAL_APP}" to activate`);
  expect(DEFAULT_TERMINAL_APP).toBe("iTerm");
});

test("activate focuses herdr Ghostty window on linux via hyprctl", async () => {
  Object.defineProperty(process, "platform", { value: "linux" });
  const calls: string[][] = [];
  const run: RunFn = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return "";
  };
  await createTerminalActivator({ run, windowTitle: "herdr" }).activate();
  expect(calls).toEqual([
    ["hyprctl", "dispatch", 'hl.dsp.focus({ window = "title:herdr" })'],
    ["hyprctl", "dispatch", "hl.dsp.window.bring_to_top()"],
  ]);
});

test("defaults the hyprland title filter to herdr's '{hostname}: ' window title", async () => {
  Object.defineProperty(process, "platform", { value: "linux" });
  expect(defaultHyprlandTitle("shuvdev")).toBe("^shuvdev: .*");
  expect(defaultHyprlandTitle("a.b")).toBe("^a\\.b: .*");
  const calls: string[][] = [];
  const run: RunFn = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return "";
  };
  const prev = process.env.HERDR_DECK_HYPRLAND_TITLE;
  delete process.env.HERDR_DECK_HYPRLAND_TITLE;
  await createTerminalActivator({ run }).activate();
  if (prev !== undefined) process.env.HERDR_DECK_HYPRLAND_TITLE = prev;
  expect(calls[0][2]).toContain(`title:${defaultHyprlandTitle()}`);
});

test("an empty title filter falls back to matching the window class", async () => {
  Object.defineProperty(process, "platform", { value: "linux" });
  const calls: string[][] = [];
  const run: RunFn = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return "";
  };
  await createTerminalActivator({ run, windowTitle: "", windowClass: "foot" }).activate();
  expect(calls[0][2]).toBe('hl.dsp.focus({ window = "class:foot" })');
});

test("hyprland selector escapes Lua backslashes and quotes", async () => {
  Object.defineProperty(process, "platform", { value: "linux" });
  const calls: string[][] = [];
  const run: RunFn = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return "";
  };
  await createTerminalActivator({ run, windowTitle: 'x\\s"y' }).activate();
  expect(calls[0][2]).toBe('hl.dsp.focus({ window = "title:x\\\\s\\"y" })');
});
