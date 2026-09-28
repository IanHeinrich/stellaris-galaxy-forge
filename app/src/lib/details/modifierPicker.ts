/**
 * The modifier picker on a planet's page: one row per modifier the game data offers, the chips
 * that narrow the rows to a category, the search that narrows them further, and the edits it and
 * the page's Modifiers list send.
 */
import type { ModifierCategory } from "../../generated/ModifierCategory";
import type { ModifierChoice } from "../../generated/ModifierChoice";
import type { Op } from "../../generated/Op";
import type { PlanetPage } from "../../generated/PlanetPage";
import { counted } from "../text";
import type { ModifierRow } from "./planetPage";

/** A chip above the rows: every row, the rows usual for the planet, or one category. */
export type ModifierChip = "All" | "Usual" | ModifierCategory;

export interface ModifierChipItem {
  chip: ModifierChip;
  label: string;
}

export const MODIFIER_CHIPS: readonly ModifierChipItem[] = [
  { chip: "All", label: "All" },
  { chip: "Usual", label: "Usual here" },
  { chip: "Feature", label: "Features" },
  { chip: "Terraforming", label: "Terraforming" },
  { chip: "Positive", label: "Positive" },
  { chip: "Negative", label: "Negative" },
  { chip: "Other", label: "Other" },
];

/** Days for an item that never runs out. */
export const PERMANENT = -1;

/** One modifier the picker offers. */
export interface ModifierPickRow {
  choice: ModifierChoice;
  /** The feature's key, else the modifier's: unique among the rows. */
  key: string;
  label: string;
  /** Its effects, spelled out: "+10% Minerals, -1 Max Districts"; empty for none. */
  gives: string;
  /** The row's hover text: its localised description and what it needs, when it has them. */
  description: string | null;
  /** The planet's class makes it a terraforming candidate with this modifier. */
  usual: boolean;
  /** The planet has it already, so adding it again is refused. */
  held: boolean;
  /** What the search matches, lower case: name, effects, category and keys. */
  search: string;
}

export interface ModifierSection {
  title: string;
  rows: ModifierPickRow[];
}

/**
 * The picker's rows for `page`, by name. `usual` is the terraforming candidate modifier the
 * planet's class links to, and `needs` says what terraforming with a candidate modifier needs.
 */
export function modifierPickRows(
  choices: readonly ModifierChoice[],
  page: PlanetPage,
  usual: string | null,
  needs: (modifier: string) => string,
): ModifierPickRow[] {
  const held = new Set([...page.planet_modifiers, ...page.timed_modifiers.map((t) => t.modifier)]);
  const rows = choices.map((choice): ModifierPickRow => {
    const label = choice.view.name || choice.view.key;
    const gives = choice.view.effects.map((e) => e.text).join(", ");
    const need = choice.category === "Terraforming" ? needs(choice.modifier) : null;
    const described = [choice.description, need].filter((t): t is string => !!t).join("\n\n");
    return {
      choice,
      key: choice.feature ?? choice.modifier,
      label,
      gives,
      description: described === "" ? null : described,
      usual: choice.modifier === usual,
      held: held.has(choice.modifier) || (choice.feature !== null && held.has(choice.feature)),
      search: [label, gives, choice.category, choice.feature ?? "", choice.modifier]
        .join(" ")
        .toLowerCase(),
    };
  });
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The rows `chip` and `query` leave, as the list shows them: under All, the usual ones first, then
 * everything else; under any other chip, one list.
 */
export function modifierSections(
  rows: readonly ModifierPickRow[],
  chip: ModifierChip,
  query: string,
): ModifierSection[] {
  const words = query.trim().toLowerCase();
  const matching = rows.filter((row) => words === "" || row.search.includes(words));
  if (chip === "All") {
    const usual = matching.filter((row) => row.usual);
    if (usual.length === 0) return matching.length === 0 ? [] : [{ title: "", rows: matching }];
    return [
      { title: "Usual for this planet", rows: usual },
      { title: "Everything else", rows: matching.filter((row) => !row.usual) },
    ].filter((section) => section.rows.length > 0);
  }
  const left = matching.filter((row) =>
    chip === "Usual" ? row.usual : row.choice.category === chip,
  );
  return left.length === 0 ? [] : [{ title: "", rows: left }];
}

/** The edit that adds `choice` to planet `planet` for `days`, or for ever when `null`. */
export function addModifierOp(planet: number, choice: ModifierChoice, days: number | null): Op {
  return {
    type: "AddPlanetModifier",
    planet,
    modifier: choice.modifier,
    days: [days ?? PERMANENT],
    ...(choice.feature === null ? {} : { feature: choice.feature }),
  };
}

/** The edit that takes a row of the page's Modifiers list off planet `planet`. */
export function removeModifierOp(planet: number, row: ModifierRow): Op {
  return {
    type: "RemovePlanetModifier",
    planet,
    modifier: row.modifier,
    ...(row.feature ? { feature: row.key } : {}),
  };
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
