/**
 * Prepare for a new game: every row label, choice name and line the Galaxy page's section shows,
 * one table per scenario profile, in the words of the game's galaxy setup screen. Each choice has
 * a tag for who places what the row holds in the new game, and one or two sentences, like a
 * tooltip. What the game does with a row depends on the scripts behind the map, so the two
 * profiles word some rows differently.
 */

import type { PrepareChoice } from "../generated/PrepareChoice";
import type { PreparePreset } from "../generated/PreparePreset";
import type { PrepareRow } from "../generated/PrepareRow";
import type { ScenarioProfile } from "../generated/ScenarioProfile";
import { counted } from "./text";

/** A line that may name the row's count, which is null until the preview is read. */
export type Line = string | ((n: number | null) => string);

/**
 * Who places what a choice leaves in the new game: this map, where it shows now; the game, when
 * the game starts; or no one.
 */
export type Placer = "forge" | "game" | "none";

/** What a choice does: its tag, and its sentences. */
export interface Answers {
  placer: Placer;
  text: Line;
}

export interface RowCopy {
  label: string;
  /** What one of the row's systems is counted as. */
  unit: string;
  /** What the row holds, the first line of its card. */
  holds: string;
  /** Each choice's name in the row's field, where it differs from `CHOICE_LABELS`. */
  choices?: Partial<Record<PrepareChoice, string>>;
  answers: Partial<Record<PrepareChoice, Answers>>;
}

/** Each tag's words. */
export const PLACER_LABELS: Record<Placer, string> = {
  forge: "Galaxy Forge",
  game: "The game",
  none: "No one",
};

/** Each choice's name, unless the row names it its own way. */
export const CHOICE_LABELS: Record<PrepareChoice, string> = {
  keep: "Keep as is",
  generic_start: "Random starting system",
  plain: "Normal systems",
  game_decides: "Let the game roll",
  none: "Remove",
  game_names: "Random names",
  pre_ftl_earth: "Pre-FTL Earth",
  une_seat: "United Nations of Earth start",
  random_seats: "New random positions",
  random_zones: "New random zones",
};

export const PRESET_LABELS: Record<PreparePreset | "custom", string> = {
  faithful: "Keep everything",
  fresh_start: "Keep the galaxy",
  bare_shell: "Keep the layout",
  custom: "Custom",
};

export const PREPARE_TITLE = "Prepare for a new game";
export const PREPARE_INTRO =
  "Choose what the new game takes from this map. Hover over a row to see what each choice does.";
export const PREPARE_NEEDS_GAME_DATA =
  "Load the game data to sort this scenario's systems into rows.";
export const PREPARE_MENU_ITEM = "Prepare for a new game…";
export const APPLY_LABEL = "Apply";
export const NOT_NOW_LABEL = "Not now";
export const ONE_STEP = "One step to undo.";
export const NOTHING_TO_CHANGE = "Nothing to change.";
export const COUNTING = "Counting the changes…";
export const ROWS_LABEL = "Row by row";
export const REROLL_LABEL = "Reroll";
export const REROLL_HINT = "Draws the starting positions and zones again.";
export const CLEAR_AROUND_LABEL =
  "Keep leviathans, marauders and L-Gates away from starting positions";
export const NO_FALLEN_EMPIRES =
  "A custom map gets no fallen empires without Paint a Galaxy, which spawns them from zones.";
export const FAITHFUL_PLAIN = "A custom map gets no fallen empires without Paint a Galaxy.";
export const CURRENT_MARK = "current";
/** The two states of the option to keep threats away, as its card names them. */
export const CLEAR_AROUND_STATES = { on: "On", off: "Off" } as const;

/** `38 systems`: how many the option to keep threats away turns into normal systems. */
export function keptClearCount(n: number): string {
  return counted(n, "system");
}

/** `these 9 positions`, `this position`, or `these positions` while the count is not read. */
function these(n: number | null, noun?: string): string {
  if (n === 1) return noun === undefined ? "this one" : `this ${noun}`;
  const count = n === null ? "" : ` ${n}`;
  return noun === undefined ? `these${count}` : `these${count} ${noun}s`;
}

/** `one` for a count of one, `many` for any other. */
function verb(n: number | null, one: string, many: string): string {
  return n === 1 ? one : many;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What each preset does. A preset has no tag: each mixes who places what. */
export const PRESET_ANSWERS: Record<PreparePreset, string> = {
  faithful:
    "Everything stays as it is on this map, the old capitals' home systems included. New " +
    "empires start in them.",
  fresh_start:
    "The galaxy stays as it is, but every empire gets a random starting system at an old " +
    "capital's position. Sol and the old origin systems become normal systems.",
  bare_shell:
    "Only the star positions, hyperlanes and nebulae stay. Galaxy Forge draws new starting " +
    "positions, and on a Paint a Galaxy map new fallen empire zones. The game rolls " +
    "everything else, as if this were a new random galaxy.",
};

/** What keeping threats away from starting positions does while it is on. */
export const KEPT_CLEAR: Answers = {
  placer: "forge",
  text: (n) =>
    `Turns the ${n === null ? "systems" : counted(n, "system")} within 2 jumps of a starting ` +
    `position into ${verb(n, "a normal system", "normal systems")}. In a random galaxy the game ` +
    "keeps these threats out of that space; on a custom map it doesn't, so Galaxy Forge does.",
};

/** The warning while threats are not kept away from starting positions. */
export const NOT_KEPT_CLEAR: Answers = {
  placer: "game",
  text:
    "A leviathan, a marauder clan or the L-Gate can spawn right next to a starting position. " +
    "The game has no rule against it on a custom map.",
};

/** The warning under Wormhole pairs when taking them out strands part of the map. */
export function cutOffLine(systems: number, seats: number): string {
  const including =
    seats === 0
      ? ""
      : seats === 1
        ? ", including a starting position"
        : `, including ${seats} starting positions`;
  return `Taking these pairs out cuts ${counted(systems, "system")} off from the rest of the map${including}.`;
}

/** `Changes 27 systems.` */
export function changesLine(changes: number): string {
  return `Changes ${counted(changes, "system")}.`;
}

/** `Custom: Keep the galaxy with 2 rows changed.` */
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

/** A row's count: `9 positions`, `1 system`. */
export function rowCount(copy: RowCopy, n: number): string {
  return counted(n, copy.unit);
}

/** `line` with the row's count `n` in it. */
export function lineText(line: Line, n: number | null): string {
  return typeof line === "string" ? line : line(n);
}

/** What `copy`'s row does when it takes `choice`, with `n` systems in the row. */
export function choiceText(
  copy: RowCopy,
  choice: PrepareChoice,
  n: number | null,
): string | undefined {
  const answers = copy.answers[choice];
  return answers === undefined ? undefined : lineText(answers.text, n);
}

/** Why `row` takes no choice on a map of `profile`; undefined while it takes one. */
export function rowDisabledReason(row: PrepareRow, profile: ScenarioProfile): string | undefined {
  return row === "fallen_empires" && profile === "plain" ? NO_FALLEN_EMPIRES : undefined;
}

const NO_GUARANTEED_WORLDS =
  "Starting positions get no guaranteed habitable worlds; the game adds none on a custom map.";
const PAINT_GUARANTEED_WORLDS =
  "Paint a Galaxy adds guaranteed habitable worlds, determined by your in-game Guaranteed " +
  "Habitable Worlds setting.";
const OWN_HOME_SYSTEM =
  "An empire whose origin or empire design brings its own home system builds that instead.";

const PLAIN_ROWS: Record<PrepareRow, RowCopy> = {
  empire_seats: {
    label: "Starting positions",
    unit: "position",
    holds: "Where empires start.",
    answers: {
      keep: {
        placer: "forge",
        text: (n) => `Empires start at ${these(n, "position")}.`,
      },
      random_seats: {
        placer: "forge",
        text: (n) =>
          `${n === null ? "New starting positions" : counted(n, "new starting position")}, ` +
          "spread out as the game spreads empires in a random galaxy. Reroll draws them again.",
      },
      none: {
        placer: "game",
        text:
          "No fixed starting positions. The game drops each empire into a random existing " +
          "system with no spacing: starts can be next to each other or in a black hole, and " +
          "some AI empires may not spawn at all.",
      },
    },
  },
  home_starts: {
    label: "Starting systems",
    unit: "position",
    holds: "The home systems the old capitals had, such as Sol or Deneb.",
    answers: {
      keep: {
        placer: "forge",
        text: `Empires start in these systems as they are now. ${OWN_HOME_SYSTEM}`,
      },
      generic_start: {
        placer: "game",
        text:
          "Each starting position gets one of the game's random starting systems. " +
          OWN_HOME_SYSTEM,
      },
    },
  },
  sol: {
    label: "Sol",
    unit: "system",
    holds: "The Sol system, with Earth.",
    choices: { plain: "Normal system" },
    answers: {
      keep: {
        placer: "forge",
        text:
          "Sol stays, with Earth. Whichever empire starts there gets it. An empire that starts " +
          "in Sol somewhere else builds a second Sol.",
      },
      plain: {
        placer: "none",
        text: "Sol becomes a normal system. Empires that start in Sol build their own where they land.",
      },
      pre_ftl_earth: {
        placer: "forge",
        text:
          "Sol stays, with a pre-FTL humanity on Earth. No empire starts there, and the game " +
          "adds no other Sol.",
      },
      une_seat: {
        placer: "forge",
        text: "Only the United Nations of Earth can start in Sol.",
      },
      game_decides: {
        placer: "game",
        text: "Sol is rerolled like any other system. There is no Sol unless an empire brings its own.",
      },
    },
  },
  home_neighbours: {
    label: "Guaranteed habitable worlds",
    unit: "system",
    holds: "The guaranteed habitable worlds next to each old capital.",
    answers: {
      keep: {
        placer: "forge",
        text: (n) =>
          `${capital(these(n))} ${verb(n, "stays", "stay")} next to the old capitals, with the ` +
          `planet class ${verb(n, "it has", "they have")} now.`,
      },
      plain: {
        placer: "none",
        text: `These become normal systems. ${NO_GUARANTEED_WORLDS}`,
      },
      game_decides: {
        placer: "none",
        text: `These are rerolled. ${NO_GUARANTEED_WORLDS}`,
      },
    },
  },
  origin_and_event: {
    label: "Origin and event systems",
    unit: "system",
    holds: "Systems an origin or an event brought with it, such as a Lost Colony's parent.",
    answers: {
      keep: {
        placer: "forge",
        text: (n) =>
          `${capital(these(n))} ${verb(n, "stays", "stay")} as ${verb(n, "it is", "they are")}. ` +
          "New empires' origins bring their own systems anyway.",
      },
      plain: {
        placer: "none",
        text:
          "These become normal systems. Lost Colony and Broken Shackles empires get no parent " +
          "system, because the game only rolls it. Event systems such as the Sealed System " +
          "still appear.",
      },
      game_decides: {
        placer: "game",
        text:
          "These are rerolled. If the game rolls a Lost Colony parent, the Commonwealth of Man " +
          "appears as an extra empire.",
      },
    },
  },
  fallen_empires: {
    label: "Fallen empires",
    unit: "system",
    holds: "The systems a fallen empire left.",
    answers: {},
  },
  marauder_clans: {
    label: "Marauders",
    unit: "clan",
    holds: "Marauder clan homes.",
    answers: {
      keep: {
        placer: "forge",
        text: (n) =>
          `${capital(these(n, "clan"))} ${verb(n, "spawns", "spawn")} where ` +
          `${verb(n, "it is", "they are")} now, whatever your in-game Marauder Empires setting says.`,
      },
      plain: {
        placer: "none",
        text:
          "These become normal systems. The in-game Marauder Empires setting only puts clans in " +
          "rerolled systems, so with nothing rerolled there are no marauders.",
      },
      game_decides: {
        placer: "game",
        text:
          "These are rerolled. Marauders spawn wherever the game puts them; how many is " +
          "determined by your in-game Marauder Empires setting.",
      },
    },
  },
  guardians: {
    label: "Leviathans and guardians",
    unit: "system",
    holds: "Leviathan lairs and guardian systems.",
    answers: {
      keep: {
        placer: "forge",
        text: (n) =>
          `${capital(these(n))} ${verb(n, "spawns", "spawn")} where ` +
          `${verb(n, "it is", "they are")} now.`,
      },
      plain: {
        placer: "game",
        text:
          "These become normal systems. Leviathans may still spawn elsewhere; the game rolls " +
          "them at random, and no galaxy setting controls them.",
      },
      game_decides: {
        placer: "game",
        text: "These are rerolled. Leviathans spawn wherever the game puts them, as in a random galaxy.",
      },
    },
  },
  enclaves: {
    label: "Enclaves",
    unit: "system",
    holds: "Enclave stations: traders, curators, artisans, shroudwalkers, salvagers.",
    answers: {
      keep: {
        placer: "forge",
        text: (n) =>
          `${capital(these(n))} ${verb(n, "spawns", "spawn")} where ` +
          `${verb(n, "it is", "they are")} now.`,
      },
      plain: {
        placer: "game",
        text:
          "These become normal systems. Enclaves may still spawn elsewhere; the game rolls them " +
          "at random, and no galaxy setting controls them.",
      },
      game_decides: {
        placer: "game",
        text: "These are rerolled. Enclaves spawn wherever the game puts them, as in a random galaxy.",
      },
    },
  },
  primitives: {
    label: "Pre-FTL civilizations",
    unit: "system",
    holds: "Systems with a pre-FTL civilization.",
    answers: {
      keep: {
        placer: "forge",
        text: (n) =>
          `${n === 1 ? "This one" : `Each of ${these(n)}`} gets a pre-FTL civilization, rolled ` +
          "fresh, whatever your in-game Pre-FTL Civilizations setting says.",
      },
      plain: {
        placer: "none",
        text: "These become normal systems with no pre-FTL civilization.",
      },
      game_decides: {
        placer: "game",
        text:
          "These are rerolled. Pre-FTL civilizations appear as determined by your in-game " +
          "Pre-FTL Civilizations setting.",
      },
    },
  },
  special_systems: {
    label: "Unique systems",
    unit: "system",
    holds: "One-of-a-kind systems: the L-Gate, caravaneers, precursor homes.",
    answers: {
      keep: {
        placer: "forge",
        text: (n) =>
          `${capital(these(n))} ${verb(n, "stays", "stay")} where ` +
          `${verb(n, "it is", "they are")}, even if turned off in your in-game galaxy settings.`,
      },
      plain: {
        placer: "game",
        text:
          "These become normal systems. The game rolls its own unique systems elsewhere, " +
          "determined by your in-game galaxy settings.",
      },
      game_decides: {
        placer: "game",
        text:
          "These are rerolled. Unique systems appear wherever the game puts them, determined by " +
          "your in-game galaxy settings.",
      },
    },
  },
  ordinary_systems: {
    label: "Regular systems",
    unit: "system",
    holds: "Every other star, with the planets it has now.",
    answers: {
      keep: {
        placer: "forge",
        text: (n) =>
          `${capital(these(n))} ${verb(n, "keeps", "keep")} the planets ` +
          `${verb(n, "it has", "they have")} now.`,
      },
      game_decides: {
        placer: "game",
        text: (n) =>
          `The game rolls new planets in ${n === null ? "all of them" : n === 1 ? "it" : `all ${n}`}. ` +
          "Positions and hyperlanes stay.",
      },
    },
  },
  wormhole_pairs: {
    label: "Wormhole pairs",
    unit: "system",
    holds: "The wormholes this map links.",
    answers: {
      keep: {
        placer: "forge",
        text: (n) =>
          `${capital(these(n, "wormhole"))} ${verb(n, "stays", "stay")}. The game still adds its own on top, ` +
          "five random pairs for every step of your in-game Wormhole Pairs setting.",
      },
      none: {
        placer: "game",
        text:
          "These wormholes go. The game still adds its own, five random pairs for every step of " +
          "your in-game Wormhole Pairs setting.",
      },
    },
  },
  system_names: {
    label: "System names",
    unit: "system",
    holds: "The names the save gave its systems.",
    answers: {
      keep: { placer: "forge", text: "Systems keep their names." },
      game_names: {
        placer: "game",
        text: "The game names every system, as in a random galaxy.",
      },
    },
  },
};

const PAINT_ROWS: Record<PrepareRow, RowCopy> = {
  ...PLAIN_ROWS,
  home_neighbours: {
    ...PLAIN_ROWS.home_neighbours,
    answers: {
      keep: {
        placer: "forge",
        text: (n) =>
          `${capital(these(n))} ${verb(n, "stays", "stay")} next to the old capitals and ` +
          `${verb(n, "takes", "take")} the new empire's planet class.`,
      },
      plain: { placer: "game", text: `These become normal systems. ${PAINT_GUARANTEED_WORLDS}` },
      game_decides: { placer: "game", text: `These are rerolled. ${PAINT_GUARANTEED_WORLDS}` },
    },
  },
  fallen_empires: {
    label: "Fallen empires",
    unit: "zone",
    holds: "Where Paint a Galaxy spawns fallen empires.",
    answers: {
      keep: {
        placer: "forge",
        text: (n) =>
          `Fallen empires spawn in ${these(n, "zone")}; how many is determined by your ` +
          "in-game Fallen Empires setting.",
      },
      random_zones: {
        placer: "forge",
        text:
          "Up to six new zones, inside the galaxy with at most two on the rim. Your in-game " +
          "Fallen Empires setting determines how many become fallen empires; the rest fill with " +
          "normal systems. Reroll draws them again.",
      },
      none: {
        placer: "none",
        text: "No fallen empires. The game adds none on a custom map.",
      },
    },
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

/** What each colour of the map's marks says: only what Galaxy Forge places anew. */
export const OUTCOME_LABELS = {
  seat: "New starting position",
  zone: "New fallen empire zone",
} as const;

/** What the map marks a system as: a new starting position or a new fallen empire zone. */
export type Outcome = keyof typeof OUTCOME_LABELS;

/** What the legend says while the map shows the galaxy as the choices leave it. */
export const MAP_PREVIEW_NOTE = "The map shows the galaxy as these choices leave it.";
