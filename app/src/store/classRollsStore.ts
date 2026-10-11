import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { ClassRolls } from "../generated/ClassRolls";

/** What a scenario body rolls as one class, or why that could not be told. */
export type ClassRollsAnswer = { rolls: ClassRolls } | { error: string };

export interface ClassRollsState {
  /** Each answer read this session, by `classRollsKey`. */
  answers: Map<string, ClassRollsAnswer>;
  /** The keys asked for and not answered yet. */
  pending: ReadonlySet<string>;
  /** Bumped by `clear`, so an answer to an ask made before it is dropped. */
  generation: number;
  /** Reads what body `body` of system `system` rolls as `className`, once per session. */
  request(system: number, body: number, className: string): void;
  clear(): void;
}

export function classRollsKey(system: number, body: number, className: string): string {
  return `${system}:${body}:${className}`;
}

export const useClassRollsStore = create<ClassRollsState>((set, get) => ({
  answers: new Map(),
  pending: new Set(),
  generation: 0,

  request(system, body, className) {
    const key = classRollsKey(system, body, className);
    const { answers, pending, generation } = get();
    if (answers.has(key) || pending.has(key)) return;
    set({ pending: new Set(pending).add(key) });
    const land = (answer: ClassRollsAnswer) => {
      if (get().generation !== generation) return;
      const left = new Set(get().pending);
      left.delete(key);
      set({ answers: new Map(get().answers).set(key, answer), pending: left });
    };
    ipc.getClassRolls(system, body, className).then(
      (rolls) => land({ rolls }),
      (e: unknown) => land({ error: ipc.errorMessage(e) }),
    );
  },

  clear() {
    set({ answers: new Map(), pending: new Set(), generation: get().generation + 1 });
  },
}));
