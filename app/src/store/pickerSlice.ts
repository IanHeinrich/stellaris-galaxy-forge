import { errorMessage } from "../api/ipc";
import type { PickerTarget } from "../lib/details/picker";
import { useGameDataStore } from "./gameDataStore";

/**
 * What every picker on a planet's page keeps. It lives in a store rather than the component
 * because an add makes the page read its body again, which draws the page anew: the picker stays
 * open, with its search, its chip and the line saying what was added.
 */
export interface PickerState<C extends string, T> {
  /** The body whose picker is open; `null` when none is. */
  target: PickerTarget | null;
  query: string;
  chip: C;
  /** What the last add added, until the next. */
  added: string | null;
  /**
   * What the picker offers, read for the body and the game data `body` names; `null` until the
   * list for the body last asked about lands.
   */
  choices: { body: string; list: T[] } | null;
  /** The `body` of the list being read; a reply for any other is dropped. */
  reading: string | null;
  setQuery(query: string): void;
  setChip(chip: C): void;
  /** Opens on `target`, keeping the search and chip when its body is the one already open. */
  openOn(target: PickerTarget): void;
  /** Reads the list for `key` at game data `version` with `read`, unless it is held or asked. */
  choicesFor(key: string, version: number, read: () => Promise<T[]>): void;
  /** Reads what the picker offers `target`'s body, without opening. */
  load(target: PickerTarget): void;
  close(): void;
  /** Closed, with nothing read. */
  reset(): void;
}

/** Where a picker's list comes from. */
export interface ChoicesSource<T> {
  /** What the list depends on in a body, besides the game data. */
  keyOf(target: PickerTarget): string;
  read(target: PickerTarget): Promise<T[]>;
  /** Names the list in the warning when it cannot be read. */
  name: string;
}

/** A closed picker's state, its search and chip cleared. */
export const PICKER_CLOSED = { target: null, query: "", chip: "All", added: null } as const;

/** The closed state and the actions every picker's store shares; each store adds its `add`. */
export function pickerSlice<C extends string, T>(
  set: (partial: Partial<PickerState<C, T>>) => void,
  get: () => PickerState<C, T>,
  source: ChoicesSource<T>,
) {
  const closed = { ...PICKER_CLOSED, chip: "All" as C };
  return {
    ...closed,
    choices: null,
    reading: null,
    setQuery: (query: string) => set({ query }),
    setChip: (chip: C) => set({ chip }),

    openOn(target: PickerTarget) {
      const was = get().target;
      if (was?.key !== target.key) set({ ...closed, target });
      else if (was !== target) set({ target });
    },

    choicesFor(key: string, version: number, read: () => Promise<T[]>) {
      const body = `${version}|${key}`;
      const { choices, reading } = get();
      if (choices?.body === body || reading === body) return;
      set({ choices: null, reading: body });
      const land = (list: T[]) => {
        if (get().reading === body) set({ choices: { body, list }, reading: null });
      };
      read().then(land, (e: unknown) => {
        console.warn(source.name, errorMessage(e));
        land([]);
      });
    },

    load(target: PickerTarget) {
      const { version } = useGameDataStore.getState();
      get().choicesFor(source.keyOf(target), version, () => source.read(target));
    },

    close() {
      set({ ...closed });
    },

    reset() {
      set({ ...closed, choices: null, reading: null });
    },
  };
}

/** Whether the picker is still open on `target`'s body, so a late add may still act on it. */
export function stillOn(state: { target: PickerTarget | null }, target: PickerTarget): boolean {
  return state.target?.key === target.key;
}
