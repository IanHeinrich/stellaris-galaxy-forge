/**
 * How a save's megastructure moves in the system view: to a point of its own, onto another body
 * of its system, or not at all, and why a body will not take it. The core refuses the rest.
 */
import type { MegastructurePlace } from "../../generated/MegastructurePlace";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import type { MegastructureView } from "../../generated/MegastructureView";
import type { Op } from "../../generated/Op";

/** The bypass kinds a moved row may stand for; another has not been tried in game. */
const MOVED_BYPASSES: ReadonlySet<string> = new Set(["gateway", "relay_bypass"]);

/** How one row moves. */
export type MegastructureMove =
  /** Dragged to any point, where the game keeps it. */
  | { readonly place: "free" }
  /** Dragged onto another body of the system; `starOnly` for a type built only around a star. */
  | { readonly place: "body"; readonly on: number; readonly starOnly: boolean }
  /** It stays where it is, for the reason given. */
  | { readonly place: "fixed"; readonly why: string };

/** Why a row stays where it is, as the tooltip and the status bar say it. */
export const MEGASTRUCTURE_FIXED = {
  ringWorld: "A ring world section stays where it is",
  bypass: "The L-Gate stays where the game put it",
  starbase: "It stands with a starbase, which stays where it is",
  whole: "It is part of a larger structure, which stays where it is",
  centre: "It stands at the system's centre without naming a body, so it stays where it is",
} as const;

/** Why a body will not take a dragged row. */
export const MEGASTRUCTURE_REFUSALS = {
  elsewhere: "That body is not in this system",
  starOnly: (name: string) => `${name} stands only around a star`,
  taken: (body: string) => `${body} already has a megastructure`,
} as const;

/** How row `row` of `type` moves. */
export function megastructureMove(
  row: MegastructureSummary,
  type: MegastructureView | undefined,
): MegastructureMove {
  if (row.kind.startsWith("ring_world")) return fixed("ringWorld");
  const bypass = type?.bypass_type ?? (row.kind.startsWith("lgate") ? "lgate" : null);
  if (bypass !== null && !MOVED_BYPASSES.has(bypass)) return fixed("bypass");
  const placement = type?.placement;
  if (placement?.place === "unsupported") {
    if (placement.why.kind === "becomes_starbase") return fixed("starbase");
    if (placement.why.kind === "whole_structure") return fixed("whole");
  }
  if (row.planet !== null) {
    const starOnly = placement?.place === "body" && placement.star_only;
    return { place: "body", on: row.planet, starOnly };
  }
  if (placement?.place === "body") return fixed("centre");
  return { place: "free" };
}

function fixed(why: keyof typeof MEGASTRUCTURE_FIXED): MegastructureMove {
  return { place: "fixed", why: MEGASTRUCTURE_FIXED[why] };
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
  if (rows.some((row) => row.id !== id && row.planet === body.id)) {
    return MEGASTRUCTURE_REFUSALS.taken(body.name);
  }
  if (move.starOnly && !body.star) return MEGASTRUCTURE_REFUSALS.starOnly(name);
  return null;
}

/** The op that moves row `id` to `at`, or null where it stands there already. */
export function moveMegastructureOp(row: MegastructureSummary, at: MegastructurePlace): Op | null {
  if (at.place === "body" && row.planet === at.body) return null;
  if (at.place === "free" && row.at !== null && samePoint(row.at, [at.x, at.y])) return null;
  return { type: "MoveMegastructure", megastructure: row.id, at };
}

/** The same point as the save writes it, to five decimals. */
function samePoint(a: readonly [number, number], b: readonly [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 5e-6 && Math.abs(a[1] - b[1]) < 5e-6;
}
