import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { DigSiteChoice } from "../generated/DigSiteChoice";
import type { DigSiteChip, DigSitePickRow } from "../lib/details/digSitePicker";
import type { PickerTarget } from "../lib/details/picker";
import { PICKER_CLOSED, pickerSlice, type PickerState } from "./pickerSlice";

/**
 * The dig site picker on a planet's page, and the site types the game data offers, which a site's
 * row reads its stage count from too. A planet holds one site, so an add closes the picker.
 */
export interface DigSitePickerState extends PickerState<DigSiteChip> {
  /** The site types offered; `null` until read. */
  choices: DigSiteChoice[] | null;
  /** The site types are being read. */
  reading: boolean;
  open(target: PickerTarget): void;
  /** Reads the site types, unless they are read or being read. */
  read(): void;
  /** Adds a site of `row`'s type to the open body, then closes the picker. */
  add(row: DigSitePickRow): Promise<void>;
}

export const useDigSitePickerStore = create<DigSitePickerState>((set, get) => ({
  ...pickerSlice<DigSiteChip>(set),
  choices: null,
  reading: false,

  open(target) {
    const was = get().target;
    if (was?.key !== target.key) set({ ...PICKER_CLOSED, target });
    else if (was !== target) set({ target });
    get().read();
  },

  read() {
    if (get().choices !== null || get().reading) return;
    set({ reading: true });
    ipc.getDigSiteChoices().then(
      (choices) => set({ choices, reading: false }),
      (e: unknown) => {
        console.warn("dig site choices", ipc.errorMessage(e));
        set({ choices: [], reading: false });
      },
    );
  },

  close() {
    set({ ...PICKER_CLOSED, choices: null });
  },

  async add(row) {
    const target = get().target;
    if (target === null) return;
    if (await target.edits.addDigSite(row.choice)) set({ ...PICKER_CLOSED });
  },
}));
