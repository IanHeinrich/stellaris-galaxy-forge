import { errorMessage } from "../api/ipc";
import type { PickerTarget, PickTarget } from "../lib/details/picker";
import { useGameDataStore } from "./gameDataStore";

/**
 * What every picker on a planet's or a system's page keeps. It lives in a store rather than the
 * component because an add makes the page read its target again, which draws the page anew: the
 * picker stays open, with its search, its chip and the line saying what was added.
 */
export interface PickerState<C extends string, T, G extends PickTarget = PickerTarget> {
  /** The target whose picker is open; `null` when none is. */
  target: G | null;
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
  /** Opens on `target`, keeping the search and chip when it is the one already open. */
  openOn(target: G): void;
  /**
   * Reads the list for `key` at game data `version` with `read`, unless it is held or asked, and
   * resolves to it; rejects when that read failed, though the picker then shows an empty list.
   */
  choicesFor(key: string, version: number, read: () => Promise<T[]>): Promise<T[]>;
  /** Reads what the picker offers `target`, without opening, and resolves to it as `choicesFor` does. */
  load(target: G): Promise<T[]>;
  close(): void;
  /** Closed, with nothing read. */
  reset(): void;
}

/** Where a picker's list comes from. */
export interface ChoicesSource<T, G extends PickTarget = PickerTarget> {
  /** What the list depends on in a target, besides the game data. */
  keyOf(target: G): string;
  read(target: G): Promise<T[]>;
  /** Names the list in the warning when it cannot be read. */
  name: string;
}

/** A closed picker's state, its search and chip cleared. */
export const PICKER_CLOSED = { target: null, query: "", chip: "All", added: null } as const;

/** The closed state and the actions every picker's store shares; each store adds its `add`. */
export function pickerSlice<C extends string, T, G extends PickTarget = PickerTarget>(
  set: (partial: Partial<PickerState<C, T, G>>) => void,
  get: () => PickerState<C, T, G>,
  source: ChoicesSource<T, G>,
) {
  const closed = { ...PICKER_CLOSED, chip: "All" as C };
  /** The read of the list last asked for, whose `body` the state's `reading` or `choices` names. */
  let asked: { body: string; list: Promise<T[]> } | null = null;
  return {
    ...closed,
    choices: null,
    reading: null,
    setQuery: (query: string) => set({ query }),
    setChip: (chip: C) => set({ chip }),

    openOn(target: G) {
      const was = get().target;
      if (was?.key !== target.key) set({ ...closed, target });
      else if (was !== target) set({ target });
    },

    choicesFor(key: string, version: number, read: () => Promise<T[]>) {
      const body = `${version}|${key}`;
      const { choices, reading } = get();
      if (asked?.body === body && (choices?.body === body || reading === body)) return asked.list;
      if (choices?.body === body) return Promise.resolve(choices.list);
      set({ choices: null, reading: body });
      const land = (list: T[]) => {
        if (get().reading === body) set({ choices: { body, list }, reading: null });
      };
      const list = read();
      asked = { body, list };
      list.then(land, (e: unknown) => {
        console.warn(source.name, errorMessage(e));
        land([]);
      });
      return list;
    },

    load(target: G) {
      const { version } = useGameDataStore.getState();
      return get().choicesFor(source.keyOf(target), version, () => source.read(target));
    },

    close() {
      set({ ...closed });
    },

    reset() {
      set({ ...closed, choices: null, reading: null });
    },
  };
}

/** Whether the picker is still open on `target`, so a late add may still act on it. */
export function stillOn(state: { target: PickTarget | null }, target: PickTarget): boolean {
  return state.target?.key === target.key;
}
