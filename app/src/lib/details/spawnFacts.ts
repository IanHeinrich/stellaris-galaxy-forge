/**
 * What a scenario system's initializer says beyond a save's fields, in the words the Inspector
 * shows: how many bodies it places, how a class or a star is decided, what a body's deposits,
 * features and anomalies are, and the facts only a random galaxy uses.
 */
import type { BodySpawn } from "../../generated/BodySpawn";
import type { Bounds } from "../../generated/Bounds";
import type { ClassPool } from "../../generated/ClassPool";
import type { CountRange } from "../../generated/CountRange";
import type { DepositStep } from "../../generated/DepositStep";
import type { ListMember } from "../../generated/ListMember";
import type { ModifierView } from "../../generated/ModifierView";
import type { NeighborSystem } from "../../generated/NeighborSystem";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { RawStatement } from "../../generated/RawStatement";
import type { StatedAnomalies } from "../../generated/StatedAnomalies";
import type { StatedFeatures } from "../../generated/StatedFeatures";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemSpawn } from "../../generated/SystemSpawn";
import type { UnknownClass } from "../../generated/UnknownClass";
import { counted } from "../text";
import type { ModifierRow } from "./planetPage";

/** What a rolled value says on hover, wherever it shows. */
export const ROLLED_TITLE = "Rolled when the game starts";

/** `2 to 10`, or `14` for a count the initializer fixes. */
export function rangeWords(range: CountRange | Bounds): string {
  const min = Math.round(range.min);
  const max = Math.round(range.max);
  return min === max ? `${min}` : `${min} to ${max}`;
}

/** `2 to 10 planets`, `1 planet`, `0 to 1 moon`: a count with its noun, singular when it can be no more than one. */
export function countWords(range: CountRange, noun: string, plural = `${noun}s`): string {
  if (range.min === range.max) return counted(range.min, noun, plural);
  return `${rangeWords(range)} ${range.max === 1 ? noun : plural}`;
}

/** Whether a count may come out to more than one value. */
export function isRanged(range: CountRange): boolean {
  return range.min !== range.max;
}

/** How many planets, moons and asteroids a system has; `null` where a script places them. */
export interface PlanetCounts {
  planets: CountRange | null;
  moons: CountRange | null;
  asteroids: CountRange | null;
}

const exactly = (n: number): CountRange => ({ min: n, max: n });

/**
 * A system's planets, moons and asteroids: the initializer's ranges for a scenario system, else
 * the bodies its details list, counted as the initializer's are. Stars count as neither, and an
 * asteroid counts as an asteroid wherever it orbits.
 */
export function planetCounts(
  details: Pick<SystemDetails, "planets" | "spawn">,
  isStar: (p: PlanetSummary) => boolean,
  isAsteroid: (p: PlanetSummary) => boolean,
): PlanetCounts {
  const spawn = details.spawn;
  if (spawn !== undefined) {
    return { planets: spawn.planets, moons: spawn.moons, asteroids: spawn.asteroids };
  }
  let planets = 0;
  let moons = 0;
  let asteroids = 0;
  for (const body of details.planets) {
    if (isStar(body)) continue;
    if (isAsteroid(body)) asteroids += 1;
    else if (body.moon) moons += 1;
    else planets += 1;
  }
  return { planets: exactly(planets), moons: exactly(moons), asteroids: exactly(asteroids) };
}

/** Whether a class is an asteroid's, as the game data or its key says. */
export function isAsteroidClass(
  planetClass: string,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
): boolean {
  return planetClasses.get(planetClass)?.asteroid === true || planetClass.includes("asteroid");
}

/** What the system's head says of an unknown count: a script places the bodies. */
export const PLANETS_FROM_SCRIPT = "planets from a script";

/** The moons and asteroids beside the planets, each left out where there can be none. */
export function moonsAndAsteroids(counts: PlanetCounts): string[] {
  const words: string[] = [];
  if (counts.moons !== null && counts.moons.max > 0) words.push(countWords(counts.moons, "moon"));
  if (counts.asteroids !== null && counts.asteroids.max > 0) {
    words.push(countWords(counts.asteroids, "asteroid"));
  }
  return words;
}

/** One star of an `rl_` list, with its share of the draw; `share` is null where a weight is unknown. */
export interface StarOdds {
  key: string;
  share: number | null;
}

/** A star list's members, likeliest first, each with its share of the draw. */
export function starOdds(members: readonly ListMember[]): StarOdds[] {
  const known = members.every((m) => m.weight !== null);
  const total = members.reduce((sum, m) => sum + (m.weight ?? 0), 0);
  return members
    .map((m, index) => ({ m, index }))
    .sort((a, b) => (b.m.weight ?? 0) - (a.m.weight ?? 0) || a.index - b.index)
    .map(({ m }) => ({
      key: m.key,
      share: known && total > 0 ? (m.weight ?? 0) / total : null,
    }));
}

/** `24%`: a share of a draw as the star list shows it. */
export function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** The hint over a rolled star's list. */
export const STAR_LIST_HINT = "The game rolls one of these when a game starts, as often as shown.";

/** Where a star list comes from, under its rows. */
export function starListSource(list: string): string {
  return `from the star list ${list}`;
}

/** What the system's head says of its star when the initializer names no class it can show. */
export const RANDOM_STAR = "Random star";
export const UNKNOWN_STAR = "Unknown star";

/** What each of the engine's random draws picks among. */
const RANDOM_DRAWS: Record<string, string> = {
  random_colonizable: "Rolled from the habitable classes that fit its orbit",
  random_non_colonizable: "Rolled from the uninhabitable classes that fit its orbit",
  random_asteroid: "Rolled from the asteroid classes",
};

/** A rolled class's words: what it is drawn from. */
export function rolledClassText(pool: ClassPool): string {
  switch (pool.kind) {
    case "random":
      return RANDOM_DRAWS[pool.draw] ?? "Rolled from the classes that fit its orbit";
    case "planet_list":
      return `One of ${pool.members.length}, from ${pool.list}`;
    case "star_list":
      return `One of the stars in ${pool.list}`;
  }
}

/** What an unknown class says, and why it can't be told. */
export const CLASS_DECIDED = "Decided when the game starts";

export function unknownClassWhy(reason: UnknownClass, written: string): string {
  switch (reason) {
    case "ideal":
      return (
        "The initializer asks for the class that suits the empire nearby. On a scenario map " +
        "there is no empire nearby when the system is built, so the class is usually random."
      );
    case "script":
      return "Its effect changes the class only under a condition, which Galaxy Forge doesn't read.";
    case "undefined":
      return `The game data has no planet class or list called ${written}.`;
  }
}

/** What a row says of a ring the initializer leaves to the class's chance. */
export const RING_ROLLED = "Rolled by the game";
/** What the Model row says where the initializer names none. */
export const MODEL_ROLLED = "One of its class's models";
/** What the Name row says where the initializer names none. */
export const NAME_UNKNOWN = "Named by the game when it starts";

/** The chip on a body that may not spawn, and the head's hint under it. */
export const MAY_NOT_SPAWN = "may not spawn";

/** Why a body may not spawn: past its block's low count, or around a body that may not. */
export function mayNotSpawnHint(spawn: BodySpawn, moon: boolean): string {
  if (spawn.copy <= spawn.count.min) return "It orbits a body that may not spawn.";
  const nouns = moon ? "moons" : "planets";
  const fewer = spawn.copy === 1 ? "none" : `fewer than ${spawn.copy}`;
  return (
    `The initializer places ${rangeWords(spawn.count)} of these ${nouns}. ` +
    `The game may place ${fewer}.`
  );
}

/** What a body's page calls it in a sentence. */
export function bodyNoun(summary: Pick<PlanetSummary, "moon" | "star_class">): string {
  if (summary.star_class !== undefined) return "star";
  return summary.moon ? "moon" : "planet";
}

/** What the Deposits section says beside the deposits it lists. */
export interface DepositLines {
  /** Under the rows: what the initializer clears and what a set deposit replaces. */
  notes: string[];
  /** Under the Blockers head; null where the initializer says nothing of blockers. */
  blockers: string | null;
}

/** `deposit_cat_rare_resources` → `rare resources`: a deposit category the game data doesn't name. */
export function categoryWords(category: string): string {
  return category.replace(/^(deposit_)?cat(egory)?_/, "").replace(/_/g, " ");
}

/** How a deposit's and a category's names are read, for `depositLines`. */
export interface DepositNames {
  deposit: (key: string) => string;
  category: (key: string) => string;
}

/**
 * The lines the initializer's deposit statements add to its Deposits section, on a body that lists
 * `listed` deposits and is called `noun`. A `set_deposit` whose replacement the install doesn't say
 * is listed with the rest and adds no line.
 */
export function depositLines(
  steps: readonly DepositStep[],
  noBlockers: boolean,
  listed: number,
  noun: string,
  names: DepositNames,
): DepositLines {
  const notes: string[] = [];
  let blockers: string | null = noBlockers
    ? `None. The initializer stops blockers on this ${noun}.`
    : null;
  for (const step of steps) {
    switch (step.kind) {
      case "clear":
        if (step.category !== null) {
          notes.push(
            `The initializer clears the rolled ${names.category(step.category)} deposits.`,
          );
        } else if (listed > 0) {
          notes.push(
            "No other deposits. The initializer clears the rolled ones before adding these.",
          );
        } else {
          notes.push("None. The initializer clears the rolled deposits.");
        }
        break;
      case "set": {
        const note = setNote(step.deposit, step.category, step.replaces, names);
        if (note !== null) notes.push(note);
        break;
      }
      case "clear_blockers":
        blockers ??= "The initializer clears the rolled blockers.";
        break;
      case "add":
      case "add_blocker":
        break;
    }
  }
  return { notes, blockers };
}

function setNote(
  deposit: string,
  category: string | null,
  replaces: Extract<DepositStep, { kind: "set" }>["replaces"],
  names: DepositNames,
): string | null {
  const named = names.deposit(deposit);
  switch (replaces) {
    case "all":
      return `${named} replaces every rolled deposit.`;
    case "category":
      return category === null
        ? `${named} replaces the rolled deposits of its kind.`
        : `${named} replaces the rolled ${names.category(category)} deposits.`;
    case "unknown":
      return null;
  }
}

/** The deposit categories the initializer's deposit statements name, for their names to be read. */
export function depositCategories(steps: readonly DepositStep[]): string[] {
  return steps.flatMap((step) =>
    (step.kind === "clear" || step.kind === "set") && step.category !== null ? [step.category] : [],
  );
}

/** The planet features and modifiers an initializer states, as the Modifiers section lists them. */
export function statedModifierRows(
  features: StatedFeatures,
  views: ReadonlyMap<string, ModifierView>,
): ModifierRow[] {
  const rows: ModifierRow[] = [];
  if (features.modifier !== null) {
    const key = features.modifier;
    const view = views.get(key);
    rows.push({
      key,
      modifier: view?.static_modifier ?? key.replace(/^pm_/, ""),
      feature: true,
      days: null,
      view,
    });
  }
  for (const added of features.added) {
    rows.push({
      key: added.modifier,
      modifier: added.modifier,
      feature: false,
      days: added.days,
      view: views.get(added.modifier),
    });
  }
  return rows;
}

/** The modifier keys a body's page reads names and effects for. */
export function statedModifierKeys(features: StatedFeatures): string[] {
  return [
    ...(features.modifier === null ? [] : [features.modifier]),
    ...features.added.map((a) => a.modifier),
  ];
}

/**
 * What the Modifiers section says of what the initializer stops or clears, on a body that lists
 * `listed` modifiers; null for neither.
 */
export function modifierLine(
  features: StatedFeatures,
  noun: string,
  listed: number,
): string | null {
  if (features.none) {
    return listed > 0
      ? `The initializer stops rolled planet features on this ${noun}.`
      : `None. The initializer stops planet features on this ${noun}.`;
  }
  if (features.cleared) return "The initializer clears the planet features the game rolls.";
  return null;
}

/** What the Anomaly section says under any anomaly the initializer places. */
export function placedAnomaly(noun: string): string {
  return `Placed by the initializer. It is found when the ${noun} is surveyed.`;
}

/** What the Anomaly section says where the initializer places none: prevented, or left to a survey. */
export function anomalyLine(anomalies: StatedAnomalies, noun: string): string | null {
  if (anomalies.categories.length > 0) return null;
  switch (anomalies.prevented) {
    case "body":
      return `None. The initializer stops anomalies on this ${noun}.`;
    case "system":
      return "None. The initializer stops anomalies in this system.";
    case null:
      return `Can appear when the ${noun} is surveyed.`;
  }
}

/** Statements as the file writes them, one after another. */
export function rawText(statements: readonly RawStatement[]): string {
  return statements.map((s) => s.text).join("\n");
}

/** The system's Script hint: what the game does with lines Galaxy Forge doesn't read. */
export const SYSTEM_SCRIPT_HINT =
  "Galaxy Forge doesn't read these lines. The game runs them once, when it builds the system. " +
  "On a scenario map there is no root system and no hyperlane neighbour when they run.";

/** A body's Script hint. */
export function bodyScriptHint(noun: string): string {
  return `Galaxy Forge doesn't read these lines. The game runs them once, when it builds the ${noun}.`;
}

/** The Other keys hint: keys of the block Galaxy Forge keeps but doesn't show. */
export const OTHER_KEYS_HINT =
  "Galaxy Forge keeps these keys of the initializer but doesn't show them anywhere else.";

/** What the start planet's Initializer row says under it. */
export const START_PLANET_HINT =
  "The empire that spawns here starts on this planet, unless it brings its own starting system.";

/** Whether the initializer says anything only a random galaxy uses. */
export function hasRandomOnly(spawn: SystemSpawn): boolean {
  return (
    spawn.usage !== null ||
    spawn.usage_odds !== null ||
    spawn.spawn_chance !== null ||
    spawn.scaled_spawn_chance !== null ||
    spawn.neighbors.length > 0
  );
}

/** The heading over the facts only a random galaxy uses, and why they do nothing here. */
export const RANDOM_ONLY_TITLE = "Only in random galaxies";

export function randomOnlyHint(spawn: SystemSpawn): string {
  const what =
    spawn.neighbors.length > 0 ? "pick this layout and link it to others" : "pick this layout";
  return `A random galaxy uses these to ${what}. A scenario names the initializer, so they do nothing here.`;
}

/** What the Neighbours row says under its list. */
export const NEIGHBOURS_WHY =
  "A scenario map doesn't add these systems. Place them yourself if you want them.";

/** `sol_neighbor_t1 · 1 to 3 jumps`: a neighbour and how far away it is placed. */
export function neighbourText(neighbor: NeighborSystem): string {
  const reach: string[] = [];
  if (neighbor.hyperlane_jumps !== null) {
    const jumps = neighbor.hyperlane_jumps;
    reach.push(`${rangeWords(jumps)} ${Math.round(jumps.max) === 1 ? "jump" : "jumps"}`);
  }
  if (neighbor.distance !== null) reach.push(`distance ${rangeWords(neighbor.distance)}`);
  return [neighbor.initializer, ...reach].join(" · ");
}

/** The Instances row's value and the hint under it. */
export function instancesText(max: number): string {
  return `${max} per galaxy`;
}

/** What the Instances row says under it: placed systems count toward the most first. */
export function instancesHint(max: number): string {
  return max === 1
    ? "A system placed on the map counts first, so the game rolls no other."
    : `Systems placed on the map count first, so the game rolls no more than ${max} in all.`;
}

/** The Pre-FTL row's hint. */
export const PRIMITIVE_HINT = "The game builds it whatever the galaxy's Pre-FTL setting says.";

/** "Comes from" lines: the keys an inline script gave, and the values an `@variable` gave. */
export function comesFrom(spawn: Pick<SystemSpawn, "inline_scripts" | "variables">): string[] {
  return [
    ...spawn.inline_scripts.map((use) =>
      use.keys.length === 0
        ? `comes from ${use.script}`
        : `${use.keys.join(", ")} come from ${use.script}`,
    ),
    ...spawn.variables.map((use) => `${use.key} from ${use.variable}`),
  ];
}

/** The line under a list every body of which an inline script gives. */
export function everyBodyFrom(script: string): string {
  return `every body comes from ${script}`;
}
