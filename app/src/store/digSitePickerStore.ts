import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { DigSiteChoice } from "../generated/DigSiteChoice";
import type { DigSiteChip, DigSitePickRow } from "../lib/details/digSitePicker";
import { pickOneSlice, type PickOneState } from "./pickOneSlice";

/** The dig site picker on a planet's page. A planet holds one site, so an add closes the picker. */
export type DigSitePickerState = PickOneState<DigSiteChip, DigSiteChoice, DigSitePickRow>;

export const useDigSitePickerStore = create<DigSitePickerState>((set, get) =>
  pickOneSlice(
    set,
    get,
    { keyOf: () => "", read: () => ipc.getDigSiteChoices(), name: "dig site choices" },
    (edits, row) => edits.addDigSite(row.choice),
  ),
);
