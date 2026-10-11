/**
 * The names the game gives a scenario system's bodies when it builds the system: a stated name,
 * or one made from a localisation template and the name of the system or the body it orbits.
 */
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SpawnName } from "../../generated/SpawnName";

/** A body's name as the game will give it. */
export interface GivenName {
  /** Its name at the lowest numeral: when only the bodies certain to spawn before it do. */
  text: string;
  /** Every name it can have, lowest numeral first. */
  all: string[];
  /** Its numeral, or its parent's, depends on bodies that may not spawn: `all` holds several. */
  rolled: boolean;
  /** How its numerals read beside its parent's name, for a span of several bodies' names. */
  numbered?: { format: string; parent: string; numerals: string[] };
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
    const given = naming.state === "fixed" ? fixed(planet, naming.name) : template(naming);
    visiting.delete(planet.id);
    if (given !== null) out.set(planet.id, given);
    return given;
  };
  const fixed = (planet: PlanetSummary, name: string): GivenName => {
    const text = read.stated(planet, name);
    return { text, all: [text], rolled: false };
  };
  const template = (naming: Extract<SpawnName, { state: "template" }>): GivenName | null => {
    let parent: GivenName | null;
    if (naming.parent === null) {
      parent = systemName === "" ? null : { text: systemName, all: [systemName], rolled: false };
    } else {
      const body = byId.get(naming.parent);
      parent = body === undefined ? null : nameOf(body);
    }
    if (parent === null) return null;
    const format = read.format(naming.format) ?? defaultFormat(naming.format);
    const numerals = naming.numerals.length === 0 ? [""] : naming.numerals;
    const all = parent.all.flatMap((p) => numerals.map((numeral) => fill(format, p, numeral)));
    const numbered = parent.rolled ? undefined : { format, parent: parent.text, numerals };
    return { text: all[0], all, rolled: all.length > 1, numbered };
  };
  for (const planet of planets) nameOf(planet);
  return out;
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
 * `Yunak II to IV`: the names from the lowest of `first`'s to the highest of `last`'s, the numerals
 * spanned where both are numbered beside the same name with a space before the numeral, else the
 * whole names.
 */
export function nameSpan(first: GivenName, last: GivenName): string {
  const low = first.all[0];
  const high = last.all[last.all.length - 1];
  if (low === high) return low;
  const a = first.numbered;
  const b = last.numbered;
  if (
    a !== undefined &&
    b !== undefined &&
    a.format === b.format &&
    a.parent === b.parent &&
    /\s\$NUMERAL\$/.test(a.format)
  ) {
    return fill(a.format, a.parent, `${a.numerals[0]} to ${b.numerals[b.numerals.length - 1]}`);
  }
  return `${low} to ${high}`;
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
