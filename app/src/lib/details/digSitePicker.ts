/**
 * The dig site picker on a planet's page: one row per site type the game data offers, the chips
 * that tell the types a survey can find from those only an event creates, and the search by name.
 * Also how the page words the site a planet has.
 */
import type { DigSiteChoice } from "../../generated/DigSiteChoice";
import type { PlanetPageDigSite } from "../../generated/PlanetPageDigSite";
import { counted } from "../text";
import { byLabel, pickerSections, searchText, type ChipItem, type PickerSection } from "./picker";

/** A chip above the rows: every row, the types a survey finds, or those only an event creates. */
export type DigSiteChip = "All" | "Surveys" | "Events";

export const DIG_SITE_CHIPS: readonly ChipItem<DigSiteChip>[] = [
  { chip: "All", label: "All" },
  { chip: "Surveys", label: "Found by surveys" },
  { chip: "Events", label: "Event only" },
];

/** One site type the picker offers. */
export interface DigSitePickRow {
  choice: DigSiteChoice;
  key: string;
  label: string;
  /** How long it is and how a game finds it: "3 stages · found by surveys". */
  gives: string;
  /** Never listed first: no type is more usual than another on a planet. */
  usual: false;
  /** What the search matches, lower case: its name and key. */
  search: string;
}

/** How a type is found, as its row says it. */
function foundBy(choice: DigSiteChoice): string {
  return choice.rolled ? "found by surveys" : "event only";
}

/** The picker's rows, by name: the types it offers. */
export function digSitePickRows(choices: readonly DigSiteChoice[]): DigSitePickRow[] {
  return byLabel(
    choices
      .filter((choice) => choice.offered)
      .map((choice) => ({
        choice,
        key: choice.key,
        label: choice.name,
        gives: `${counted(choice.stages, "stage")} · ${foundBy(choice)}`,
        usual: false,
        search: searchText([choice.name, choice.key]),
      })),
  );
}

/** The rows `chip` and `query` leave, as one list without a heading. */
export function digSiteSections(
  rows: readonly DigSitePickRow[],
  chip: DigSiteChip,
  query: string,
): PickerSection<DigSitePickRow>[] {
  return pickerSections(
    rows,
    chip,
    query,
    (row, each) => row.choice.rolled === (each === "Surveys"),
    "",
  );
}

/**
 * Where the site stands, as its row's second line: "Stage 2 of 3 · 5 clues · Excavating", or
 * "Finished" once every stage is done. `stages` is the type's count, `null` when the game data
 * does not offer the type.
 */
export function digSiteLine(site: PlanetPageDigSite, stages: number | null): string {
  const finished = stages !== null && site.stages_done >= stages;
  const stage = finished
    ? "Finished"
    : `Stage ${site.stages_done + 1}${stages === null ? "" : ` of ${stages}`}`;
  return [stage, counted(site.clues, "clue"), ...(site.excavating ? ["Excavating"] : [])].join(
    " · ",
  );
}
