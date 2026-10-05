import { test, expect } from "bun:test";
import { resolveInput } from "./input";

test("resolveInput defaults to a single Enter", () => {
  expect(resolveInput({})).toEqual({ mode: "keys", keys: ["enter"], label: "enter" });
});

test("resolveInput splits keys on whitespace/commas and labels from them", () => {
  expect(resolveInput({ mode: "keys", keys: "ctrl+c, esc" })).toEqual({
    mode: "keys",
    keys: ["ctrl+c", "esc"],
    label: "ctrl+c esc",
  });
  expect(resolveInput({ keys: "y", label: "Yes" }).label).toBe("Yes");
});

test("resolveInput prompt mode keeps the text and labels from the first word", () => {
  expect(resolveInput({ mode: "prompt", text: "  continue with the plan " })).toEqual({
    mode: "prompt",
    text: "continue with the plan",
    label: "continue",
  });
  expect(resolveInput({ mode: "prompt" })).toEqual({ mode: "prompt", text: "", label: "prompt" });
});
