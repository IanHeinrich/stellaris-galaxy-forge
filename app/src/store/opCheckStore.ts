import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { HistoryView } from "../generated/HistoryView";
import type { Op } from "../generated/Op";

/** What the core said of one op: its refusal, or null, as the history stood when it was asked. */
export interface OpCheck {
  history: HistoryView;
  refusal: string | null;
}

export interface OpCheckState {
  /** By the op's JSON. */
  answers: ReadonlyMap<string, OpCheck>;
  /**
   * Asks the core why the op `key` would be refused, against the session at `history`, unless
   * that has been asked already.
   */
  ask(key: string, history: HistoryView): void;
}

/** The ops asked about at each history, so that each is asked once. */
let asked = new WeakMap<HistoryView, Set<string>>();

/** Forgets what was asked, as a new store would. */
export function resetOpChecks(): void {
  asked = new WeakMap();
  useOpCheckStore.setState({ answers: new Map() });
}

export const useOpCheckStore = create<OpCheckState>((set, get) => ({
  answers: new Map(),

  ask(key, history) {
    const keys = asked.get(history) ?? new Set<string>();
    asked.set(history, keys);
    if (keys.has(key)) return;
    keys.add(key);
    const land = (refusal: string | null) =>
      set({ answers: new Map([...get().answers, [key, { history, refusal }]]) });
    ipc.checkOp(JSON.parse(key) as Op).then(land, (e: unknown) => land(ipc.errorMessage(e)));
  },
}));
