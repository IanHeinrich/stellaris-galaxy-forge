/**
 * Moving a system's bodies, belts, inner radius and wormholes, whatever the document is.
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
import type { SystemRadii } from "../../generated/SystemRadii";
import type { WormholeSummary } from "../../generated/WormholeSummary";
import {
  BELT_SCATTER,
  MOON_RING_FIRST,
  MOON_RING_STEP,
  OVERLAP_TOLERANCE,
  STORED_ORBIT_SLACK,
  VANILLA_SYSTEM_RADII,
} from "../../generated/constants";
import type { EntityRef } from "../../store/inspectorStore";
import { counted } from "../text";
import {
  polar,
  saveAngle,
  wrapDegrees,
  type BodyOrbit,
  type BodyPlacement,
  type LayoutOverride,
  type Point,
  type SystemLayout,
} from "./orbits";

export type { BodyOrbit, LayoutOverride } from "./orbits";

/**
 * Where a body, a belt, the inner radius or a wormhole should end up. Radius and angle are about
 * the new parent's point, in `polar`'s degrees; `parent: null` is the system's centre, which a
 * wormhole is always placed about.
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
  | { kind: "innerRadius"; system: number; radius: number }
  | { kind: "moveWormhole"; system: number; wormhole: number; radius: number; angle: number };

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
  reason?: string;
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
  asteroidPast: "One of the belt's asteroids would end up at or past the centre",
  lockedWormhole: "Only a natural wormhole can be moved",
  wormholeElsewhere: "That wormhole is not in this system",
  wormholeAtCentre: "A wormhole can't stand at the system's centre",
} as const;

/** The inner radius may not go below `least`. */
export function innerTooSmall(least: number): string {
  return `The inner radius can't go below ${roundedText(least)}`;
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
  const { x, y } = wormhole;
  return { radius: Math.hypot(x, y), angle: saveAngle(0, 0, x, y) };
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

/**
 * The orbit the save stores for `body`, or its drawn radius when it stores none. The drawn radius
 * can sit a hair off what the game wrote, so an edit that steps from it starts from the stored one.
 */
function storedRadius(frame: Pick<GeometryFrame, "details">, body: BodyPlacement): number {
  const stored = frame.details?.planets.find((p) => p.id === body.id)?.orbit ?? null;
  return stored !== null && stored > 0 ? stored : (body.ring?.radius ?? 0);
}

/** The orbit a new moon of `host` takes: the first moon ring, or one step past its outermost moon. */
export function nextMoonRing(
  frame: Pick<GeometryFrame, "layout" | "details">,
  host: number,
): number {
  const moons = frame.layout.bodies.filter((b) => b.parent === host && b.ring);
  if (moons.length === 0) return MOON_RING_FIRST;
  return Math.max(...moons.map((b) => storedRadius(frame, b))) + MOON_RING_STEP;
}

/** The orbit a new planet of a star off the centre takes when none orbits it yet. */
const STAR_RING_FIRST = 30;

/** How much further out than a star's outermost planet a new one of it goes. */
const STAR_RING_STEP = 25;

/** The orbit a new planet of `star` takes: the first star ring, or one step past its outermost planet. */
function nextStarRing(frame: Pick<GeometryFrame, "layout" | "details">, star: number): number {
  const planets = frame.layout.bodies.filter((b) => b.parent === star && b.ring);
  if (planets.length === 0) return STAR_RING_FIRST;
  return Math.max(...planets.map((b) => storedRadius(frame, b))) + STAR_RING_STEP;
}

/** Whether `body` is the star at the system's centre: a body that orbits it orbits the centre. */
export function isCentreStar(body: BodyPlacement): boolean {
  return body.star && atCentre(body);
}

/**
 * What `body` orbits, as an edit names it: its parent, or null for the centre, which a body whose
 * save names the star at the centre as its parent orbits too.
 */
export function orbitParent(layout: SystemLayout, body: BodyPlacement): number | null {
  return asOrbitParent(layout, body.parent);
}

/** `parent` as an edit names it: null for the star at the centre. */
function asOrbitParent(layout: SystemLayout, parent: number | null): number | null {
  if (parent === null) return null;
  const body = layout.bodies.find((b) => b.id === parent);
  return body && isCentreStar(body) ? null : parent;
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

/** What the reach of a system is measured from. */
type ReachFrame = Pick<GeometryFrame, "layout" | "details" | "radii">;

type Belt = { kind: string; radius: number };

/**
 * The bodies the core counts towards the system's reach: the primary, the first body listed, and
 * any whose stored orbit is above 0. An event-placed body at orbit 0 far out does not count.
 */
function reachingBodies(details: SystemDetails | null): ReadonlySet<number> {
  const planets = details?.planets ?? [];
  const counted = planets.filter((p, i) => i === 0 || p.orbit === null || p.orbit > 0);
  return new Set(counted.map((p) => p.id));
}

/**
 * How far out the system's bodies and `belts` reach, as the core's inner radius measures them: a
 * body's drawn radius plus its parent's distance from the centre, a belt its radius. A moved body
 * and its moons always count.
 */
function reachOf(
  { layout, details }: ReachFrame,
  moved: ReadonlyMap<number, BodyOrbit>,
  belts: readonly Belt[],
): number {
  const pointOf = pointsAfter(layout, moved);
  const reaching = reachingBodies(details);
  let reach = 0;
  for (const body of layout.bodies) {
    if (!reaching.has(body.id) && !carried(layout, moved, body.id)) continue;
    reach = Math.max(reach, bodyReach(pointOf, moved, body));
  }
  for (const belt of belts) reach = Math.max(reach, belt.radius);
  return reach;
}

/**
 * How far out the moved bodies, their moons and `belts` new or moved from the layout's reach, as
 * the core measures what its op puts in place.
 */
function ownReach(
  { layout }: ReachFrame,
  moved: ReadonlyMap<number, BodyOrbit>,
  belts: readonly Belt[],
): number {
  const pointOf = pointsAfter(layout, moved);
  let reach = 0;
  for (const body of layout.bodies) {
    if (carried(layout, moved, body.id)) reach = Math.max(reach, bodyReach(pointOf, moved, body));
  }
  belts.forEach((belt, i) => {
    if (layout.belts[i]?.radius !== belt.radius) reach = Math.max(reach, belt.radius);
  });
  return reach;
}

/** Whether `id` is one of the `moved` bodies or orbits one. */
function carried(layout: SystemLayout, moved: ReadonlyMap<number, BodyOrbit>, id: number): boolean {
  return [...moved.keys()].some((body) => under(layout, id, body));
}

/** How far from the centre `body` reaches once `moved` is applied: its radius plus its parent's distance. */
function bodyReach(
  pointOf: (id: number) => Point,
  moved: ReadonlyMap<number, BodyOrbit>,
  body: BodyPlacement,
): number {
  const to = moved.get(body.id);
  const parent = to ? to.parent : body.parent;
  const radius = to ? to.radius : body.ring?.radius;
  if (radius === undefined) return Math.hypot(pointOf(body.id).x, pointOf(body.id).y);
  const centre = parent === null ? ORIGIN : pointOf(parent);
  return Math.hypot(centre.x, centre.y) + radius;
}

const NOTHING_MOVED: ReadonlyMap<number, BodyOrbit> = new Map();

/**
 * The inner radius once `override` is applied: the one it names, or the system's grown to reach
 * past the moved bodies and belts when they lie outside it or reach further than the system did.
 * It never shrinks on its own.
 */
export function grownInner(frame: ReachFrame, override: LayoutOverride): number {
  const current = override.innerRadius ?? frame.layout.innerRadius;
  const moved = override.bodies ?? NOTHING_MOVED;
  if (moved.size === 0 && override.belts === undefined) return current;
  const belts = override.belts ?? frame.layout.belts;
  const before = reachOf(frame, NOTHING_MOVED, frame.layout.belts);
  const after = reachOf(frame, moved, belts);
  const own = ownReach(frame, moved, belts);
  const { min_inner, inner_offset } = frame.radii;
  const further = after > before + STORED_ORBIT_SLACK && after + inner_offset > current;
  return further || own > current ? Math.max(min_inner, own + inner_offset) : current;
}

/**
 * The least the inner radius may be set to: how far the system's bodies and belts reach, or its own
 * value when that is lower.
 */
function innerFloorOf(frame: ReachFrame): number {
  const reach = reachOf(frame, NOTHING_MOVED, frame.layout.belts);
  return Math.min(frame.layout.innerRadius, Math.max(frame.radii.min_inner, reach));
}

function roundedText(value: number): string {
  return String(Math.round(value * 100) / 100);
}

const NOTHING_EDITABLE: SceneEditing = {
  bodies: new Map(),
  belts: false,
  innerRadius: false,
  innerFloor: VANILLA_SYSTEM_RADII.min_inner,
  wormholes: new Set(),
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

/** Whether the install's classes make `planetClass` a ring world segment. */
function isRingSegment(planetClass: string | undefined, classes: GeometryFrame["planetClasses"]) {
  return planetClass !== undefined && classes.get(planetClass)?.ringworld === true;
}

const FIXED_RING_SEGMENT: BodyEditing = {
  move: false,
  host: false,
  reparent: false,
  asMoon: false,
  reason: GEOMETRY_REASONS.ringworld,
};

function saveBodyEditing(
  body: BodyPlacement,
  frame: GeometryFrame,
  byId: ReadonlyMap<number, BodyPlacement>,
  classOf: ReadonlyMap<number, string>,
  parents: ReadonlySet<number>,
): BodyEditing {
  if (isCentreStar(body)) {
    const reason = GEOMETRY_REASONS.star;
    return { move: false, host: false, reparent: false, asMoon: false, reason };
  }
  if (body.star) {
    const moonRing = nextStarRing(frame, body.id);
    const reason = GEOMETRY_REASONS.starMoon;
    return { move: true, host: true, reparent: false, asMoon: false, moonRing, reason };
  }
  if (isRingSegment(classOf.get(body.id), frame.planetClasses)) return { ...FIXED_RING_SEGMENT };
  const asteroid = isAsteroid(classOf.get(body.id), frame.planetClasses);
  const hasMoons = parents.has(body.id);
  const editing: BodyEditing = {
    move: body.ring !== null,
    host: !body.moon && !asteroid,
    reparent: true,
    asMoon: !hasMoons,
  };
  if (editing.host) editing.moonRing = nextMoonRing(frame, body.id);
  const parent = orbitParent(frame.layout, body);
  if (parent !== null) {
    const above = byId.get(parent);
    editing.detachTo = above ? orbitParent(frame.layout, above) : null;
  } else if (body.moon) editing.detachTo = null;
  if (isOrphan(body)) {
    editing.detachOnly = true;
    editing.reason = GEOMETRY_REASONS.noOrbit;
    return editing;
  }
  const reason = hostRefusal(body, asteroid) ?? (hasMoons ? GEOMETRY_REASONS.hasMoons : undefined);
  if (reason !== undefined) editing.reason = reason;
  return editing;
}

/** Whether `body` stands where it orbits, as a star at the system's centre does, with no orbit to move along. */
function atCentre(body: BodyPlacement): boolean {
  return body.ring === null || body.ring.radius <= STORED_ORBIT_SLACK;
}

/** A moon whose planet is missing, drawn about the centre though its parent is still that planet. */
function isOrphan(body: BodyPlacement): boolean {
  return body.moon && body.parent === null;
}

/** Why `body` cannot have moons, or undefined when it can. */
function hostRefusal(body: BodyPlacement, asteroid: boolean): string | undefined {
  if (body.star) return undefined;
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
    innerFloor: innerFloorOf(frame),
    wormholes: new Set(details.wormholes.filter(isNaturalWormhole).map((w) => w.id)),
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

function shownBelts(layout: SystemLayout): Belt[] {
  return layout.belts.map(({ kind, radius }) => ({ kind, radius }));
}

/** The belt asteroids a belt moved from `from` to `to` carries with it, by the same step. */
function carriedAsteroids(frame: GeometryFrame, from: number, to: number): Map<number, BodyOrbit> {
  return new Map(
    beltAsteroids(frame, from).map((b) => [
      b.id,
      { parent: null, radius: storedRadius(frame, b) + to - from, angle: b.angle },
    ]),
  );
}

/** `override`, with the inner radius the bodies and belts it moves grow. */
function grown(frame: GeometryFrame, override: LayoutOverride): LayoutOverride {
  const inner = grownInner(frame, override);
  return inner === frame.layout.innerRadius ? override : { ...override, innerRadius: inner };
}

function savePreview(intent: GeometryIntent, frame: GeometryFrame): LayoutOverride {
  const { layout } = frame;
  const belts = shownBelts(layout);
  switch (intent.kind) {
    case "move": {
      const body = layout.bodies.find((b) => b.id === intent.body);
      if (!body) return {};
      const to = { parent: body.parent, radius: intent.radius, angle: intent.angle };
      return grown(frame, { bodies: new Map([[intent.body, to]]) });
    }
    case "reparent": {
      const { parent, radius, angle } = intent;
      return grown(frame, { bodies: new Map([[intent.body, { parent, radius, angle }]]) });
    }
    case "addBelt":
      return grown(frame, { belts: [...belts, { kind: intent.beltKind, radius: intent.radius }] });
    case "setBeltRadius": {
      const belt = belts[intent.index];
      if (!belt) return {};
      belts[intent.index] = { ...belt, radius: intent.radius };
      const carried = carriedAsteroids(frame, belt.radius, intent.radius);
      return grown(frame, carried.size === 0 ? { belts } : { belts, bodies: carried });
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
    case "moveWormhole":
      return {
        wormholes: new Map([[intent.wormhole, polar(0, 0, intent.radius, intent.angle)]]),
      };
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
  const { system, radius, angle } = intent;
  const { layout } = frame;
  const body = layout.bodies.find((b) => b.id === intent.body);
  if (!body) return { refused: GEOMETRY_REASONS.elsewhere };
  const parent = asOrbitParent(layout, intent.parent);
  const current = orbitParent(layout, body);
  if (isCentreStar(body)) return { refused: GEOMETRY_REASONS.star };
  if (body.star && parent !== current) return { refused: GEOMETRY_REASONS.starMoon };
  if (isRingSegment(classOfBody(frame, body.id), frame.planetClasses)) {
    return { refused: GEOMETRY_REASONS.ringworld };
  }
  if (!isOrphan(body) && parent === current) return moveOp(system, body, radius, angle);
  const editing = saveEditing(frame).bodies;
  const own = editing.get(body.id);
  if (!own?.reparent) return { refused: own?.reason ?? GEOMETRY_REASONS.hasMoons };
  let star = false;
  if (parent !== null) {
    if (under(layout, parent, body.id)) return { refused: GEOMETRY_REASONS.itself };
    const host = layout.bodies.find((b) => b.id === parent);
    if (!host) return { refused: GEOMETRY_REASONS.elsewhere };
    const hostEditing = editing.get(parent);
    if (!hostEditing?.host) {
      const asteroid = isAsteroid(classOfBody(frame, parent), frame.planetClasses);
      return {
        refused: hostRefusal(host, asteroid) ?? hostEditing?.reason ?? GEOMETRY_REASONS.moonHost,
      };
    }
    if (!host.star && !own.asMoon) return { refused: GEOMETRY_REASONS.hasMoons };
    star = host.star;
  }
  return {
    op: {
      type: "SetSaveBodyParent",
      system,
      body: body.id,
      parent,
      star,
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

function wormholeOp(
  intent: Extract<GeometryIntent, { kind: "moveWormhole" }>,
  frame: GeometryFrame,
): GeometryOp {
  const { wormhole: id, radius, angle } = intent;
  const wormhole = frame.details?.wormholes.find((w) => w.id === id);
  if (!wormhole) return { refused: GEOMETRY_REASONS.wormholeElsewhere };
  if (!isNaturalWormhole(wormhole)) return { refused: GEOMETRY_REASONS.lockedWormhole };
  if (!(radius > 0)) return { refused: GEOMETRY_REASONS.wormholeAtCentre };
  const { x, y } = wormhole;
  const unmoved = same(Math.hypot(x, y), radius) && angleGap(saveAngle(0, 0, x, y), angle) < SAME;
  if (unmoved) return null;
  return { op: { type: "MoveSaveWormhole", wormhole: id, radius, angle: wrapDegrees(angle) } };
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
      if (body.star && atCentre(body)) return { refused: GEOMETRY_REASONS.star };
      if (isRingSegment(classOfBody(frame, body.id), frame.planetClasses)) {
        return { refused: GEOMETRY_REASONS.ringworld };
      }
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
      const least = innerFloorOf(frame);
      if (intent.radius < least) return { refused: innerTooSmall(least) };
      return { op: { type: "SetSaveInnerRadius", system: intent.system, radius: intent.radius } };
    }
    case "moveWormhole":
      return wormholeOp(intent, frame);
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
