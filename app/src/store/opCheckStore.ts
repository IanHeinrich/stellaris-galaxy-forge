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
  /** By `opCheckKey`. */
  answers: ReadonlyMap<string, OpCheck>;
  /** By system: how many edits, undos and redos have staled its details. */
  generations: ReadonlyMap<number, number>;
  /**
   * Asks the core why `op` would be refused, its system at `generation`, unless that has been
   * asked already. An answer older than the one held, or for the document before, is dropped.
   */
  ask(op: Op, generation: number): void;
  /** Notes that an edit, undo or redo staled the details of `systems`. */
  staled(systems: readonly number[]): void;
  /** Forgets what was asked and answered, as for a new document. */
  reset(): void;
}

/** What an answer about `op` is held under. */
export function opCheckKey(op: Op): string {
  return JSON.stringify(op);
}

/** The ops asked about, each with the generation it was asked at, so each is asked once. */
let asked = new Set<string>();
/** Bumped by every reset, so an answer for the document before lands nowhere. */
let session = 0;

export const useOpCheckStore = create<OpCheckState>((set, get) => ({
  answers: new Map(),
  generations: new Map(),

  ask(op, generation) {
    const key = opCheckKey(op);
    const tag = `${generation}:${key}`;
    if (asked.has(tag)) return;
    asked.add(tag);
    const mine = session;
    const land = (refusal: string | null) => {
      if (mine !== session) return;
      const held = get().answers.get(key);
      if (held !== undefined && held.generation > generation) return;
      set({ answers: new Map([...get().answers, [key, { generation, refusal }]]) });
    };
    ipc.checkOp(op).then(land, (e: unknown) => land(ipc.errorMessage(e)));
  },

  staled(systems) {
    if (systems.length === 0) return;
    const generations = new Map(get().generations);
    for (const system of systems) generations.set(system, (generations.get(system) ?? 0) + 1);
    set({ generations });
  },

  reset() {
    asked = new Set();
    session += 1;
    set({ answers: new Map(), generations: new Map() });
  },
}));
