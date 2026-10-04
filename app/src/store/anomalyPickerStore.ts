import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { AnomalyChoice } from "../generated/AnomalyChoice";
import type { AnomalyChip, AnomalyPickRow } from "../lib/details/anomalyPicker";
import type { PickerTarget } from "../lib/details/picker";
import { pickerSlice, stillOn, type PickerState } from "./pickerSlice";

/** The anomaly picker on a planet's page. */
export interface AnomalyPickerState extends PickerState<AnomalyChip, AnomalyChoice> {
  open(target: PickerTarget): void;
  /** Adds `row` to the open body and closes, as a planet holds one anomaly. */
  add(row: AnomalyPickRow): Promise<void>;
}

export const useAnomalyPickerStore = create<AnomalyPickerState>((set, get) => ({
  ...pickerSlice<AnomalyChip, AnomalyChoice>(set, get, {
    keyOf: (target) => [target.planetClass, target.size, target.moon].join("|"),
    read: (target) => ipc.getAnomalyChoices(target.planetClass, target.size, target.moon),
    name: "anomaly choices",
  }),

  open(target) {
    get().openOn(target);
    get().load(target);
  },

  async add(row) {
    const target = get().target;
    if (target === null) return;
    if ((await target.edits.addAnomaly(row.key)) && stillOn(get(), target)) get().close();
  },
}));
