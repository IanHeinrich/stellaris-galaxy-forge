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
  /** How far out a scenario body steps from `base`, as its initializer writes it; null in a save. */
  step: Span | null;
  /** The running orbit a scenario body steps out from, as rolled; null in a save. */
  base: number | null;
}

/** How a scenario body's angle turns on from the body before it in its initializer's walk. */
export interface Turn {
  /**
   * Degrees it turns on from: the rolled angle of the body before it in its walk, or for the first
   * of a walk 0, and `FIRST_MOON_ANGLE` for a planet's first moon.
   */
  from: number;
  /** How far on it may turn, in degrees; a turn or more lets it stand anywhere. */
  step: Span;
  /**
   * The body before it in its walk, which it turns from; null for the first of a walk, and for one
   * standing at the centre of the walk, which marks no direction.
   */
  anchor: number | null;
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
  /**
   * A scenario body's turn from the body before it, a whole turn for one out on an orbit that names
   * no angle; null in a save.
   */
  turn: Turn | null;
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

/** A span as a label reads it, rounded: one number, or its two ends. */
export function spanText(span: Span): string {
  const min = Math.round(span.min);
  const max = Math.round(span.max);
  return min === max ? `${min}` : `${min}–${max}`;
}

/** A step out as a label reads it, with a plus where it steps outwards. */
export function stepText(step: Span): string {
  const text = spanText(step);
  return Math.round(step.min) >= 0 ? `+${text}` : text;
}

/** An angle in [0, 360). */
function turned(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** A turn as a label reads it: "+90–270°", or "any angle" for a turn or more. */
export function turnText(step: Span): string {
  return step.max - step.min >= 360 ? "any angle" : `${stepText(step)}°`;
}

/** The walk a body is placed in: its parent's moons, or the system's own bodies. */
function walkOf(planet: PlanetSummary): number | null {
  return planet.parent === planet.id ? null : planet.parent;
}

/** A scenario body's radius in one roll of its initializer, and the running orbit it stepped out from. */
export interface RolledRadius {
  radius: number;
  base: number;
}

/** The angle the game turns a planet's first moon on from, in the save's frame. */
export const FIRST_MOON_ANGLE = 180;

/** Draws the radii apart from the angles, so a roll's radii need no discs to be read again. */
const ANGLE_STREAM = 0x5bd1e995;

/**
 * Each scenario body's radius in the roll `seed`: its step drawn within the range the core gives
 * and added to the running orbit, which the body before it in its walk left where it was rolled
 * and the initializer may have moved since.
 */
export function rolledRadii(
  planets: readonly PlanetSummary[],
  seed: number,
): ReadonlyMap<number, RolledRadius> {
  const rand = seeded(seed);
  const orbits = new Map(planets.map((p) => [p.id, p.layout?.orbit ?? null]));
  const rolled = new Map<number, RolledRadius>();
  for (const planet of planets) {
    const { orbit, orbit_step: step, orbit_base: base, turns_from: before } = planet.layout ?? {};
    if (!orbit || !step || !base) continue;
    const rolledBefore = before == null ? undefined : rolled.get(before);
    const orbitBefore = before == null ? null : orbits.get(before);
    const moved = rolledBefore && orbitBefore ? rolledBefore.radius - orbitBefore.min : 0;
    const running = base.min + moved;
    const radius = Math.min(orbit.max, Math.max(orbit.min, running + between(rand, step)));
    rolled.set(planet.id, { radius, base: running });
  }
  return rolled;
}

/** Where a scenario body stands about its parent in one roll of its initializer. */
interface Rolled {
  radius: number;
  /** The running orbit it stepped out from; null where the core gives no step. */
  base: number | null;
  /** Degrees; null for a body that names no angle and stands at the centre of its walk. */
  angle: number | null;
  turn: Turn | null;
}

/** The turn of a body that names no angle: the game may place it anywhere on its orbit. */
const ANY_ANGLE: Span = { min: 0, max: 360 };

/** Past the two discs, how far apart a free body keeps from another about the same parent. */
const FREE_GAP = 4;
const FREE_TRIES = 32;

/**
 * One roll of each walk. Each angle turns on from the rolled angle of the body before it by a
 * draw within its step. A body that names no angle is given a spot drawn at random on its ring,
 * drawn again while it comes within a disc and a gap of a body placed before it about the same
 * parent; after the last try, the spot that came nearest to clearing.
 */
function rollWalks(
  planets: readonly PlanetSummary[],
  seed: number,
  discOf: (planet: PlanetSummary) => number,
): Map<number, Rolled> {
  const radii = rolledRadii(planets, seed);
  const rand = seeded(seed ^ ANGLE_STREAM);
  const rolled = new Map<number, Rolled>();
  const taken = new Map<number | null, { at: Point; disc: number }[]>();
  for (const planet of planets) {
    const layout = planet.layout;
    const drawn = radii.get(planet.id);
    const radius = drawn?.radius ?? (layout?.orbit ? mid(layout.orbit) : 0);
    const walk = walkOf(planet);
    let others = taken.get(walk);
    if (!others) taken.set(walk, (others = []));
    const disc = discOf(planet);
    const step = layout?.angle_step ?? null;
    const anchor = layout?.turns_from ?? null;
    let angle: number | null = null;
    let turn: Turn | null = null;
    if (step) {
      const before = anchor === null ? undefined : rolled.get(anchor);
      const first = walk === null ? 0 : FIRST_MOON_ANGLE;
      const from = anchor === null ? first : (before?.angle ?? 0);
      angle = from + between(rand, step);
      const marks = before !== undefined && before.radius > 0;
      turn = { from: turned(from), step, anchor: marks ? anchor : null };
    } else if (layout?.angle) {
      angle = mid(layout.angle);
    } else if (radius > 0) {
      const clearance = (at: Point) =>
        others.reduce(
          (least, o) =>
            Math.min(least, Math.hypot(at.x - o.at.x, at.y - o.at.y) - disc - o.disc - FREE_GAP),
          Infinity,
        );
      let best = { angle: 0, clear: -Infinity };
      for (let i = 0; i < FREE_TRIES && best.clear < 0; i++) {
        const tried = rand() * 360;
        const clear = clearance(polar(0, 0, radius, tried));
        if (clear > best.clear) best = { angle: tried, clear };
      }
      angle = best.angle;
      turn = { from: 0, step: ANY_ANGLE, anchor: null };
    }
    others.push({ at: polar(0, 0, radius, angle ?? 0), disc });
    rolled.set(planet.id, { radius, base: drawn?.base ?? null, angle, turn });
  }
  return rolled;
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
   * The bodies are a scenario's, whose distances and angles are ranges its initializer's walk
   * adds up: they are drawn as one roll of it.
   */
  scenario?: boolean;
  /** Which roll: the same seed draws the same system. */
  seed?: number;
}

/** The seed for roll `roll` of system `system`. */
export function rollSeed(system: number, roll: number): number {
  return Math.imul(system + 1, 0x9e3779b1) ^ Math.imul(roll + 1, 0x85ebca6b);
}

/** Every body's point, circle and angles, the belts, and the radius the camera fits. */
export function systemLayout(
  details: SystemDetails | null,
  { classOf = writtenClass, scenario = false, seed = 0 }: LayoutOptions = {},
): SystemLayout {
  const planets = details?.planets ?? [];
  const byId = new Map(planets.map((p) => [p.id, p]));
  const discOf = (planet: PlanetSummary) => {
    const { planetClass, star } = classOf(planet) ?? writtenClass(planet);
    const size = planet.layout?.size;
    return discRadius(size ? mid(size) : null, walkOf(planet) !== null, planetClass, star);
  };
  const rolled = rollWalks(scenario ? planets : [], seed, discOf);
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
    let turn: Turn | null = null;
    const roll = rolled.get(planet.id);
    if (layout?.at) {
      point = { x: layout.at[0], y: layout.at[1] };
      radius = layout.orbit?.min ?? Math.hypot(point.x - centre.x, point.y - centre.y);
      angle = saveAngle(centre.x, centre.y, point.x, point.y);
    } else {
      const orbit = layout?.orbit ?? null;
      const angleRange = layout?.angle ?? null;
      if (orbit && orbit.min !== orbit.max) band = { inner: orbit.min, outer: orbit.max };
      if (roll) {
        radius = roll.radius;
        angle = turned(roll.angle ?? 0);
        turn = roll.turn;
      } else {
        radius = orbit ? mid(orbit) : 0;
        angle = angleRange ? mid(angleRange) : 0;
      }
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
      turn,
      radius: ring && {
        min: band?.inner ?? radius,
        max: band?.outer ?? radius,
        step: roll ? (layout?.orbit_step ?? null) : null,
        base: roll?.base ?? null,
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
  const rand = seeded(seed);
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
