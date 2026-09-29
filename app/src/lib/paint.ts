/** Paint a Galaxy: its companion mod, and the seats its spawn script names. */

import type { DocumentKind } from "../generated/DocumentKind";
import type { HeaderField } from "../generated/HeaderField";
import type { PaintModView } from "../generated/PaintModView";
import type { PaintSpawnKind } from "../generated/PaintSpawnKind";
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { SpawnScript } from "../generated/SpawnScript";
import type { SystemNode } from "../generated/SystemNode";
import { RESERVED_SEAT_NAMES } from "../generated/constants";
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

/** A seat's kind without a reserved seat's name: the keys of `SEAT_KINDS`. */
export type SeatKind = "enabled" | "preferred" | "sol" | "reserved";

/** A reserved seat's name as the site shows it: `display` in text, `tag` on its map chip. */
export interface ReservedName {
  /** `A` or `Alpha`, as the trait "Reserved Spawn: A" spells it. */
  display: string;
  /** `A` or `α`: one glyph. */
  tag: string;
}

const GREEK_TAGS: Readonly<Record<string, string>> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  omicron: "ο",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
};

/** How the site shows the reserved seat a script names `name`, in any case. */
export function reservedName(name: string): ReservedName {
  const lower = name.toLowerCase();
  const display = lower.charAt(0).toUpperCase() + lower.slice(1);
  return { display, tag: GREEK_TAGS[lower] ?? display };
}

const NOT_RESERVED: ReservedName = { display: "", tag: "" };

/** What the app says and draws for one kind of seat; `name` is a reserved seat's. */
interface SeatKindInfo {
  /** In a word or two, as a script's label spells it. */
  label(name: ReservedName): string;
  /** What its chip on the map shows, or null for none. */
  tag(name: ReservedName): string | null;
  /** What the kind means, in the site's own terms. */
  description(name: ReservedName): string;
  /** Whether a seat of the kind can carry its holder's weight. */
  weightable: boolean;
  /** What the weight does for a seat of the kind. */
  weighted(name: ReservedName): string;
}

/**
 * Every kind of seat the site writes. A reserved seat's description ends before naming the
 * trait's submod, which a caller with a link to offer appends itself.
 */
export const SEAT_KINDS: Record<SeatKind, SeatKindInfo> = {
  enabled: {
    label: () => "enabled",
    tag: () => null,
    description: () => "Any empire may start here.",
    weightable: false,
    weighted: () => "",
  },
  preferred: {
    label: () => "1st Player",
    tag: () => "P",
    description: () =>
      "Kept for the first player: you in single player, the host in multiplayer. AI empires and " +
      "other players seldom start here. Use reserved seats to choose where they start.",
    weightable: true,
    weighted: () => "Weighted so the first player is all but certain to start here.",
  },
  sol: {
    label: () => "Sol",
    tag: () => "Sol",
    description: () =>
      'Only the United Nations of Earth, or an empire with the "Reserved Spawn Sol" trait, starts ' +
      "here. Give it Sol's initializer. When no one plays the United Nations of Earth, Paint a " +
      "Galaxy puts it on this Sol as the parent of a human Lost Colony, such as the Commonwealth " +
      "of Man.",
    weightable: true,
    weighted: () =>
      "Weighted so the United Nations of Earth is certain to start here. No other empire can.",
  },
  reserved: {
    label: (name) => `reserved ${name.display}`,
    tag: (name) => name.tag,
    description: (name) =>
      `Only an empire whose species has the "Reserved Spawn: ${name.display}" trait starts here.`,
    weightable: true,
    weighted: (name) =>
      `Weighted so an empire with the "Reserved Spawn: ${name.display}" trait is certain to start here. No other empire can.`,
  },
};

/** A script's kind of seat, and how a reserved seat's name shows (empty for the rest). */
export function seatKindOf(kind: PaintSpawnKind): { seat: SeatKind; name: ReservedName } {
  return typeof kind === "string"
    ? { seat: kind, name: NOT_RESERVED }
    : { seat: "reserved", name: reservedName(kind.reserved) };
}

/** The seat a script offers, in a word or two; ", weighted" when it carries its holder's weight. */
export function spawnScriptLabel(script: SpawnScript): string {
  const { kind, player } = script.paint_a_galaxy;
  const { seat, name } = seatKindOf(kind);
  const label = SEAT_KINDS[seat].label(name);
  return player ? `${label}, weighted` : label;
}

/** One choice of seat, keyed for a select. */
export interface PaintSpawnKindOption {
  key: string;
  label: string;
}

const RESERVED_PREFIX = "reserved:";
/** The random values an enabled or 1st Player seat is drawn from, as the mod reads them. */
const SEAT_MODULO = 10;

/** Every seat the site knows: enabled, 1st Player, Sol, then one reservation per name. */
export const PAINT_SPAWN_KINDS: readonly PaintSpawnKindOption[] = [
  { key: "enabled", label: "Enabled" },
  { key: "preferred", label: "1st Player" },
  { key: "sol", label: "Sol" },
  ...RESERVED_SEAT_NAMES.map((name) => ({
    key: `${RESERVED_PREFIX}${name}`,
    label: `Reserved ${reservedName(name).display}`,
  })),
];

/** Whether a select key names a reserved seat. */
export function isReservedKey(key: string): boolean {
  return key.startsWith(RESERVED_PREFIX);
}

/** The name a reserved key names, as `seatSummary` lists it: `A` or `Alpha`. */
export function reservedSeatName(key: string): string {
  return reservedName(key.slice(RESERVED_PREFIX.length)).display;
}

/** The seats any empire may take, then the ones reserved for one: the select's two groups. */
export const PLAIN_SPAWN_KINDS: readonly PaintSpawnKindOption[] = PAINT_SPAWN_KINDS.filter(
  (k) => !isReservedKey(k.key),
);
export const RESERVED_SPAWN_KINDS: readonly PaintSpawnKindOption[] = PAINT_SPAWN_KINDS.filter((k) =>
  isReservedKey(k.key),
);

/** What a seat's kind means, in the site's own terms (see `SEAT_KINDS`). */
export function paintKindDescription(script: SpawnScript): string {
  const { seat, name } = seatKindOf(script.paint_a_galaxy.kind);
  return SEAT_KINDS[seat].description(name);
}

/** Whether a seat of this kind can carry its holder's weight. */
export function canBeWeighted(kind: PaintSpawnKind): boolean {
  return SEAT_KINDS[seatKindOf(kind).seat].weightable;
}

/** What the weight does for a seat of this kind. */
export function weightedDescription(kind: PaintSpawnKind): string {
  const { seat, name } = seatKindOf(kind);
  return SEAT_KINDS[seat].weighted(name);
}

/** The select key of a script's seat: a reserved name is lower-cased, as the site writes it. */
export function paintKindKey(script: SpawnScript): string {
  const kind = script.paint_a_galaxy.kind;
  return typeof kind === "string" ? kind : `${RESERVED_PREFIX}${kind.reserved.toLowerCase()}`;
}

function kindOf(key: string): PaintSpawnKind {
  if (isReservedKey(key)) return { reserved: key.slice(RESERVED_PREFIX.length) };
  if (key === "enabled" || key === "preferred" || key === "sol") return key;
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
  const random_value = current?.random_value ?? system.id % SEAT_MODULO;
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
  return { paint_a_galaxy: { kind: "enabled", random_value: id % SEAT_MODULO, player: false } };
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
  /** 1st Player seats. */
  preferred: number;
  /** Reserved names in use as `reservedName` shows them, deduplicated, in the site's order. */
  reserved: string[];
  sol: boolean;
  /** A seat of any kind carries its holder's weight. */
  player: boolean;
  /**
   * AI empires the seats leave room for once the 1st Player, reserved and Sol seats are set
   * aside, and the player's own seat when it is none of those.
   */
  safeAi: number;
}

/** Where a reserved name falls in the site's order; a name it does not list goes last. */
function reservedOrder(display: string): number {
  const i = (RESERVED_SEAT_NAMES as readonly string[]).indexOf(display.toLowerCase());
  return i === -1 ? RESERVED_SEAT_NAMES.length : i;
}

/** The seats a galaxy's scripted systems add up to, for the header section's summary line. */
export function seatSummary(systems: Iterable<SystemNode>): SeatSummary {
  let seats = 0;
  let preferred = 0;
  let sol = false;
  let player = false;
  let reservedSeats = 0;
  let playerOnReserved = false;
  const reserved = new Set<string>();
  for (const system of systems) {
    const script = system.spawn_script?.paint_a_galaxy;
    if (script === undefined) continue;
    const { seat, name } = seatKindOf(script.kind);
    seats++;
    if (script.player) player = true;
    if (script.player && (seat === "sol" || seat === "reserved")) playerOnReserved = true;
    if (seat === "preferred") preferred++;
    if (seat === "sol" || seat === "reserved") reservedSeats++;
    if (seat === "sol") sol = true;
    else if (seat === "reserved") reserved.add(name.display);
  }
  const names = [...reserved].sort(
    (a, b) => reservedOrder(a) - reservedOrder(b) || a.localeCompare(b),
  );
  const playersOwn = preferred > 0 || playerOnReserved ? 0 : 1;
  const safeAi = Math.max(0, seats - preferred - reservedSeats - playersOwn);
  return { seats, preferred, reserved: names, sol, player, safeAi };
}

/** The systems seated by a reserved name, in the galaxy's order; a Sol seat is not one. */
export function reservedSeatIds(systems: Iterable<SystemNode>): number[] {
  const ids: number[] = [];
  for (const system of systems) {
    const kind = system.spawn_script?.paint_a_galaxy.kind;
    if (kind !== undefined && seatKindOf(kind).seat === "reserved") ids.push(system.id);
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
