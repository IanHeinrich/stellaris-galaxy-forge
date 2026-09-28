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
import { PICKER_CLOSED, pickerSlice, type PickerState } from "./pickerSlice";
import { usePlanetDataStore } from "./planetDataStore";

/** The body the offered types were read for: its class, size, whether a moon, what it holds. */
function bodyKey(target: PickerTarget): string {
  return [target.planetClass, target.size, target.moon, ...target.deposits].join("|");
}

/** The deposit picker on a planet's page, and the add waiting on its warnings. */
export interface DepositPickerState extends PickerState<DepositChip> {
  /** Which of its two pickers is open. */
  mode: PickerMode;
  /** An add waiting for the user to confirm what the game will take away for it. */
  pending: { row: DepositRow; amount: DepositAmount; warnings: readonly string[] } | null;
  /** The types offered, read for the body `body` names; `null` until read. */
  choices: { body: string; list: DepositChoice[] } | null;
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

export const useDepositPickerStore = create<DepositPickerState>((set, get) => ({
  ...pickerSlice<DepositChip>(set),
  mode: "deposits",
  pending: null,
  choices: null,

  open(target, mode) {
    const was = get().target;
    if (was?.key !== target.key || get().mode !== mode) {
      set({ ...PICKER_CLOSED, target, mode, pending: null });
    } else if (was !== target) {
      set({ target });
    }
    const body = bodyKey(target);
    if (get().choices?.body === body) return;
    ipc.getDepositChoices(target.planetClass, target.size, target.moon, [...target.deposits]).then(
      (list) => {
        usePlanetDataStore
          .getState()
          .request({ deposits: list.map((c) => c.key), modifiers: [], colonyTypes: [] });
        set({ choices: { body, list } });
      },
      (e: unknown) => {
        console.warn("deposit choices", ipc.errorMessage(e));
        set({ choices: { body, list: [] } });
      },
    );
  },

  close() {
    set({ ...PICKER_CLOSED, pending: null });
  },

  async add(row, amount, warnings = []) {
    const target = get().target;
    if (target === null) return;
    if (warnings.length > 0 && get().pending?.amount.key !== amount.key) {
      set({ pending: { row, amount, warnings } });
      return;
    }
    set({ pending: null });
    if (await target.edits.addDeposit(amount.key)) set({ added: addedLine(row, amount) });
  },

  async confirm() {
    const pending = get().pending;
    if (pending !== null) await get().add(pending.row, pending.amount);
  },

  cancel() {
    set({ pending: null });
  },
}));
