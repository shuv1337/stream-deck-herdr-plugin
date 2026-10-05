// src/core/render.test.ts
import { test, expect } from "bun:test";
import {
  renderKeySvg,
  renderPagerSvg,
  renderAttentionSvg,
  renderNavSvg,
  renderSummarySvg,
  renderToggleIdleSvg,
  renderInputKeySvg,
  wrapLabel,
} from "./render";

function decode(uri: string): string {
  const prefix = "data:image/svg+xml;base64,";
  expect(uri.startsWith(prefix)).toBe(true);
  return Buffer.from(uri.slice(prefix.length), "base64").toString("utf8");
}

test("renderKeySvg paints the status color, glyph and escaped label", () => {
  const svg = decode(renderKeySvg({ label: "a&b", status: "working", agent: "claude", pinned: false }));
  expect(svg).toContain("JetBrains Mono");
  expect(svg).toContain("font-family='JetBrains Mono");
  expect(svg).toContain('font-weight="bold"');
  expect(svg).toContain('font-size="30"');
  expect(svg).toContain("#E8901E");
  expect(svg).toContain("●");
  expect(svg).toContain("a&amp;b");
});

test("renderKeySvg wraps a long label onto up to 3 lines", () => {
  const svg = decode(renderKeySvg({ label: "LMManagementSystem", status: "idle", agent: "claude", pinned: false }));
  const textCount = (svg.match(/<text/g) ?? []).length;
  // 1 status glyph + 3 wrapped label lines (claude's badge is an icon <g>, not <text>)
  expect(textCount).toBe(4);
  expect(svg).toContain(">LMMana<");
  expect(svg).toContain(">System<");
  // three lines are shrunk so the block ends inside the key
  expect(svg).toContain('font-size="25"');
  expect(svg).toContain('y="136"');
  expect(svg).not.toMatch(/y="14\d"/);
});

test("wrapLabel breaks at separators and keeps short words whole", () => {
  expect(wrapLabel("shuvbro", 6, 2)).toEqual(["shuvbro"]); // 7 chars: one line, caller shrinks font
  expect(wrapLabel("sb-v2-qualify-shuv2", 6, 2)).toEqual(["sb-v2-", "qualify…"]);
  expect(wrapLabel("sb-v2-qualify-shuv2", 6, 3)).toEqual(["sb-v2-", "qualify-", "shuv2"]);
  expect(wrapLabel("sc-i412-run-admission", 6, 3)).toEqual(["sc-i412-", "run-", "admissi…"]);
  expect(wrapLabel("modretromaxxing", 6, 3)).toEqual(["modret", "romaxx", "ing"]);
  expect(wrapLabel("hd-i6-startup-exit", 6, 3)).toEqual(["hd-i6-", "startup-", "exit"]);
  expect(wrapLabel("app #2", 6, 2)).toEqual(["app #2"]);
  expect(wrapLabel("sb-pr30-i43", 6, 2)).toEqual(["sb-pr30-", "i43"]);
});

test("renderKeySvg shrinks the font for a line that runs long instead of orphaning", () => {
  const svg = decode(renderKeySvg({ label: "shuvbro", status: "working", agent: "shuvcode", pinned: false }));
  expect(svg).toContain(">shuvbro<");
  expect(svg).toContain('font-size="25"'); // 30 * 6/7
  expect(svg).toContain("<g transform"); // shuvcode borrows the opencode logo
});

test("renderKeySvg renders a monochrome icon badge for a known agent", () => {
  const svg = decode(renderKeySvg({ label: "proj", status: "working", agent: "claude", pinned: false }));
  expect(svg).toContain("<g transform");
  expect(svg).toContain('fill-rule="evenodd"');
  expect(svg).not.toContain(">CL<"); // icon replaces the text code
});

test("renderKeySvg matches the agent type case-insensitively", () => {
  const svg = decode(renderKeySvg({ label: "proj", status: "idle", agent: "CURSOR", pinned: false }));
  expect(svg).toContain("<g transform");
});

test("renderKeySvg falls back to a 2-letter code when no icon exists", () => {
  // droid has no Lobehub logo; unknown agents also fall back to the text code.
  const droid = decode(renderKeySvg({ label: "proj", status: "idle", agent: "droid", pinned: false }));
  expect(droid).toContain(">DR<");
  const unknown = decode(renderKeySvg({ label: "proj", status: "idle", agent: "zephyr", pinned: false }));
  expect(unknown).toContain(">ZE<");
});

test("renderKeySvg draws a pin marker only when pinned", () => {
  const on = decode(renderKeySvg({ label: "proj", status: "working", agent: "claude", pinned: true }));
  expect(on).toContain('<circle cx="126" cy="15"');
  const off = decode(renderKeySvg({ label: "proj", status: "working", agent: "claude", pinned: false }));
  expect(off).not.toContain('<circle cx="126" cy="15"');
});

test("renderKeySvg empty slot is black with no label", () => {
  const svg = decode(renderKeySvg(null));
  expect(svg).toContain("#000");
});

test("renderAttentionSvg colors by worst status and shows the count", () => {
  const svg = decode(renderAttentionSvg({ count: 3, attention: "blocked" }));
  expect(svg).toContain("#D13438"); // blocked color
  expect(svg).toContain(">3<");
});

test("renderAttentionSvg is dim when nothing needs attention", () => {
  const svg = decode(renderAttentionSvg({ count: 0, attention: null }));
  expect(svg).toContain("#0a0a0a");
  expect(svg).toContain(">0<");
});

test("renderPagerSvg shows page indicator and badge when attention present", () => {
  const svg = decode(renderPagerSvg({ page: 0, total: 2, attention: "blocked", count: 1 }));
  expect(svg).toContain("1/2");
  expect(svg).toContain("#D13438"); // blocked badge
  expect(svg).toContain("▲");
});

test("renderPagerSvg shows count when more than one off-page attention", () => {
  const svg = decode(renderPagerSvg({ page: 0, total: 3, attention: "done", count: 4 }));
  expect(svg).toContain(">4<"); // count rendered instead of glyph
});

test("renderPagerSvg single page has no badge", () => {
  const svg = decode(renderPagerSvg({ page: 0, total: 1, attention: null, count: 0 }));
  expect(svg).toContain("1/1");
  expect(svg).not.toContain("circle");
});

test("renderPagerSvg single page renders no badge even with attention", () => {
  const svg = decode(renderPagerSvg({ page: 0, total: 1, attention: "blocked", count: 3 }));
  expect(svg).toContain("1/1");
  expect(svg).not.toContain("circle");
});

test("renderKeySvg draws a focus ring, workspace tag and pending wash only when asked", () => {
  const plain = decode(renderKeySvg({ label: "proj", status: "working", agent: "claude", pinned: false }));
  expect(plain).not.toContain('stroke-width="5"');
  const focused = decode(
    renderKeySvg({ label: "proj", status: "working", agent: "claude", pinned: false, focused: true, workspaceNumber: 7 }),
  );
  expect(focused).toContain('stroke-width="5"'); // ring
  expect(focused).toContain(">7<"); // workspace tag
  const pending = decode(
    renderKeySvg({ label: "proj", status: "working", agent: "claude", pinned: false, launchPending: true }),
  );
  expect(pending).toContain('fill-opacity="0.45"');
  expect(pending).toContain(">…<");
});

test("renderNavSvg points the arrow by direction and shares the pager badge", () => {
  const prev = decode(renderNavSvg({ direction: "prev", page: 1, total: 3, attention: "blocked", count: 2 }));
  expect(prev).toContain("◀");
  expect(prev).toContain("2/3");
  expect(prev).toContain("#D13438");
  expect(prev).toContain(">2<");
  const next = decode(renderNavSvg({ direction: "next", page: 0, total: 1, attention: null, count: 0 }));
  expect(next).toContain("▶");
  expect(next).not.toContain("circle");
});

test("renderSummarySvg lists the four counts and goes red when anything is blocked", () => {
  const red = decode(renderSummarySvg({ working: 3, blocked: 1, done: 2, idle: 4, connected: true }));
  expect(red).toContain("#D13438");
  for (const n of [">3<", ">1<", ">2<", ">4<"]) expect(red).toContain(n);
  const green = decode(renderSummarySvg({ working: 0, blocked: 0, done: 1, idle: 0, connected: true }));
  expect(green).toContain("#22C55E");
  const calm = decode(renderSummarySvg({ working: 2, blocked: 0, done: 0, idle: 0, connected: true }));
  expect(calm).toContain("#111827");
  const off = decode(renderSummarySvg({ working: 0, blocked: 0, done: 0, idle: 0, connected: false }));
  expect(off).toContain("offline");
});

test("renderToggleIdleSvg lights up with the idle count when idle agents are shown", () => {
  const on = decode(renderToggleIdleSvg({ showIdle: true, idleCount: 5 }));
  expect(on).toContain("#6B7280");
  expect(on).toContain("idle 5");
  const off = decode(renderToggleIdleSvg({ showIdle: false, idleCount: 5 }));
  expect(off).toContain("idle off");
});

test("renderInputKeySvg tints by the focused agent's status and dims without one", () => {
  const live = decode(renderInputKeySvg({ label: "enter", hint: "reviewer", status: "blocked" }));
  expect(live).toContain("#D13438");
  expect(live).toContain(">enter<");
  expect(live).toContain(">reviewer<");
  const dead = decode(renderInputKeySvg({ label: "esc", hint: "no focus", status: null }));
  expect(dead).toContain("#0a0a0a");
  expect(dead).toContain("no focus");
});
