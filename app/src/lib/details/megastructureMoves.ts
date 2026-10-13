/**
 * How a save's megastructure moves in the system view: to a point of its own, onto another body
 * of its system, or not at all, and why a body will not take it. The core refuses the rest.
 */
import { MEGASTRUCTURE_BYPASS_KINDS } from "../../generated/constants";
import type { MegastructurePlace } from "../../generated/MegastructurePlace";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import type { MegastructureView } from "../../generated/MegastructureView";
import type { Op } from "../../generated/Op";
import { isRingRow } from "./ringWorldRemoval";

/** The bypass kinds a moved row may stand for, as the core moves them. */
const MOVED_BYPASSES: ReadonlySet<string> = new Set(MEGASTRUCTURE_BYPASS_KINDS);

/** How one row moves. */
export type MegastructureMove =
  /** Dragged to any point, where the game keeps it. */
  | { readonly place: "free" }
  /**
   * Dragged onto another body of the system: only a star for `starOnly`, a type built only
   * around a star; never a star for `planetOnly`, a type the game never builds on one.
   */
  | {
      readonly place: "body";
      readonly on: number;
      readonly starOnly: boolean;
      readonly planetOnly: boolean;
      /**
       * It stands at a point of its own about its body, as a moon does, and is dragged freely;
       * false for one the game draws on its body wherever its point is.
       */
      readonly floats: boolean;
    }
  /** It stays where it is, for the reason given. */
  | { readonly place: "fixed"; readonly why: string };

/** Why a row stays where it is, as the tooltip and the status bar say it. */
export const MEGASTRUCTURE_FIXED = {
  ringWorld: "A ring world section stays where it is",
  bypass: "The L-Gate stays where the game put it",
  starbase: "It stands with a starbase, which stays where it is",
  whole: "It is part of a larger structure, which stays where it is",
  centre: "It stands at the system's centre without naming a body, so it stays where it is",
  made: "It made the planet it stands on, so it stays with it",
} as const;

/** Why a body will not take a dragged row. */
export const MEGASTRUCTURE_REFUSALS = {
  elsewhere: "That body is not in this system",
  starOnly: (name: string) => `${name} stands only around a star`,
  planetOnly: (name: string) => `${name} can't stand on a star`,
  taken: (body: string) => `${body} already has a megastructure`,
} as const;

/** What a row's move reads of the body it is tied to. */
export interface HomeBody {
  readonly star: boolean;
  /** It is drawn as an Arc Furnace's hidden model. */
  readonly hidden: boolean;
}

/**
 * Whether a row of `type` tied to a body stands at its own point: false for a type the game
 * draws on its body wherever its point is, one that grows with its planet or stands on its star
 * with no offset, as an Orbital Ring or a Dyson Sphere does. Without the type, false.
 */
export function floatsFree(type: MegastructureView | undefined, onStar: boolean): boolean {
  if (type === undefined || type.scales_with_planet) return false;
  const [dx, dy] = type.entity_offset;
  return !(onStar && dx === 0 && dy === 0);
}

/**
 * How row `row` of `type` moves. A body drawn as the furnace's hidden model keeps it off a star
 * whatever the game data says.
 */
export function megastructureMove(
  row: MegastructureSummary,
  type: MegastructureView | undefined,
  home: HomeBody = { star: false, hidden: false },
): MegastructureMove {
  const known = type === undefined ? undefined : new Map([[row.kind, type]]);
  if (isRingRow(row.kind, known)) return fixed("ringWorld");
  const bypass = type?.bypass_type ?? null;
  if (bypass !== null && !MOVED_BYPASSES.has(bypass)) return fixed("bypass");
  const placement = type?.placement;
  if (placement?.place === "unsupported") {
    if (placement.why.kind === "becomes_starbase") return fixed("starbase");
    if (placement.why.kind === "whole_structure") return fixed("whole");
  }
  if (row.made_body === true) return fixed("made");
  if (row.planet !== null) {
    const starOnly = placement?.place === "body" && placement.star_only;
    const planetOnly = type?.planet_only === true || home.hidden;
    const floats = floatsFree(type, home.star);
    return { place: "body", on: row.planet, starOnly, planetOnly, floats };
  }
  if (placement?.place === "body") return fixed("centre");
  return { place: "free" };
}

function fixed(why: keyof typeof MEGASTRUCTURE_FIXED): MegastructureMove {
  return { place: "fixed", why: MEGASTRUCTURE_FIXED[why] };
}

/** The label of the menu item that stands a floating structure back at its planet's point. */
export function snapLabel(planet: string): string {
  return `Snap to ${planet}`;
}

/**
 * The body a floating row of `type` goes back to the point of, among `bodies`: its own, when it
 * stands away from it; null for any other row.
 */
export function snapBody(
  row: MegastructureSummary,
  type: MegastructureView | undefined,
  bodies: readonly { id: number; x: number; y: number; star: boolean }[],
): number | null {
  const home = bodies.find((b) => b.id === row.planet);
  if (!home || row.at === null || row.made_body === true) return null;
  if (!floatsFree(type, home.star)) return null;
  return samePoint(row.at, [home.x, home.y]) ? null : home.id;
}

/** What a body of the system is to a row dragged onto it. */
export interface TargetBody {
  readonly id: number;
  readonly star: boolean;
  /** What the readout calls it. */
  readonly name: string;
}

/**
 * Why `body` will not take row `id`, which moves as `move` and is called `name`, or null when it
 * will. `rows` are the system's megastructures. A body the row stands on is not a target.
 */
export function targetRefusal(
  move: Extract<MegastructureMove, { place: "body" }>,
  id: number,
  name: string,
  body: TargetBody,
  rows: readonly MegastructureSummary[],
): string | null {
  if (move.starOnly && !body.star) return MEGASTRUCTURE_REFUSALS.starOnly(name);
  if (move.planetOnly && body.star) return MEGASTRUCTURE_REFUSALS.planetOnly(name);
  if (rows.some((row) => row.id !== id && row.planet === body.id)) {
    return MEGASTRUCTURE_REFUSALS.taken(body.name);
  }
  return null;
}

/**
 * The op that moves row `row` to `at`, or null where it stands there already. `home` is where its
 * body stands, which a row sent back to its own body may already stand at; null when unknown.
 */
export function moveMegastructureOp(
  row: MegastructureSummary,
  at: MegastructurePlace,
  home: readonly [number, number] | null = null,
): Op | null {
  if (at.place === "body" && row.planet === at.body && atOwnBody(row, home)) return null;
  const point = at.place === "body" ? null : ([at.x, at.y] as const);
  const sameBody = at.place !== "beside" || row.planet === at.body;
  if (point !== null && sameBody && row.at !== null && samePoint(row.at, point)) return null;
  return { type: "MoveMegastructure", megastructure: row.id, at };
}

/** Whether `row` stands at its body's point `home`, or is taken to where that is unknown. */
function atOwnBody(row: MegastructureSummary, home: readonly [number, number] | null): boolean {
  return home === null || row.at === null || samePoint(row.at, home);
}

/** The same point as the save writes it, to five decimals. */
function samePoint(a: readonly [number, number], b: readonly [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 5e-6 && Math.abs(a[1] - b[1]) < 5e-6;
}
