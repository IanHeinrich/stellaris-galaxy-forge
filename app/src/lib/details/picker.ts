/**
 * What a planet's pickers and fields share: the body they edit and the adapter that writes to it,
 * the chips every picker starts with, the search, and the usual rows first under All.
 */
import type { Bounds } from "../../generated/Bounds";
import type { DigSiteChoice } from "../../generated/DigSiteChoice";
import type { ModifierChoice } from "../../generated/ModifierChoice";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetPageAnomaly } from "../../generated/PlanetPageAnomaly";
import type { StarClassView } from "../../generated/StarClassView";

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

/** A field's row: its key, its label and the header it sits under, where it has one. */
export interface GroupedRow {
  key: string;
  label: string;
  group?: string;
}

/** What a source gives each kind of row it lists, and takes back to remove that row. */
export interface RowRefs {
  deposit: unknown;
  modifier: unknown;
  digSite: unknown;
}

/** A body as a source finds it: the system it is in, where known, and its id. */
export interface PlanetBody {
  system: number | null;
  id: number;
}

/** A system and its star bodies, as a star type edit reads them. */
export interface StarSystem {
  id: number;
  star_class: string;
  bodies: readonly { id: number; class: string }[];
}

/**
 * How one source edits a body: its fields, its removal, and its deposits, modifiers, dig site and
 * anomaly. Each edit resolves `false` where nothing was written.
 */
export interface PlanetEditAdapter<R extends RowRefs = RowRefs> {
  /** Whether a size may be a range the game draws from; without, a range is refused. */
  ranges: boolean;
  /** Whether a modifier it adds can run out after some days; without, every add is permanent. */
  timedModifiers: boolean;
  /** Renames the body from `current` to `text`, trimmed; nothing for an empty or unchanged name. */
  rename(text: string, current: string): Promise<boolean>;
  /** Gives the body `size` in place of `current`; nothing for one under 1, fractional or unchanged. */
  setSize(size: Bounds, current: number): Promise<boolean>;
  /** Makes the body of class `current` into `key`; nothing when unchanged or either is unknown. */
  setClass(
    key: string,
    current: string,
    planetClasses: ReadonlyMap<string, PlanetClassView>,
  ): Promise<boolean>;
  /** Gives the body the model `key`, or takes `current` off back to its class's; nothing when unchanged. */
  setModel(key: string, current: string | null): Promise<boolean>;
  setRing(ring: boolean): Promise<boolean>;
  /**
   * Turns the star body into `planetClass`. The system's star class, which draws its map icon and
   * applies its modifier, follows when some class has the stars it leaves.
   */
  setStarType(
    planetClass: string,
    system: StarSystem,
    starClasses: ReadonlyMap<string, StarClassView>,
  ): Promise<boolean>;
  /** Deletes the body, named `name`, with its moons, once the user confirms. */
  remove(name: string, moon: boolean): Promise<boolean>;
  /** Removes the colony on the body, named `name`, once the user confirms; the body stays. */
  removeColony(name: string): Promise<boolean>;
  addDeposit(key: string): Promise<boolean>;
  removeDeposit(ref: R["deposit"]): Promise<boolean>;
  /** Adds `choice` for `days`, or for ever when `null`. */
  addModifier(choice: ModifierChoice, days: number | null): Promise<boolean>;
  removeModifier(ref: R["modifier"]): Promise<boolean>;
  /** Adds the anomaly category `category`. */
  addAnomaly(category: string): Promise<boolean>;
  removeAnomaly(): Promise<boolean>;
  addDigSite(choice: DigSiteChoice): Promise<boolean>;
  removeDigSite(ref: R["digSite"]): Promise<boolean>;
}

/** The body a picker adds to: what its choices are read for, and how it is edited. */
export interface PickerTarget<R extends RowRefs = RowRefs> {
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
  edits: PlanetEditAdapter<R>;
}
