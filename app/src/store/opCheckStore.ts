import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { Op } from "../generated/Op";
import { latest } from "./reads";

/**
 * What the core said of one op: its refusal, or null, as its system stood at `generation`,
 * the count of edits, undos and redos that have staled that system's details.
 */
export interface OpCheck {
  generation: number;
  refusal: string | null;
}

export interface OpCheckState {
  /** By `opCheckKey`; an edit, undo or redo drops the answers it staled. */
  answers: ReadonlyMap<string, OpCheck>;
  /** By system: how many edits, undos and redos have staled its details. */
  generations: ReadonlyMap<number, number>;
  /** How many edits, undos and redos there have been: the generation of an op about no system. */
  edits: number;
  /**
   * Asks the core why `op` would be refused, `system` at `generation` (or every edit, for no
   * system), unless that has been asked already. An answer to an older ask, to one an edit has
   * staled since, or for the document before, is dropped.
   */
  ask(op: Op, system: number | null, generation: number): void;
  /** Notes an edit, undo or redo, which staled the details of `systems`. */
  staled(systems: readonly number[]): void;
  /** Forgets what was asked and answered, as for a new document. */
  reset(): void;
}

/**
 * What an answer about `op` is held under. A system's generations and the edit count run apart,
 * so an answer counted on one is never compared with the other.
 */
export function opCheckKey(op: Op, system: number | null): string {
  return `${system ?? "edits"}|${JSON.stringify(op)}`;
}

/**
 * The ops asked about, by `opCheckKey`, each with its system and the newest generation it was
 * asked at, so each is asked once per generation.
 */
let asked = new Map<string, { system: number | null; generation: number }>();
/** Moved on by every reset, so an answer for the document before lands nowhere. */
const session = latest();

export const useOpCheckStore = create<OpCheckState>((set, get) => ({
  answers: new Map(),
  generations: new Map(),
  edits: 0,

  ask(op, system, generation) {
    const key = opCheckKey(op, system);
    const held = asked.get(key);
    if (held !== undefined && held.generation >= generation) return;
    asked.set(key, { system, generation });
    const mine = session.current();
    const land = (refusal: string | null) => {
      if (!session.is(mine) || asked.get(key)?.generation !== generation) return;
      set({ answers: new Map([...get().answers, [key, { generation, refusal }]]) });
    };
    ipc.checkOp(op).then(land, (e: unknown) => land(ipc.errorMessage(e)));
  },

  staled(systems) {
    const generations = new Map(get().generations);
    for (const system of systems) generations.set(system, (generations.get(system) ?? 0) + 1);
    const touched = new Set(systems);
    const stale = (key: string) => {
      const about = asked.get(key);
      return about !== undefined && (about.system === null || touched.has(about.system));
    };
    const answers = new Map([...get().answers].filter(([key]) => !stale(key)));
    asked = new Map([...asked].filter(([key]) => !stale(key)));
    set({ answers, generations, edits: get().edits + 1 });
  },

  reset() {
    asked = new Map();
    session.next();
    set({ answers: new Map(), generations: new Map(), edits: 0 });
  },
}));
