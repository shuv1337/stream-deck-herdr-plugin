// Executable half of FORK.md's identity contract: compatibility identifiers
// stay byte-for-byte, canonical URLs point at the fork, provenance survives.
import { test, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dir, "..");
const pluginDir = "dev.timvdhoorn.herdr-agents.sdPlugin";
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const manifest = JSON.parse(read(`${pluginDir}/manifest.json`));

test("compatibility: plugin + action UUIDs and directory name are unchanged", () => {
  expect(fs.existsSync(path.join(root, pluginDir))).toBe(true);
  expect(manifest.UUID).toBe("dev.timvdhoorn.herdr-agents");
  expect(manifest.Actions.map((a: { UUID: string }) => a.UUID).sort()).toEqual([
    "dev.timvdhoorn.herdr-agents.input",
    "dev.timvdhoorn.herdr-agents.pager",
    "dev.timvdhoorn.herdr-agents.slot",
    "dev.timvdhoorn.herdr-agents.summary",
    "dev.timvdhoorn.herdr-agents.toggle-idle",
  ]);
  for (const name of ["slotIndex", "display"]) expect(read(`${pluginDir}/ui/slot.html`)).toContain(`setting="${name}"`);
  expect(read(`${pluginDir}/ui/pager.html`)).toContain('setting="mode"');
  for (const name of ["mode", "keys", "text", "label"]) expect(read(`${pluginDir}/ui/input.html`)).toContain(`setting="${name}"`);
});

test("canonical: display name kept, repository URLs point at the fork", () => {
  expect(manifest.Name).toBe("herdr agents");
  expect(manifest.Category).toBe("herdr");
  expect(manifest.URL).toBe("https://github.com/shuv1337/stream-deck-herdr-plugin");
  const readme = read("README.md");
  expect(readme).toContain("github.com/shuv1337/stream-deck-herdr-plugin");
  expect(readme).not.toMatch(/git clone https:\/\/github\.com\/timvdhoorn\//);
});

test("provenance: license, author and upstream link are retained", () => {
  expect(read("LICENSE")).toContain("Tim van der Hoorn");
  expect(manifest.Author).toBe("Tim van der Hoorn");
  expect(read("README.md")).toContain("© Tim van der Hoorn");
  expect(read("FORK.md")).toContain("github.com/timvdhoorn/stream-deck-herdr-plugin");
});
