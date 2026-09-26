/**
 * Where the system view draws each body, orbit, belt and hyperlane exit, and how far it zooms.
 *
 * Points are in save units, which are the world units of `Camera`: the camera applies
 * `SAVE_X_SIGN` and `SAVE_Y_SIGN` itself. `angle`s are degrees in the save frame, as `polar`
 * measures them. `light` and `rotation` are radians on screen, with the axis signs applied, for a
 * sprite drawn upright.
 */
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SystemDetails } from "../../generated/SystemDetails";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../geometry/geometry";
import { seeded } from "../random";
import { isStarBody } from "./starBody";

/** The game's moon to planet scale (`MOON_SCALE` in `00_defines.txt`). */
export const MOON_SCALE = 0.7;
/** World units of disc radius per `planet_size`: Earth (16) is 4.2 at 90 out. */
export const DISC_PER_SIZE = 0.26;
/** The size a body is drawn at when its layout gives none. */
export const FALLBACK_SIZE = 10;
/** The smallest disc radius, so a size-0 body still has one to pick and zoom to. */
export const MIN_DISC_RADIUS = 0.5;
/** Width of an asteroid belt's band, centred on the belt's radius. */
export const BELT_BAND_WIDTH = 20;
/** `inner_radius` when a system gives none: the floor `docs/format-notes.md` gives. */
export const FALLBACK_INNER_RADIUS = 150;
/** Room past the furthest drawn thing for the hyperlane exits and their labels. */
export const FIT_MARGIN = 40;

export interface Point {
  x: number;
  y: number;
}

/** A circle to draw, in save units. */
export interface Ring {
  cx: number;
  cy: number;
  radius: number;
}

/** A scenario body's orbit left to a draw between two radii. */
export interface Band {
  inner: number;
  outer: number;
}

/** A stretch of radii, one value when its ends are the same. */
export interface Span {
  min: number;
  max: number;
}

/** How far a body stands from what it orbits, as the radius readouts give it. */
export interface OrbitRadius {
  /** The radius, or a scenario band's two ends. */
  min: number;
  max: number;
  /**
   * How far out it steps from the previous body with an orbit about the same parent, in source
   * order, each end apart as an initializer's ranges add up; null in a save.
   */
  step: Span | null;
}

/** A scenario body's angle left to a draw, in degrees about its parent. */
export interface Arc {
  from: number;
  to: number;
}

export interface BodyPlacement {
  id: number;
  /** The drawn point, in save units. */
  x: number;
  y: number;
  /** The drawn disc radius, in world units, before the screen-pixel floor. */
  disc: number;
  star: boolean;
  /** The body it is drawn about; null about the centre, or when its parent is missing. */
  parent: number | null;
  /** Its orbit circle, about the parent's point; null on a missing parent or at radius 0. */
  ring: Ring | null;
  /** Degrees about the parent's point (or the centre), in the save frame of `polar`. */
  angle: number;
  /** Screen radians from the body towards the star it orbits, or the centre; null for a star. */
  light: number | null;
  band: Band | null;
  arc: Arc | null;
  /** A scenario body with no angle out on an orbit: drawn on its whole ring. */
  ghost: boolean;
  /** Its distance from what it orbits; null where it has no ring. */
  radius: OrbitRadius | null;
}

export interface BeltBand {
  kind: string;
  radius: number;
  inner: number;
  outer: number;
}

export interface SystemLayout {
  bodies: BodyPlacement[];
  belts: BeltBand[];
  /** Where the inner-radius circle and the exits sit. */
  innerRadius: number;
  /** The radius the camera fits, margin included. */
  fitRadius: number;
  /** The largest body's disc radius, for `zoomLimits`. */
  largestDisc: number;
}

export interface Bearing {
  /** Unit direction in the save frame. */
  dx: number;
  dy: number;
  /** Degrees in the save frame. */
  angle: number;
  /** Screen radians, for a sprite drawn upright. */
  rotation: number;
}

/** Where a body `orbit` out at `angle` degrees from (x, y) stands, as the add-system writer places it. */
export function polar(x: number, y: number, orbit: number, angle: number): Point {
  const a = (angle * Math.PI) / 180;
  return { x: x + orbit * Math.cos(a), y: y + orbit * Math.sin(a) };
}

/** Degrees from (fromX, fromY) to (toX, toY) in the save frame, in [0, 360). */
function saveAngle(fromX: number, fromY: number, toX: number, toY: number): number {
  const deg = (Math.atan2(toY - fromY, toX - fromX) * 180) / Math.PI;
  return (((deg % 360) + 360) % 360) + 0;
}

/** Screen radians of the save-frame direction (dx, dy). */
function screenRotation(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2(SAVE_Y_SIGN * dy, SAVE_X_SIGN * dx);
}

/**
 * How much larger an asteroid is drawn than its `planet_size` gives: the game's asteroid model
 * stands out from the belt around it, where a size-5 disc would be lost.
 */
export const ASTEROID_SCALE = 2;
/**
 * How much larger a star is drawn than a planet of the same `planet_size`: the game's star mesh
 * is 1.65 times its planet mesh, and its corona adds more. Bodies here are already larger against
 * their orbits than the game draws them, so a star is kept short of its full in-game share.
 */
export const STAR_SCALE = 1.8;

/** The game draws a brown dwarf with a planet's model, so at a planet's size. */
function brownDwarf(planetClass: string): boolean {
  return planetClass === "pc_t_star";
}

/** A body's disc radius in world units from its `planet_size`. */
export function discRadius(
  size: number | null,
  moon: boolean,
  planetClass = "",
  star = false,
): number {
  const kind =
    star && !brownDwarf(planetClass)
      ? STAR_SCALE
      : planetClass.includes("asteroid")
        ? ASTEROID_SCALE
        : 1;
  const r = (size ?? FALLBACK_SIZE) * DISC_PER_SIZE * (moon ? MOON_SCALE : 1) * kind;
  return Math.max(r, MIN_DISC_RADIUS);
}

/** The class a body is drawn and sized as, which the scene resolves from its source. */
export interface LaidClass {
  planetClass: string;
  star: boolean;
}

function writtenClass(planet: PlanetSummary): LaidClass {
  return { planetClass: planet.class, star: isStarBody(planet.class, new Map(), new Map()) };
}

function mid(b: { min: number; max: number }): number {
  return (b.min + b.max) / 2;
}

/** The ring a scenario body stands on, as a key: its parent and its drawn radius. */
function ringKey(planet: PlanetSummary): string | null {
  const orbit = planet.layout?.orbit;
  if (!orbit || planet.layout?.at) return null;
  return `${planet.parent ?? ""}:${Math.round(mid(orbit) * 1e6)}`;
}

/**
 * The angles `count` bodies free to stand anywhere on a ring are drawn at, so none stands on
 * another or on a body an angle places there at `placed`. Each goes into the widest gap left,
 * the bodies in one gap spaced evenly across it. With nothing placed they share the ring evenly
 * from `start`.
 */
function spread(placed: readonly number[], count: number, start: number): number[] {
  if (placed.length === 0) {
    return Array.from({ length: count }, (_, i) => start + (i * 360) / count);
  }
  const at = placed.map((a) => ((a % 360) + 360) % 360).sort((a, b) => a - b);
  const gaps = at.map((from, i) => ({
    from,
    width: (i + 1 < at.length ? at[i + 1] : at[0] + 360) - from,
    bodies: 0,
  }));
  for (let n = 0; n < count; n++) {
    const widest = gaps.reduce((a, b) =>
      b.width / (b.bodies + 1) > a.width / (a.bodies + 1) ? b : a,
    );
    widest.bodies++;
  }
  return gaps.flatMap(({ from, width, bodies }) =>
    Array.from({ length: bodies }, (_, i) => from + ((i + 1) * width) / (bodies + 1)),
  );
}

/**
 * The angle each body free to stand anywhere on its ring is drawn at, in a scenario: a ghost, or
 * one whose angle ranges over a turn or more. Where the ring has no placed body, the share starts
 * from the middle of the first free body's range, which keeps free bodies on different rings
 * from lining up.
 */
function freeAngles(planets: readonly PlanetSummary[]): Map<number, number> {
  const rings = new Map<string, { placed: number[]; free: number[]; start: number | null }>();
  for (const planet of planets) {
    const key = ringKey(planet);
    if (key === null || mid(planet.layout?.orbit ?? { min: 0, max: 0 }) <= 0) continue;
    let ring = rings.get(key);
    if (!ring) rings.set(key, (ring = { placed: [], free: [], start: null }));
    const angle = planet.layout?.angle;
    if (angle && angle.max - angle.min < 360) {
      ring.placed.push(mid(angle));
      continue;
    }
    ring.free.push(planet.id);
    if (angle && ring.start === null) ring.start = mid(angle);
  }
  const angles = new Map<number, number>();
  for (const { placed, free, start } of rings.values()) {
    const at = spread(placed, free.length, start ?? 0);
    free.forEach((id, i) => angles.set(id, at[i]));
  }
  return angles;
}

/**
 * Each scenario body's step out from the previous body with an orbit about the same parent, in
 * source order, as an initializer's `orbit_distance` adds up; the first about a parent steps
 * out from it.
 */
function orbitSteps(planets: readonly PlanetSummary[]): Map<number, Span> {
  const last = new Map<number | null, Span>();
  const steps = new Map<number, Span>();
  for (const planet of planets) {
    const orbit = planet.layout?.orbit;
    if (!orbit) continue;
    const parent = planet.parent === planet.id ? null : planet.parent;
    const prev = last.get(parent) ?? { min: 0, max: 0 };
    steps.set(planet.id, { min: orbit.min - prev.min, max: orbit.max - prev.max });
    last.set(parent, orbit);
  }
  return steps;
}

interface Placed {
  point: Point;
  placement: BodyPlacement;
  parent: Placed | null;
}

export interface LayoutOptions {
  /** The class each body is drawn and sized as; the class its source writes by default. */
  classOf?: (planet: PlanetSummary) => LaidClass | undefined;
  /**
   * The bodies are a scenario's, whose angles may be left to chance: bodies free to stand
   * anywhere on a ring share it out rather than all standing at angle 0.
   */
  scenario?: boolean;
}

/** Every body's point, circle and angles, the belts, and the radius the camera fits. */
export function systemLayout(
  details: SystemDetails | null,
  { classOf = writtenClass, scenario = false }: LayoutOptions = {},
): SystemLayout {
  const planets = details?.planets ?? [];
  const byId = new Map(planets.map((p) => [p.id, p]));
  const free = scenario ? freeAngles(planets) : new Map<number, number>();
  const steps = scenario ? orbitSteps(planets) : new Map<number, Span>();
  const placed = new Map<number, Placed>();
  const inProgress = new Set<number>();

  function place(planet: PlanetSummary): Placed | null {
    const done = placed.get(planet.id);
    if (done) return done;
    if (inProgress.has(planet.id)) return null;
    inProgress.add(planet.id);

    let parent: Placed | null = null;
    let missing = false;
    if (planet.parent !== null && planet.parent !== planet.id) {
      const parentPlanet = byId.get(planet.parent);
      if (parentPlanet) parent = place(parentPlanet);
      else missing = true;
    }
    const centre = parent?.point ?? { x: 0, y: 0 };
    const { planetClass, star } = classOf(planet) ?? writtenClass(planet);
    const moon = parent ? !parent.placement.star : planet.parent !== null && missing;
    const layout = planet.layout;

    let point: Point;
    let radius: number;
    let angle: number;
    let band: Band | null = null;
    let arc: Arc | null = null;
    let ghost = false;
    if (layout?.at) {
      point = { x: layout.at[0], y: layout.at[1] };
      radius = layout.orbit?.min ?? Math.hypot(point.x - centre.x, point.y - centre.y);
      angle = saveAngle(centre.x, centre.y, point.x, point.y);
    } else {
      const orbit = layout?.orbit ?? null;
      const angleRange = layout?.angle ?? null;
      radius = orbit ? mid(orbit) : 0;
      if (orbit && orbit.min !== orbit.max) band = { inner: orbit.min, outer: orbit.max };
      if (angleRange && angleRange.min !== angleRange.max) {
        arc = { from: angleRange.min, to: angleRange.max };
      }
      ghost = angleRange === null && radius > 0;
      angle = free.get(planet.id) ?? (angleRange ? mid(angleRange) : 0);
      point = polar(centre.x, centre.y, radius, angle);
    }

    const ring = !missing && radius > 0 ? { cx: centre.x, cy: centre.y, radius } : null;
    const placement: BodyPlacement = {
      id: planet.id,
      x: point.x,
      y: point.y,
      disc: discRadius(layout?.size ? mid(layout.size) : null, moon, planetClass, star),
      star,
      parent: parent ? parent.placement.id : null,
      ring,
      angle,
      light: null,
      band,
      arc,
      ghost,
      radius: ring && {
        min: band?.inner ?? radius,
        max: band?.outer ?? radius,
        step: steps.get(planet.id) ?? null,
      },
    };
    const result = { point, placement, parent };
    placed.set(planet.id, result);
    inProgress.delete(planet.id);
    return result;
  }

  const all = planets.flatMap((p) => place(p) ?? []);
  for (const body of all) {
    if (body.placement.star) continue;
    let lit: Point = { x: 0, y: 0 };
    for (let up = body.parent; up; up = up.parent) {
      if (up.placement.star) {
        lit = up.point;
        break;
      }
    }
    body.placement.light = screenRotation(lit.x - body.point.x, lit.y - body.point.y);
  }
  const bodies = all.map((b) => b.placement);

  const belts = (details?.belts ?? []).map((belt) => ({
    kind: belt.kind,
    radius: belt.inner_radius,
    inner: belt.inner_radius - BELT_BAND_WIDTH / 2,
    outer: belt.inner_radius + BELT_BAND_WIDTH / 2,
  }));

  let outermost = 0;
  for (const b of bodies) {
    outermost = Math.max(outermost, Math.hypot(b.x, b.y) + b.disc);
    if (b.ring) {
      const reach = b.band ? Math.max(b.ring.radius, b.band.outer) : b.ring.radius;
      outermost = Math.max(outermost, Math.hypot(b.ring.cx, b.ring.cy) + reach);
    }
  }
  for (const belt of belts) outermost = Math.max(outermost, belt.outer);

  const innerRadius = details?.inner_radius ?? Math.max(FALLBACK_INNER_RADIUS, outermost);
  const largestDisc = bodies.reduce((m, b) => Math.max(m, b.disc), 0);
  return {
    bodies,
    belts,
    innerRadius,
    fitRadius: Math.max(outermost, innerRadius) + FIT_MARGIN,
    largestDisc: largestDisc || discRadius(null, false),
  };
}

/**
 * A planet drawn only to show that the game rolls the system's planets when it generates the
 * galaxy: no body of the source, and nothing to pick.
 */
export interface RolledPlanet {
  x: number;
  y: number;
  disc: number;
  ring: Ring;
}

/** How many rolled planets a system shows, and where the first orbit and each step out fall. */
const ROLLED_COUNT = { min: 3, max: 6 };
const ROLLED_FIRST = { min: 40, max: 60 };
const ROLLED_STEP = { min: 20, max: 40 };
/** How far inside the inner radius the outermost stays. */
const ROLLED_MARGIN = 20;
/** `planet_size` ranges: most are rocky, and past the first two orbits some are gas giants. */
const ROCKY_SIZE = { min: 8, max: 18 };
const GAS_GIANT_SIZE = { min: 20, max: 25 };
const GAS_GIANT_CHANCE = 0.3;

function between(rand: () => number, { min, max }: Span): number {
  return min + rand() * (max - min);
}

/**
 * A few planets on plausible orbits for a system whose planets the game rolls, the same for
 * the same `seed`, all inside `within`.
 */
export function rolledPlanets(seed: number, within: number): RolledPlanet[] {
  const rand = seeded(Math.imul(seed + 1, 0x9e3779b1));
  const count = Math.floor(between(rand, { min: ROLLED_COUNT.min, max: ROLLED_COUNT.max + 1 }));
  const radii = [between(rand, ROLLED_FIRST)];
  while (radii.length < count) radii.push(radii[radii.length - 1] + between(rand, ROLLED_STEP));
  const fit = Math.min(1, (within - ROLLED_MARGIN) / radii[radii.length - 1]);
  return radii.map((r, i) => {
    const giant = i >= 2 && rand() < GAS_GIANT_CHANCE;
    const size = Math.round(between(rand, giant ? GAS_GIANT_SIZE : ROCKY_SIZE));
    const radius = r * fit;
    const { x, y } = polar(0, 0, radius, rand() * 360);
    return { x, y, disc: discRadius(size, false), ring: { cx: 0, cy: 0, radius } };
  });
}

/** Pixels per world unit at which `fitRadius` reaches the edge of the view's short side. */
export function fitScale(fitRadius: number, width: number, height: number): number {
  return Math.min(width, height) / (2 * Math.max(fitRadius, 1));
}

/** Out to half the fit scale; in until the largest disc's diameter fills the short side. */
export function zoomLimits(
  fitRadius: number,
  width: number,
  height: number,
  largestDisc: number,
): { minScale: number; maxScale: number } {
  return {
    minScale: fitScale(fitRadius, width, height) / 2,
    maxScale: Math.min(width, height) / (2 * Math.max(largestDisc, MIN_DISC_RADIUS)),
  };
}

/** The direction of a hyperlane's exit, from this system's galaxy position to the neighbour's. */
export function exitBearing(from: Point, to: Point): Bearing {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const dx = len === 0 ? 1 : (to.x - from.x) / len;
  const dy = len === 0 ? 0 : (to.y - from.y) / len;
  return { dx, dy, angle: saveAngle(0, 0, dx, dy), rotation: screenRotation(dx, dy) };
}
