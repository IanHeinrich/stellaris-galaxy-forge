import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { DepositChoice } from "../generated/DepositChoice";
import type { Op } from "../generated/Op";
import type { PlanetPage } from "../generated/PlanetPage";
import {
  addedLine,
  type DepositAmount,
  type DepositChip,
  type DepositRow,
  type PickerMode,
} from "../lib/details/depositPicker";
import { addDepositOp } from "../lib/details/planetEdits";
import { useEditorStore } from "./editorStore";
import { usePlanetDataStore } from "./planetDataStore";

/** The body the offered types were read for: its class, size, whether a moon, what it holds. */
function bodyKey(page: PlanetPage, moon: boolean): string {
  return [page.class, page.size ?? 0, moon, ...page.deposits.map((d) => d.kind)].join("|");
}

/**
 * The deposit picker on a planet's page. It lives here rather than in the component because an
 * add makes the page read its planet again, which draws the page anew: the picker stays open, with
 * its search, its chip and the line saying what was added, over the deposits the page now lists.
 */
export interface DepositPickerState {
  /** The planet whose picker is open; `null` when none is. */
  planet: number | null;
  /** Which of its two pickers is open. */
  mode: PickerMode;
  query: string;
  chip: DepositChip;
  /** What the last add added, until the next. */
  added: string | null;
  /** An add waiting for the user to confirm what the game will take away for it. */
  pending: { row: DepositRow; amount: DepositAmount; warnings: readonly string[] } | null;
  /** The types offered, read for the body `body` names; `null` until read. */
  choices: { body: string; list: DepositChoice[] } | null;
  open(page: PlanetPage, moon: boolean, mode: PickerMode): void;
  close(): void;
  setQuery(query: string): void;
  setChip(chip: DepositChip): void;
  /**
   * Adds `amount` of `row` to the open planet and says so; with `warnings`, first holds the add
   * for `confirm` instead.
   */
  add(row: DepositRow, amount: DepositAmount, warnings?: readonly string[]): Promise<void>;
  /** Makes the add waiting on its warnings. */
  confirm(): Promise<void>;
  /** Drops the add waiting on its warnings. */
  cancel(): void;
}

export const useDepositPickerStore = create<DepositPickerState>((set, get) => ({
  planet: null,
  mode: "deposits",
  query: "",
  chip: "All",
  added: null,
  pending: null,
  choices: null,

  open(page, moon, mode) {
    if (get().planet !== page.id || get().mode !== mode) {
      set({ planet: page.id, mode, query: "", chip: "All", added: null, pending: null });
    }
    const body = bodyKey(page, moon);
    if (get().choices?.body === body) return;
    const held = page.deposits.map((d) => d.kind);
    ipc.getDepositChoices(page.class, page.size ?? 0, moon, held).then(
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
    set({ planet: null, query: "", chip: "All", added: null, pending: null });
  },

  setQuery(query) {
    set({ query });
  },

  setChip(chip) {
    set({ chip });
  },

  async add(row, amount, warnings = []) {
    const planet = get().planet;
    if (planet === null) return;
    if (warnings.length > 0) {
      set({ pending: { row, amount, warnings } });
      return;
    }
    set({ pending: null });
    const op: Op = addDepositOp(planet, amount.key);
    if (await useEditorStore.getState().applyOp(op)) set({ added: addedLine(row, amount) });
  },

  async confirm() {
    const pending = get().pending;
    if (pending !== null) await get().add(pending.row, pending.amount);
  },

  cancel() {
    set({ pending: null });
  },
}));
