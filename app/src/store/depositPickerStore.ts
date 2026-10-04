import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { DepositChoice } from "../generated/DepositChoice";
import {
  addedLine,
  type DepositAmount,
  type DepositChip,
  type DepositRow,
  type PickerMode,
} from "../lib/details/depositPicker";
import type { PickerTarget } from "../lib/details/picker";
import { PICKER_CLOSED, pickerSlice, stillOn, type PickerState } from "./pickerSlice";
import { usePlanetDataStore } from "./planetDataStore";

/** The deposit picker on a planet's page, and the add waiting on its warnings. */
export interface DepositPickerState extends PickerState<DepositChip, DepositChoice> {
  /** Which of its two pickers is open. */
  mode: PickerMode;
  /** An add waiting for the user to confirm what the game will take away for it. */
  pending: { row: DepositRow; amount: DepositAmount; warnings: readonly string[] } | null;
  open(target: PickerTarget, mode: PickerMode): void;
  /**
   * Adds `amount` of `row` to the open body and says so; with `warnings`, first holds the add
   * for `confirm` instead. Asking again for the amount being held confirms it.
   */
  add(row: DepositRow, amount: DepositAmount, warnings?: readonly string[]): Promise<void>;
  /** Makes the add waiting on its warnings. */
  confirm(): Promise<void>;
  /** Drops the add waiting on its warnings. */
  cancel(): void;
}

/** The types offered `target`'s body, with the pages of each asked for as they land. */
async function depositChoices(target: PickerTarget): Promise<DepositChoice[]> {
  const list = await ipc.getDepositChoices(target.planetClass, target.size, target.moon, [
    ...target.deposits,
  ]);
  usePlanetDataStore
    .getState()
    .request({ deposits: list.map((c) => c.key), modifiers: [], colonyTypes: [] });
  return list;
}

export const useDepositPickerStore = create<DepositPickerState>((set, get) => {
  const slice = pickerSlice<DepositChip, DepositChoice>(set, get, {
    keyOf: (target) => [target.planetClass, target.size, target.moon, ...target.deposits].join("|"),
    read: depositChoices,
    name: "deposit choices",
  });
  return {
    ...slice,
    mode: "deposits",
    pending: null,

    open(target, mode) {
      if (get().mode !== mode) set({ ...PICKER_CLOSED, mode, pending: null });
      if (get().target?.key !== target.key) set({ pending: null });
      get().openOn(target);
      get().load(target);
    },

    close() {
      slice.close();
      set({ pending: null });
    },

    reset() {
      slice.reset();
      set({ mode: "deposits", pending: null });
    },

    async add(row, amount, warnings = []) {
      const target = get().target;
      if (target === null) return;
      if (warnings.length > 0 && get().pending?.amount.key !== amount.key) {
        set({ pending: { row, amount, warnings } });
        return;
      }
      set({ pending: null });
      if ((await target.edits.addDeposit(amount.key)) && stillOn(get(), target)) {
        set({ added: addedLine(row, amount) });
      }
    },

    async confirm() {
      const pending = get().pending;
      if (pending !== null) await get().add(pending.row, pending.amount);
    },

    cancel() {
      set({ pending: null });
    },
  };
});
