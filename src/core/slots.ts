// src/core/slots.ts

// One Agent Slot key as seen by the plugin: where it sits on the deck and
// whether the user pinned it to an explicit slot number.
export type SlotKey = {
  id: string;
  device: string;
  row: number;
  column: number;
  explicit: number | null;
};

// Parse the Property Inspector `slotIndex` setting. Anything that is not a
// non-negative integer (missing, "", "auto") means "assign by position".
export function parseSlotSetting(value: unknown): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    return Number(trimmed);
  }
  return null;
}

// Pure: map every slot key to its display index. Explicit indices win; the
// rest are filled in reading order (device, row, column) into the lowest
// indices still free. Dropping Agent Slot keys anywhere on an XL therefore
// yields a left-to-right, top-to-bottom grid with no Property Inspector work.
export function assignSlots(keys: SlotKey[]): Map<string, number> {
  const assigned = new Map<string, number>();
  const taken = new Set<number>();
  for (const k of keys) {
    if (k.explicit !== null) {
      assigned.set(k.id, k.explicit);
      taken.add(k.explicit);
    }
  }
  const auto = keys
    .filter((k) => k.explicit === null)
    .sort(
      (a, b) =>
        a.device.localeCompare(b.device) || a.row - b.row || a.column - b.column || a.id.localeCompare(b.id),
    );
  let next = 0;
  for (const k of auto) {
    while (taken.has(next)) next += 1;
    assigned.set(k.id, next);
    taken.add(next);
  }
  return assigned;
}

// Page size implied by the slot keys present: one more than the highest index
// in use, so an explicit gap still leaves a (blank) place for its agent.
export function pageSizeFor(assigned: Map<string, number>, fallback: number): number {
  if (assigned.size === 0) return fallback;
  return Math.max(...assigned.values()) + 1;
}
