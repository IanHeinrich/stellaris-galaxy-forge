import type { PickerTarget } from "../lib/details/picker";

/**
 * What every picker on a planet's page keeps. It lives in a store rather than the component
 * because an add makes the page read its body again, which draws the page anew: the picker stays
 * open, with its search, its chip and the line saying what was added.
 */
export interface PickerState<C extends string> {
  /** The body whose picker is open; `null` when none is. */
  target: PickerTarget | null;
  query: string;
  chip: C;
  /** What the last add added, until the next. */
  added: string | null;
  setQuery(query: string): void;
  setChip(chip: C): void;
  close(): void;
}

/** A closed picker's state, its search and chip cleared. */
export const PICKER_CLOSED = { target: null, query: "", chip: "All", added: null } as const;

/** The closed state and the setters every picker's store starts from. */
export function pickerSlice<C extends string>(
  set: (partial: Partial<Pick<PickerState<C>, "query" | "chip">>) => void,
) {
  return {
    ...PICKER_CLOSED,
    setQuery: (query: string) => set({ query }),
    setChip: (chip: C) => set({ chip }),
  };
}
