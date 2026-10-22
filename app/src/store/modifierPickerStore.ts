import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { ModifierChoice } from "../generated/ModifierChoice";
import {
  addedModifierLine,
  type ModifierChip,
  type ModifierPickRow,
} from "../lib/details/modifierPicker";
import type { PickerTarget } from "../lib/details/picker";
import { useGameDataStore } from "./gameDataStore";
import { pickerSlice, stillOn, type PickerState } from "./pickerSlice";

/** The modifier picker on a planet's page, and how long its next add lasts. */
export interface ModifierPickerState extends PickerState<ModifierChip, ModifierChoice> {
  /** How many days the next add lasts; `null` for ever. */
  days: number | null;
  open(target: PickerTarget): void;
  setDays(days: number | null): void;
  /** Adds `row` to the open body for the days set, where its source can time one, and says so. */
  add(row: ModifierPickRow): Promise<void>;
}

/** The list's key: every body is offered the same modifiers. */
const ANY_BODY = "";
const readChoices = () => ipc.getModifierChoices();

export const useModifierPickerStore = create<ModifierPickerState>((set, get) => ({
  ...pickerSlice<ModifierChip, ModifierChoice>(set, get, {
    keyOf: () => ANY_BODY,
    read: readChoices,
    name: "modifier choices",
  }),
  days: null,

  open(target) {
    get().openOn(target);
    void get().load(target);
  },

  setDays(days) {
    set({ days });
  },

  async add(row) {
    const target = get().target;
    if (target === null) return;
    const days = target.edits.timedModifiers ? get().days : null;
    if ((await target.edits.addModifier(row.choice, days)) && stillOn(get(), target)) {
      set({ added: addedModifierLine(row, days) });
    }
  },
}));

/**
 * The modifiers the game data offers, with the flags each sets, read once per game data into the
 * picker's list whether or not it is open; rejects when they can't be read.
 */
export function modifierChoices(): Promise<ModifierChoice[]> {
  const { version } = useGameDataStore.getState();
  return useModifierPickerStore.getState().choicesFor(ANY_BODY, version, readChoices);
}
