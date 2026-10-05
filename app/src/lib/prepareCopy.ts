/**
 * Prepare for a new game: every row label, choice label and consequence the Galaxy page's
 * section shows, one table per scenario profile. What the game does with a row left out depends
 * on the scripts behind the map, so the two profiles word some rows differently.
 */

import type { PrepareChoice } from "../generated/PrepareChoice";
import type { PreparePreset } from "../generated/PreparePreset";
import type { PrepareRow } from "../generated/PrepareRow";
import type { ScenarioProfile } from "../generated/ScenarioProfile";
import { counted } from "./text";

export interface RowCopy {
  label: string;
  /** What one of the row's systems is counted as. */
  unit: string;
  /** Each choice's name in the row's field, where it differs from `CHOICE_LABELS`. */
  choices?: Partial<Record<PrepareChoice, string>>;
  /**
   * What the new game has when the row takes each choice: a warning under a row left out, and
   * a plain line under a kept row where keeping it is not the whole story.
   */
  consequences: Partial<Record<PrepareChoice, string>>;
  /** What leaving the row out does, shown while the pointer is on a kept row. */
  ifLeftOut: string;
  /** A further line under the row, whatever its choice. */
  note?: string;
}

/** Each choice's name, unless the row names it its own way. */
export const CHOICE_LABELS: Record<PrepareChoice, string> = {
  keep: "Keep",
  generic_start: "Generic start",
  plain: "Plain system",
  game_decides: "Game decides",
  none: "None",
  game_names: "Game names",
};

export const PRESET_LABELS: Record<PreparePreset | "custom", string> = {
  faithful: "Faithful",
  fresh_start: "Fresh start",
  bare_shell: "Bare shell",
  custom: "Custom",
};

export const PREPARE_TITLE = "Prepare for a new game";
export const PREPARE_INTRO =
  "Choose what the new game keeps from this scenario. Each row says what the game does with what you leave out.";
export const PREPARE_NEEDS_GAME_DATA =
  "Load the game data to sort this scenario's systems into rows.";
export const PREPARE_MENU_ITEM = "Prepare for a new game…";
export const APPLY_LABEL = "Apply";
export const ONE_STEP = "One step to undo.";
export const NOTHING_TO_CHANGE = "Nothing to change.";
export const COUNTING = "Counting the changes…";

/** `Changes 27 systems.` */
export function changesLine(changes: number): string {
  return `Changes ${counted(changes, "system")}.`;
}

/** The footer's list of the rows left out, named in lower case. */
export function leftOutLine(labels: readonly string[]): string | null {
  if (labels.length === 0) return null;
  return `Left out of the new game: ${listed(labels.map((label) => label.toLowerCase()))}.`;
}

/** `Custom: Fresh start with 2 rows changed.` */
export function customLine(nearest: PreparePreset, differing: number): string {
  return `Custom: ${PRESET_LABELS[nearest]} with ${counted(differing, "row")} changed.`;
}

/**
 * The closed section's summary: what the choices would change, else what the last Apply
 * changed, else that nothing changed.
 */
export function summaryLine(
  preset: PreparePreset | "custom",
  pending: number | null,
  applied: { preset: PreparePreset | "custom"; changed: number } | null,
): string {
  if (pending !== null && pending > 0) {
    return `${PRESET_LABELS[preset]} · changes ${counted(pending, "system")}`;
  }
  if (applied !== null) {
    return `${PRESET_LABELS[applied.preset]} · ${counted(applied.changed, "system")} changed`;
  }
  return `${PRESET_LABELS[preset]} · nothing changed`;
}

/** A row's count: `9 seats`, `1 system`. */
export function rowCount(copy: RowCopy, n: number): string {
  return counted(n, copy.unit);
}

function listed(items: readonly string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** What Game decides does to any row's systems. */
const GAME_DECIDES =
  "The game rolls these systems from the random galaxy pool. A static map keeps no space clear " +
  "around capitals, so a leviathan, an L-Gate or a marauder home can land beside one.";

/** The Marauders setting's reach, which every choice of the clans' row meets. */
const ROLLED_CLANS_ONLY = "The Marauders setting only adds clans to systems the game rolls.";

const PLAIN_ROWS: Record<PrepareRow, RowCopy> = {
  empire_seats: {
    label: "Empire seats",
    unit: "seat",
    choices: { keep: "Old capitals" },
    // to confirm in game
    consequences: { none: "The new game has no fixed seats. Empires start in random systems." },
    // to confirm in game
    ifLeftOut: "If left out, empires start in random systems.",
  },
  home_starts: {
    label: "Home starts",
    unit: "seat",
    choices: { keep: "As in save" },
    // to confirm in game
    consequences: {
      generic_start: "These seats get one of the game's random empire starts.",
    },
    // to confirm in game
    ifLeftOut: "If left out, these seats get one of the game's random empire starts.",
    note:
      "Origins with a home system of their own replace this start, such as Void Dwellers, " +
      "Fear of the Dark and Riftworld. " +
      // to confirm in game
      "Shattered Ring, Ocean Paradise and others do the same.",
  },
  home_neighbours: {
    label: "Home neighbours",
    unit: "system",
    consequences: {
      plain:
        "These systems become ordinary stars. Capitals lose the habitable worlds placed beside them.",
      game_decides: GAME_DECIDES,
    },
    ifLeftOut: "If left out, capitals lose the habitable worlds placed beside them.",
    note: "On a plain scenario these worlds get a random planet class, not the empire's.",
  },
  origin_and_event: {
    label: "Origin and event systems",
    unit: "system",
    consequences: {
      plain:
        "These systems become ordinary stars. Lost Colony and Broken Shackles empires won't get " +
        "their parent system, because the game only rolls it. Systems that events spawn still " +
        "appear, such as the Sealed System, a Scion's fallen empire and Hegemon partners.",
      game_decides: GAME_DECIDES,
    },
    ifLeftOut:
      "If left out, Lost Colony and Broken Shackles empires won't get their parent system.",
  },
  fallen_empires: {
    label: "Fallen empires",
    unit: "system",
    consequences: {
      keep: "A plain scenario gets no fallen empires. Keep only keeps these systems.",
      none: "These systems become ordinary stars.",
    },
    ifLeftOut: "If left out, these systems become ordinary stars.",
  },
  marauder_clans: {
    label: "Marauder clans",
    unit: "system",
    consequences: {
      keep: "These clans spawn whatever the Marauders setting says.",
      plain: `These systems become ordinary stars. ${ROLLED_CLANS_ONLY}`,
      game_decides: `${GAME_DECIDES} ${ROLLED_CLANS_ONLY}`,
    },
    ifLeftOut: `If left out, no clans start here. ${ROLLED_CLANS_ONLY}`,
  },
  guardians: {
    label: "Guardians and leviathans",
    unit: "system",
    consequences: {
      plain: "These systems become ordinary stars. No guardians start here.",
      game_decides: GAME_DECIDES,
    },
    ifLeftOut: "If left out, no guardians start here.",
  },
  enclaves: {
    label: "Enclaves",
    unit: "system",
    consequences: {
      plain: "These systems become ordinary stars. No enclaves start here.",
      game_decides: GAME_DECIDES,
    },
    ifLeftOut: "If left out, no enclaves start here.",
  },
  primitives: {
    label: "Primitives",
    unit: "system",
    consequences: {
      plain: "These systems become ordinary stars. No pre-FTL civilisations start here.",
      game_decides: GAME_DECIDES,
    },
    ifLeftOut: "If left out, no pre-FTL civilisations start here.",
  },
  special_systems: {
    label: "Special systems",
    unit: "system",
    consequences: {
      plain: "These one-off systems become ordinary stars.",
      game_decides: GAME_DECIDES,
    },
    ifLeftOut: "If left out, these one-off systems go.",
  },
  ordinary_systems: {
    label: "Ordinary systems",
    unit: "system",
    choices: { keep: "Keep recipe" },
    consequences: { game_decides: GAME_DECIDES },
    ifLeftOut: "If left out, the game rolls these systems from the random galaxy pool.",
  },
  wormhole_pairs: {
    label: "Wormhole pairs",
    unit: "system",
    consequences: {
      none: "These pairs go. The game still adds random pairs from the Wormhole Pairs setting, 5 per step.",
    },
    ifLeftOut: "If left out, only the Wormhole Pairs setting adds pairs.",
  },
  system_names: {
    label: "System names",
    unit: "system",
    consequences: { game_names: "The game names these systems." },
    ifLeftOut: "If left out, the game names these systems.",
  },
};

const PAINT_ROWS: Record<PrepareRow, RowCopy> = {
  ...PLAIN_ROWS,
  home_neighbours: {
    ...PLAIN_ROWS.home_neighbours,
    // to confirm in game
    note: "Paint a Galaxy gives these worlds the empire's planet class.",
  },
  fallen_empires: {
    ...PLAIN_ROWS.fallen_empires,
    consequences: {
      keep: "Paint a Galaxy builds the fallen empires from these zones.",
      // to confirm in game
      none: "The zones go, so Paint a Galaxy builds no fallen empires.",
    },
    // to confirm in game
    ifLeftOut: "If left out, Paint a Galaxy builds no fallen empires.",
  },
};

export const PREPARE_COPY: Record<ScenarioProfile, Record<PrepareRow, RowCopy>> = {
  plain: PLAIN_ROWS,
  paint_a_galaxy: PAINT_ROWS,
};

/** The name `choice` takes in `row`'s field. */
export function choiceLabel(copy: RowCopy, choice: PrepareChoice): string {
  return copy.choices?.[choice] ?? CHOICE_LABELS[choice];
}
