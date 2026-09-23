/** Paint a Galaxy: its companion mod, and the seats its spawn script names. */

import type { DocumentKind } from "../generated/DocumentKind";
import type { HeaderField } from "../generated/HeaderField";
import type { PaintModView } from "../generated/PaintModView";
import type { PaintSpawnKind } from "../generated/PaintSpawnKind";
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { SpawnScript } from "../generated/SpawnScript";
import type { SystemNode } from "../generated/SystemNode";
import { isUnder, normalise } from "./paths";

/** The facts of the open document the Paint a Galaxy layer is derived from. */
export interface PaintDocument {
  kind: DocumentKind | null;
  path: string | null;
  /** The file carries the site's scripts or flags, or Forge's header for the mod. */
  painted: boolean;
  /** The user asked for the mod's profile when this document was started or opened. */
  paintChosen: boolean;
}

/**
 * Whether the open document is written for the Paint a Galaxy mod: a scenario that is painted,
 * was chosen as one, or lives in the mod's own scenarios folder. Never a save.
 */
export function paintLayer(doc: PaintDocument, paintMod: PaintModView | null): boolean {
  if (doc.kind !== "scenario") return false;
  if (doc.painted || doc.paintChosen) return true;
  const dir = paintMod?.scenarios_dir ?? null;
  return doc.path !== null && dir !== null && isUnder(doc.path, dir);
}

/**
 * Whether the scenario file at `path` is written for the Paint a Galaxy mod: it sits in the
 * mod's own scenarios folder, or its listing says it is painted. Null for a file neither can
 * speak for.
 */
export function scenarioForPaint(
  path: string,
  listings: readonly ScenarioListing[] | null,
  paintMod: PaintModView | null,
): boolean | null {
  const dir = paintMod?.scenarios_dir ?? null;
  if (dir !== null && isUnder(path, dir)) return true;
  const key = normalise(path);
  const listing = listings?.find((l) => normalise(l.path) === key);
  return listing === undefined ? null : listing.painted;
}

/** What opening a scenario file asks first, if anything. */
export type ScenarioOpenPrompt = "none" | "not_for_paint" | "paint_mod_off";

/**
 * A scenario for the mod opens at once while the mod is enabled, and asks first while it is not
 * or its state is unknown. Any other scenario asks unless the user turned that warning off.
 */
export function scenarioOpenPrompt(
  forPaint: boolean | null,
  paintMod: PaintModView | null,
  warnNotForPaint: boolean,
): ScenarioOpenPrompt {
  if (forPaint === true) return paintMod?.enabled ? "none" : "paint_mod_off";
  return warnNotForPaint ? "not_for_paint" : "none";
}

/** The seat a script offers, in a word or two; ", weighted" when it carries its holder's weight. */
export function spawnScriptLabel(script: SpawnScript): string {
  const { kind, player } = script.paint_a_galaxy;
  const seat =
    kind === "enabled"
      ? "enabled"
      : kind === "preferred"
        ? "preferred"
        : kind === "sol"
          ? "Sol"
          : `reserved ${kind.reserved.toUpperCase()}`;
  return player ? `${seat}, weighted` : seat;
}

/** One choice of seat, keyed for a select. */
export interface PaintSpawnKindOption {
  key: string;
  label: string;
}

const RESERVED_PREFIX = "reserved:";
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

/** Every seat the site knows: enabled, preferred, Sol, then one reservation per letter. */
export const PAINT_SPAWN_KINDS: readonly PaintSpawnKindOption[] = [
  { key: "enabled", label: "Enabled" },
  { key: "preferred", label: "Preferred" },
  { key: "sol", label: "Sol" },
  ...[...LETTERS].map((letter) => ({
    key: `${RESERVED_PREFIX}${letter}`,
    label: `Reserved ${letter.toUpperCase()}`,
  })),
];

/** Whether a select key names a reserved letter's seat. */
export function isReservedKey(key: string): boolean {
  return key.startsWith(RESERVED_PREFIX);
}

/** The letter a reserved key names, uppercase as `seatSummary` lists it. */
export function reservedLetter(key: string): string {
  return key.slice(RESERVED_PREFIX.length).toUpperCase();
}

/** The seats any empire may take, then the ones reserved for one: the select's two groups. */
export const PLAIN_SPAWN_KINDS: readonly PaintSpawnKindOption[] = PAINT_SPAWN_KINDS.filter(
  (k) => !isReservedKey(k.key),
);
export const RESERVED_SPAWN_KINDS: readonly PaintSpawnKindOption[] = PAINT_SPAWN_KINDS.filter((k) =>
  isReservedKey(k.key),
);

/**
 * What a seat's kind means, in the site's own terms. For a reserved letter the sentence ends
 * before naming the trait's submod, which a caller with a link to offer appends itself.
 */
export function paintKindDescription(script: SpawnScript): string {
  const { kind } = script.paint_a_galaxy;
  if (kind === "enabled") return "Any empire may start here.";
  if (kind === "preferred") {
    return (
      "Filled before enabled seats. In single player the player is seated first, so with one " +
      "preferred seat that is where you start."
    );
  }
  if (kind === "sol") {
    return (
      'Only the United Nations of Earth, or an empire with the "Reserved Spawn Sol" trait, starts ' +
      "here. Give it a generic initializer. The United Nations of Earth brings Sol with it, and " +
      "the game will not seat it on a seat that already names Sol's initializer."
    );
  }
  return `Only an empire whose species has the "Reserved Spawn ${kind.reserved.toUpperCase()}" trait starts here.`;
}

/** Whether a seat of this kind can carry its holder's weight: every kind but enabled. */
export function canBeWeighted(kind: PaintSpawnKind): boolean {
  return kind !== "enabled";
}

/**
 * What the weight does for a seat of this kind: a preferred seat's makes it the likeliest start,
 * Sol's and a reserved letter's make their one empire's start certain.
 */
export function weightedDescription(kind: PaintSpawnKind): string {
  if (kind === "enabled") return "";
  if (kind === "preferred") {
    return (
      "Weighted so it is the likeliest start once the earlier-placed empires have taken theirs. " +
      "Not a certain one."
    );
  }
  if (kind === "sol") {
    return "Weighted so the United Nations of Earth is certain to start here. No other empire can.";
  }
  return `Weighted so an empire with the Reserved Spawn ${kind.reserved.toUpperCase()} trait is certain to start here. No other empire can.`;
}

/** The select key of a script's seat: a reserved letter is lower-cased, as the site writes it. */
export function paintKindKey(script: SpawnScript): string {
  const { kind } = script.paint_a_galaxy;
  if (typeof kind === "string") return kind;
  return `${RESERVED_PREFIX}${kind.reserved.toLowerCase()}`;
}

function kindOf(key: string): PaintSpawnKind {
  if (key === "enabled" || key === "preferred" || key === "sol") return key;
  if (isReservedKey(key)) return { reserved: key.slice(RESERVED_PREFIX.length) };
  throw new Error(`Unknown Paint a Galaxy spawn kind: ${key}`);
}

/**
 * The script that seats `system` as `key` says: its random value is kept when it already has
 * one, and otherwise spread over the site's ten by the system's id. Its weight is kept when the
 * new kind can carry one.
 */
export function scriptForKind(key: string, system: SystemNode): SpawnScript {
  const current = system.spawn_script?.paint_a_galaxy;
  const kind = kindOf(key);
  const random_value = current?.random_value ?? system.id % 10;
  const player = canBeWeighted(kind) && (current?.player ?? false);
  return { paint_a_galaxy: { kind, random_value, player } };
}

/** The system's script with its holder's weight turned `on` or off. */
export function weightedScript(system: SystemNode, on: boolean): SpawnScript {
  const script = system.spawn_script ?? enabledScript(system);
  return { paint_a_galaxy: { ...script.paint_a_galaxy, player: on } };
}

/** The script a system is marked with when made a spawn point under the profile. */
export function enabledScript(system: SystemNode): SpawnScript {
  return scriptForKind("enabled", system);
}

/** The same for a system not yet in the galaxy, from the id it will take. */
export function enabledScriptFor(id: number): SpawnScript {
  return { paint_a_galaxy: { kind: "enabled", random_value: id % 10, player: false } };
}

/** The id the core gives the next added system: one past the highest in use, 1 when none is. */
export function nextSystemId(systems: Iterable<SystemNode>): number {
  let highest = 0;
  for (const system of systems) {
    if (system.id > highest) highest = system.id;
  }
  return highest + 1;
}

/**
 * The scenario header's `name`, unquoted: the string the game lists the scenario under. `null`
 * while the header states no such key.
 */
export function scenarioHeaderName(header: readonly HeaderField[]): string | null {
  const field = header.find((f) => f.key === "name");
  if (field === undefined) return null;
  const value = field.value.trim();
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

/** What a painted galaxy's scripted seats add up to. */
export interface SeatSummary {
  /** Every system a script seats, of any kind. */
  seats: number;
  preferred: number;
  /** Reserved letters in use, uppercase and deduplicated, ascending. */
  reserved: string[];
  sol: boolean;
  /** A seat of any kind carries its holder's weight. */
  player: boolean;
  /** AI empires the seats leave room for once the reserved seats and the player's are set aside. */
  safeAi: number;
}

/** The seats a galaxy's scripted systems add up to, for the header section's summary line. */
export function seatSummary(systems: Iterable<SystemNode>): SeatSummary {
  let seats = 0;
  let preferred = 0;
  let sol = false;
  let player = false;
  let playerOnReserved = false;
  const reserved = new Set<string>();
  for (const system of systems) {
    const script = system.spawn_script?.paint_a_galaxy;
    if (script === undefined) continue;
    const { kind } = script;
    const isReserved = kind === "sol" || typeof kind !== "string";
    seats++;
    if (script.player) player = true;
    if (script.player && isReserved) playerOnReserved = true;
    if (kind === "preferred") preferred++;
    else if (kind === "sol") sol = true;
    else if (typeof kind !== "string") reserved.add(kind.reserved.toUpperCase());
  }
  const reservedLetters = [...reserved].sort();
  const playersOwn = playerOnReserved ? 0 : 1;
  const safeAi = Math.max(0, seats - reservedLetters.length - (sol ? 1 : 0) - playersOwn);
  return { seats, preferred, reserved: reservedLetters, sol, player, safeAi };
}

/** The systems seated by a reserved letter, in the galaxy's order; a Sol seat is not one. */
export function reservedSeatIds(systems: Iterable<SystemNode>): number[] {
  const ids: number[] = [];
  for (const system of systems) {
    const kind = system.spawn_script?.paint_a_galaxy.kind;
    if (kind !== undefined && kind !== null && typeof kind !== "string") ids.push(system.id);
  }
  return ids;
}

/** The number a new wormhole pair takes: one past the highest in use, 1 when none is. */
export function nextWormholePair(systems: Iterable<SystemNode>): number {
  let highest = 0;
  for (const system of systems) {
    if (system.wormhole_pair !== null && system.wormhole_pair > highest) {
      highest = system.wormhole_pair;
    }
  }
  return highest + 1;
}

/** The pair two systems are the ends of, or null when they do not share one. */
export function sharedWormholePair(
  systems: ReadonlyMap<number, SystemNode>,
  a: number,
  b: number,
): number | null {
  const pair = systems.get(a)?.wormhole_pair ?? null;
  return pair !== null && a !== b && systems.get(b)?.wormhole_pair === pair ? pair : null;
}

/** The other end of the pair `system` is one end of; null when the file names no other end. */
export function wormholePartner(
  systems: ReadonlyMap<number, SystemNode>,
  system: SystemNode,
): SystemNode | null {
  if (system.wormhole_pair === null) return null;
  for (const other of systems.values()) {
    if (other.id !== system.id && other.wormhole_pair === system.wormhole_pair) return other;
  }
  return null;
}
