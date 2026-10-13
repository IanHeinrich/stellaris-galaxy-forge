import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { AnomalyChoice } from "../generated/AnomalyChoice";
import type { AnomalyChip, AnomalyPickRow } from "../lib/details/anomalyPicker";
import { pickOneSlice, type PickOneState } from "./pickOneSlice";

/** The anomaly picker on a planet's page. A planet holds one anomaly, so an add closes the picker. */
export type AnomalyPickerState = PickOneState<AnomalyChip, AnomalyChoice, AnomalyPickRow>;

export const useAnomalyPickerStore = create<AnomalyPickerState>((set, get) =>
  pickOneSlice(
    set,
    get,
    {
      keyOf: (target) => [target.planetClass, target.size, target.moon].join("|"),
      read: (target) => ipc.getAnomalyChoices(target.planetClass, target.size, target.moon),
      name: "anomaly choices",
    },
    (edits, row) => edits.addAnomaly(row.key),
  ),
);
