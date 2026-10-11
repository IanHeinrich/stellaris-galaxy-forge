/**
 * The names the game gives a scenario system's bodies when it builds the system: a stated name,
 * or one made from a localisation template and the name of the system or the body it orbits.
 */
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { NameTemplate } from "../../generated/NameTemplate";
import type { SpawnName } from "../../generated/SpawnName";
import { displayNameIn, nodeNameIn, templateName } from "../names";

/** A body's name as the game will give it. */
export interface GivenName {
  /**
   * Its name at the lowest numeral it can have: when only the bodies certain to spawn before it,
   * and the copies of its block before it, do.
   */
  text: string;
  /** Every name it can have, lowest numeral first. */
  all: string[];
  /** Its numeral, or its parent's, depends on bodies that may not spawn: `all` holds several. */
  rolled: boolean;
}

/** A template's English text, for while the install's localisation has not been read. */
export function defaultFormat(format: string): string {
  if (format === "PLANET_NAME_FORMAT") return "$PARENT$ $NUMERAL$";
  if (format === "SUBPLANET_NAME_FORMAT") return "$PARENT$$NUMERAL$";
  const star = /^STAR_NAME_(\d+)_OF_(\d+)$/.exec(format);
  if (star === null) return "$NAME$";
  const nth = Number(star[1]);
  const of = Number(star[2]);
  return of <= 1 ? "$NAME$" : `$NAME$ ${String.fromCharCode(64 + nth)}`;
}

/** `format`'s text with the parent's name and a numeral put in, each taken as written. */
function fill(format: string, parent: string, numeral: string): string {
  return format
    .replace(/\$(NAME|PARENT)\$/g, () => parent)
    .replace(/\$NUMERAL\$/g, () => numeral)
    .replace(/\s+/g, " ")
    .trim();
}

/** How `givenNames` reads a template's text and a stated name. */
export interface NameReader {
  /** A localisation template's text, `undefined` where the names read have none. */
  format: (key: string) => string | undefined;
  /** A body's stated name, as it shows: `name` is its key or its literal text. */
  stated: (planet: PlanetSummary, name: string) => string;
}

/**
 * Each body's given name by its id, for the bodies whose names can be told: a stated name, or a
 * template filled in with `systemName`, or with the given name of the body it orbits. A body is
 * left out where the game draws its name, never spawns it, or the system has no name yet.
 */
export function givenNames(
  planets: readonly PlanetSummary[],
  systemName: string,
  read: NameReader,
): Map<number, GivenName> {
  const byId = new Map(planets.map((p) => [p.id, p]));
  const out = new Map<number, GivenName>();
  const visiting = new Set<number>();
  const nameOf = (planet: PlanetSummary): GivenName | null => {
    const known = out.get(planet.id);
    if (known !== undefined) return known;
    const naming: SpawnName | undefined = planet.spawn?.naming;
    if (naming === undefined || naming.state === "unknown" || visiting.has(planet.id)) return null;
    visiting.add(planet.id);
    const given = naming.state === "fixed" ? fixed(planet, naming.name) : template(planet, naming);
    visiting.delete(planet.id);
    if (given !== null) out.set(planet.id, given);
    return given;
  };
  const fixed = (planet: PlanetSummary, name: string): GivenName => {
    const text = read.stated(planet, name);
    return { text, all: [text], rolled: false };
  };
  const lowest = new Map<number, string>();
  /** The copy of the same block just before `planet`, which spawns whenever `planet` does. */
  const previousCopy = (planet: PlanetSummary): PlanetSummary | undefined => {
    const spawn = planet.spawn;
    if (spawn === undefined || spawn.copy <= 1) return undefined;
    const at = planets.indexOf(planet);
    for (let i = at - 1; i >= 0; i--) {
      const other = planets[i].spawn;
      if (
        planets[i].parent === planet.parent &&
        other !== undefined &&
        other.copy === spawn.copy - 1 &&
        other.count.min === spawn.count.min &&
        other.count.max === spawn.count.max
      ) {
        return planets[i];
      }
    }
    return undefined;
  };
  /**
   * The numerals a copy can take: past the lowest of the copy before it, since a block's copies
   * spawn in order and that one is there whenever this one is.
   */
  const ownNumerals = (planet: PlanetSummary, numerals: readonly string[]): string[] => {
    const before = previousCopy(planet);
    if (before === undefined || nameOf(before) === null) return [...numerals];
    const floor = lowest.get(before.id);
    const at = floor === undefined ? -1 : numerals.indexOf(floor);
    const past = numerals.slice(at + 1);
    return past.length === 0 ? [...numerals] : past;
  };
  const template = (
    planet: PlanetSummary,
    naming: Extract<SpawnName, { state: "template" }>,
  ): GivenName | null => {
    let parent: GivenName | null;
    if (naming.parent === null) {
      parent = systemName === "" ? null : { text: systemName, all: [systemName], rolled: false };
    } else {
      const body = byId.get(naming.parent);
      parent = body === undefined ? null : nameOf(body);
    }
    if (parent === null) return null;
    const format = read.format(naming.format) ?? defaultFormat(naming.format);
    const numerals = naming.numerals.length === 0 ? [""] : ownNumerals(planet, naming.numerals);
    lowest.set(planet.id, numerals[0]);
    const all = parent.all.flatMap((p) => numerals.map((numeral) => fill(format, p, numeral)));
    return { text: all[0], all, rolled: all.length > 1 };
  };
  for (const planet of planets) nameOf(planet);
  return out;
}

const NO_NAMES: ReadonlyMap<number, GivenName> = new Map();

/**
 * The given names of a system's bodies, made from `systemName` as it stands and the name formats
 * as the install writes them; empty where no body has one.
 */
export function givenNamesFrom(
  planets: readonly PlanetSummary[] | undefined,
  systemName: NameTemplate | undefined,
  names: ReadonlyMap<string, string>,
  formats: ReadonlyMap<string, string>,
): ReadonlyMap<number, GivenName> {
  if (planets === undefined || !planets.some((p) => p.spawn?.naming !== undefined)) {
    return NO_NAMES;
  }
  const system =
    systemName === undefined || systemName.key === "" ? "" : nodeNameIn(names, systemName);
  return givenNames(planets, system, {
    format: (key) => formats.get(key),
    stated: (planet, name) =>
      name === planet.name_key && templateName(planet) !== ""
        ? templateName(planet)
        : displayNameIn(names, name),
  });
}

/** The localisation templates the bodies' given names are made from, for their text to be read. */
export function nameFormats(planets: readonly PlanetSummary[]): string[] {
  const formats = new Set<string>();
  for (const planet of planets) {
    const naming = planet.spawn?.naming;
    if (naming?.state === "template") formats.add(naming.format);
  }
  return [...formats];
}

/**
 * `Yunak II to IV`: the names from the lowest of `first`'s to the highest of `last`'s, the second
 * without the words it shares with the first at its start. One body that can have only two names
 * reads `Riadore Ia or IIa`, since it has one or the other and nothing between.
 */
export function nameSpan(first: GivenName, last: GivenName = first): string {
  const low = first.all[0];
  const high = last.all[last.all.length - 1];
  if (low === high) return low;
  const joiner = first === last && first.all.length === 2 ? "or" : "to";
  const lows = low.split(" ");
  const highs = high.split(" ");
  let shared = 0;
  while (shared < highs.length - 1 && shared < lows.length - 1 && lows[shared] === highs[shared]) {
    shared++;
  }
  return `${low} ${joiner} ${highs.slice(shared).join(" ")}`;
}

/** A body's name in a list: its span where its numeral is rolled, else its name. */
export function listedName(given: GivenName): string {
  return given.rolled ? nameSpan(given) : given.text;
}

/** `Kanthe II, Kanthe III or Kanthe IV`: every name a rolled numeral can give. */
export function eitherName(all: readonly string[]): string {
  if (all.length <= 1) return all[0] ?? "";
  return `${all.slice(0, -1).join(", ")} or ${all[all.length - 1]}`;
}

/** What the Name row says under a name whose numeral is rolled. */
export function rolledNameWhy(given: GivenName, noun: string): string {
  return `The game numbers ${noun}s in order, so this one is ${eitherName(given.all)}, depending on how many before it are placed.`;
}

/** What the Name row says of a body named after a system that has no name yet. */
export const NAMED_AFTER_SYSTEM = "Named after the system";
export const SYSTEM_UNNAMED_WHY = "The game picks the system's name when it starts.";

/** What the Name row says of a body named after a body whose name can't be told yet. */
export function namedAfterParent(parentNoun: string): string {
  return `Named after the ${parentNoun} it orbits`;
}
export function parentUnnamedWhy(parentNoun: string): string {
  return `That ${parentNoun}'s name isn't known until the game starts.`;
}
/** What the Name row says under a name the game draws at random. */
export const NAME_DRAWN_WHY = "The game draws asteroid names at random.";
