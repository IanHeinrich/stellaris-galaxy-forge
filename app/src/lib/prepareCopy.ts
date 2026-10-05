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
   * a plain line under a kept row where keeping it is not the whole story. Game decides holds
   * only the row's own line, which `consequence` puts after what every rolled system gets.
   */
  consequences: Partial<Record<PrepareChoice, string>>;
  /** What leaving the row out does, which the map caption shows while the pointer is on a kept row. */
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
  pre_ftl_earth: "Pre-FTL Earth",
  une_seat: "UNE seat",
  random_seats: "New random seats",
  random_zones: "New random zones",
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
export const CLEAR_AROUND_LABEL = "Keep the space around capitals clear";
export const CLEAR_AROUND_HINT =
  "Systems the game would roll within 2 jumps of a capital get an ordinary star instead.";

/** `Turns 12 systems within 2 jumps of a capital into ordinary stars.` */
export function keptClearLine(systems: number): string {
  return `Turns ${counted(systems, "system")} within 2 jumps of a capital into ordinary stars.`;
}

/** The warning under Wormhole pairs when taking them out strands part of the map. */
export function cutOffLine(systems: number, seats: number): string {
  const including =
    seats === 0 ? "" : seats === 1 ? ", including a seat" : `, including ${seats} seats`;
  return `Taking these pairs out cuts ${counted(systems, "system")} off from the rest of the map${including}.`;
}

/** `Changes 27 systems.` */
export function changesLine(changes: number): string {
  return `Changes ${counted(changes, "system")}.`;
}

/** Row labels that are names and keep their capital in a sentence. */
const PROPER_LABELS: ReadonlySet<string> = new Set(["Sol"]);

/** The footer's list of the rows left out, named in lower case, and the systems cut off. */
export function leftOutLine(labels: readonly string[], cutOff = 0): string | null {
  const items = labels.map((label) => (PROPER_LABELS.has(label) ? label : label.toLowerCase()));
  if (cutOff > 0) items.push(`${counted(cutOff, "system")} cut off from the rest of the map`);
  if (items.length === 0) return null;
  return `Left out of the new game: ${listed(items)}.`;
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

/** The map caption while a row is hovered: `3 systems ringed: Fallen empires`. */
export function ringedLine(copy: RowCopy, n: number): string {
  return `${counted(n, "system")} ringed: ${copy.label}`;
}

/** The caption's line for the systems ringed beside Wormhole pairs' own. */
export function cutOffRingedLine(systems: number): string {
  return `Also ringed: ${counted(systems, "system")} cut off from the rest of the map`;
}

/** A row's count: `9 seats`, `1 system`. */
export function rowCount(copy: RowCopy, n: number): string {
  return counted(n, copy.unit);
}

function listed(items: readonly string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** What Game decides does to any row's systems, before what keeping capitals clear adds. */
const GAME_DECIDES = "The game rolls these systems from the random galaxy pool.";
const KEPT_CLEAR = "Systems within 2 jumps of a capital get an ordinary star instead.";
const NOT_KEPT_CLEAR =
  "Nothing keeps specials away from capitals. A leviathan, an L-Gate or a marauder home can " +
  "land beside one.";

/**
 * What the new game has when `copy`'s row takes `choice`. Game decides says what every row's
 * rolled systems get, whether the space around capitals is kept clear, then the row's own line.
 */
export function consequence(
  copy: RowCopy,
  choice: PrepareChoice,
  clearAroundSeats: boolean,
): string | undefined {
  const own = copy.consequences[choice];
  if (choice !== "game_decides") return own;
  const around = clearAroundSeats ? KEPT_CLEAR : NOT_KEPT_CLEAR;
  return [GAME_DECIDES, around, own].filter((line) => line !== undefined).join(" ");
}

/** A rolled Lost Colony parent's extra empire. */
const COMMONWEALTH =
  "If the game rolls a Lost Colony parent, it adds the Commonwealth of Man as an extra empire " +
  "with no seat.";

/** What a kept special does whatever its switch on the New Game screen. */
const SETTINGS_SAY = "spawn whatever the New Game settings say.";

/** The Marauders setting's reach, which every choice of the clans' row meets. */
const ROLLED_CLANS_ONLY = "The Marauders setting only adds clans to systems the game rolls.";

const PLAIN_ROWS: Record<PrepareRow, RowCopy> = {
  empire_seats: {
    label: "Empire seats",
    unit: "seat",
    choices: { keep: "Old capitals" },
    consequences: {
      // to confirm in game
      keep: "Nomads only start where a seat is left free.",
      none:
        "The new game has no fixed seats. Each empire starts in a system already on the map, " +
        "as that system is. A start can be a black hole or sit beside another empire.",
    },
    ifLeftOut: "If left out, each empire starts in a system already on the map.",
  },
  home_starts: {
    label: "Home starts",
    unit: "seat",
    choices: { keep: "As in save" },
    consequences: {
      generic_start: "These seats get one of the game's random empire starts.",
    },
    ifLeftOut: "If left out, these seats get one of the game's random empire starts.",
    note:
      "Origins with their own home system replace this start, such as Ocean Paradise, " +
      "Shattered Ring, Void Dwellers and Riftworld. Unplugged and Arc Welders also add systems.",
  },
  sol: {
    label: "Sol",
    unit: "system",
    choices: { plain: "Normal system" },
    consequences: {
      keep:
        "Whoever draws a Sol seat gets Sol and Earth. An empire that starts in Sol elsewhere " +
        "builds a second Sol. The game then treats this Earth as the real one.",
      plain:
        "Empires that start in Sol build their own where they land. With none in the game, " +
        "the game sometimes adds a Sol of its own.",
      pre_ftl_earth:
        "Sol gets Earth with pre-FTL humans. No empire starts there. The game adds no other Sol. " +
        "An empire that starts in Sol still builds its own.",
      une_seat:
        "Only the United Nations of Earth can start here. Other empires that start in Sol " +
        "build their own.",
    },
    ifLeftOut: "If left out, empires that start in Sol build their own where they land.",
  },
  home_neighbours: {
    label: "Home neighbours",
    unit: "system",
    consequences: {
      plain:
        "These systems become ordinary stars. Capitals lose the habitable worlds placed beside them.",
    },
    ifLeftOut: "If left out, capitals lose the habitable worlds placed beside them.",
    note: "The guaranteed worlds keep their own planet class, not the empire's.",
  },
  origin_and_event: {
    label: "Origin and event systems",
    unit: "system",
    consequences: {
      plain:
        "These systems become ordinary stars. Lost Colony and Broken Shackles empires won't get " +
        "their parent system, because the game only rolls it. Systems that events spawn still " +
        "appear, such as the Sealed System, a Scion's fallen empire and Hegemon partners.",
      game_decides: COMMONWEALTH,
    },
    ifLeftOut:
      "If left out, Lost Colony and Broken Shackles empires won't get their parent system.",
  },
  fallen_empires: {
    label: "Fallen empires",
    unit: "system",
    consequences: {
      keep: "A plain scenario never gets fallen empires. Keep keeps these systems empty.",
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
      game_decides: ROLLED_CLANS_ONLY,
    },
    ifLeftOut: `If left out, no clans start here. ${ROLLED_CLANS_ONLY}`,
  },
  guardians: {
    label: "Guardians and leviathans",
    unit: "system",
    consequences: {
      keep: `These guardians ${SETTINGS_SAY}`,
      plain: "These systems become ordinary stars. No guardians start here.",
    },
    ifLeftOut: "If left out, no guardians start here.",
  },
  enclaves: {
    label: "Enclaves",
    unit: "system",
    consequences: {
      keep: `These enclaves ${SETTINGS_SAY}`,
      plain: "These systems become ordinary stars. No enclaves start here.",
    },
    ifLeftOut: "If left out, no enclaves start here.",
  },
  primitives: {
    label: "Primitives",
    unit: "system",
    consequences: {
      keep:
        "Each of these systems gets a pre-FTL civilisation, whatever the New Game settings say. " +
        "The game rolls a new one, not the one the save had.",
      plain: "These systems become ordinary stars. No pre-FTL civilisations start here.",
    },
    ifLeftOut: "If left out, no pre-FTL civilisations start here.",
  },
  special_systems: {
    label: "Special systems",
    unit: "system",
    consequences: {
      // to confirm in game: caravaneers with the Caravaneers setting off
      keep: `These systems ${SETTINGS_SAY}`,
      plain: "These one-off systems become ordinary stars.",
      game_decides: COMMONWEALTH,
    },
    ifLeftOut: "If left out, these one-off systems go.",
  },
  ordinary_systems: {
    label: "Ordinary systems",
    unit: "system",
    choices: { keep: "Keep recipe" },
    consequences: {},
    ifLeftOut: "If left out, the game rolls these systems from the random galaxy pool.",
  },
  wormhole_pairs: {
    label: "Wormhole pairs",
    unit: "system",
    consequences: {
      none: "These pairs go. The game still adds 5 random pairs per step of the Wormhole Pairs setting.",
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
    note: "Paint a Galaxy gives the guaranteed worlds the empire's planet class.",
  },
  fallen_empires: {
    ...PLAIN_ROWS.fallen_empires,
    consequences: {
      keep: "Paint a Galaxy builds the fallen empires from these zones.",
      none: "The zones go, so Paint a Galaxy builds no fallen empires.",
    },
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
