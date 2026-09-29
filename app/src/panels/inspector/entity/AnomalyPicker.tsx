import { useEffect, useMemo } from "react";
import {
  ANOMALY_CHIPS,
  anomalyPickRows,
  anomalySections,
  type AnomalyPickRow,
} from "../../../lib/details/anomalyPicker";
import type { PickerTarget } from "../../../lib/details/picker";
import { useAnomalyPickerStore } from "../../../store/anomalyPickerStore";
import { Icon } from "../../parts";
import { PickerMenu, PickerOpener, type PickerItem } from "./PickerMenu";

export const ANOMALY_PICKER_NEEDS_GAME_DATA = "Adding an anomaly needs the game data";
export const READING_ANOMALIES = "Reading the anomalies…";
export const NO_ANOMALY_MATCHES = "No anomaly matches";

/** A category's row: its level, and one Add button. */
function anomalyItem(row: AnomalyPickRow): PickerItem {
  return {
    key: row.key,
    label: row.label,
    gives: row.gives,
    description: row.description,
    art: <Icon keys={[]} glyph="?" />,
    buttons: [{ text: "Add", label: `Add ${row.label}`, title: `Add ${row.label}` }],
  };
}

/** The open picker, with the level chips and one row per category. */
function AnomalyMenu({ target }: { target: PickerTarget }) {
  const query = useAnomalyPickerStore((s) => s.query);
  const chip = useAnomalyPickerStore((s) => s.chip);
  const choices = useAnomalyPickerStore((s) => s.choices);
  useEffect(() => useAnomalyPickerStore.getState().open(target), [target]);
  const rows = useMemo(() => (choices === null ? null : anomalyPickRows(choices.list)), [choices]);
  return (
    <PickerMenu
      usePicker={useAnomalyPickerStore}
      name="Add an anomaly"
      searchName="Search anomalies"
      placeholder="Search name"
      chips={ANOMALY_CHIPS}
      chipsName="Anomaly levels"
      sections={rows === null ? null : anomalySections(rows, chip, query)}
      reading={READING_ANOMALIES}
      noneMatch={NO_ANOMALY_MATCHES}
      idPrefix={`ap-row-${target.key}`}
      item={anomalyItem}
      onAdd={(row) => void useAnomalyPickerStore.getState().add(row)}
    />
  );
}

/** The picker's button, and the picker below it while open. */
export function AnomalyPicker({ target }: { target: PickerTarget }) {
  const open = useAnomalyPickerStore((s) => s.target?.key === target.key);
  if (open) return <AnomalyMenu target={target} />;
  return (
    <PickerOpener
      label="+ Add anomaly…"
      title="Add an anomaly for a science ship to research. If you have surveyed the planet, it shows at once."
      needsGameData={ANOMALY_PICKER_NEEDS_GAME_DATA}
      onOpen={() => useAnomalyPickerStore.getState().open(target)}
    />
  );
}
