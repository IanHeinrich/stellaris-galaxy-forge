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

/**
 * Each system's modifiers its page has shown since the file was read, so a modifier no script adds
 * stays offered after it is taken out, through other systems' lists and game data reloads.
 */
const shown = new Map<number, Set<string>>();

/** `target`'s modifiers, with every other one its page has shown since the file was read. */
function shownOn(target: SystemModifierTarget): string[] {
  const seen = shown.get(target.system) ?? new Set<string>();
  for (const modifier of target.modifiers) seen.add(modifier);
  shown.set(target.system, seen);
  return [...seen];
}

/** Forgets the modifiers the pages have shown, once the file is read again. */
export function forgetShownSystemModifiers(): void {
  shown.clear();
}

export const useSystemModifierPickerStore = create<SystemModifierPickerState>((set, get) => ({
  ...pickerSlice<ModifierChip, ModifierChoice, SystemModifierTarget>(set, get, {
    keyOf: (target) => target.key,
    read: (target) => ipc.getSystemModifierChoices(shownOn(target)),
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
