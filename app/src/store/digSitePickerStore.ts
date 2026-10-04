import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { DigSiteChoice } from "../generated/DigSiteChoice";
import type { DigSiteChip, DigSitePickRow } from "../lib/details/digSitePicker";
import type { PickerTarget } from "../lib/details/picker";
import { pickerSlice, stillOn, type PickerState } from "./pickerSlice";

/**
 * The dig site picker on a planet's page, and the site types the game data offers, which a site's
 * row reads its stage count from too. A planet holds one site, so an add closes the picker.
 */
export interface DigSitePickerState extends PickerState<DigSiteChip, DigSiteChoice> {
  open(target: PickerTarget): void;
  /** Adds a site of `row`'s type to the open body, then closes the picker. */
  add(row: DigSitePickRow): Promise<void>;
}

export const useDigSitePickerStore = create<DigSitePickerState>((set, get) => ({
  ...pickerSlice<DigSiteChip, DigSiteChoice>(set, get, {
    keyOf: () => "",
    read: () => ipc.getDigSiteChoices(),
    name: "dig site choices",
  }),

  open(target) {
    get().openOn(target);
    get().load(target);
  },

  async add(row) {
    const target = get().target;
    if (target === null) return;
    if ((await target.edits.addDigSite(row.choice)) && stillOn(get(), target)) get().close();
  },
}));
