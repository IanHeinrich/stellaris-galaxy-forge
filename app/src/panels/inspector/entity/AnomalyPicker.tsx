import { useMemo } from "react";
import {
  ANOMALY_CHIPS,
  anomalyPickRows,
  anomalySections,
  type AnomalyChip,
  type AnomalyPickRow,
} from "../../../lib/details/anomalyPicker";
import type { AnomalyChoice } from "../../../generated/AnomalyChoice";
import { useAnomalyPickerStore } from "../../../store/anomalyPickerStore";
import { Icon } from "../../parts";
import type { PickerItem } from "./PickerMenu";
import type { PickerKind } from "./PlanetPicker";

/** A category's row: its level, and one Add button. */
function anomalyItem(row: AnomalyPickRow): PickerItem {
  return {
    key: row.key,
    label: row.label,
    effects: row.effects,
    description: row.description,
    art: <Icon keys={[]} glyph="?" />,
    buttons: [{ text: "Add", label: `Add ${row.label}`, title: `Add ${row.label}` }],
  };
}

/** The anomaly picker, with the level chips and one row per category. */
export const ANOMALY_PICKER: PickerKind<AnomalyPickRow, AnomalyChip, AnomalyChoice> = {
  store: useAnomalyPickerStore,
  words: {
    name: "Add an anomaly",
    searchName: "Search anomalies",
    placeholder: "Search name",
    chipsName: "Anomaly levels",
    reading: "Reading the anomalies…",
    noneMatch: "No anomaly matches",
    opener: {
      label: "+ Add anomaly…",
      title:
        "Add an anomaly for a science ship to research. If you have surveyed the planet, it shows at once.",
      needsGameData: "Adding an anomaly needs the game data",
    },
  },
  chips: ANOMALY_CHIPS,
  idPrefix: (target) => `ap-row-${target.key}`,
  useIsOpen: (target) => useAnomalyPickerStore((s) => s.target?.key === target.key),
  open: (target) => useAnomalyPickerStore.getState().open(target),
  useRows: (choices) =>
    useMemo(() => (choices === null ? null : anomalyPickRows(choices.list)), [choices]),
  sections: anomalySections,
  item: anomalyItem,
  onAdd: (row) => void useAnomalyPickerStore.getState().add(row),
};
