// src/core/pagination.test.ts
import { test, expect } from "bun:test";
import {
  PAGE_SIZE,
  pageCount,
  clampPage,
  pageSlice,
  offPageWorstAttention,
  offPageAttentionCount,
  attentionAgents,
  worstAttention,
} from "./pagination";
import { mk } from "../../tests/helpers";

test("PAGE_SIZE is 8 and pageCount has a floor of 1", () => {
  expect(PAGE_SIZE).toBe(8);
  expect(pageCount(0)).toBe(1);
  expect(pageCount(8)).toBe(1);
  expect(pageCount(9)).toBe(2);
  expect(pageCount(17)).toBe(3);
});

test("clampPage keeps page inside range", () => {
  expect(clampPage(2, 1)).toBe(0);
  expect(clampPage(-1, 3)).toBe(0);
  expect(clampPage(5, 3)).toBe(2);
});

test("pageSlice returns the window for a page", () => {
  const agents = Array.from({ length: 10 }, (_, i) => mk("idle", `p${i}`));
  expect(pageSlice(agents, 1).map((a) => a.paneId)).toEqual(["p8", "p9"]);
});

test("offPageWorstAttention ranks blocked > done and ignores working + on-page", () => {
  const agents = [
    ...Array.from({ length: 8 }, (_, i) => mk("idle", `p${i}`)), // page 0
    mk("working", "p8"),
    mk("done", "p9"),
    mk("blocked", "p10"),
  ];
  expect(offPageWorstAttention(agents, 0)).toBe("blocked");
  expect(offPageAttentionCount(agents, 0)).toBe(2);
  expect(offPageWorstAttention(agents, 1)).toBe(null);
});

test("working off-page never raises the pager badge", () => {
  const agents = [
    ...Array.from({ length: 8 }, (_, i) => mk("idle", `p${i}`)),
    mk("working", "p8"),
    mk("working", "p9"),
  ];
  expect(offPageWorstAttention(agents, 0)).toBe(null);
  expect(offPageAttentionCount(agents, 0)).toBe(0);
});

test("idle/unknown off-page produce no badge", () => {
  const agents = [
    ...Array.from({ length: 8 }, (_, i) => mk("working", `p${i}`)),
    mk("idle", "p8"),
    mk("unknown", "p9"),
  ];
  expect(offPageWorstAttention(agents, 0)).toBe(null);
  expect(offPageAttentionCount(agents, 0)).toBe(0);
});

test("attentionAgents keeps only blocked/done in order", () => {
  const agents = [mk("working", "p0"), mk("blocked", "p1"), mk("idle", "p2"), mk("done", "p3")];
  expect(attentionAgents(agents).map((a) => a.paneId)).toEqual(["p1", "p3"]);
});

test("worstAttention is blocked > done > null", () => {
  expect(worstAttention([mk("done", "p0"), mk("blocked", "p1")])).toBe("blocked");
  expect(worstAttention([mk("done", "p0")])).toBe("done");
  expect(worstAttention([mk("working", "p0"), mk("idle", "p1")])).toBe(null);
});