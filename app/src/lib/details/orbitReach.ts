/**
 * Where a system's bodies stand and how far they reach: what a body orbits, where a new moon goes,
 * which body another would stand on top of, and how the inner radius grows and how low it may go.
 *
 * The drag needs answers between frames, so the core's overlap, growth and floor rules are kept
 * here too. `testdata/orbit_rules.json` holds the cases both suites check: `overlapOf`,
 * `grownRadius` with `own` left at `reach`, and `innerFloor`. `own`, which sizes the radius from
 * what a move carries, has no counterpart in the core, and no case pins it or `grownInner`'s
 * measure of the reach.
 */
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemRadii } from "../../generated/SystemRadii";
import {
  BELT_SCATTER,
  MOON_RING_FIRST,
  MOON_RING_STEP,
  OVERLAP_TOLERANCE,
  STORED_ORBIT_SLACK,
} from "../../generated/constants";
import type { GeometryFrame } from "./orbitIntent";
import {
  polar,
  wrapDegrees,
  type BodyOrbit,
  type BodyPlacement,
  type LayoutOverride,
  type Point,
  type SystemLayout,
} from "./orbits";

/**
 * The orbit the save stores for `body`, or its drawn radius when it stores none. The drawn radius
 * can sit a hair off what the game wrote, so an edit that steps from it starts from the stored one.
 */
export function storedRadius(frame: Pick<GeometryFrame, "details">, body: BodyPlacement): number {
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
export function nextStarRing(
  frame: Pick<GeometryFrame, "layout" | "details">,
  star: number,
): number {
  const planets = frame.layout.bodies.filter((b) => b.parent === star && b.ring);
  if (planets.length === 0) return STAR_RING_FIRST;
  return Math.max(...planets.map((b) => storedRadius(frame, b))) + STAR_RING_STEP;
}

/** Whether `body` stands where it orbits, as a star at the system's centre does, with no orbit to move along. */
export function atCentre(body: BodyPlacement): boolean {
  return body.ring === null || body.ring.radius <= STORED_ORBIT_SLACK;
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
export function asOrbitParent(layout: SystemLayout, parent: number | null): number | null {
  if (parent === null) return null;
  const body = layout.bodies.find((b) => b.id === parent);
  return body && isCentreStar(body) ? null : parent;
}

/** A moon whose planet is missing, drawn about the centre though its parent is still that planet. */
export function isOrphan(body: BodyPlacement): boolean {
  return body.moon && body.parent === null;
}

/** Whether `id` is `body` or orbits it, however far down. */
export function under(layout: SystemLayout, id: number, body: number): boolean {
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

/** How far apart two angles are, in degrees, the short way round. */
export function angleGap(a: number, b: number): number {
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

/**
 * The inner radius a system now reaching `reach` grows its `current` one to, or null when it stays:
 * when that is past the current radius, or past both the current radius less its offset and the
 * `reached` the system reached before. `own`, how far what was put in place reaches, sizes it and
 * is the reach unless a move carries more of the system with it.
 */
export function grownRadius(
  radii: SystemRadii,
  { reach, reached, current, own = reach }: GrowthCase,
): number | null {
  const further = reach > reached + STORED_ORBIT_SLACK && reach + radii.inner_offset > current;
  return further || own > current ? Math.max(radii.min_inner, own + radii.inner_offset) : null;
}

interface GrowthCase {
  reach: number;
  reached: number;
  current: number;
  own?: number;
}

/**
 * The least the inner radius may be set to: how far the system's bodies and belts `reach`, not
 * below the smallest radius, or its `current` one when that is lower.
 */
export function innerFloor(radii: SystemRadii, reach: number, current: number): number {
  return Math.min(current, Math.max(radii.min_inner, reach));
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
  const reached = reachOf(frame, NOTHING_MOVED, frame.layout.belts);
  const reach = reachOf(frame, moved, belts);
  const own = ownReach(frame, moved, belts);
  return grownRadius(frame.radii, { reach, reached, current, own }) ?? current;
}

/** The least the system's inner radius may be set to, from how far its bodies and belts reach. */
export function innerFloorOf(frame: ReachFrame): number {
  const reach = reachOf(frame, NOTHING_MOVED, frame.layout.belts);
  return innerFloor(frame.radii, reach, frame.layout.innerRadius);
}
