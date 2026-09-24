import { create } from "zustand";
import * as ipc from "../api/ipc";
import { useGameDataStore } from "./gameDataStore";

/** A star class a rolled system can have, named as the game names it. */
export interface GeneratorStarClass {
  key: string;
  label: string;
}

export interface GeneratorState {
  /** Null until read for the loaded game data. */
  starClasses: GeneratorStarClass[] | null;
  /** Reads the classes once per loaded game data; a no-op without it. */
  request(): void;
  clear(): void;
}

export const useGeneratorStore = create<GeneratorState>((set, get) => {
  let generation = 0;
  let asked = false;
  return {
    starClasses: null,

    request() {
      if (asked || useGameDataStore.getState().status !== "ready") return;
      asked = true;
      const mine = generation;
      ipc.getGeneratorStarClasses().then(
        (pairs) => {
          if (mine !== generation) return;
          set({ starClasses: pairs.map(([key, label]) => ({ key, label })) });
        },
        (e: unknown) => {
          if (mine === generation) asked = false;
          console.warn("generator star classes", ipc.errorMessage(e));
        },
      );
    },

    clear() {
      generation += 1;
      asked = false;
      if (get().starClasses !== null) set({ starClasses: null });
    },
  };
});
