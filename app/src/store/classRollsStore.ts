import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { ClassRolls } from "../generated/ClassRolls";
import { keyedReads } from "./reads";

/** What a scenario body rolls as one class, or why that could not be told. */
export type ClassRollsAnswer = { rolls: ClassRolls } | { error: string };

export interface ClassRollsState {
  /** Each answer read this session, by `classRollsKey`. */
  answers: Map<string, ClassRollsAnswer>;
  /** The keys asked for and not answered yet. */
  pending: ReadonlySet<string>;
  /** Reads what body `body` of system `system` rolls as `className`, once per session. */
  request(system: number, body: number, className: string): void;
  /**
   * Drops the answers on the bodies of `systems`, which an edit changed. Every ask still out is
   * dropped too, and asked again by the page that wants it.
   */
  forget(systems: readonly number[]): void;
  clear(): void;
}

export function classRollsKey(system: number, body: number, className: string): string {
  return `${system}:${body}:${className}`;
}

interface ClassRollsAsk {
  system: number;
  body: number;
  className: string;
}

const keyOf = (ask: ClassRollsAsk) => classRollsKey(ask.system, ask.body, ask.className);

const reads = keyedReads(
  ([ask]: ClassRollsAsk[]) => ipc.getClassRolls(ask.system, ask.body, ask.className),
  {
    key: keyOf,
    batch: 1,
    answered: ([ask], rolls) => land(ask, { rolls }),
    failed: ([ask], error) => land(ask, { error }),
  },
);

function land(ask: ClassRollsAsk, answer: ClassRollsAnswer): void {
  const { answers } = useClassRollsStore.getState();
  useClassRollsStore.setState({
    answers: new Map(answers).set(keyOf(ask), answer),
    pending: reads.pending(),
  });
}

export const useClassRollsStore = create<ClassRollsState>((set, get) => ({
  answers: new Map(),
  pending: new Set(),

  request(system, body, className) {
    const key = classRollsKey(system, body, className);
    if (get().answers.has(key) || reads.asked(key)) return;
    void reads.read([{ system, body, className }]);
    set({ pending: reads.pending() });
  },

  forget(systems) {
    const answers = new Map(get().answers);
    for (const key of answers.keys()) {
      if (systems.some((system) => key.startsWith(`${system}:`))) answers.delete(key);
    }
    reads.clear();
    set({ answers, pending: new Set() });
  },

  clear() {
    reads.clear();
    set({ answers: new Map(), pending: new Set() });
  },
}));
