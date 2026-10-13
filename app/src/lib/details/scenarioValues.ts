/**
 * Each scenario value in one of its three states, with the words it shows: as the file states it,
 * rolled when a new game starts, or decided then in a way Galaxy Forge can't show.
 */
import type { BodySpawn } from "../../generated/BodySpawn";
import type { CountRange } from "../../generated/CountRange";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SpawnName } from "../../generated/SpawnName";
import type { SpawnRing } from "../../generated/SpawnRing";
import type { SpawnStar } from "../../generated/SpawnStar";
import { templateName, type Names } from "../names";
import { capitalised } from "../text";
import { blockNoun } from "./bodyBlocks";
import { bodyClassName, boundsText, givenBodyName, isUnrolledClass } from "./labels";
import { rounded } from "./orbits";
import {
  CLASS_DECIDED,
  CLASS_DECIDED_ROW,
  CLASS_SUITED,
  classDraw,
  countWords,
  isAsteroidClass,
  isRanged,
  NAME_RANDOM,
  NAME_RANDOM_WHY,
  PLANETS_FROM_SCRIPT,
  RANDOM_CLASS,
  RANDOM_STAR,
  RING_ROLLED,
  ringWords,
  starClassesWords,
  UNKNOWN_STAR,
  type PlanetCounts,
} from "./spawnFacts";
import {
  NAMED_AFTER_SYSTEM,
  namedAfterParent,
  nameSpan,
  parentUnnamedWhy,
  rolledNameWhy,
  SYSTEM_UNNAMED_WHY,
  type GivenName,
} from "./spawnNames";

export type ValueState = "fixed" | "rolled" | "unknown";

/** A scenario value as it shows: its state, and its words. */
export interface StateText {
  state: ValueState;
  text: string;
}

/** The two bounds of a range the game may roll, a count or a radius. */
interface Range {
  min: number;
  max: number;
}

const fixed = (text: string): StateText => ({ state: "fixed", text });
const rolled = (text: string): StateText => ({ state: "rolled", text });
const unknown = (text: string): StateText => ({ state: "unknown", text });

/** What the Planets section says beside its title of a count a script gives. */
export const FROM_SCRIPT = "from a script";

/** A value left to the class the body gets. */
export const CLASS_SUITED_VALUE = rolled(CLASS_SUITED);

/** A range, rolled where its bounds differ, worded by `text`. */
export function rangeValue(range: Range, text: (range: Range) => string = boundsText): StateText {
  return { state: isRanged(range) ? "rolled" : "fixed", text: text(range) };
}

/** A system's star: its class's `label`, or what an initializer that rolls it or names none says. */
export function starValue(star: SpawnStar | undefined, label: string): StateText {
  if (star?.state === "rolled") return rolled(RANDOM_STAR);
  if (star?.state === "unknown") return unknown(UNKNOWN_STAR);
  return fixed(label);
}

/** A system's planets, planets alone: `14 planets`, a range the game rolls, or a script's. */
export function planetCountValue(counts: PlanetCounts): StateText {
  if (counts.planets === null) return unknown(PLANETS_FROM_SCRIPT);
  return rangeValue(counts.planets, (range) => countWords(range, "planet"));
}

/** What the Planets section says beside its title: nothing for a count the file states. */
export function planetsSummaryValue(counts: PlanetCounts): StateText | null {
  if (counts.planets === null) return unknown(FROM_SCRIPT);
  return isRanged(counts.planets) ? rolled(boundsText(counts.planets)) : null;
}

/** How many copies a block places: `×3`, or a range the game rolls. */
export function copiesValue(count: CountRange): StateText {
  return rangeValue(count, (range) => (isRanged(range) ? boundsText(range) : `×${range.max}`));
}

/** `40.5`, or `40 to 60` for a radius the game rolls. */
function radiusText(bounds: Range): string {
  return isRanged(bounds) ? boundsText(bounds) : `${rounded(bounds.min)}`;
}

/** A radius the game may draw: a range it rolls, or the one number. */
export function radiusValue(bounds: Range): StateText {
  return rangeValue(bounds, radiusText);
}

/** A scenario's inner radius: unknown where the initializer writes an offset no game file explains. */
export function innerRadiusValue(bounds: Range, offset: number | null): StateText {
  return offset === null ? radiusValue(bounds) : unknown(radiusText(bounds));
}

/** A body's ring: as its block says, else as its summary states it or leaves it to its class. */
export function ringValue(ring: SpawnRing | undefined, stated: boolean | null): StateText {
  if (ring !== undefined) {
    return { state: ring.state === "fixed" ? "fixed" : "rolled", text: ringWords(ring) };
  }
  if (stated === null) return rolled(RING_ROLLED);
  return fixed(stated ? "Yes" : "No");
}

/** A body's name as lists show it, rolled where its numeral depends on bodies that may not spawn. */
export function listedNameValue(listed: { text: string; rolled: boolean }): StateText {
  return { state: listed.rolled ? "rolled" : "fixed", text: listed.text };
}

/** A value with what its card says; `hint` is `null` where it has nothing to add. */
export interface HintedValue {
  value: StateText;
  hint: string | null;
}

/**
 * A scenario body's Name row: the name the game gives it, the one its block states, a name made
 * after a system or `parentNoun` not named yet, or one the game picks at random. `noun` names the
 * body in the card.
 */
export function nameValue(
  given: GivenName | undefined,
  naming: SpawnName | undefined,
  stated: string | null,
  noun: string,
  parentNoun: string,
): HintedValue {
  if (given !== undefined) {
    return {
      value: listedNameValue(given),
      hint: given.rolled ? rolledNameWhy(given, noun) : null,
    };
  }
  if (naming?.state === "template" && stated === null) {
    return naming.parent === null
      ? { value: unknown(NAMED_AFTER_SYSTEM), hint: SYSTEM_UNNAMED_WHY }
      : { value: unknown(namedAfterParent(parentNoun)), hint: parentUnnamedWhy(parentNoun) };
  }
  if (stated === null) return { value: rolled(NAME_RANDOM), hint: NAME_RANDOM_WHY };
  return { value: fixed(stated), hint: null };
}

/** A body's size: as the initializer's effect changes it, its range, or left to its class. */
export function sizeValue(changed: number | null, size: Range | null): StateText {
  if (changed !== null) return fixed(`${changed}`);
  return size === null ? CLASS_SUITED_VALUE : rangeValue(size);
}

/**
 * A scenario body's class: as the initializer's effect changes it, as its block states it,
 * decided at game start, or what it is drawn from; `stars` star classes where a star list draws it.
 */
export function classValue(
  spawn: BodySpawn,
  names: Names,
  moon: boolean,
  stars: number | null,
): StateText {
  if (spawn.changed_class !== null) return fixed(bodyClassName(spawn.changed_class, names, moon));
  const cls = spawn.class;
  switch (cls.state) {
    case "fixed":
      return fixed(bodyClassName(cls.class, names, moon));
    case "unknown":
      return unknown(CLASS_DECIDED);
    case "rolled":
      return rolled(stars === null ? capitalised(classDraw(cls.pool)) : starClassesWords(stars));
  }
}

/** What a Planets row heads with, and what it says of the body's class. */
export interface RowLabel {
  /** The body's name, as its page heads it. */
  name: string;
  title: StateText;
  /** `null` where the title names the body and its class goes unsaid. */
  class: StateText | null;
  /** The title says what the body or its block is, having no name to give. */
  described: boolean;
}

/**
 * A Planets row's label: the body's name, the names `span` its block's copies run through, or what
 * it is where it has none, and its class as the row says it. `count` is how many its block places.
 */
export function rowLabel(
  planet: PlanetSummary,
  given: GivenName | undefined,
  count: CountRange | null,
  span: string | undefined,
  facts: { names: Names; planetClasses: ReadonlyMap<string, PlanetClassView> },
): RowLabel {
  const unrolled = isUnrolledClass(planet.class);
  const named = given?.text ?? templateName(planet);
  const name = givenBodyName(planet, given, facts.names);
  const spawn = planet.spawn;
  const state = spawn?.class.state;
  const plural = count !== null && count.max > 1;
  const noun = blockNoun(planet.moon, isAsteroidClass(planet.class, facts.planetClasses), !plural);
  const random = unrolled || (state !== undefined && state !== "fixed");
  const described = named === "" && (plural || random);
  const describedText = random ? `Random ${noun}` : capitalised(noun);
  const text =
    span ?? (given !== undefined ? nameSpan(given, given) : described ? describedText : name);
  const rolledSpan = span !== undefined && count !== null && isRanged(count);
  const titleState: ValueState =
    given?.rolled === true || rolledSpan
      ? "rolled"
      : named !== "" || state === undefined
        ? "fixed"
        : state;
  const classText = (): StateText | null => {
    if (named === "" && !described) return null;
    if (spawn?.class.state === "rolled") return rolled(classDraw(spawn.class.pool));
    if (state === "unknown") return unknown(CLASS_DECIDED_ROW);
    if (described && unrolled) return fixed(RANDOM_CLASS);
    return fixed(bodyClassName(planet.class, facts.names, planet.moon));
  };
  return { name, title: { state: titleState, text }, class: classText(), described };
}
