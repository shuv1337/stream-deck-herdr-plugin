// src/core/pagination.ts
import type { Agent } from "./agents";
import { ATTENTION_RANK } from "./status";

// Fallback page size when no Agent Slot keys have appeared yet. At runtime the
// store derives the real page size from the number of slot keys on the deck
// (6 on a Mini, up to 32 on an XL).
export const PAGE_SIZE = 8;
export const MAX_SLOTS = 32;

export function pageCount(count: number, pageSize = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(count / Math.max(1, pageSize)));
}

export function clampPage(page: number, pages: number): number {
  if (page < 0) return 0;
  const max = Math.max(0, pages - 1);
  return page > max ? max : page;
}

export function pageSlice(agents: Agent[], page: number, pageSize = PAGE_SIZE): Agent[] {
  const start = page * pageSize;
  return agents.slice(start, start + pageSize);
}

export type Attention = "blocked" | "done";

function isOffPage(index: number, page: number, pageSize: number): boolean {
  const start = page * pageSize;
  return index < start || index >= start + pageSize;
}

export function offPageWorstAttention(
  agents: Agent[],
  page: number,
  pageSize = PAGE_SIZE,
): Attention | null {
  return agents.reduce<Attention | null>((best, agent, index) => {
    if (!isOffPage(index, page, pageSize)) return best;
    const rank = ATTENTION_RANK[agent.status] ?? 0;
    const bestRank = best ? ATTENTION_RANK[best] : 0;
    return rank > bestRank ? (agent.status as Attention) : best;
  }, null);
}

export function offPageAttentionCount(
  agents: Agent[],
  page: number,
  pageSize = PAGE_SIZE,
): number {
  return agents.filter(
    (agent, index) =>
      isOffPage(index, page, pageSize) && (ATTENTION_RANK[agent.status] ?? 0) > 0,
  ).length;
}

export function attentionAgents(agents: Agent[]): Agent[] {
  return agents.filter((a) => (ATTENTION_RANK[a.status] ?? 0) > 0);
}

export function worstAttention(agents: Agent[]): Attention | null {
  return agents.reduce<Attention | null>((best, a) => {
    const rank = ATTENTION_RANK[a.status] ?? 0;
    const bestRank = best ? ATTENTION_RANK[best] : 0;
    return rank > bestRank ? (a.status as Attention) : best;
  }, null);
}

// Page that contains the given display index.
export function pageOf(index: number, pageSize = PAGE_SIZE): number {
  return Math.floor(Math.max(0, index) / Math.max(1, pageSize));
}
