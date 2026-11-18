/**
 * The modifier picker on a scenario system's page, and the removal of one of its rows: both send
 * the system's modifier ops.
 */
import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { ModifierChoice } from "../generated/ModifierChoice";
import {
  addedModifierLine,
  type ModifierChip,
  type ModifierPickRow,
} from "../lib/details/modifierPicker";
import {
  addSystemModifierOp,
  removeSystemModifierOp,
  type SystemModifierTarget,
} from "../lib/details/systemModifiers";
import { useEditorStore } from "./editorStore";
import { pickerSlice, stillOn, type PickerState } from "./pickerSlice";

export interface SystemModifierPickerState extends PickerState<
  ModifierChip,
  ModifierChoice,
  SystemModifierTarget
> {
  open(target: SystemModifierTarget): void;
  /** Adds `row` to the open system for good, and says so. */
  add(row: ModifierPickRow): Promise<void>;
}

export const useSystemModifierPickerStore = create<SystemModifierPickerState>((set, get) => ({
  ...pickerSlice<ModifierChip, ModifierChoice, SystemModifierTarget>(set, get, {
    // The list holds what the system's file held when it was first read, so a modifier only the
    // file added stays offered after it is taken out.
    keyOf: (target) => target.key,
    read: (target) => ipc.getSystemModifierChoices(target.modifiers),
    name: "system modifier choices",
  }),

  open(target) {
    get().openOn(target);
    void get().load(target);
  },

  async add(row) {
    const target = get().target;
    if (target === null) return;
    const op = addSystemModifierOp(target.system, row.choice.modifier);
    if ((await useEditorStore.getState().applyOp(op)) && stillOn(get(), target)) {
      set({ added: addedModifierLine(row, null) });
    }
  },
}));

/** Takes `modifier` out of scenario system `system`'s own effect block. */
export function removeSystemModifier(system: number, modifier: string): Promise<boolean> {
  return useEditorStore.getState().applyOp(removeSystemModifierOp(system, modifier));
}
