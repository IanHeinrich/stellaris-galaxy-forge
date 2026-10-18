import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { AddSystemPicks } from "../generated/AddSystemPicks";
import type { Arrangement } from "../generated/Arrangement";
import type { BodyClassPick } from "../generated/BodyClassPick";
import type { PickSummary } from "../generated/PickSummary";
import type { SpecialLayout } from "../generated/SpecialLayout";
import type { StarType } from "../generated/StarType";
import { buildsStars, documentCapabilities } from "../lib/capabilities";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { keyedReads } from "./reads";

/** A star class a rolled system can have, named as the game names it, with its odds. */
export interface GeneratorStarClass {
  key: string;
  label: string;
  /** How often a pick of this class draws it. */
  odds: number;
  /** How often a pick of no class rolls it: zero for a class only special layouts make. */
  randomOdds: number;
}

/** A star class row of the add and reroll pickers, with its card once the picks are read. */
export interface StarClassPick extends Pick<GeneratorStarClass, "key" | "label"> {
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
  /** The arrangements a binary or trinary is built in; null until read. */
  arrangements: Arrangement[] | null;
  /** Every star type a star slot offers, the usual ones first; null until read. */
  starTypes: StarType[] | null;
  /** The class each set of stars asked of `fileStars` is filed under, by `starsKey`. */
  filed: ReadonlyMap<string, string>;
  /** Reads the classes once per loaded game data; a no-op without it. */
  request(): void;
  /**
   * Reads the arrangements and star types once per loaded game data, for a document that builds
   * systems from chosen stars; a no-op otherwise.
   */
  requestStars(): void;
  /** Asks which class `stars`, in slot order, are filed under, unless it is known or on its way. */
  fileStars(stars: readonly string[]): void;
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

/** The key `filed` holds a set of stars under. */
export function starsKey(stars: readonly string[]): string {
  return stars.join("+");
}

export const useGeneratorStore = create<GeneratorState>((set, get) => {
  let generation = 0;
  let asked = false;
  let bodiesAsked = false;
  let starsAsked = false;
  const filing = keyedReads((asks: string[][]) => ipc.fileStarClass(asks[0]), {
    key: starsKey,
    batch: 1,
    answered([stars], filed: string) {
      set({ filed: new Map(get().filed).set(starsKey(stars), filed) });
    },
    failed(_asks, message) {
      console.warn("file star class", message);
    },
  });
  /** The latest picks read asked for; an older answer landing after it is dropped. */
  let picksAsked = 0;
  return {
    starClasses: null,
    picks: null,
    planetClasses: null,
    moonClasses: null,
    arrangements: null,
    starTypes: null,
    filed: new Map(),

    request() {
      if (asked || useGameDataStore.getState().status !== "ready") return;
      asked = true;
      const mine = generation;
      ipc.getGeneratorStarClasses().then(
        (picks) => {
          if (mine !== generation) return;
          set({
            starClasses: picks.map(({ key, name, odds, random_odds }) => ({
              key,
              label: name,
              odds,
              randomOdds: random_odds,
            })),
          });
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

    requestStars() {
      if (starsAsked || useGameDataStore.getState().status !== "ready") return;
      if (!buildsStars(documentCapabilities(useFileSessionStore.getState()))) return;
      starsAsked = true;
      const mine = generation;
      Promise.all([ipc.getStarArrangements(), ipc.getStarTypes()]).then(
        ([arrangements, starTypes]) => {
          if (mine === generation) set({ arrangements, starTypes });
        },
        (e: unknown) => {
          if (mine === generation) starsAsked = false;
          console.warn("star arrangements", ipc.errorMessage(e));
        },
      );
    },

    fileStars(stars) {
      if (stars.length === 0 || get().filed.has(starsKey(stars))) return;
      void filing.read([[...stars]]);
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
      starsAsked = false;
      filing.clear();
      if (get().arrangements !== null || get().starTypes !== null || get().filed.size > 0) {
        set({ arrangements: null, starTypes: null, filed: new Map() });
      }
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
