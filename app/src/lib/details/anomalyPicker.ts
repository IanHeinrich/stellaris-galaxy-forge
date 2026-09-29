/**
 * The anomaly picker on a planet's page: one row per category the game data offers, the chips
 * that narrow the rows to a level, and the search by name.
 */
import type { AnomalyChoice } from "../../generated/AnomalyChoice";
import {
  byLabel,
  COMMON_CHIPS,
  pickerSections,
  searchText,
  type ChipItem,
  type CommonChip,
  type PickerSection,
} from "./picker";

/** A chip above the rows: every row, the rows usual for the planet, or a band of levels. */
export type AnomalyChip = CommonChip | "Low" | "Middle" | "High";

export const ANOMALY_CHIPS: readonly ChipItem<AnomalyChip>[] = [
  ...COMMON_CHIPS,
  { chip: "Low", label: "Level 1–2" },
  { chip: "Middle", label: "Level 3–4" },
  { chip: "High", label: "Level 5+" },
];

/** One category the picker offers. */
export interface AnomalyPickRow {
  choice: AnomalyChoice;
  key: string;
  label: string;
  /** "Level 3"; empty for a category without one. */
  gives: string;
  description: string | null;
  /** Its spawn chance is above zero for the planet. */
  usual: boolean;
  /** What the search matches, lower case: name and key. */
  search: string;
}

/** The picker's rows, by name. */
export function anomalyPickRows(choices: readonly AnomalyChoice[]): AnomalyPickRow[] {
  const rows = choices.map((choice): AnomalyPickRow => ({
    choice,
    key: choice.key,
    label: choice.name || choice.key,
    gives: choice.level === null ? "" : `Level ${choice.level}`,
    description: choice.description,
    usual: choice.usual,
    search: searchText([choice.name, choice.key]),
  }));
  return byLabel(rows);
}

/** Whether a category of `level` falls in `chip`'s band. */
function inBand(level: number | null, chip: AnomalyChip): boolean {
  if (level === null) return false;
  if (chip === "Low") return level <= 2;
  if (chip === "Middle") return level >= 3 && level <= 4;
  return level >= 5;
}

/**
 * The rows `chip` and `query` leave, as the list shows them: under All, the usual ones first, then
 * everything else, as one list without a heading when none is usual.
 */
export function anomalySections(
  rows: readonly AnomalyPickRow[],
  chip: AnomalyChip,
  query: string,
): PickerSection<AnomalyPickRow>[] {
  return pickerSections(rows, chip, query, (row, each) => inBand(row.choice.level, each), "");
}
