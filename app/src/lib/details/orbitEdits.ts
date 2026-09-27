/**
 * Moving a system's bodies, belts and inner radius, whatever the document is.
 *
 * The drag, the fields and the nudge say where a thing should end up as an absolute intent. A
 * source's adapter says what may be edited, what the scene draws while an intent is shown, and the
 * op that makes it so. `geometryAdapterFor` is the one place a source is chosen, and this is the
 * only file that names the geometry ops.
 */
import type { Capabilities } from "../../generated/Capabilities";
import type { Op } from "../../generated/Op";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { SystemDetails } from "../../generated/SystemDetails";
import {
  BELT_SCATTER,
  INNER_MARGIN,
  MIN_INNER_RADIUS,
  MOON_RING_FIRST,
  MOON_RING_STEP,
  OVERLAP_TOLERANCE,
} from "../../generated/constants";
import type { EntityRef } from "../../store/inspectorStore";
import { counted } from "../text";
import {
  polar,
  wrapDegrees,
  type BodyOrbit,
  type BodyPlacement,
  type LayoutOverride,
  type Point,
  type SystemLayout,
} from "./orbits";

export type { BodyOrbit, LayoutOverride } from "./orbits";

/**
 * Where a body, a belt or the inner radius should end up. Radius and angle are about the new
 * parent's point, in `polar`'s degrees; `parent: null` is the system's centre.
 */
export type GeometryIntent =
  | { kind: "move"; system: number; body: number; radius: number; angle: number }
  | {
      kind: "reparent";
      system: number;
      body: number;
      parent: number | null;
      radius: number;
      angle: number;
    }
  | { kind: "addBelt"; system: number; beltKind: string; radius: number }
  | { kind: "setBeltRadius"; system: number; index: number; radius: number }
  | { kind: "setBeltKind"; system: number; index: number; beltKind: string }
  | { kind: "removeBelt"; system: number; index: number }
  | { kind: "innerRadius"; system: number; radius: number };

/** What may be done to one body. */
export interface BodyEditing {
  /** It can be dragged, nudged or typed along and across its orbit. */
  move: boolean;
  /** Another body may be made its moon. */
  host: boolean;
  /** It may be given another parent. */
  reparent: boolean;
  /** For a moon, the parent it gets when dragged away from its planet: null for the centre. */
  detachTo?: number | null;
  /** Why it may not move, host or be given another parent, where one of those is false. */
  reason?: string;
}

/** What may be edited in a system. A body the map leaves out is fixed. */
export interface SceneEditing {
  bodies: ReadonlyMap<number, BodyEditing>;
  belts: boolean;
  innerRadius: boolean;
  /** The least the inner radius may be set to. */
  innerFloor: number;
}

/** What an adapter reads of a system. */
export interface GeometryFrame {
  layout: SystemLayout;
  details: SystemDetails | null;
  planetClasses: ReadonlyMap<string, PlanetClassView>;
}

/** The op an intent makes, or why it is refused; null when it changes nothing. */
export type GeometryOp = { op: Op } | { refused: string } | null;

/** How one source's geometry is edited. */
export interface GeometryAdapter {
  editing(frame: GeometryFrame): SceneEditing;
  /** What the scene draws while `intent` is shown. */
  preview(intent: GeometryIntent, frame: GeometryFrame): LayoutOverride;
  op(intent: GeometryIntent, frame: GeometryFrame): GeometryOp;
}

/** Why a body may not do what is asked of it, as the status bar and the pages say it. */
export const GEOMETRY_REASONS = {
  star: "A star stays where it is",
  starHost: "A star can't have moons",
  hasMoons: "A planet with moons can't become a moon",
  moonHost: "A moon can't have moons of its own",
  asteroidHost: "An asteroid can't have moons",
  noOrbit: "Its planet is missing, so it has no orbit to move along",
  itself: "A body can't orbit itself",
  elsewhere: "That body is not in this system",
  notANumber: "That isn't a number",
  asteroidPast: "One of the belt's asteroids would end up at or past the centre",
} as const;

/** The inner radius may not go below `least`. */
export function innerTooSmall(least: number): string {
  return `The inner radius can't go below ${roundedText(least)}`;
}

/** What the status bar says while something is dragged. */
export const DRAG_HINTS = {
  along: "along its orbit · Shift snaps to 15° · Esc cancels",
  across: "across orbits · Esc cancels",
  toPlanet: "release to make it a planet",
  belt: "belt radius · Esc cancels",
  innerRadius: "inner radius · Esc cancels",
  /** Added to the readout of a body that can move. */
  movable: "drag to move · Shift+arrows nudge",
} as const;

/** What the status bar says while a body is held over `host`, which it would orbit. */
export function toMoonHint(host: string): string {
  return `release to make it a moon of ${host}`;
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

/** How near two values must be to count as the same, a value and a whole number included. */
const SAME = 1e-6;

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

/** The orbit a new moon of `host` takes: the first moon ring, or one step past its outermost moon. */
export function nextMoonRing(layout: SystemLayout, host: number): number {
  const rings = layout.bodies.flatMap((b) => (b.parent === host && b.ring ? [b.ring.radius] : []));
  return rings.length === 0 ? MOON_RING_FIRST : Math.max(...rings) + MOON_RING_STEP;
}

/** How far apart two angles are, in degrees, the short way round. */
function angleGap(a: number, b: number): number {
  const gap = wrapDegrees(a - b);
  return Math.min(gap, 360 - gap);
}

/** Whether two radii about the centre both lie within one belt's scatter. */
function onOneBelt(layout: SystemLayout, a: number, b: number): boolean {
  return layout.belts.some(
    (belt) =>
      Math.abs(a - belt.radius) <= BELT_SCATTER && Math.abs(b - belt.radius) <= BELT_SCATTER,
  );
}

/**
 * The body `body` would stand on top of at `radius` and `angle` about `parent`, or null: one
 * about the same parent within `OVERLAP_TOLERANCE` in both. Two asteroids of one belt do not count.
 */
export function overlapOf(
  layout: SystemLayout,
  body: number,
  parent: number | null,
  radius: number,
  angle: number,
): number | null {
  const other = layout.bodies.find(
    (b) =>
      b.id !== body &&
      b.parent === parent &&
      b.ring !== null &&
      Math.abs(b.ring.radius - radius) <= OVERLAP_TOLERANCE &&
      angleGap(b.angle, angle) <= OVERLAP_TOLERANCE &&
      !(parent === null && onOneBelt(layout, b.ring.radius, radius)),
  );
  return other?.id ?? null;
}

/**
 * The body of `system` that `ref` opens, or null: a planet the layout lists, or a scenario body of
 * this system. The scene rings it, and the nudge moves it.
 */
export function inspectedBody(
  layout: SystemLayout,
  system: number | null,
  ref: EntityRef | null,
): number | null {
  const ours = ref?.kind === "planet" || (ref?.kind === "body" && ref.system === system);
  if (!ours) return null;
  return layout.bodies.some((b) => b.id === ref.id) ? ref.id : null;
}

const ORIGIN: Point = { x: 0, y: 0 };

/** Every body's point once `moved` puts some elsewhere, their moons keeping their offsets. */
function pointsAfter(
  layout: SystemLayout,
  moved: ReadonlyMap<number, BodyOrbit>,
): (id: number) => Point {
  const byId = new Map(layout.bodies.map((b) => [b.id, b]));
  const known = new Map<number, Point>();
  const visiting = new Set<number>();
  function pointOf(id: number): Point {
    const done = known.get(id);
    if (done) return done;
    const body = byId.get(id);
    if (!body) return ORIGIN;
    if (visiting.has(id)) return body;
    visiting.add(id);
    const to = moved.get(id);
    let point: Point;
    if (to) {
      const centre = to.parent === null ? ORIGIN : pointOf(to.parent);
      point = polar(centre.x, centre.y, to.radius, to.angle);
    } else if (body.parent === null) {
      point = { x: body.x, y: body.y };
    } else {
      const was = byId.get(body.parent) ?? ORIGIN;
      const now = pointOf(body.parent);
      point = { x: body.x + now.x - was.x, y: body.y + now.y - was.y };
    }
    visiting.delete(id);
    known.set(id, point);
    return point;
  }
  return pointOf;
}

/**
 * How far out the system's bodies reach, as its inner radius measures them: a body its distance
 * from its parent plus its parent's from the centre.
 */
function reachOf(layout: SystemLayout, moved: ReadonlyMap<number, BodyOrbit>): number {
  const pointOf = pointsAfter(layout, moved);
  let reach = 0;
  for (const body of layout.bodies) {
    if (!body.reaches && !moved.has(body.id)) continue;
    const parent = moved.has(body.id) ? moved.get(body.id)!.parent : body.parent;
    const centre = parent === null ? ORIGIN : pointOf(parent);
    const point = pointOf(body.id);
    const out = Math.hypot(centre.x, centre.y) + Math.hypot(point.x - centre.x, point.y - centre.y);
    reach = Math.max(reach, out);
  }
  return reach;
}

const NOTHING_MOVED: ReadonlyMap<number, BodyOrbit> = new Map();

/**
 * The inner radius once `override` is applied: the one it names, or the system's grown to reach
 * past the moved bodies when they reach further than the system did. It never shrinks on its own.
 */
export function grownInner(layout: SystemLayout, override: LayoutOverride): number {
  const current = override.innerRadius ?? layout.innerRadius;
  const moved = override.bodies;
  if (!moved || moved.size === 0) return current;
  const before = reachOf(layout, NOTHING_MOVED);
  const after = reachOf(layout, moved);
  const grows = after > before && after + INNER_MARGIN > current;
  return grows ? Math.max(MIN_INNER_RADIUS, after + INNER_MARGIN) : current;
}

/** The least the inner radius may be set to: the system's reach, or its own value when that is lower. */
function innerFloorOf(layout: SystemLayout): number {
  const least = Math.max(MIN_INNER_RADIUS, reachOf(layout, NOTHING_MOVED));
  return Math.min(layout.innerRadius, least);
}

function roundedText(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const NOTHING_EDITABLE: SceneEditing = {
  bodies: new Map(),
  belts: false,
  innerRadius: false,
  innerFloor: MIN_INNER_RADIUS,
};

/** Nothing about the system's geometry may be edited. */
export const NO_GEOMETRY: GeometryAdapter = {
  editing: () => NOTHING_EDITABLE,
  preview: () => ({}),
  op: () => null,
};

/** Whether the install's classes make `planetClass` an asteroid. */
function isAsteroid(planetClass: string | undefined, classes: GeometryFrame["planetClasses"]) {
  return planetClass !== undefined && classes.get(planetClass)?.asteroid === true;
}

function saveBodyEditing(
  body: BodyPlacement,
  frame: GeometryFrame,
  byId: ReadonlyMap<number, BodyPlacement>,
  classOf: ReadonlyMap<number, string>,
  parents: ReadonlySet<number>,
): BodyEditing {
  if (body.star) {
    return { move: false, host: false, reparent: false, reason: GEOMETRY_REASONS.star };
  }
  const asteroid = isAsteroid(classOf.get(body.id), frame.planetClasses);
  const hasMoons = parents.has(body.id);
  const editing: BodyEditing = {
    move: body.ring !== null,
    host: !body.moon && !asteroid,
    reparent: !hasMoons,
  };
  if (body.moon)
    editing.detachTo = body.parent === null ? null : (byId.get(body.parent)?.parent ?? null);
  const reason = hostRefusal(body, asteroid) ?? (hasMoons ? GEOMETRY_REASONS.hasMoons : undefined);
  if (reason !== undefined) editing.reason = reason;
  return editing;
}

/** Why `body` cannot have moons, or undefined when it can. */
function hostRefusal(body: BodyPlacement, asteroid: boolean): string | undefined {
  if (body.star) return GEOMETRY_REASONS.starHost;
  if (body.moon) return GEOMETRY_REASONS.moonHost;
  if (asteroid) return GEOMETRY_REASONS.asteroidHost;
  return undefined;
}

function saveEditing(frame: GeometryFrame): SceneEditing {
  const { layout, details } = frame;
  if (details === null) return NOTHING_EDITABLE;
  const byId = new Map(layout.bodies.map((b) => [b.id, b]));
  const classOf = new Map(details.planets.map((p) => [p.id, p.class]));
  const parents = new Set(layout.bodies.flatMap((b) => (b.parent === null ? [] : [b.parent])));
  const bodies = new Map(
    layout.bodies.map((b) => [b.id, saveBodyEditing(b, frame, byId, classOf, parents)]),
  );
  return {
    bodies,
    belts: true,
    innerRadius: details.inner_radius !== null,
    innerFloor: innerFloorOf(layout),
  };
}

/** The asteroids about the centre within a belt's scatter of `radius`. */
function beltAsteroids(frame: GeometryFrame, radius: number): BodyPlacement[] {
  const classOf = new Map((frame.details?.planets ?? []).map((p) => [p.id, p.class]));
  return frame.layout.bodies.filter(
    (b) =>
      b.parent === null &&
      b.ring !== null &&
      Math.abs(b.ring.radius - radius) <= BELT_SCATTER &&
      isAsteroid(classOf.get(b.id), frame.planetClasses),
  );
}

type Belt = { kind: string; radius: number };

function shownBelts(layout: SystemLayout): Belt[] {
  return layout.belts.map(({ kind, radius }) => ({ kind, radius }));
}

/** The belt asteroids a belt moved from `from` to `to` carries with it, by the same step. */
function carriedAsteroids(frame: GeometryFrame, from: number, to: number): Map<number, BodyOrbit> {
  return new Map(
    beltAsteroids(frame, from).map((b) => [
      b.id,
      { parent: null, radius: b.ring!.radius + to - from, angle: b.angle },
    ]),
  );
}

/** `bodies` put elsewhere, with the inner radius they grow. */
function movedBodies(layout: SystemLayout, bodies: Map<number, BodyOrbit>): LayoutOverride {
  const grown = grownInner(layout, { bodies });
  return grown === layout.innerRadius ? { bodies } : { bodies, innerRadius: grown };
}

function savePreview(intent: GeometryIntent, frame: GeometryFrame): LayoutOverride {
  const { layout } = frame;
  const belts = shownBelts(layout);
  switch (intent.kind) {
    case "move": {
      const body = layout.bodies.find((b) => b.id === intent.body);
      if (!body) return {};
      const to = { parent: body.parent, radius: intent.radius, angle: intent.angle };
      return movedBodies(layout, new Map([[intent.body, to]]));
    }
    case "reparent": {
      const { parent, radius, angle } = intent;
      return movedBodies(layout, new Map([[intent.body, { parent, radius, angle }]]));
    }
    case "addBelt":
      return { belts: [...belts, { kind: intent.beltKind, radius: intent.radius }] };
    case "setBeltRadius": {
      const belt = belts[intent.index];
      if (!belt) return {};
      belts[intent.index] = { ...belt, radius: intent.radius };
      const carried = carriedAsteroids(frame, belt.radius, intent.radius);
      return carried.size === 0 ? { belts } : { belts, ...movedBodies(layout, carried) };
    }
    case "setBeltKind": {
      const belt = belts[intent.index];
      if (!belt) return {};
      belts[intent.index] = { ...belt, kind: intent.beltKind };
      return { belts };
    }
    case "removeBelt":
      return { belts: belts.filter((_, i) => i !== intent.index) };
    case "innerRadius":
      return { innerRadius: intent.radius };
  }
}

function same(a: number, b: number): boolean {
  return Math.abs(a - b) < SAME;
}

function moveOp(system: number, body: BodyPlacement, radius: number, angle: number): GeometryOp {
  if (!body.ring) return { refused: GEOMETRY_REASONS.noOrbit };
  if (same(body.ring.radius, radius) && angleGap(body.angle, angle) < SAME) return null;
  return { op: { type: "MoveSaveBody", system, body: body.id, radius, angle: wrapDegrees(angle) } };
}

/** Whether `id` is `body` or orbits it, however far down. */
function under(layout: SystemLayout, id: number, body: number): boolean {
  const byId = new Map(layout.bodies.map((b) => [b.id, b]));
  const seen = new Set<number>();
  for (
    let at: number | null = id;
    at !== null && !seen.has(at);
    at = byId.get(at)?.parent ?? null
  ) {
    if (at === body) return true;
    seen.add(at);
  }
  return false;
}

function reparentOp(
  intent: Extract<GeometryIntent, { kind: "reparent" }>,
  frame: GeometryFrame,
): GeometryOp {
  const { system, parent, radius, angle } = intent;
  const { layout } = frame;
  const body = layout.bodies.find((b) => b.id === intent.body);
  if (!body) return { refused: GEOMETRY_REASONS.elsewhere };
  if (body.star) return { refused: GEOMETRY_REASONS.star };
  // A moon whose planet is missing is drawn about the centre, but its parent is still that planet.
  const orphan = body.moon && body.parent === null;
  if (!orphan && parent === body.parent) return moveOp(system, body, radius, angle);
  const editing = saveEditing(frame).bodies;
  const own = editing.get(body.id);
  if (!own?.reparent) return { refused: GEOMETRY_REASONS.hasMoons };
  if (parent !== null) {
    if (under(layout, parent, body.id)) return { refused: GEOMETRY_REASONS.itself };
    const host = layout.bodies.find((b) => b.id === parent);
    if (!host) return { refused: GEOMETRY_REASONS.elsewhere };
    if (!editing.get(parent)?.host && parent !== own.detachTo) {
      const asteroid = isAsteroid(classOfBody(frame, parent), frame.planetClasses);
      return { refused: hostRefusal(host, asteroid) ?? GEOMETRY_REASONS.starHost };
    }
  }
  return {
    op: {
      type: "SetSaveBodyParent",
      system,
      body: body.id,
      parent,
      radius,
      angle: wrapDegrees(angle),
    },
  };
}

function beltRadiusOp(
  intent: Extract<GeometryIntent, { kind: "setBeltRadius" }>,
  frame: GeometryFrame,
): GeometryOp {
  const { system, index, radius } = intent;
  const belt = frame.layout.belts[index];
  if (!belt || same(belt.radius, radius)) return null;
  const op: Op = { type: "SetSaveBeltRadius", system, index, radius };
  const carried = [...carriedAsteroids(frame, belt.radius, radius)];
  if (carried.some(([, to]) => !(to.radius > 0))) return { refused: GEOMETRY_REASONS.asteroidPast };
  if (carried.length === 0) return { op };
  const moves: Op[] = carried.map(([body, to]) => ({
    type: "MoveSaveBody",
    system,
    body,
    radius: to.radius,
    angle: to.angle,
  }));
  const description =
    `Moved the belt at radius ${roundedText(belt.radius)} in system #${system} to ` +
    `${roundedText(radius)}, with ${counted(moves.length, "asteroid")}`;
  return { op: { type: "Batch", description, ops: [op, ...moves] } };
}

/** The class of body `id`, as the details give it. */
function classOfBody(frame: GeometryFrame, id: number): string | undefined {
  return frame.details?.planets.find((p) => p.id === id)?.class;
}

/** Whether every radius and angle `intent` names is a number. */
function finite(intent: GeometryIntent): boolean {
  const values = ["radius" in intent ? intent.radius : 0, "angle" in intent ? intent.angle : 0];
  return values.every(Number.isFinite);
}

function saveOp(intent: GeometryIntent, frame: GeometryFrame): GeometryOp {
  if (!finite(intent)) return { refused: GEOMETRY_REASONS.notANumber };
  const { layout } = frame;
  switch (intent.kind) {
    case "move": {
      const body = layout.bodies.find((b) => b.id === intent.body);
      if (!body) return { refused: GEOMETRY_REASONS.elsewhere };
      if (body.star) return { refused: GEOMETRY_REASONS.star };
      return moveOp(intent.system, body, intent.radius, intent.angle);
    }
    case "reparent":
      return reparentOp(intent, frame);
    case "addBelt":
      return {
        op: {
          type: "AddSaveBelt",
          system: intent.system,
          kind: intent.beltKind,
          radius: intent.radius,
        },
      };
    case "setBeltRadius":
      return beltRadiusOp(intent, frame);
    case "setBeltKind": {
      const belt = layout.belts[intent.index];
      if (!belt || belt.kind === intent.beltKind) return null;
      const { system, index, beltKind: kind } = intent;
      return { op: { type: "SetSaveBeltKind", system, index, kind } };
    }
    case "removeBelt": {
      if (!layout.belts[intent.index]) return null;
      return { op: { type: "RemoveSaveBelt", system: intent.system, index: intent.index } };
    }
    case "innerRadius": {
      if (same(layout.innerRadius, intent.radius)) return null;
      const least = innerFloorOf(layout);
      if (intent.radius < least) return { refused: innerTooSmall(least) };
      return { op: { type: "SetSaveInnerRadius", system: intent.system, radius: intent.radius } };
    }
  }
}

/** A save's geometry: its bodies, belts and inner radius, edited by the save's own ops. */
export const SAVE_GEOMETRY: GeometryAdapter = {
  editing: saveEditing,
  preview: savePreview,
  op: saveOp,
};

/**
 * The adapter that edits system `system`'s geometry in a document that supports `capabilities`:
 * the one place a source is chosen. With no system there is nothing to edit.
 */
export function geometryAdapterFor(
  capabilities: Capabilities,
  system: number | null,
): GeometryAdapter {
  return capabilities.geometry && system !== null ? SAVE_GEOMETRY : NO_GEOMETRY;
}
