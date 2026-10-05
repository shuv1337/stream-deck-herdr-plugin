import { test, expect } from "bun:test";
import { assignSlots, pageSizeFor, parseSlotSetting, type SlotKey } from "./slots";

const key = (id: string, row: number, column: number, explicit: number | null = null, device = "d1"): SlotKey => ({
  id,
  device,
  row,
  column,
  explicit,
});

test("parseSlotSetting accepts non-negative integers, treats anything else as auto", () => {
  expect(parseSlotSetting(3)).toBe(3);
  expect(parseSlotSetting("7")).toBe(7);
  expect(parseSlotSetting(" 0 ")).toBe(0);
  expect(parseSlotSetting("auto")).toBeNull();
  expect(parseSlotSetting("")).toBeNull();
  expect(parseSlotSetting(undefined)).toBeNull();
  expect(parseSlotSetting(-1)).toBeNull();
  expect(parseSlotSetting(1.5)).toBeNull();
});

test("auto keys are numbered in reading order regardless of appearance order", () => {
  const assigned = assignSlots([key("c", 1, 0), key("a", 0, 0), key("d", 1, 7), key("b", 0, 3)]);
  expect([...assigned.entries()].sort()).toEqual([
    ["a", 0],
    ["b", 1],
    ["c", 2],
    ["d", 3],
  ]);
});

test("explicit indices are honored and auto keys skip them", () => {
  const assigned = assignSlots([key("x", 3, 3, 0), key("a", 0, 0), key("b", 0, 1), key("y", 3, 4, 2)]);
  expect(assigned.get("x")).toBe(0);
  expect(assigned.get("y")).toBe(2);
  expect(assigned.get("a")).toBe(1);
  expect(assigned.get("b")).toBe(3);
});

test("pageSizeFor is highest index + 1, with a fallback when no keys exist", () => {
  expect(pageSizeFor(new Map(), 8)).toBe(8);
  expect(pageSizeFor(assignSlots([key("a", 0, 0), key("b", 0, 1)]), 8)).toBe(2);
  // explicit gap still reserves its place
  expect(pageSizeFor(assignSlots([key("a", 0, 0), key("b", 0, 1, 5)]), 8)).toBe(6);
  // 24 keys across three XL rows
  const xl = Array.from({ length: 24 }, (_, i) => key(`k${i}`, Math.floor(i / 8), i % 8));
  expect(pageSizeFor(assignSlots(xl), 8)).toBe(24);
});
