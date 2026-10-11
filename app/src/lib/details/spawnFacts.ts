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
import type { PoolClass } from "../../generated/PoolClass";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { RawStatement } from "../../generated/RawStatement";
import type { SpawnPool } from "../../generated/SpawnPool";
import type { SpawnRing } from "../../generated/SpawnRing";
import type { StatedFeatures } from "../../generated/StatedFeatures";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemSpawn } from "../../generated/SystemSpawn";
import type { UnknownClass } from "../../generated/UnknownClass";
import { dedent, scriptTokens } from "../scriptText";
import { counted, keyWords } from "../text";
import { boundsText } from "./labels";
import type { ModifierRow } from "./planetPage";

/** What the die mark beside a rolled value says on hover, wherever it shows. */
export const ROLLED_TITLE = "Rolled when a new game starts";

/** `2 to 10`, or `14` for a count the initializer fixes. */
export function rangeWords(range: CountRange | Bounds): string {
  return boundsText(range);
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

/** The classes a random draw can give at a body's orbit, likeliest first, each with its share where every weight is known. */
export function classOdds(classes: readonly PoolClass[]): StarOdds[] {
  return starOdds(classes.map((c) => ({ key: c.class, weight: c.weight })));
}

/** What the Class row says under classes listed without odds: which fit depends on the roll. */
export function classFitHint(orbitRanged: boolean, starRolled: boolean): string {
  if (orbitRanged && starRolled) {
    return "Which of these it can be depends on its orbit and on the system's star.";
  }
  return orbitRanged
    ? "Which of these it can be depends on its orbit."
    : "Which of these it can be depends on the system's star.";
}

/** What the Class row says under a planet list's members: the list may not be held to the orbit. */
export const LIST_ORBIT_HINT =
  "The game may roll any class in this list, even one that doesn't fit the orbit.";

/** `24%`: a share of a draw as the star list shows it; `<1%` for one too small to round up. */
export function percent(share: number): string {
  const whole = Math.round(share * 100);
  return whole === 0 && share > 0 ? "<1%" : `${whole}%`;
}

/** Where a star list comes from, in its card. */
export function starListSource(list: string): string {
  return `From the game's star list ${list}.`;
}

/** Where a planet class list comes from, in its card. */
export function classListSource(list: string): string {
  return `From the game's class list ${list}.`;
}

/** `One of 6 star classes`, the value of a star's class rolled from a list. */
export function starClassesWords(count: number): string {
  return `One of ${counted(count, "star class", "star classes")}`;
}

/** What the system's head says of its star when the initializer names no class it can show. */
export const RANDOM_STAR = "Random star";
export const UNKNOWN_STAR = "Unknown star";

/** What each of the engine's random rolls picks among. */
const RANDOM_ROLLS: Record<string, string> = {
  random_colonizable: "Rolled from the habitable classes that fit its orbit",
  random_non_colonizable: "Rolled from the uninhabitable classes that fit its orbit",
  random_asteroid: "Rolled from the asteroid classes",
};

/** A rolled class's words on its page: what it is rolled from. */
export function rolledClassText(pool: ClassPool): string {
  switch (pool.kind) {
    case "random":
      return RANDOM_ROLLS[pool.draw] ?? "Rolled from the classes that fit its orbit";
    case "planet_list":
      return `One of ${counted(pool.members.length, "class", "classes")}`;
    case "star_list":
      return "A rolled star class";
  }
}

/** What an unknown value says, on a page and on a list row. */
export const CLASS_DECIDED = "Decided at game start";
export const CLASS_DECIDED_ROW = "class decided at game start";

export function unknownClassWhy(reason: UnknownClass, written: string): string {
  switch (reason) {
    case "ideal":
      return (
        "The initializer asks for the class that suits the empire nearby. On a scenario map " +
        "no empire is nearby yet when a new game starts, so the class is usually random."
      );
    case "script":
      return "The initializer changes the class only when a condition holds, and Galaxy Forge can't tell whether it will.";
    case "undefined":
      return `Your installed game and mods have no planet class called ${written}.`;
  }
}

/** What a row says of a ring the initializer leaves to the class's chance. */
export const RING_ROLLED = "Rolled";

/** What a value the class a body gets decides says, and its card. */
export const CLASS_SUITED = "Rolled to suit its class";
export function classSuitedHint(noun: string): string {
  return `The game rolls these to suit the class the ${noun} gets.`;
}

/** The Ring row's words: stated, a chance, or left to a class the game decides. */
export function ringWords(ring: SpawnRing): string {
  switch (ring.state) {
    case "fixed":
      return ring.ring ? "Yes" : "No";
    case "rolled":
      return ring.chance === null ? RING_ROLLED : `${percent(ring.chance)} chance`;
    case "unknown":
      return CLASS_SUITED;
  }
}
/** What the Name row says where the game picks a name at random, and its card. */
export const NAME_RANDOM = "Random";
export const NAME_RANDOM_WHY = "The game picks a name for it at random when a new game starts.";

/** `1st`, `2nd`, `3rd`, `11th`: a copy's place among its block's. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/** The line a body's page shows of its place among its block's copies, and its card's sentence. */
export interface CopyFacts {
  line: string;
  hint: string;
}

/** `The game places 2 to 4 planets like this one.`, on a block's row and a copy's page alike. */
export function placedWords(count: CountRange, noun: string, moon: boolean): string {
  const around = moon ? " around each planet" : "";
  return `The game places ${rangeWords(count)} ${noun}s like this one${around}.`;
}

/**
 * What a body's page says of its place among the bodies its block places: a short line, such as
 * `3rd of 2 to 4 planets like this one · not in every game`, and the full sentence for its card.
 * `noun` is `planet`, `moon` or `asteroid`. `null` for a body placed once that every game has.
 */
export function copyFacts(spawn: BodySpawn, noun: string): CopyFacts | null {
  const { count, copy, always } = spawn;
  const some = `Some games have this ${noun} and some don't.`;
  const orbit = spawn.orbit_fit === "sometimes" ? orbitMayLeaveOut(noun) : null;
  const notEvery = "not in every game";
  if (count.max <= 1) {
    if (always && orbit === null) return null;
    return { line: "Not in every game", hint: orbit ?? some };
  }
  const placed = placedWords(count, noun, noun === "moon");
  const nth = `This is the ${ordinal(copy)}`;
  const short = `${ordinal(copy)} of ${rangeWords(count)} ${noun}s like this one`;
  if (isRanged(count) && copy > count.min) {
    return {
      line: `${short} · ${notEvery}`,
      hint: `${placed} ${nth}, so it is only there when the game places ${copy} or more.`,
    };
  }
  if (orbit !== null) return { line: `${short} · ${notEvery}`, hint: `${placed} ${nth}. ${orbit}` };
  return always
    ? { line: short, hint: `${placed} ${nth}, so every game has it.` }
    : { line: `${short} · ${notEvery}`, hint: `${placed} ${nth}. ${some}` };
}

/** Whether the game never places the body: no class it can roll fits any orbit it can land at. */
export function neverSpawns(spawn: BodySpawn | undefined): boolean {
  return spawn?.orbit_fit === "never";
}

/** Whether some games lack the body, for its count or for its orbit. */
export function maySpawn(spawn: BodySpawn | undefined): boolean {
  return spawn !== undefined && (!spawn.always || spawn.orbit_fit === "sometimes");
}

/** What the Inner radius row says where the initializer also writes an offset the range leaves out. */
export function innerOffsetHint(offset: number): string {
  return `The initializer adds ${offset} to this in a way Galaxy Forge can't work out, so the range leaves it out.`;
}

/** The mark a row and a page head show on a body the game never places. */
export const NEVER_PLACED = "never placed";

/**
 * What a body's page says of a body the game never places, and why: no class it can roll fits its
 * orbit, or the body it orbits is never placed.
 */
export function neverLine(noun: string, parentNever: boolean): string {
  return parentNever
    ? `The game never places this ${noun}, because it never places the body it orbits.`
    : `The game never places this ${noun}. None of the classes it can roll fit its orbit.`;
}

/** What a body's page adds where its orbit can leave it out of some games. */
export function orbitMayLeaveOut(noun: string): string {
  return `Some games have this ${noun} and some don't. At some of the orbits it can land at, none of the classes it can roll fit.`;
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
  /** Under the Blockers head; null where the initializer clears none. */
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
 * `listed` deposits. A `set_deposit` whose replacement the install doesn't say
 * is listed with the rest and adds no line.
 */
export function depositLines(
  steps: readonly DepositStep[],
  listed: number,
  names: DepositNames,
): DepositLines {
  const notes: string[] = [];
  let blockers: string | null = null;
  for (const step of steps) {
    switch (step.kind) {
      case "clear":
        if (step.category !== null) {
          notes.push(
            `The initializer clears the ${names.category(step.category)} deposits the game rolls.`,
          );
        } else if (listed > 0) {
          notes.push(
            "Only these. The initializer clears the deposits the game rolls, then adds these.",
          );
        } else {
          notes.push("None. The initializer clears the deposits the game rolls.");
        }
        break;
      case "set": {
        const note = setNote(step.deposit, step.category, step.replaces, names);
        if (note !== null) notes.push(note);
        break;
      }
      case "clear_blockers":
        blockers ??= "The initializer clears the blockers the game rolls.";
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

/** One thing a body's roll can give it, with the chance one roll gives it where that is known. */
export interface PoolPick {
  key: string;
  chance: number | null;
}

/** A pool's entries, likeliest first, the install's order kept among equals and unknown chances last. */
export function poolPicks(pool: Extract<SpawnPool, { state: "rolled" }>): PoolPick[] {
  return pool.entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => (b.entry.chance ?? -1) - (a.entry.chance ?? -1) || a.index - b.index)
    .map(({ entry }) => ({ key: entry.key, chance: entry.chance }));
}

/** The keys a pool can give, for their names to be read. */
export function poolKeys(pool: SpawnPool | undefined): string[] {
  return pool?.state === "rolled" ? pool.entries.map((e) => e.key) : [];
}

/** `Can roll · 9` or `Can also roll · 3`: the line over a pool, after the stated rows when there are some. */
export function poolTitle(stated: number, tail: string): string {
  return `${stated > 0 ? "Can also roll" : "Can roll"} · ${tail}`;
}

/** `3 planet features`: what a planet features pool's line counts, each name once. */
export function featuresTail(count: number): string {
  return counted(count, "planet feature");
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
      stated: true,
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
 * `listed` modifiers; null for neither, and where the Stopped row says it.
 */
export function modifierLine(
  features: StatedFeatures,
  noun: string,
  listed: number,
): string | null {
  if (features.none) {
    return listed > 0 ? `The game rolls no other planet features for this ${noun}.` : null;
  }
  if (features.cleared) return "The initializer clears the planet features the game rolls.";
  return null;
}

/** What the Anomaly section says under any anomaly the initializer places. */
export function placedAnomaly(noun: string): string {
  return `Placed by the initializer. It is found when the ${noun} is surveyed.`;
}

/** Something the initializer stops on a body: its tag in the Stopped row, and what the card says. */
export interface StoppedFact {
  tag: string;
  line: string;
}

/**
 * What the initializer stops on a body that lists `modifiers` modifiers, each a tag of the Stopped
 * row in place of a section that would only say so.
 */
export function stoppedFacts(spawn: BodySpawn, modifiers: number, noun: string): StoppedFact[] {
  const facts: StoppedFact[] = [];
  if (spawn.no_blockers) {
    facts.push({ tag: "Blockers", line: `The game rolls no blockers for this ${noun}.` });
  }
  if (spawn.features.none && modifiers === 0) {
    facts.push({
      tag: "Planet features",
      line: `The game rolls no planet features for this ${noun}.`,
    });
  }
  const anomalies = spawn.anomalies;
  if (anomalies.categories.length === 0 && anomalies.prevented !== null) {
    facts.push({
      tag: "Anomaly",
      line:
        anomalies.prevented === "body"
          ? `No anomaly can appear on this ${noun}.`
          : "No anomaly can appear anywhere in this system.",
    });
  }
  return facts;
}

/**
 * Whether the class a body rolls decides what a pool gives it: the install can't tell what the
 * pool holds, or the chance of anything in it.
 */
export function suitsClass(pool: SpawnPool | undefined): boolean {
  if (pool === undefined || pool.state === "fixed") return false;
  return pool.state === "unknown" || pool.entries.every((entry) => entry.chance === null);
}

/**
 * Whether a body's deposits show as a row rolled to suit its class, in place of a section: it
 * states none, and its class decides what it rolls.
 */
export function depositsWithClass(spawn: BodySpawn, listed: number): boolean {
  return suitsClass(spawn.rolled_deposits) && listed === 0 && spawn.deposits.length === 0;
}

/** Whether a body's planet features show as a row rolled to suit its class, in place of a section. */
export function featuresWithClass(spawn: BodySpawn, listed: number): boolean {
  const { features } = spawn;
  return suitsClass(spawn.rolled_features) && listed === 0 && !features.none && !features.cleared;
}

/** The heading over what a row rolled to suit its class can give, folded until opened. */
export const CAN_ROLL_TITLE = "What it can roll";

/** The lines that name the blockers and the other deposits a roll can give, by their count. */
export const BLOCKERS_LABEL = "Blockers";
export const OTHER_DEPOSITS_LABEL = "Other";

/**
 * Picks that show under one name as one, their chances added, null where any is unknown;
 * likeliest first, and in the order each name first comes among equals.
 */
export function mergedByName(
  picks: readonly PoolPick[],
  name: (key: string) => string,
): (PoolPick & { name: string })[] {
  const merged = new Map<string, PoolPick & { name: string }>();
  for (const pick of picks) {
    const shown = name(pick.key);
    const known = merged.get(shown);
    if (known === undefined) merged.set(shown, { ...pick, name: shown });
    else
      known.chance =
        known.chance === null || pick.chance === null ? null : known.chance + pick.chance;
  }
  return [...merged.values()]
    .map((pick, index) => ({ pick, index }))
    .sort((a, b) => (b.pick.chance ?? -1) - (a.pick.chance ?? -1) || a.index - b.index)
    .map(({ pick }) => pick);
}

/** What the Stopped row's card heads its lines with. */
export const STOPPED_LABEL = "Stopped";

/** The keys whose `@variable` the Size row's card names, and those the Orbit step row's card names. */
const SIZE_KEYS = new Set(["size", "size.min", "size.max"]);
const ORBIT_STEP_KEYS = new Set(["change_orbit", "orbit_distance"]);

/**
 * Whether a value an `@variable` sets is named in the card of the row that shows it: the Size row,
 * or the Orbit step row where the body has one.
 */
export function shownWithItsRow(key: string, orbitStep: boolean): boolean {
  return SIZE_KEYS.has(key) || (orbitStep && ORBIT_STEP_KEYS.has(key));
}

/** Whether an `@variable` sets part of a body's size. */
export function setsSize(key: string): boolean {
  return SIZE_KEYS.has(key);
}

/** Whether an `@variable` sets how far out a body is stepped. */
export function setsOrbitStep(key: string): boolean {
  return ORBIT_STEP_KEYS.has(key);
}

/** Statements as the file writes them, one after another. */
export function rawText(statements: readonly RawStatement[]): string {
  return statements.map((s) => dedent(s.text)).join("\n");
}

/** How many lines statements take as written. */
export function lineCount(statements: readonly RawStatement[]): number {
  return rawText(statements).split("\n").length;
}

/** The heading over the lines an initializer runs, which Galaxy Forge shows but doesn't read, and its card. */
export const SCRIPT_TITLE = "Script at game start";
export const SCRIPT_HINT = "The game runs these lines once, when a new game starts.";

/** What a script's section warns of where it looks for a neighbouring system. */
export const NEIGHBOUR_LOOKUP_WARNING =
  "On a scenario map they run before hyperlanes exist, so lines that look for a neighbouring system find none.";

/** A key of a scope that looks for a system one hyperlane away. */
export const NEIGHBOUR_LOOKUP = /^(every|random|any|count)_neighbor_system$/;

/** The heading over the initializer's lines Galaxy Forge keeps as written, and its card. */
export const OTHER_KEYS_TITLE = "Other initializer lines";
export const OTHER_KEYS_HINT =
  "Galaxy Forge keeps these lines as written and doesn't show them anywhere else.";

/** The titles the start planet and home planet chips show. */
export const START_PLANET_TITLE = "An empire that spawns here can start on this planet.";
export const HOME_PLANET_TITLE = "The home planet of the empire placed in this system.";

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

/** The heading over what only a random galaxy reads, the note beside it, and why it does nothing here. */
export const RANDOM_SETTINGS_TITLE = "Random galaxy settings";
export const RANDOM_SETTINGS_TAIL = "no effect here";
export const RANDOM_SETTINGS_HINT =
  "A random galaxy uses these to decide how often to add this system. " +
  "This map already places it, so they don't apply.";

/** What the Spawn chance and Scaled chance rows say in their cards, as the game's example initializer explains them. */
export const SPAWN_CHANCE_HINT =
  "The chance in 100 that a random galaxy uses this system once it has picked it.";
export const SCALED_CHANCE_HINT =
  "A spawn chance that grows with the galaxy: this number times the galaxy's systems, over 100. It wins over Spawn chance.";

/** The How often row of a `usage_odds` written as a number. */
export function usageWeight(weight: number): string {
  return `Weight ${weight}, against other systems of its kind`;
}

/** The How often row of `usage_odds` written as conditions: the number they start at, and its card. */
export function usageOddsText(base: number | null): string {
  return base === null ? "Set by conditions" : `Starts at ${base}`;
}
export function usageOddsHint(base: number | null): string {
  return base === null ? "The conditions below set it." : "The conditions below change it.";
}

/** The `usage` keys the game's own initializers use, in the words the Used as row shows. */
const USAGES: Record<string, string> = {
  misc_system_init: "a special system away from empires",
  empire_init: "an empire's home system",
  fallen_empire_init: "a fallen empire's home system",
  nomad_init: "a nomad empire's home system",
  custom_empire: "a home system to pick in the empire creator",
  origin: "an origin's home system",
};

/** What the Used as row shows for a `usage` key: its words, or the key where it has none. */
export function usageWords(usage: string): string {
  return USAGES[usage] ?? usage;
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

/** The Per galaxy row: the most systems a galaxy makes from the initializer. */
export function perGalaxyText(max: number): string {
  return `At most ${max}`;
}

/** What the Per galaxy row says under it: systems on the map count towards the most. */
export function perGalaxyHint(max: number): string {
  return max === 1
    ? "This system is that one, so a new game won't add another."
    : "Systems on this map count towards that.";
}

/**
 * Whether the initializer states how many a galaxy holds, that it is pre-FTL or its name list, or
 * takes a value from an inline script or an `@variable`.
 */
export function hasStatedRows(spawn: SystemSpawn): boolean {
  return (
    spawn.max_instances !== null ||
    spawn.primitive_system ||
    spawn.namelist !== null ||
    spawn.inline_scripts.length > 0 ||
    spawn.variables.length > 0
  );
}

/** The Pre-FTL row's hint. */
export const PRIMITIVE_HINT =
  "A random galaxy adds this system more or less often with its Pre-FTL Civilizations setting. This map already places it.";

/** A value an inline script or an `@variable` gives: its row's label, and what sets it. */
export interface ValueSource {
  label: string;
  via: "inline script" | "variable";
  name: string;
}

const VALUE_LABELS: Record<string, string> = {
  size: "Size",
  "size.min": "The smallest size",
  "size.max": "The largest size",
  orbit_distance: "Orbit step",
  orbit_angle: "Orbit angle",
  change_orbit: "Extra step",
  class: "Class",
  planet: "Planets",
  moon: "Moons",
  count: "Count",
  entity: "Model",
  has_ring: "Ring",
  spawn_chance: "Spawn chance",
  scaled_spawn_chance: "Scaled chance",
  usage_odds: "How often",
  max_instances: "Per galaxy",
  neighbor_system: "Neighbours",
  init_effect: SCRIPT_TITLE,
};

/** A key's label in a Set by row; on a moon `change_orbit` is its distance from its planet. */
function valueLabel(key: string, moon: boolean): string {
  if (key === "change_orbit" && moon) return "Moon distance";
  return VALUE_LABELS[key] ?? keyWords(key);
}

/** The values an inline script or an `@variable` gives, each with what sets it. */
export function valueSources(
  spawn: Pick<SystemSpawn, "inline_scripts" | "variables">,
  moon = false,
): ValueSource[] {
  return [
    ...spawn.inline_scripts.flatMap((use) =>
      (use.keys.length === 0 ? ["other_values"] : use.keys).map((key): ValueSource => ({
        label: key === "other_values" ? "Other values" : valueLabel(key, moon),
        via: "inline script",
        name: use.script,
      })),
    ),
    ...spawn.variables.map((use): ValueSource => ({
      label: valueLabel(use.key, moon),
      via: "variable",
      name: use.variable,
    })),
  ];
}

/** The line under a list every body of which a shared script gives, and the line under a body's head. */
export const EVERY_BODY_FROM = "Every body here comes from a shared script.";
export function bodyFrom(noun: string): string {
  return `This ${noun} comes from a shared script.`;
}

/** What a shared script's card names. */
export function sharedScriptHint(script: string): string {
  return `From the shared script ${script}.`;
}

/** What a value the game files define once says in its card. */
export const SHARED_VALUE_HINT = "A value the game files define once and reuse.";

/** Whether script text looks for a system one hyperlane away, by its keys as the snippet reads them. */
export function looksForNeighbours(text: string): boolean {
  return scriptTokens(text).some(
    (t) => t.kind !== "string" && t.kind !== "comment" && NEIGHBOUR_LOOKUP.test(t.text),
  );
}
