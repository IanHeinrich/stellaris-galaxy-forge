import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { AddSystemPicks } from "../generated/AddSystemPicks";
import type { BodyClassPick } from "../generated/BodyClassPick";
import type { PickSummary } from "../generated/PickSummary";
import type { SpecialLayout } from "../generated/SpecialLayout";
import { useGameDataStore } from "./gameDataStore";

/** A star class a rolled system can have, named as the game names it. */
export interface GeneratorStarClass {
  key: string;
  label: string;
}

/** A star class row of the add and reroll pickers, with its card once the picks are read. */
export interface StarClassPick extends GeneratorStarClass {
  summary?: PickSummary;
}

export interface GeneratorState {
  /** Null until read for the loaded game data. */
  starClasses: GeneratorStarClass[] | null;
  /** What the Add system menu offers for the open save, each with its card; null until read. */
  picks: AddSystemPicks | null;
  /** The classes an added planet may take, by name; null until read. */
  planetClasses: BodyClassPick[] | null;
  /** The classes an added moon may take, by name; null until read. */
  moonClasses: BodyClassPick[] | null;
  /** Reads the classes once per loaded game data; a no-op without it. */
  request(): void;
  /** Reads the planet and moon classes once per loaded game data; a no-op without it. */
  requestBodyClasses(): void;
  /**
   * Reads the picks for the open save again, since each add changes what the galaxy holds. The
   * last ones stay until the new ones land; a no-op without game data.
   */
  refreshPicks(): void;
  /** Forgets the picks, which belong to the document that was open. */
  clearPicks(): void;
  clear(): void;
}

export const useGeneratorStore = create<GeneratorState>((set, get) => {
  let generation = 0;
  let asked = false;
  let bodiesAsked = false;
  /** The latest picks read asked for; an older answer landing after it is dropped. */
  let picksAsked = 0;
  return {
    starClasses: null,
    picks: null,
    planetClasses: null,
    moonClasses: null,

    request() {
      if (asked || useGameDataStore.getState().status !== "ready") return;
      asked = true;
      const mine = generation;
      ipc.getGeneratorStarClasses().then(
        (picks) => {
          if (mine !== generation) return;
          set({ starClasses: picks.map(({ key, name }) => ({ key, label: name })) });
        },
        (e: unknown) => {
          if (mine === generation) asked = false;
          console.warn("generator star classes", ipc.errorMessage(e));
        },
      );
    },

    requestBodyClasses() {
      if (bodiesAsked || useGameDataStore.getState().status !== "ready") return;
      bodiesAsked = true;
      const mine = generation;
      Promise.all([ipc.getBodyClasses(false), ipc.getBodyClasses(true)]).then(
        ([planetClasses, moonClasses]) => {
          if (mine === generation) set({ planetClasses, moonClasses });
        },
        (e: unknown) => {
          if (mine === generation) bodiesAsked = false;
          console.warn("body classes", ipc.errorMessage(e));
        },
      );
    },

    refreshPicks() {
      if (useGameDataStore.getState().status !== "ready") return;
      picksAsked += 1;
      const mine = picksAsked;
      ipc.getAddSystemPicks().then(
        (picks) => {
          if (mine === picksAsked) set({ picks });
        },
        (e: unknown) => {
          if (mine === picksAsked) console.warn("add system picks", ipc.errorMessage(e));
        },
      );
    },

    clearPicks() {
      picksAsked += 1;
      if (get().picks !== null) set({ picks: null });
    },

    clear() {
      generation += 1;
      asked = false;
      bodiesAsked = false;
      if (get().starClasses !== null) set({ starClasses: null });
      if (get().planetClasses !== null || get().moonClasses !== null) {
        set({ planetClasses: null, moonClasses: null });
      }
      get().clearPicks();
    },
  };
});

/** The star classes a rolled system can take: the picks' when read, else the plain list. */
export function starClassPicks(
  picks: AddSystemPicks | null,
  starClasses: readonly GeneratorStarClass[] | null,
): StarClassPick[] {
  return (
    picks?.star_classes.map((p) => ({ key: p.key, label: p.name, summary: p.summary })) ??
    starClasses?.map((c) => ({ key: c.key, label: c.label })) ??
    []
  );
}

/** The Special menu layout a system's initializer names, or null for a regular system. */
export function specialFor(
  picks: AddSystemPicks | null,
  initializer: string,
): SpecialLayout | null {
  return picks?.special.find((p) => p.layout.key === initializer)?.layout ?? null;
}
