/**
 * Moving a system's bodies, belts, inner radius and wormholes, whatever the document is: what the
 * drag, the fields and the nudge ask for, what an adapter answers, and the words for both.
 *
 * The drag, the fields and the nudge say where a thing should end up as an absolute intent. A
 * source's adapter (`saveGeometry.ts`) says what may be edited, what the scene draws while an
 * intent is shown, and the op that makes it so.
 */
import type { Bounds } from "../../generated/Bounds";
import type { Op } from "../../generated/Op";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemRadii } from "../../generated/SystemRadii";
import type { WormholeSummary } from "../../generated/WormholeSummary";
import type { EntityRef } from "../../store/inspectorStore";
import {
  polarAbout,
  rounded,
  SAME,
  wrapDegrees,
  type BodyOrbit,
  type LayoutOverride,
  type SystemLayout,
} from "./orbits";

export type { BodyOrbit, LayoutOverride } from "./orbits";

/** A radius or an angle as typed: one value, or a range for a source that leaves it to a draw. */
export type Span = number | Bounds;

/**
 * Where a body, a belt, the inner radius or a wormhole should end up. Radius and angle are about
 * the new parent's point, in `polar`'s degrees; `parent: null` is the system's centre, which a
 * wormhole is always placed about.
 */
export type GeometryIntent =
  | { kind: "move"; system: number; body: number; radius: Span; angle: Span }
  | {
      kind: "reparent";
      system: number;
      body: number;
      parent: number | null;
      radius: Span;
      angle: Span;
    }
  | { kind: "addBelt"; system: number; beltKind: string; radius: number }
  | { kind: "setBeltRadius"; system: number; index: number; radius: number }
  | { kind: "setBeltKind"; system: number; index: number; beltKind: string }
  | { kind: "removeBelt"; system: number; index: number }
  | { kind: "innerRadius"; system: number; radius: number }
  | { kind: "moveWormhole"; system: number; wormhole: number; radius: number; angle: number };

/** Why a body may not move, host or be given another parent; `GEOMETRY_REASONS` has the words. */
export type BodyRefusal =
  | "star"
  | "orbitsCentre"
  | "starMoon"
  | "hasMoons"
  | "moonHost"
  | "asteroidHost"
  | "ringworld"
  | "noOrbit";

/** What may be done to one body. */
export interface BodyEditing {
  /** It can be dragged, nudged or typed along and across its orbit. */
  move: boolean;
  /** Another body may be made its moon, or for a star off the centre, its planet. */
  host: boolean;
  /** It may be given another parent: a star at least. */
  reparent: boolean;
  /** It may become a moon of a planet: it has no moons of its own. */
  asMoon: boolean;
  /**
   * For a moon, or a planet of a star off the centre, the parent it gets when dragged away from
   * what it orbits: null for the centre.
   */
  detachTo?: number | null;
  /**
   * It has no orbit to move along, as a moon whose planet is missing: a drag or its Orbits field
   * makes it a planet of the star where it ends up.
   */
  detachOnly?: boolean;
  /** For a body that may host, the orbit a new moon of it takes, or a new planet of a star. */
  moonRing?: number;
  /** Why it may not move, host or be given another parent, where one of those is false. */
  refusal?: BodyRefusal;
  /** Why no body may be dropped on it to orbit it, where `host` is false. */
  hostRefusal?: BodyRefusal;
  /** What the drag's readout adds about the body, as its source sees it. */
  note?: string;
}

/** What may be edited in a system. A body the map leaves out is fixed. */
export interface SceneEditing {
  bodies: ReadonlyMap<number, BodyEditing>;
  belts: boolean;
  innerRadius: boolean;
  /** The least the inner radius may be set to. */
  innerFloor: number;
  /** The wormholes that may be dragged, by id. */
  wormholes: ReadonlySet<number>;
}

/** What an adapter reads of a system. */
export interface GeometryFrame {
  layout: SystemLayout;
  details: SystemDetails | null;
  planetClasses: ReadonlyMap<string, PlanetClassView>;
  /** How the install sizes a system; `VANILLA_SYSTEM_RADII` before game data gives them. */
  radii: SystemRadii;
  /** What an edit's description calls the system, as `systemLabel` says; set when the edit is sent. */
  systemLabel?: string;
}

/** The op an intent makes, or why it is refused; null when it changes nothing. */
export type GeometryOp = { op: Op } | { refused: string } | null;

/** How one source's geometry is edited. */
export interface GeometryAdapter {
  /** Whether a typed radius or angle may be a range. */
  ranges: boolean;
  editing(frame: GeometryFrame): SceneEditing;
  /** What the scene draws while `intent` is shown. */
  preview(intent: GeometryIntent, frame: GeometryFrame): LayoutOverride;
  op(intent: GeometryIntent, frame: GeometryFrame): GeometryOp;
}

/** Why a body may not do what is asked of it, as the status bar and the pages say it. */
export const GEOMETRY_REASONS = {
  star: "The star at the system's centre stays where it is",
  orbitsCentre: "It already orbits the star at the system's centre",
  starMoon: "A star can't become a moon",
  hasMoons: "A planet with moons can't become a moon",
  moonHost: "A moon can't have moons of its own",
  asteroidHost: "An asteroid can't have moons",
  ringworld: "A ring world segment stays where it is",
  noOrbit: "Its planet is missing, so it has no orbit to move along",
  itself: "A body can't orbit itself",
  elsewhere: "That body is not in this system",
  notANumber: "That isn't a number",
  range: "A save's orbit takes one value, not a range",
  asteroidPast: "One of the belt's asteroids would end up at or past the centre",
  lockedWormhole: "Only a natural wormhole can be moved",
  wormholeElsewhere: "That wormhole is not in this system",
  wormholeAtCentre: "A wormhole can't stand at the system's centre",
} as const;

/** The inner radius may not go below `least`. */
export function innerTooSmall(least: number): string {
  return `The inner radius can't go below ${rounded(least)}`;
}

/** What the status bar says while something is dragged. */
export const DRAG_HINTS = {
  free: "drag to move · Ctrl holds the orbit or the angle · Shift snaps to 15° · Esc cancels",
  along: "along its orbit · Shift snaps to 15° · Esc cancels",
  across: "across orbits · Esc cancels",
  toPlanet: "release to make it a planet",
  belt: "belt radius · Esc cancels",
  innerRadius: "inner radius · Esc cancels",
  wormhole: "drag to move · Shift snaps to 15° · Esc cancels",
  /** Added to the readout of a body that can move. */
  movable: "drag to move · Shift+arrows nudge",
  /** Under the name of a wormhole that can move. */
  movableWormhole: "drag to move",
} as const;

/** Whether a `natural_wormholes` entry is a natural wormhole, the only kind that may be moved. */
export function isNaturalWormhole(wormhole: WormholeSummary): boolean {
  return wormhole.kind === "wormhole";
}

/** Where `wormhole` stands about the star, as its page's Distance and Angle fields show it. */
export function wormholePlace(wormhole: WormholeSummary): { radius: number; angle: number } {
  return polarAbout(wormhole, { x: 0, y: 0 });
}

/** The move typing `typed` into a wormhole's Distance or Angle field asks for. */
export function wormholeFieldIntent(
  system: number,
  wormhole: WormholeSummary,
  field: "radius" | "angle",
  typed: number,
): GeometryIntent {
  const place = wormholePlace(wormhole);
  const to =
    field === "angle" ? { ...place, angle: wrapDegrees(typed) } : { ...place, radius: typed };
  return { kind: "moveWormhole", system, wormhole: wormhole.id, ...to };
}

/** What the status bar says while a body is held over `host`, which it would orbit. */
export function toMoonHint(host: string): string {
  return `release to make it a moon of ${host}`;
}

/** What the status bar says while a body is held over `star`, which it would orbit as a planet. */
export function toStarHint(star: string): string {
  return `release to make it orbit ${star}`;
}

/** What a lock keeps a body on: `parent`'s name, or the star for the centre (null) or a body with none. */
export function lockedToName(
  parent: number | null,
  nameOf: (id: number) => string | undefined,
): string {
  return (parent === null ? undefined : nameOf(parent)) || "the star";
}

export function lockedHint(parent: string): string {
  return `locked to ${parent}`;
}

/** The belt kind a new belt gets: the system's first belt's, else rocky. */
export function defaultBeltKind(details: SystemDetails | null): string {
  return details?.belts[0]?.kind ?? "rocky_asteroid_belt";
}

/** Where body `id` stands about what it orbits; null for one with no orbit to move along. */
export function bodyOrbit(layout: SystemLayout, id: number): BodyOrbit | null {
  const body = layout.bodies.find((b) => b.id === id);
  if (!body?.ring) return null;
  return { parent: body.parent, radius: body.ring.radius, angle: body.angle };
}

/**
 * The body of `system` that `ref` opens, or null: a body of this system the layout lists. The scene
 * rings it, and the nudge moves it.
 */
export function inspectedBody(
  layout: SystemLayout,
  system: number | null,
  ref: EntityRef | null,
): number | null {
  if (ref?.kind !== "body" || ref.system !== system) return null;
  return layout.bodies.some((b) => b.id === ref.id) ? ref.id : null;
}

/** `value` moved `by` whole steps, landing on a whole number: 45.3 up one is 46, down one 45. */
function stepWhole(value: number, by: number): number {
  if (by === 0) return value;
  const near = Math.round(value);
  const start = Math.abs(value - near) < SAME ? near : value;
  return by > 0 ? Math.floor(start) + by : Math.ceil(start) + by;
}

/**
 * `orbit` turned `turn` degrees and stepped `out` units, each landing on a whole number; the
 * radius stops at 1 and a value not asked to change stays exact.
 */
export function nudged(orbit: BodyOrbit, { turn, out }: { turn: number; out: number }): BodyOrbit {
  return {
    parent: orbit.parent,
    radius: out === 0 ? orbit.radius : Math.max(1, stepWhole(orbit.radius, out)),
    angle: turn === 0 ? orbit.angle : wrapDegrees(stepWhole(orbit.angle, turn)),
  };
}

/**
 * `orbit` with the value typed into one of its fields, the other kept exact; null for a radius
 * not above 0 or a number that is not one.
 */
export function fieldIntent(
  orbit: BodyOrbit,
  field: "radius" | "angle",
  typed: number,
): BodyOrbit | null {
  if (!Number.isFinite(typed)) return null;
  if (field === "angle") return { ...orbit, angle: wrapDegrees(typed) };
  return typed > 0 ? { ...orbit, radius: typed } : null;
}
