// src/core/store.ts
import {
  countByStatus,
  normalize,
  orderForDisplay,
  type Agent,
  type RawAgent,
  type RawWorkspace,
  type StatusCounts,
} from "./agents";
import { clampPage, pageCount, pageOf, PAGE_SIZE } from "./pagination";

export type StoreState = {
  /** Agents in display order (pinned first, idle hidden unless showIdle). */
  agents: Agent[];
  /** Every live agent, in sidebar order — for counts and the focused agent. */
  all: Agent[];
  page: number;
  pageSize: number;
  showIdle: boolean;
  /** False once herdr has been unreachable for two consecutive polls. */
  connected: boolean;
};

export type AgentStore = {
  getState(): StoreState;
  subscribe(fn: (s: StoreState) => void): () => void;
  setPage(next: number): void;
  nextPage(): void;
  prevPage(): void;
  /** Jump to the page showing this agent; no-op when it is not displayed. */
  revealAgent(paneId: string): void;
  setPageSize(size: number): void;
  setShowIdle(show: boolean): void;
  toggleShowIdle(): void;
  togglePin(paneId: string): void;
  isPinned(paneId: string): boolean;
  counts(): StatusCounts;
  focusedAgent(): Agent | undefined;
  pollNow(): Promise<void>;
  start(intervalMs?: number): void;
  stop(): void;
};

export type Fetch = () => Promise<{ agents: RawAgent[]; workspaces?: RawWorkspace[] }>;

export function createAgentStore(opts: { fetch: Fetch; pageSize?: number }): AgentStore {
  let state: StoreState = {
    agents: [],
    all: [],
    page: 0,
    pageSize: opts.pageSize ?? PAGE_SIZE,
    showIdle: false,
    connected: false,
  };
  // `pinned` is paneIds in pin order (in-memory, reset on plugin restart).
  let pinned: string[] = [];
  let hasLastGood = false;
  let failStreak = 0;
  let inFlight = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const subs = new Set<(s: StoreState) => void>();

  const emit = () => subs.forEach((fn) => fn(state));
  const set = (next: Partial<StoreState>) => {
    state = { ...state, ...next };
    emit();
  };
  // Re-derive the displayed list from the full list + pins + idle toggle,
  // clamping the page to the new length.
  const recompute = (next: Partial<StoreState> = {}) => {
    const merged = { ...state, ...next };
    const agents = orderForDisplay(merged.all, pinned, merged.showIdle);
    set({
      ...next,
      agents,
      page: clampPage(merged.page, pageCount(agents.length, merged.pageSize)),
    });
  };

  const store: AgentStore = {
    getState: () => state,
    subscribe(fn) {
      subs.add(fn);
      fn(state);
      return () => {
        subs.delete(fn);
      };
    },
    setPage(next) {
      set({ page: clampPage(next, pageCount(state.agents.length, state.pageSize)) });
    },
    nextPage() {
      const pages = pageCount(state.agents.length, state.pageSize);
      set({ page: (state.page + 1) % pages });
    },
    prevPage() {
      const pages = pageCount(state.agents.length, state.pageSize);
      set({ page: (state.page - 1 + pages) % pages });
    },
    revealAgent(paneId) {
      const index = state.agents.findIndex((a) => a.paneId === paneId);
      if (index === -1) return;
      const page = pageOf(index, state.pageSize);
      if (page !== state.page) set({ page });
    },
    setPageSize(size) {
      const pageSize = Math.max(1, Math.floor(size));
      if (pageSize !== state.pageSize) recompute({ pageSize });
    },
    setShowIdle(show) {
      if (show !== state.showIdle) recompute({ showIdle: show });
    },
    toggleShowIdle() {
      recompute({ showIdle: !state.showIdle });
    },
    togglePin(paneId) {
      pinned = pinned.includes(paneId)
        ? pinned.filter((id) => id !== paneId)
        : [...pinned, paneId];
      recompute();
    },
    isPinned: (paneId) => pinned.includes(paneId),
    counts: () => countByStatus(state.all),
    focusedAgent: () => state.all.find((a) => a.focused),
    async pollNow() {
      if (inFlight) return;
      inFlight = true;
      try {
        const snap = await opts.fetch();
        hasLastGood = true;
        failStreak = 0;
        recompute({ all: normalize(snap.agents, snap.workspaces ?? []), connected: true });
      } catch {
        failStreak += 1;
        // One failure keeps the last-good view (a transient hiccup should not
        // blank the deck); a second consecutive one empties it.
        if (!(failStreak === 1 && hasLastGood)) {
          hasLastGood = false;
          recompute({ all: [], connected: false });
        }
      } finally {
        inFlight = false;
      }
    },
    start(intervalMs = 1000) {
      if (timer) return;
      void store.pollNow();
      timer = setInterval(() => void store.pollNow(), intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };

  return store;
}
