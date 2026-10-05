/**
 * Prepare for a new game: every row label, choice label and answer the Galaxy page's section
 * shows, one table per scenario profile. Each choice answers three questions: what the new game
 * has, whether this map or the game decides it, and whether what Forge shows is what the game
 * gets. What the game does with a row depends on the scripts behind the map, so the two
 * profiles word some rows differently.
 */

import type { PrepareChoice } from "../generated/PrepareChoice";
import type { PreparePreset } from "../generated/PreparePreset";
import type { PrepareRow } from "../generated/PrepareRow";
import type { ScenarioProfile } from "../generated/ScenarioProfile";
import { counted } from "./text";

/** A line that may name the row's count, which is null until the preview is read. */
export type Line = string | ((n: number | null) => string);

/** What a choice gives: the three answers, in the order the section shows them. */
export interface Answers {
  newGame: Line;
  decidedBy: Line;
  shownHere: string;
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

/** The three questions' labels. */
export const ANSWER_LABELS: Record<keyof Answers, string> = {
  newGame: "New game",
  decidedBy: "Decided by",
  shownHere: "Shown here",
};

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
  "Pick what the new game takes from this map. Point at a row to see what each choice gives.";
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
export const REROLL_HINT = "Draws the new seats and zones again.";
export const CLEAR_AROUND_LABEL = "Keep the space around capitals clear";
export const NO_FALLEN_EMPIRES =
  "A plain scenario never has fallen empires. Paint a Galaxy builds them from zones.";
export const FAITHFUL_PLAIN = "No fallen empires: a plain scenario never has them.";
export const CURRENT_MARK = "current";

const MAP = "This map.";
const GAME = "The game.";
const ORDINARY = "This map. These systems become ordinary stars.";
const YES = "Yes.";
const NO = "No.";

/** `9 empires`, or `empires` while the count is not read. */
function amount(n: number | null, noun: string): string {
  return n === null ? `${noun}s` : counted(n, noun);
}

/** `All 3`, `This one` for a row of one, or `All of them` while the count is not read. */
function all(n: number | null): string {
  if (n === null) return "All of them";
  return n === 1 ? "This one" : `All ${n}`;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What the section says of each preset. */
export const PRESET_ANSWERS: Record<PreparePreset, Answers> = {
  faithful: {
    newGame:
      "The galaxy as the save left it, with new empires in the old capitals. An empire " +
      "whose origin brings its own home system still builds it there.",
    decidedBy: "This map, all of it.",
    shownHere: "Everything.",
  },
  fresh_start: {
    newGame: "The same galaxy with new empires and random starting systems.",
    decidedBy: "This map, except each capital's starting system.",
    shownHere: "Everything but the capital systems.",
  },
  bare_shell: {
    newGame: "A random galaxy on this map's shape.",
    decidedBy: "The game, except where the capitals sit, which is drawn fresh here.",
    shownHere: "Positions, hyperlanes, nebulae and the new capital positions. Nothing else.",
  },
};

/** What keeping the space around capitals clear gives while it is on. */
export function keptClearLine(systems: number): string {
  return (
    `Turns ${counted(systems, "system")} within 2 jumps of a capital into ordinary stars, ` +
    "with no leviathan, marauder home or L-Gate there, as a random galaxy does."
  );
}

/** The warning while the space around capitals is not kept clear. */
export const NOT_KEPT_CLEAR: Answers = {
  newGame:
    "Whatever the game rolls there. A leviathan, a marauder home or an L-Gate can land " +
    "beside a capital, because the game has no such rule on a static map.",
  decidedBy: GAME,
  shownHere: NO,
};

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

/** `line` with the row's count `n` in it. */
export function lineText(line: Line, n: number | null): string {
  return typeof line === "string" ? line : line(n);
}

/** What the new game has when `copy`'s row takes `choice`, with `n` systems in the row. */
export function newGameLine(
  copy: RowCopy,
  choice: PrepareChoice,
  n: number | null,
): string | undefined {
  const answers = copy.answers[choice];
  return answers === undefined ? undefined : lineText(answers.newGame, n);
}

const PLAIN_ROWS: Record<PrepareRow, RowCopy> = {
  empire_seats: {
    label: "Empire seats",
    unit: "seat",
    holds: "The systems where empires start.",
    answers: {
      keep: {
        newGame: (n) => `${capital(amount(n, "empire"))} starting at these positions.`,
        decidedBy: MAP,
        shownHere: YES,
      },
      random_seats: {
        newGame: (n) =>
          `${capital(amount(n, "empire"))} at new positions, spaced 75 units apart as a random ` +
          "galaxy spaces them.",
        decidedBy: "This map: Forge draws them here, and Reroll draws again.",
        shownHere: "Yes, once drawn.",
      },
      none: {
        newGame:
          "Empires in systems the game picks, with no spacing rule. Some AI empires may " +
          "fail to start, and no capital gets guaranteed worlds.",
        decidedBy: "The game, anywhere on the map.",
        shownHere: NO,
      },
    },
  },
  home_starts: {
    label: "Home starts",
    unit: "seat",
    holds: "The starting systems the old capitals had, such as Sol or Deneb.",
    answers: {
      keep: {
        newGame:
          "These starting systems for empires whose home system is Random and whose " +
          "origin brings none. Any other empire builds its own here.",
        decidedBy: MAP,
        shownHere: "Yes, except for those origins.",
      },
      generic_start: {
        newGame:
          "One of the game's six random empire starts per seat, drawn when you Apply. " +
          "An empire whose origin brings a home system still builds that one.",
        decidedBy: "This map, at each seat.",
        shownHere: "The seat yes, the system no.",
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
        newGame:
          "Sol with Earth here. Whoever draws the seat gets it. An empire starting in " +
          "Sol elsewhere builds a second Sol, and the game treats this Earth as the real one.",
        decidedBy: MAP,
        shownHere: YES,
      },
      plain: {
        newGame:
          "No Sol from here. Empires that start in Sol build their own where they land. " +
          "With none, the game sometimes adds one.",
        decidedBy: "The empires that start in Sol, or the game.",
        shownHere: NO,
      },
      pre_ftl_earth: {
        newGame: "Sol with pre-FTL humans. No empire starts here, and the game adds no other Sol.",
        decidedBy: MAP,
        shownHere: YES,
      },
      une_seat: {
        newGame: "Sol for the United Nations of Earth only.",
        decidedBy: MAP,
        shownHere: YES,
      },
      game_decides: {
        newGame: "Whatever the game rolls here, and Sol only if an empire brings it.",
        decidedBy: GAME,
        shownHere: NO,
      },
    },
  },
  home_neighbours: {
    label: "Home neighbours",
    unit: "system",
    holds: "The guaranteed habitable worlds placed beside each old capital.",
    answers: {
      keep: {
        newGame: "These guaranteed worlds beside the old capitals, each with its own planet class.",
        decidedBy: MAP,
        shownHere: YES,
      },
      plain: {
        newGame: "No guaranteed worlds from here, and the game adds none on a static map.",
        decidedBy: ORDINARY,
        shownHere: NO,
      },
      game_decides: {
        newGame: "Whatever the game rolls here, with no guaranteed worlds.",
        decidedBy: GAME,
        shownHere: NO,
      },
    },
  },
  origin_and_event: {
    label: "Origin and event systems",
    unit: "system",
    holds: "Systems an origin or an event brought with it, such as a Lost Colony's parent.",
    answers: {
      keep: {
        newGame:
          "These systems as places on the map. New empires' origins bring their own " +
          "systems regardless.",
        decidedBy: MAP,
        shownHere: YES,
      },
      plain: {
        newGame:
          "Ordinary stars here. Lost Colony and Broken Shackles empires get no parent " +
          "system, because the game only rolls it. Event systems still appear: the Sealed " +
          "System, a Scion's fallen empire and Hegemon partners.",
        decidedBy: MAP,
        shownHere: NO,
      },
      game_decides: {
        newGame:
          "Whatever the game rolls. A rolled Lost Colony parent adds the Commonwealth of " +
          "Man as an extra empire with no seat.",
        decidedBy: GAME,
        shownHere: NO,
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
    label: "Marauder clans",
    unit: "system",
    holds: "Marauder clan homes.",
    answers: {
      keep: {
        newGame: "These clans, whatever the Marauders setting says.",
        decidedBy: MAP,
        shownHere: YES,
      },
      plain: {
        newGame:
          "No clans from here. The Marauders setting only adds clans to systems the " +
          "game rolls.",
        decidedBy: ORDINARY,
        shownHere: NO,
      },
      game_decides: {
        newGame: "Clans as the Marauders setting says.",
        decidedBy: "The game, wherever it puts them.",
        shownHere: NO,
      },
    },
  },
  guardians: {
    label: "Guardians and leviathans",
    unit: "system",
    holds: "Leviathan lairs and guardian systems.",
    answers: {
      keep: {
        newGame: (n) => `${all(n)}, even with the Leviathans setting off.`,
        decidedBy: MAP,
        shownHere: YES,
      },
      plain: {
        newGame:
          "No guardians from here. The game may roll some elsewhere, as the Leviathans " +
          "setting says.",
        decidedBy: ORDINARY,
        shownHere: NO,
      },
      game_decides: {
        newGame: "Whatever the Leviathans setting says.",
        decidedBy: "The game, wherever it rolls them.",
        shownHere: NO,
      },
    },
  },
  enclaves: {
    label: "Enclaves",
    unit: "system",
    holds: "Enclave stations: traders, curators, artisans, shroudwalkers, salvagers.",
    answers: {
      keep: {
        newGame: (n) => `${all(n)}, even with the Enclaves setting off.`,
        decidedBy: MAP,
        shownHere: YES,
      },
      plain: {
        newGame:
          "No enclaves from here. The game may roll some elsewhere, as the Enclaves " +
          "setting says.",
        decidedBy: ORDINARY,
        shownHere: NO,
      },
      game_decides: {
        newGame: "Whatever the Enclaves setting says.",
        decidedBy: "The game, wherever it rolls them.",
        shownHere: NO,
      },
    },
  },
  primitives: {
    label: "Primitives",
    unit: "system",
    holds: "Systems with a pre-FTL civilisation.",
    answers: {
      keep: {
        newGame: (n) =>
          `A pre-FTL civilisation in ${n === 1 ? "this system" : "each of these systems"}, ` +
          "rolled fresh, whatever the Pre-FTL setting says.",
        decidedBy: MAP,
        shownHere: YES,
      },
      plain: {
        newGame: "No pre-FTL civilisations from here.",
        decidedBy: ORDINARY,
        shownHere: NO,
      },
      game_decides: {
        newGame: "Pre-FTL civilisations as the Pre-FTL setting says.",
        decidedBy: GAME,
        shownHere: NO,
      },
    },
  },
  special_systems: {
    label: "Special systems",
    unit: "system",
    holds: "One-off systems: the L-Gate, caravaneers, precursor homes.",
    answers: {
      keep: {
        newGame:
          "These one-offs, such as the L-Gate, caravaneers and precursor homes, whatever " +
          "their settings say.",
        decidedBy: MAP,
        shownHere: YES,
      },
      plain: {
        newGame: "No one-offs from here. The game rolls its own as its settings say.",
        decidedBy: ORDINARY,
        shownHere: NO,
      },
      game_decides: {
        newGame:
          "One-offs as their settings say, wherever the game rolls them. A Lost Colony " +
          "parent among them brings the Commonwealth of Man too.",
        decidedBy: GAME,
        shownHere: NO,
      },
    },
  },
  ordinary_systems: {
    label: "Ordinary systems",
    unit: "system",
    holds: "Every other star, with the planets it has now.",
    answers: {
      keep: {
        newGame: "These systems with the planets they have now.",
        decidedBy: MAP,
        shownHere: YES,
      },
      game_decides: {
        newGame: "New planets in every one of them, rolled by the game. Positions and lanes stay.",
        decidedBy: "The game for the planets, this map for positions and lanes.",
        shownHere: "Positions yes, contents no.",
      },
    },
  },
  wormhole_pairs: {
    label: "Wormhole pairs",
    unit: "system",
    holds: "The wormholes this map links.",
    answers: {
      keep: {
        newGame: "These pairs, plus 5 random pairs per step of the Wormhole Pairs slider.",
        decidedBy: "This map, plus the game's own pairs.",
        shownHere: "These pairs yes.",
      },
      none: {
        newGame: "Only the slider's pairs. Taking these out can cut systems off.",
        decidedBy: GAME,
        shownHere: NO,
      },
    },
  },
  system_names: {
    label: "System names",
    unit: "system",
    holds: "The names the save gave its systems.",
    answers: {
      keep: { newGame: "These names.", decidedBy: MAP, shownHere: YES },
      game_names: { newGame: "The game's names.", decidedBy: GAME, shownHere: NO },
    },
  },
};

const PAINT_ROWS: Record<PrepareRow, RowCopy> = {
  ...PLAIN_ROWS,
  home_neighbours: {
    ...PLAIN_ROWS.home_neighbours,
    answers: {
      ...PLAIN_ROWS.home_neighbours.answers,
      keep: {
        newGame: "These guaranteed worlds beside the old capitals, with the empire's planet class.",
        decidedBy: MAP,
        shownHere: YES,
      },
      plain: {
        newGame: "No guaranteed worlds from here. Paint a Galaxy adds them from its slider.",
        decidedBy: ORDINARY,
        shownHere: NO,
      },
    },
  },
  fallen_empires: {
    ...PLAIN_ROWS.fallen_empires,
    holds: "Paint a Galaxy fallen empire zones.",
    answers: {
      keep: {
        newGame: "Fallen empires built in these zones, as the Fallen Empires slider allows.",
        decidedBy: MAP,
        shownHere: YES,
      },
      random_zones: {
        newGame: "Fallen empires built in new zones, as the Fallen Empires slider allows.",
        decidedBy: "This map: Forge fits the zones here, and Reroll draws again.",
        shownHere: "Yes, once drawn.",
      },
      none: {
        newGame: "No fallen empires. The game adds none on a static map.",
        decidedBy: "Nothing: there are none to place.",
        shownHere: NO,
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

/** What each colour of the map's outcome marks says. */
export const OUTCOME_LABELS = {
  ordinary: "Ordinary star",
  rolled: "Rolled by the game",
  seat: "New seat",
  zone: "New zone",
} as const;

/** What the map marks a system as under the current choices; a kept system has no mark. */
export type Outcome = keyof typeof OUTCOME_LABELS;
