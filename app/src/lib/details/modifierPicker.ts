/**
 * The modifier picker on a planet's page: one row per modifier the game data offers, the chips
 * that narrow the rows to a category, the search that narrows them further, and how long an add
 * lasts.
 */
import type { ModifierCategory } from "../../generated/ModifierCategory";
import type { ModifierChoice } from "../../generated/ModifierChoice";
import { counted } from "../text";
import {
  byLabel,
  COMMON_CHIPS,
  pickerSections,
  searchText,
  type ChipItem,
  type CommonChip,
  type PickerSection,
} from "./picker";

/** A chip above the rows: every row, the rows usual for the planet, or one category. */
export type ModifierChip = CommonChip | ModifierCategory;

export const MODIFIER_CHIPS: readonly ChipItem<ModifierChip>[] = [
  ...COMMON_CHIPS,
  { chip: "Feature", label: "Features" },
  { chip: "Terraforming", label: "Terraforming" },
  { chip: "Positive", label: "Positive" },
  { chip: "Negative", label: "Negative" },
  { chip: "Other", label: "Other" },
];

/** One modifier the picker offers. */
export interface ModifierPickRow {
  choice: ModifierChoice;
  /** The feature's key, else the modifier's: unique among the rows. */
  key: string;
  label: string;
  /** Its effects, a line each as the game words them: "+10% Minerals"; empty for none. */
  effects: string[];
  /** The row's hover text: its localised description and what it needs, when it has them. */
  description: string | null;
  /** The planet's class makes it a terraforming candidate with this modifier. */
  usual: boolean;
  /** The planet has it already, so adding it again is refused. */
  held: boolean;
  /** What the search matches, lower case: name, effects, category and keys. */
  search: string;
}

/**
 * The picker's rows for a body that has the modifiers and features `has`, by name. `usual` is the
 * terraforming candidate modifier the body's class links to, and `needs` says what terraforming
 * with a candidate modifier needs.
 */
export function modifierPickRows(
  choices: readonly ModifierChoice[],
  has: readonly string[],
  usual: string | null,
  needs: (modifier: string) => string,
): ModifierPickRow[] {
  const held = new Set(has);
  const rows = choices.map((choice): ModifierPickRow => {
    const label = choice.view.name || choice.view.key;
    const effects = choice.view.effects.map((e) => e.text);
    const need = choice.category === "Terraforming" ? needs(choice.modifier) : null;
    const described = [choice.description, need].filter((t): t is string => !!t).join("\n\n");
    return {
      choice,
      key: choice.feature ?? choice.modifier,
      label,
      effects,
      description: described === "" ? null : described,
      usual: choice.modifier === usual,
      held: held.has(choice.modifier) || (choice.feature !== null && held.has(choice.feature)),
      search: searchText([
        label,
        effects.join(", "),
        choice.category,
        choice.feature ?? "",
        choice.modifier,
      ]),
    };
  });
  return byLabel(rows);
}

/**
 * The rows `chip` and `query` leave, as the list shows them: under All, the usual ones first, then
 * everything else, as one list without a heading when none is usual.
 */
export function modifierSections(
  rows: readonly ModifierPickRow[],
  chip: ModifierChip,
  query: string,
): PickerSection<ModifierPickRow>[] {
  return pickerSections(rows, chip, query, (row, each) => row.choice.category === each, "");
}

/** The line that confirms an add: "Added Mineral Poor", or "Added Mineral Poor for 360 days". */
export function addedModifierLine(row: ModifierPickRow, days: number | null): string {
  return days === null ? `Added ${row.label}` : `Added ${row.label} for ${counted(days, "day")}`;
}

/** A days field's text as days, or `null` for anything but a whole number above zero. */
export function parseDays(text: string): number | null {
  const n = Number(text.trim());
  return Number.isInteger(n) && n > 0 && n <= 2 ** 31 - 1 ? n : null;
}
