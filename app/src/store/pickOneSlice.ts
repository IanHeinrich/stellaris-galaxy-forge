import type { PickerTarget } from "../lib/details/picker";
import { pickerSlice, stillOn, type ChoicesSource, type PickerState } from "./pickerSlice";

/** A picker for something a planet holds one of: an add closes it. */
export interface PickOneState<C extends string, T, Row> extends PickerState<C, T> {
  /** Opens on `target` and reads what it offers. */
  open(target: PickerTarget): void;
  /** Adds `row` to the open body, then closes the picker. */
  add(row: Row): Promise<void>;
}

/**
 * The state and actions of a picker whose add closes it. `addTo` sends the add through the open
 * body's edits and answers whether it was made.
 */
export function pickOneSlice<C extends string, T, Row>(
  set: (partial: Partial<PickOneState<C, T, Row>>) => void,
  get: () => PickOneState<C, T, Row>,
  source: ChoicesSource<T>,
  addTo: (edits: PickerTarget["edits"], row: Row) => Promise<boolean>,
): PickOneState<C, T, Row> {
  return {
    ...pickerSlice<C, T>(set, get, source),

    open(target) {
      get().openOn(target);
      get().load(target);
    },

    async add(row) {
      const target = get().target;
      if (target === null) return;
      if ((await addTo(target.edits, row)) && stillOn(get(), target)) get().close();
    },
  };
}
