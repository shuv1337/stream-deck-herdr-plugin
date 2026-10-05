// src/core/render.ts
import { presentation, type AgentStatus } from "./status";
import { AGENT_ICON } from "./agent-icons";

/** Key label typography — override at runtime: HERDR_DECK_FONT_FAMILY */
const FONT_FAMILY =
  process.env.HERDR_DECK_FONT_FAMILY?.trim() ||
  "JetBrains Mono, JetBrainsMono Nerd Font, monospace";

// Single-quoted SVG attribute — a double-quoted stack like `"Foo", bar` breaks font-family="...".
const FONT_FAMILY_ATTR = `font-family='${FONT_FAMILY.replace(/'/g, "&apos;")}'`;

const LABEL_SIZE = Number(process.env.HERDR_DECK_LABEL_SIZE) || 30;
const LABEL_WEIGHT = process.env.HERDR_DECK_LABEL_WEIGHT?.trim() || "bold";
const LABEL_COLS = Number(process.env.HERDR_DECK_LABEL_COLS) || 6;
const LABEL_MAX_LINES = Number(process.env.HERDR_DECK_LABEL_LINES) || 3;
const LABEL_STROKE = process.env.HERDR_DECK_LABEL_STROKE?.trim() || "#000000";
const LABEL_STROKE_WIDTH = Number(process.env.HERDR_DECK_LABEL_STROKE_WIDTH) || 3;
const LABEL_STROKE_OPACITY = Number(process.env.HERDR_DECK_LABEL_STROKE_OPACITY) || 0.72;

export type KeyView = {
  label: string;
  status: AgentStatus;
  agent: string;
  pinned: boolean;
  /** This agent's pane is the herdr-focused pane: drawn with a white ring. */
  focused?: boolean;
  /** 1-based workspace number; drawn as a small tag so keys map to the sidebar. */
  workspaceNumber?: number;
  /** `agent start` in flight: dims the key until herdr detects the agent. */
  launchPending?: boolean;
} | null;

type Attention = "blocked" | "done" | null;

type PagerView = {
  page: number;
  total: number;
  attention: Attention;
  count: number;
};

const CANVAS = 144;
const RADIUS = 16;
const BG_CONTROL = "#111827";
const BG_OFF = "#0a0a0a";
const FG_DIM = "#444444";
const FG_MUTED = "#9ca3af";

function svg(body: string): string {
  return toDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}">${body}</svg>`,
  );
}

function bgRect(fill: string): string {
  return `<rect width="${CANVAS}" height="${CANVAS}" rx="${RADIUS}" fill="${fill}"/>`;
}

function centered(text: string, y: number, size: number, fill: string, extra = ""): string {
  return (
    `<text x="72" y="${y}" ${FONT_FAMILY_ATTR} font-size="${size}" fill="${fill}" ` +
    `text-anchor="middle"${extra}>${text}</text>`
  );
}

// Base64 rather than percent-encoding: OpenDeck stores the payload of a
// `data:image/svg+xml,…` URI verbatim without decoding it, which renders as a
// black key; the base64 form is decoded correctly by both Stream Deck and OpenDeck.
function toDataUri(markup: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(markup, "utf8").toString("base64")}`;
}

function escapeXml(value: string): string {
  const map: Record<string, string> = {
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '"': "&quot;",
  };
  return value.replace(/[<>&'"]/g, (c) => map[c] ?? c);
}

// Wrap a label into up to maxLines lines of about perLine chars, breaking at
// separators (-, _, ., space) when one is near, and letting a single short
// word run slightly long rather than orphaning its tail ("shuvbro", not
// "shuvbr"/"o"). The caller shrinks the font for over-long lines. The last
// line is ellipsised if the text still overflows.
export function wrapLabel(label: string, perLine: number, maxLines: number): string[] {
  const slack = 2; // chars a line may exceed perLine by, if it avoids a bad break
  const lines: string[] = [];
  let rest = label;
  while (rest.length > perLine && lines.length < maxLines - 1) {
    const window = rest.slice(0, perLine + slack + 1);
    // Prefer breaking right after the last separator within the window…
    const sep = Math.max(...[...window.matchAll(/[-_. ]/g)].map((m) => m.index! + 1), -1);
    let cut: number;
    if (sep >= Math.ceil(perLine / 2) && sep <= perLine + slack) cut = sep;
    // …otherwise keep a short word whole, else hard-slice.
    else if (rest.length <= perLine + slack) cut = rest.length;
    else cut = perLine;
    lines.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut);
  }
  if (rest.length > perLine + slack) {
    rest = `${rest.slice(0, perLine + slack - 1)}…`;
  }
  if (rest.length > 0) lines.push(rest);
  return lines;
}

// Font size that lets the longest line fit the width `perLine` chars would.
function fitLabelSize(lines: string[], perLine: number, base: number): number {
  const longest = Math.max(...lines.map((l) => l.length), 1);
  return longest <= perLine ? base : Math.floor((base * perLine) / longest);
}

// Short 2-letter code per known herdr agent integration; falls back to the
// first two letters of any other agent name.
const AGENT_CODE: Record<string, string> = {
  claude: "CL", codex: "CX", copilot: "CP", cursor: "CU", devin: "DV",
  droid: "DR", kimi: "KM", opencode: "OC", kilo: "KL", hermes: "HM",
  qodercli: "QC", pi: "PI", omp: "OM", shuvcode: "SC",
};

// Forks / renames that share a logo with a known integration.
const AGENT_ICON_ALIAS: Record<string, string> = { shuvcode: "opencode" };

function agentCode(name: string): string {
  const key = name.toLowerCase();
  return AGENT_CODE[key] ?? name.slice(0, 2).toUpperCase();
}

// Agent-type badge in the top-left corner: a monochrome white brand logo when
// one exists (Lobehub Icons), otherwise the 2-letter text code. Sits clear of
// the top-center status glyph.
const BADGE_X = 8;
const BADGE_Y = 8;
const BADGE_SIZE = 30;

function agentBadge(name: string): string {
  const key = name.toLowerCase();
  const icon = AGENT_ICON[AGENT_ICON_ALIAS[key] ?? key];
  if (icon) {
    const [minX, minY, w, h] = icon.vb.split(/\s+/).map(Number);
    const scale = BADGE_SIZE / Math.max(w, h);
    const transform = `translate(${BADGE_X} ${BADGE_Y}) scale(${scale}) translate(${-minX} ${-minY})`;
    return (
      `<g transform="${transform}" fill="#ffffff" fill-opacity="0.85" fill-rule="evenodd">` +
      icon.body +
      `</g>`
    );
  }
  return (
    `<text x="10" y="28" ${FONT_FAMILY_ATTR} font-size="18" font-weight="bold" ` +
    `fill="#ffffff" fill-opacity="0.75" text-anchor="start">${escapeXml(agentCode(name))}</text>`
  );
}

export function renderKeySvg(view: KeyView): string {
  if (!view) {
    // Empty slot: fully black ("screen off"), no marker.
    return svg(bgRect("#000"));
  }
  const { color, glyph } = presentation(view.status);
  const lines = wrapLabel(view.label, LABEL_COLS, LABEL_MAX_LINES);
  let labelSize = fitLabelSize(lines, LABEL_COLS, LABEL_SIZE);
  let lineStep = labelSize + 4;
  // Keep the whole block between the badge row and the bottom edge; three
  // lines at full size would otherwise run off the key.
  const maxBlock = 88;
  if (lines.length * lineStep > maxBlock) {
    lineStep = Math.floor(maxBlock / lines.length);
    labelSize = lineStep - 4;
  }
  const lastY = lines.length >= 3 ? 136 : 108 + (lines.length - 1) * (lineStep / 2);
  const firstY = lastY - (lines.length - 1) * lineStep;
  const labelSvg = lines
    .map((line, i) => {
      const y = firstY + i * lineStep;
      return (
        `<text x="72" y="${y}" ${FONT_FAMILY_ATTR} font-size="${labelSize}" font-weight="${LABEL_WEIGHT}" ` +
        `fill="#fff" stroke="${LABEL_STROKE}" stroke-opacity="${LABEL_STROKE_OPACITY}" stroke-width="${LABEL_STROKE_WIDTH}" ` +
        `stroke-linejoin="round" paint-order="stroke fill" text-anchor="middle">` +
        `${escapeXml(line)}</text>`
      );
    })
    .join("");
  const badge = agentBadge(view.agent);
  // Pushpin marker (round head + needle) in the top-right corner when pinned.
  const pin = view.pinned
    ? `<g fill="#ffffff" fill-opacity="0.92">` +
      `<circle cx="126" cy="15" r="7"/>` +
      `<path d="M126 20 L122 23 L126 33 L130 23 Z"/>` +
      `</g>`
    : "";
  // White inset ring marks the pane herdr currently has focused.
  const ring = view.focused
    ? `<rect x="3" y="3" width="138" height="138" rx="14" fill="none" stroke="#ffffff" stroke-opacity="0.95" stroke-width="5"/>`
    : "";
  // Workspace number tag (top-right, under the pin) ties the key to the sidebar.
  const tag =
    view.workspaceNumber !== undefined && Number.isFinite(view.workspaceNumber)
      ? `<text x="${view.pinned ? 110 : 134}" y="30" ${FONT_FAMILY_ATTR} font-size="18" font-weight="bold" ` +
        `fill="#ffffff" fill-opacity="0.75" text-anchor="end">${view.workspaceNumber}</text>`
      : "";
  // Launch pending: wash the key out until herdr detects the agent.
  const pending = view.launchPending
    ? `<rect width="144" height="144" rx="16" fill="#000" fill-opacity="0.45"/>` +
      centered("…", 84, 48, "#ffffff")
    : "";
  return svg(
    bgRect(color) +
      centered(glyph, 34, 24, "#fff") +
      badge +
      pin +
      tag +
      labelSvg +
      pending +
      ring,
  );
}

export function renderAttentionSvg(opts: { count: number; attention: Attention }): string {
  const active = opts.count > 0 && opts.attention !== null;
  const bg = active ? presentation(opts.attention as "blocked" | "done").color : BG_OFF;
  const fg = active ? "#ffffff" : FG_DIM;
  return svg(bgRect(bg) + centered("⇥", 74, 52, fg) + centered(String(opts.count), 116, 22, fg));
}

// Directional page key (Prev/Next). Dim when there is a single page; carries
// the off-page attention badge like the morphing pager.
export function renderNavSvg(view: PagerView & { direction: "prev" | "next" }): string {
  const multi = view.total > 1;
  const bg = multi ? BG_CONTROL : BG_OFF;
  const arrow = multi ? "#ffffff" : FG_DIM;
  const glyph = view.direction === "prev" ? "◀" : "▶";
  const badge = multi && view.attention ? presentation(view.attention) : null;
  const badgeSvg = badge
    ? `<circle cx="116" cy="28" r="22" fill="${badge.color}"/>` +
      centered(view.count > 1 ? String(view.count) : badge.glyph, 36, 24, "#fff").replace('x="72"', 'x="116"')
    : "";
  return svg(
    bgRect(bg) +
      centered(glyph, 82, 46, arrow) +
      centered(`${view.page + 1}/${view.total}`, 120, 20, FG_MUTED) +
      badgeSvg,
  );
}

// Dashboard key: counts per status across every live agent. Background takes
// the worst attention color so the whole key reads as a traffic light.
export function renderSummarySvg(view: {
  working: number;
  blocked: number;
  done: number;
  idle: number;
  connected: boolean;
}): string {
  if (!view.connected) {
    return svg(bgRect(BG_OFF) + centered("herdr", 66, 26, FG_DIM) + centered("offline", 100, 22, FG_DIM));
  }
  const bg = view.blocked > 0 ? presentation("blocked").color : view.done > 0 ? presentation("done").color : BG_CONTROL;
  const row = (y: number, glyph: string, n: number, color: string): string =>
    `<text x="40" y="${y}" ${FONT_FAMILY_ATTR} font-size="24" fill="${color}" text-anchor="middle">${glyph}</text>` +
    `<text x="104" y="${y}" ${FONT_FAMILY_ATTR} font-size="26" font-weight="bold" fill="#fff" text-anchor="end">${n}</text>`;
  const onColor = view.blocked > 0 || view.done > 0;
  const c = (status: AgentStatus): string => (onColor ? "#ffffff" : presentation(status).color);
  return svg(
    bgRect(bg) +
      row(38, presentation("working").glyph, view.working, c("working")) +
      row(70, presentation("blocked").glyph, view.blocked, c("blocked")) +
      row(102, presentation("done").glyph, view.done, c("done")) +
      row(134, presentation("idle").glyph, view.idle, onColor ? "#ffffff" : FG_MUTED),
  );
}

// Idle visibility toggle: lit when idle agents are shown, with the idle count.
export function renderToggleIdleSvg(view: { showIdle: boolean; idleCount: number }): string {
  const bg = view.showIdle ? presentation("idle").color : BG_CONTROL;
  const fg = view.showIdle ? "#ffffff" : FG_MUTED;
  return svg(
    bgRect(bg) +
      centered(presentation("idle").glyph, 70, 52, fg) +
      centered(view.showIdle ? `idle ${view.idleCount}` : "idle off", 116, 20, fg),
  );
}

// Agent input key (send keys / prompt). Shows the configured label, tinted by
// the focused agent's status so a red key means "answer the dialog".
export function renderInputKeySvg(view: {
  label: string;
  hint: string;
  status: AgentStatus | null;
}): string {
  const enabled = view.status !== null;
  const bg = enabled ? presentation(view.status as AgentStatus).color : BG_OFF;
  const fg = enabled ? "#ffffff" : FG_DIM;
  const lines = wrapLabel(view.label, 7, 2);
  const size = lines.some((l) => l.length > 4) ? 26 : 40;
  const step = size + 4;
  const firstY = 72 - ((lines.length - 1) * step) / 2 + size / 3;
  const labelSvg = lines
    .map((line, i) => centered(escapeXml(line), firstY + i * step, size, fg, ' font-weight="bold"'))
    .join("");
  return svg(bgRect(bg) + labelSvg + centered(escapeXml(view.hint), 130, 16, enabled ? "#ffffffcc" : FG_DIM));
}

export function renderPagerSvg(view: PagerView): string {
  return renderNavSvg({ ...view, direction: "next" });
}
