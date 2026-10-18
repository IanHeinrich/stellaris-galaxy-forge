import { create } from "zustand";
import type { Arrangement } from "../generated/Arrangement";
import type { StarType } from "../generated/StarType";
import type { Pt } from "../lib/geometry/pt";
import { arrangementOf, fitSlots } from "../lib/multiStar";
import { useEditorStore } from "./editorStore";
import { useGeneratorStore } from "./generatorStore";
import { PREF_KEYS } from "./prefKeys";
import { isBoolean, prefField } from "./prefs";
import { useSpecialPickerStore } from "./specialPickerStore";

/** The arrangement and stars the builder was left with. */
interface LastBuilt {
  layout: string;
  stars: string[];
}

function isLastBuilt(value: unknown): value is LastBuilt {
  if (typeof value !== "object" || value === null) return false;
  const { layout, stars } = value as Partial<LastBuilt>;
  return (
    typeof layout === "string" && Array.isArray(stars) && stars.every((s) => typeof s === "string")
  );
}

const LAST = prefField<LastBuilt | null>(
  PREF_KEYS.starBuilderLast,
  null,
  (value): value is LastBuilt | null => value === null || isLastBuilt(value),
);
const NO_PLANETS = prefField(PREF_KEYS.starBuilderNoPlanets, false, isBoolean);
const NO_EXTENT: Pt = { x: 0, y: 0 };

/** The builder: a binary or trinary of the player's own stars, placed beside a right-clicked point. */
export interface StarBuilderState {
  open: boolean;
  /** The world point the system goes at. */
  at: Pt | null;
  /** The same point in the map area's pixels, which the dialog opens beside. */
  anchor: Pt | null;
  /** The map area's pixels per world unit about the point. */
  perUnit: Pt;
  /** The arrangement chosen; the first one offered while none is, or it is gone. Remembered. */
  layout: string | null;
  /**
   * The stars chosen, in slot order, with any past the arrangement's slots kept so a trio's third
   * star comes back after a pair; `builtStars` fits them to the arrangement. Remembered.
   */
  stars: string[];
  /** The class the player chose for the galaxy map, or null for the automatic one. */
  starClass: string | null;
  /** Whether the stars are added alone, with no planets, moons or belts; remembered. */
  noPlanets: boolean;

  openAt(at: Pt, anchor: Pt, perUnit?: Pt): void;
  close(): void;
  setLayout(layout: string): void;
  /** Puts `star` in slot `index`. */
  setStar(index: number, star: string): void;
  /** Fills the slots with `stars` in order, as a chip of the game's own sets does. */
  fillStars(stars: readonly string[]): void;
  setStarClass(starClass: string | null): void;
  setNoPlanets(noPlanets: boolean): void;
  /** Adds the system at the point and closes; false when nothing was added. */
  place(): Promise<boolean>;
}

/** The builder's arrangement and slots, fitted to what the install offers. */
export interface BuiltView {
  arrangement: Arrangement | null;
  slots: string[];
  /** The star the unused last slot of a pair shows, greyed; null where every slot is in use. */
  spare: string | null;
}

/** The most stars an arrangement has. */
const MAX_STARS = 3;

/**
 * The star a pair's unused third slot shows: the third star `stars` still holds, else the first
 * star's type, as a trio would start with. Null for a trio, which has no unused slot.
 */
export function spareStar(
  stars: readonly string[],
  count: number,
  starTypes: readonly StarType[] | null,
): string | null {
  return count >= MAX_STARS ? null : fitSlots(stars, MAX_STARS, starTypes)[MAX_STARS - 1];
}

/** The arrangement `layout` names, or the first offered, and `stars` fitted to its slots. */
export function builtStars(
  layout: string | null,
  stars: readonly string[],
  arrangements: readonly Arrangement[] | null,
  starTypes: readonly StarType[] | null,
): BuiltView {
  const offered = arrangements ?? [];
  const arrangement =
    (layout === null ? null : arrangementOf(offered, layout)) ?? offered[0] ?? null;
  if (arrangement === null) return { arrangement, slots: [...stars], spare: null };
  return {
    arrangement,
    slots: fitSlots(stars, arrangement.stars, starTypes),
    spare: spareStar(stars, arrangement.stars, starTypes),
  };
}

export const useStarBuilderStore = create<StarBuilderState>((set, get) => {
  /** The builder's arrangement and slots as the generator's lists stand now. */
  function viewNow(layout = get().layout, stars: readonly string[] = get().stars): BuiltView {
    const { arrangements, starTypes } = useGeneratorStore.getState();
    return builtStars(layout, stars, arrangements, starTypes);
  }

  /**
   * Keeps `layout` and `stars`, with the stars held past its slots, remembers them and asks how
   * the slots are filed.
   */
  function choose(layout: string | null, stars: readonly string[]) {
    const { arrangement, slots } = viewNow(layout, stars);
    const kept = arrangement === null ? slots : [...slots, ...get().stars.slice(slots.length)];
    set({ layout: arrangement?.layout ?? layout, stars: kept });
    if (arrangement !== null) LAST.save({ layout: arrangement.layout, stars: kept });
    useGeneratorStore.getState().fileStars(slots);
  }

  const last = LAST.read();
  return {
    open: false,
    at: null,
    anchor: null,
    perUnit: NO_EXTENT,
    layout: last?.layout ?? null,
    stars: last?.stars ?? [],
    starClass: null,
    noPlanets: NO_PLANETS.read(),

    openAt(at, anchor, perUnit = NO_EXTENT) {
      set({
        open: true,
        at: { ...at },
        anchor: { ...anchor },
        perUnit: { ...perUnit },
        starClass: null,
      });
      useGeneratorStore.getState().requestStars();
    },

    close() {
      set({ open: false });
    },

    setLayout(layout) {
      choose(layout, get().stars);
    },

    setStar(index, star) {
      const slots = [...viewNow().slots];
      if (index < 0 || index >= slots.length) return;
      slots[index] = star;
      choose(get().layout, slots);
    },

    fillStars(stars) {
      const { slots } = viewNow();
      choose(
        get().layout,
        slots.map((star, i) => stars[i] ?? star),
      );
    },

    setStarClass(starClass) {
      set({ starClass });
    },

    setNoPlanets(noPlanets) {
      set({ noPlanets });
      NO_PLANETS.save(noPlanets);
    },

    async place() {
      const { open, at, starClass, noPlanets } = get();
      const { arrangement, slots } = viewNow();
      if (!open || at === null || arrangement === null || slots.length !== arrangement.stars) {
        return false;
      }
      const join = useSpecialPickerStore.getState().join;
      const added = await useEditorStore
        .getState()
        .addBuiltSystemAt(
          at.x,
          at.y,
          { layout: arrangement.layout, stars: slots, starClass, planets: !noPlanets },
          join,
        );
      if (!added) return false;
      get().close();
      return true;
    },
  };
});
