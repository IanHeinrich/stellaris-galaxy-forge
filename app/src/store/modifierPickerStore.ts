import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { ModifierChoice } from "../generated/ModifierChoice";
import {
  addedModifierLine,
  addModifierOp,
  type ModifierChip,
  type ModifierPickRow,
} from "../lib/details/modifierPicker";
import { useEditorStore } from "./editorStore";

/**
 * The modifier picker on a planet's page. It lives here rather than in the component because an
 * add makes the page read its planet again, which draws the page anew: the picker stays open, with
 * its search, its chip, its duration and the line saying what was added.
 */
export interface ModifierPickerState {
  /** The planet whose picker is open; `null` when none is. */
  planet: number | null;
  query: string;
  chip: ModifierChip;
  /** How many days the next add lasts; `null` for ever. */
  days: number | null;
  /** What the last add added, until the next. */
  added: string | null;
  /** The modifiers offered; `null` until read. */
  choices: ModifierChoice[] | null;
  open(planet: number): void;
  close(): void;
  setQuery(query: string): void;
  setChip(chip: ModifierChip): void;
  setDays(days: number | null): void;
  /** Adds `row` to the open planet for the days set and says so. */
  add(row: ModifierPickRow): Promise<void>;
}

export const useModifierPickerStore = create<ModifierPickerState>((set, get) => ({
  planet: null,
  query: "",
  chip: "All",
  days: null,
  added: null,
  choices: null,

  open(planet) {
    if (get().planet !== planet) set({ planet, query: "", chip: "All", added: null });
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
    set({ planet: null, query: "", chip: "All", added: null, choices: null });
  },

  setQuery(query) {
    set({ query });
  },

  setChip(chip) {
    set({ chip });
  },

  setDays(days) {
    set({ days });
  },

  async add(row) {
    const { planet, days } = get();
    if (planet === null) return;
    const op = addModifierOp(planet, row.choice, days);
    if (await useEditorStore.getState().applyOp(op)) set({ added: addedModifierLine(row, days) });
  },
}));
