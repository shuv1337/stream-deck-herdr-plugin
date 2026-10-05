#!/usr/bin/env bun
// Generate an OpenDeck profile that lays the herdr plugin out across a whole
// deck. Default layout (Stream Deck XL, 8×4):
//
//   rows 1–3  : 24 Agent Slot keys (auto-numbered in reading order)
//   row 4     : [Summary][Prev][Next][Attention][Toggle idle][enter][esc][ctrl+c]
//
// Usage:
//   bun scripts/opendeck-profile.ts --device sd-XXXX [--profile herdr] [--columns 8 --rows 4] [--write]
//
// Without --write the JSON is printed to stdout. With --write it is saved to
// ~/.config/opendeck/profiles/<device>/<profile>.json (backing up any existing
// file) and selected in <device>.json. Restart OpenDeck afterwards; it keeps
// profiles in memory and only re-reads them at startup.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PLUGIN_ID = "dev.timvdhoorn.herdr-agents.sdPlugin";
const PREFIX = "dev.timvdhoorn.herdr-agents";

type Args = { device?: string; profile: string; columns: number; rows: number; write: boolean; configHome: string };

function parseArgs(argv: string[]): Args {
  const args: Args = {
    profile: "herdr",
    columns: 8,
    rows: 4,
    write: false,
    configHome: process.env.XDG_CONFIG_HOME?.trim() || path.join(os.homedir(), ".config"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--device") args.device = next();
    else if (a === "--profile") args.profile = next();
    else if (a === "--columns") args.columns = Number(next());
    else if (a === "--rows") args.rows = Number(next());
    else if (a === "--write") args.write = true;
    else if (a === "--config-home") args.configHome = next();
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

type ManifestAction = {
  Name: string;
  UUID: string;
  Icon: string;
  Tooltip?: string;
  PropertyInspectorPath?: string;
  Controllers?: string[];
  States: { Image: string; TitleAlignment?: string }[];
};

function loadManifest(): { Actions: ManifestAction[] } {
  const here = path.dirname(new URL(import.meta.url).pathname);
  const file = path.join(here, "..", PLUGIN_ID, "manifest.json");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// OpenDeck denormalises the action definition into every key of a profile.
function actionRecord(m: ManifestAction) {
  const states = m.States.map((s) => ({
    alignment: s.TitleAlignment ?? "middle",
    background_colour: "#000000",
    colour: "#FFFFFF",
    family: "Liberation Sans",
    image: `plugins/${PLUGIN_ID}/${s.Image}@2x.png`,
    image_scale: 100,
    name: "",
    show: true,
    size: 16,
    stroke_colour: "#000000",
    stroke_size: 3,
    style: "Regular",
    text: "",
    underline: false,
  }));
  return {
    action: {
      controllers: m.Controllers ?? ["Keypad"],
      disable_automatic_states: false,
      encoder: null,
      icon: `plugins/${PLUGIN_ID}/${m.Icon}@2x.png`,
      name: m.Name,
      plugin: PLUGIN_ID,
      property_inspector: m.PropertyInspectorPath ? `plugins/${PLUGIN_ID}/${m.PropertyInspectorPath}` : "",
      states,
      supported_in_multi_actions: true,
      tooltip: m.Tooltip ?? "",
      uuid: m.UUID,
      visible_in_action_list: true,
    },
    states,
  };
}

type Placement = { uuid: string; settings: Record<string, unknown> };

// The control strip, left to right. Trimmed when the deck is narrower.
function controlRow(): Placement[] {
  return [
    { uuid: `${PREFIX}.summary`, settings: {} },
    { uuid: `${PREFIX}.pager`, settings: { mode: "prev" } },
    { uuid: `${PREFIX}.pager`, settings: { mode: "next" } },
    { uuid: `${PREFIX}.pager`, settings: { mode: "attention" } },
    { uuid: `${PREFIX}.toggle-idle`, settings: {} },
    { uuid: `${PREFIX}.input`, settings: { mode: "keys", keys: "enter", label: "enter" } },
    { uuid: `${PREFIX}.input`, settings: { mode: "keys", keys: "esc", label: "esc" } },
    { uuid: `${PREFIX}.input`, settings: { mode: "keys", keys: "ctrl+c", label: "ctrl+c" } },
  ];
}

export function layout(columns: number, rows: number): (Placement | null)[] {
  const keys: (Placement | null)[] = [];
  const slotRows = Math.max(1, rows - 1);
  for (let i = 0; i < slotRows * columns; i++) keys.push({ uuid: `${PREFIX}.slot`, settings: {} });
  const controls = controlRow();
  // On a 6-key Mini (3×2) keep the morphing pager only, like the original layout.
  const strip =
    columns < 4
      ? [controls[0], { uuid: `${PREFIX}.pager`, settings: {} }, controls[5]].slice(0, columns)
      : controls.slice(0, columns);
  for (let c = 0; c < columns; c++) keys.push(strip[c] ?? null);
  return keys;
}

export function buildProfile(columns: number, rows: number) {
  const manifest = loadManifest();
  const byUuid = new Map(manifest.Actions.map((a) => [a.UUID, actionRecord(a)]));
  const keys = layout(columns, rows).map((p, index) => {
    if (!p) return null;
    const record = byUuid.get(p.uuid);
    if (!record) throw new Error(`manifest has no action ${p.uuid}`);
    return {
      action: record.action,
      children: null,
      context: `Keypad.${index}.0`,
      current_state: 0,
      settings: p.settings,
      states: record.states,
    };
  });
  return { infobars: [], keys, sliders: [] };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const profile = buildProfile(args.columns, args.rows);
  if (!args.write) {
    process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
    return;
  }
  if (!args.device) throw new Error("--write needs --device <id> (see ~/.config/opendeck/profiles/)");
  const dir = path.join(args.configHome, "opendeck", "profiles", args.device);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${args.profile}.json`);
  if (fs.existsSync(file)) {
    const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.copyFileSync(file, backup);
    process.stderr.write(`backed up ${file} → ${backup}\n`);
  }
  fs.writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`);
  const selector = path.join(args.configHome, "opendeck", "profiles", `${args.device}.json`);
  fs.writeFileSync(selector, `${JSON.stringify({ selected_profile: args.profile }, null, 2)}\n`);
  process.stderr.write(`wrote ${file} (${args.columns}×${args.rows}); selected profile "${args.profile}". Restart OpenDeck.\n`);
}

if (import.meta.main) main();
