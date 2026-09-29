import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { Op } from "../generated/Op";

/**
 * What the core said of one op: its refusal, or null, as its system stood at `generation`,
 * the count of edits, undos and redos that have staled that system's details.
 */
export interface OpCheck {
  generation: number;
  refusal: string | null;
}

export interface OpCheckState {
  /** By the op's JSON. */
  answers: ReadonlyMap<string, OpCheck>;
  /** By system: how many edits, undos and redos have staled its details. */
  generations: ReadonlyMap<number, number>;
  /**
   * Asks the core why the op `key` would be refused, its system at `generation`, unless that
   * has been asked already. An answer older than the one held is dropped.
   */
  ask(key: string, generation: number): void;
  /** Notes that an edit, undo or redo staled the details of `systems`. */
  staled(systems: readonly number[]): void;
}

/** The ops asked about, each with the generation it was asked at, so each is asked once. */
let asked = new Set<string>();

/** Forgets what was asked and answered, as for a new document. */
export function resetOpChecks(): void {
  asked = new Set();
  useOpCheckStore.setState({ answers: new Map(), generations: new Map() });
}

export const useOpCheckStore = create<OpCheckState>((set, get) => ({
  answers: new Map(),
  generations: new Map(),

  ask(key, generation) {
    const tag = `${generation}:${key}`;
    if (asked.has(tag)) return;
    asked.add(tag);
    const land = (refusal: string | null) => {
      const held = get().answers.get(key);
      if (held !== undefined && held.generation > generation) return;
      set({ answers: new Map([...get().answers, [key, { generation, refusal }]]) });
    };
    ipc.checkOp(JSON.parse(key) as Op).then(land, (e: unknown) => land(ipc.errorMessage(e)));
  },

  staled(systems) {
    if (systems.length === 0) return;
    const generations = new Map(get().generations);
    for (const system of systems) generations.set(system, (generations.get(system) ?? 0) + 1);
    set({ generations });
  },
}));
