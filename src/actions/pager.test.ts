import { test, expect } from "bun:test";
import { parseMode } from "./pager";

test("parseMode accepts the dedicated modes and falls back to auto", () => {
  expect(parseMode("next")).toBe("next");
  expect(parseMode("prev")).toBe("prev");
  expect(parseMode("attention")).toBe("attention");
  expect(parseMode("auto")).toBe("auto");
  expect(parseMode(undefined)).toBe("auto");
  expect(parseMode("bogus")).toBe("auto");
});
