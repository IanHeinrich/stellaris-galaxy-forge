import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { AnomalyChoice } from "../generated/AnomalyChoice";
import type { AnomalyChip, AnomalyPickRow } from "../lib/details/anomalyPicker";
import type { PickerTarget } from "../lib/details/picker";
import { PICKER_CLOSED, pickerSlice, type PickerState } from "./pickerSlice";

/** The body the offered categories were read for: its class, size and whether a moon. */
function bodyKey(target: PickerTarget): string {
  return [target.planetClass, target.size, target.moon].join("|");
}

/** The anomaly picker on a planet's page. */
export interface AnomalyPickerState extends PickerState<AnomalyChip> {
  /** The categories offered, read for the body `body` names; `null` until read. */
  choices: { body: string; list: AnomalyChoice[] } | null;
  open(target: PickerTarget): void;
  /** Adds `row` to the open body and closes, as a planet holds one anomaly. */
  add(row: AnomalyPickRow): Promise<void>;
}

export const useAnomalyPickerStore = create<AnomalyPickerState>((set, get) => ({
  ...pickerSlice<AnomalyChip>(set),
  choices: null,

  open(target) {
    const was = get().target;
    if (was?.key !== target.key) set({ ...PICKER_CLOSED, target });
    else if (was !== target) set({ target });
    const body = bodyKey(target);
    if (get().choices?.body === body) return;
    ipc.getAnomalyChoices(target.planetClass, target.size, target.moon).then(
      (list) => set({ choices: { body, list } }),
      (e: unknown) => {
        console.warn("anomaly choices", ipc.errorMessage(e));
        set({ choices: { body, list: [] } });
      },
    );
  },

  close() {
    set({ ...PICKER_CLOSED });
  },

  async add(row) {
    const target = get().target;
    if (target === null) return;
    if (await target.edits.addAnomaly(row.key)) get().close();
  },
}));
