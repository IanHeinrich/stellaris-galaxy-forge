/**
 * What a planet's pickers share: the body they add to and the adapter that writes to it, the
 * chips every picker starts with, the search, and the usual rows first under All.
 */
import type { DigSiteChoice } from "../../generated/DigSiteChoice";
import type { ModifierChoice } from "../../generated/ModifierChoice";
import type { PlanetPageAnomaly } from "../../generated/PlanetPageAnomaly";

/** The chips every picker starts with: every row, and the rows usual for the planet. */
export type CommonChip = "All" | "Usual";

/** A chip and what it says. */
export interface ChipItem<C extends string> {
  chip: C;
  label: string;
}

export const COMMON_CHIPS: readonly ChipItem<CommonChip>[] = [
  { chip: "All", label: "All" },
  { chip: "Usual", label: "Usual here" },
];

/** What the shared filtering reads of a row. */
export interface PickRow {
  label: string;
  /** Usual for the planet, so listed first under All. */
  usual: boolean;
  /** What the search matches, lower case. */
  search: string;
}

/** A heading and the rows under it; the heading is empty for a single list. */
export interface PickerSection<R> {
  title: string;
  rows: R[];
}

export const USUAL_TITLE = "Usual for this planet";
export const EVERYTHING_ELSE = "Everything else";

/** What the search matches of a row: `parts`, lower case. */
export function searchText(parts: readonly string[]): string {
  return parts.join(" ").toLowerCase();
}

/** `rows` sorted by name, in place. */
export function byLabel<R extends PickRow>(rows: R[]): R[] {
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The rows `chip` and `query` leave, as the list shows them: under All, the usual ones first, then
 * everything else, titled `restAlone` when none is usual; under any other chip, one list.
 * `inChip` says whether a row stays under a chip of the picker's own.
 */
export function pickerSections<R extends PickRow, C extends string>(
  rows: readonly R[],
  chip: C,
  query: string,
  inChip: (row: R, chip: C) => boolean,
  restAlone: string,
): PickerSection<R>[] {
  const words = query.trim().toLowerCase();
  const matching = rows.filter((row) => words === "" || row.search.includes(words));
  if (chip === "All") {
    const usual = matching.filter((row) => row.usual);
    return [
      { title: USUAL_TITLE, rows: usual },
      {
        title: usual.length > 0 ? EVERYTHING_ELSE : restAlone,
        rows: matching.filter((row) => !row.usual),
      },
    ].filter((section) => section.rows.length > 0);
  }
  const left = matching.filter((row) => (chip === "Usual" ? row.usual : inChip(row, chip)));
  return left.length === 0 ? [] : [{ title: "", rows: left }];
}

/** A value a source gives each row it lists, and takes back to remove that row. */
export type RowRef = unknown;

/** How one source adds and removes a body's deposits, modifiers, dig site and anomaly. */
export interface PlanetEditAdapter {
  /** Whether a modifier it adds can run out after some days; without, every add is permanent. */
  timedModifiers: boolean;
  addDeposit(key: string): Promise<boolean>;
  removeDeposit(ref: RowRef): Promise<boolean>;
  /** Adds `choice` for `days`, or for ever when `null`. */
  addModifier(choice: ModifierChoice, days: number | null): Promise<boolean>;
  removeModifier(ref: RowRef): Promise<boolean>;
  /** Adds the anomaly category `category`. */
  addAnomaly(category: string): Promise<boolean>;
  removeAnomaly(): Promise<boolean>;
  addDigSite(choice: DigSiteChoice): Promise<boolean>;
  removeDigSite(ref: RowRef): Promise<boolean>;
}

/** The body a picker adds to: what its choices are read for, and how it is edited. */
export interface PickerTarget {
  /** Tells one body from another across sources, as `save-planet:<id>`. */
  key: string;
  planetClass: string | null;
  size: number | null;
  moon: boolean;
  /** Its deposit types, one entry per deposit. */
  deposits: readonly string[];
  /** The modifiers and planet features it has. */
  modifiers: readonly string[];
  /** The anomaly it holds and who has found it; `null` for none. */
  anomaly: PlanetPageAnomaly | null;
  edits: PlanetEditAdapter;
}
