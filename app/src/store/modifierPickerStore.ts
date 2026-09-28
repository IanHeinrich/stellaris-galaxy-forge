import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { ModifierChoice } from "../generated/ModifierChoice";
import {
  addedModifierLine,
  type ModifierChip,
  type ModifierPickRow,
} from "../lib/details/modifierPicker";
import type { PickerTarget } from "../lib/details/picker";
import { PICKER_CLOSED, pickerSlice, type PickerState } from "./pickerSlice";

/** The modifier picker on a planet's page, and how long its next add lasts. */
export interface ModifierPickerState extends PickerState<ModifierChip> {
  /** How many days the next add lasts; `null` for ever. */
  days: number | null;
  /** The modifiers offered; `null` until read. */
  choices: ModifierChoice[] | null;
  open(target: PickerTarget): void;
  setDays(days: number | null): void;
  /** Adds `row` to the open body for the days set, where its source can time one, and says so. */
  add(row: ModifierPickRow): Promise<void>;
}

export const useModifierPickerStore = create<ModifierPickerState>((set, get) => ({
  ...pickerSlice<ModifierChip>(set),
  days: null,
  choices: null,

  open(target) {
    const was = get().target;
    if (was?.key !== target.key) set({ ...PICKER_CLOSED, target });
    else if (was !== target) set({ target });
    if (get().choices !== null) return;
    ipc.getModifierChoices().then(
      (choices) => set({ choices }),
      (e: unknown) => {
        console.warn("modifier choices", ipc.errorMessage(e));
        set({ choices: [] });
      },
    );
  },

  close() {
    set({ ...PICKER_CLOSED, choices: null });
  },

  setDays(days) {
    set({ days });
  },

  async add(row) {
    const target = get().target;
    if (target === null) return;
    const days = target.edits.timedModifiers ? get().days : null;
    if (await target.edits.addModifier(row.choice, days)) {
      set({ added: addedModifierLine(row, days) });
    }
  },
}));
