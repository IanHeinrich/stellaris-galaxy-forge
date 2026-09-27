/**
 * Where the system view draws each body, orbit, belt and hyperlane exit.
 *
 * Points are in save units, which are the world units of `Camera`: the camera applies
 * `SAVE_X_SIGN` and `SAVE_Y_SIGN` itself. `angle`s are degrees in the save frame, as `polar`
 * measures them. `light` and `rotation` are radians on screen, with the axis signs applied, for a
 * sprite drawn upright.
 */
import type { BodyLayout } from "../../generated/BodyLayout";
import { MIN_INNER_RADIUS } from "../../generated/constants";
import type { Bounds } from "../../generated/Bounds";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { RolledBody } from "../../generated/RolledBody";
import type { StarClassView } from "../../generated/StarClassView";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemRoll } from "../../generated/SystemRoll";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../geometry/geometry";
import { discRadius } from "./discs";
import { isStarBody } from "./starBody";

/** Width of an asteroid belt's band, centred on the belt's radius. */
const BELT_BAND_WIDTH = 20;
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

/** How far a body stands from what it orbits, as the radius readouts give it. */
export interface OrbitRadius {
  /** The radius, or a scenario band's two ends. */
  min: number;
  max: number;
  /** How far out a scenario body steps from `base`, as its initializer writes it; null in a save. */
  step: Bounds | null;
  /** The running orbit a scenario body steps out from, as rolled; null in a save. */
  base: number | null;
}

/** How a scenario body's angle turns on from the body before it in its initializer's walk. */
export interface Turn {
  /**
   * Degrees it turns on from: the rolled angle of the body before it in its walk, or the walk's
   * start for the first of a walk and one after a body at its centre.
   */
  from: number;
  /** How far on it may turn, in degrees; a turn or more lets it stand anywhere. */
  step: Bounds;
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
  /** It orbits a planet, or a body the system does not list. */
  moon: boolean;
  /** The body it is drawn about; null about the centre, or when its parent is missing. */
  parent: number | null;
  /** Its orbit circle, about the parent's point; null on a missing parent or at radius 0. */
  ring: Ring | null;
  /**
   * It counts towards how far the system reaches. A save body the game placed by event with no
   * orbit (an astral scar far out) does not, as the game's own inner radius leaves it out.
   */
  reaches: boolean;
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
  /** The largest body's disc radius, for the camera's zoom. */
  largestDisc: number;
}

/** Where a body stands about what it orbits: `radius` and `angle` about the parent's point, in `polar`'s degrees. */
export interface BodyOrbit {
  /** The body it orbits; null for the system's centre. */
  parent: number | null;
  radius: number;
  angle: number;
}

/**
 * What a layout draws in place of the details: bodies put elsewhere, other belts, another inner
 * radius. A body's moons go with it.
 */
export interface LayoutOverride {
  bodies?: ReadonlyMap<number, BodyOrbit>;
  belts?: readonly { kind: string; radius: number }[];
  innerRadius?: number;
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

/** The turn of a body that names no angle: the game may place it anywhere on its orbit. */
export const ANY_ANGLE: Bounds = { min: 0, max: 360 };

/** Whether a turn of `step` lets a body stand anywhere on its orbit: a whole turn or more. */
export function wholeTurn(step: Bounds): boolean {
  return step.max - step.min >= 360;
}

/** Where a body `orbit` out at `angle` degrees from (x, y) stands, as the add-system writer places it. */
export function polar(x: number, y: number, orbit: number, angle: number): Point {
  const a = (angle * Math.PI) / 180;
  return { x: x + orbit * Math.cos(a), y: y + orbit * Math.sin(a) };
}

/** `deg` turned into [0, 360). */
export function wrapDegrees(deg: number): number {
  return (((deg % 360) + 360) % 360) + 0;
}

/** Degrees from (fromX, fromY) to (toX, toY) in the save frame, in [0, 360). */
function saveAngle(fromX: number, fromY: number, toX: number, toY: number): number {
  return wrapDegrees((Math.atan2(toY - fromY, toX - fromX) * 180) / Math.PI);
}

/** Screen radians of the save-frame direction (dx, dy). */
function screenRotation(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  return Math.atan2(SAVE_Y_SIGN * dy, SAVE_X_SIGN * dx);
}

const NO_STAR_CLASSES: ReadonlyMap<string, StarClassView> = new Map();

/** Whether a body is drawn as a star: one the core gives a star class, else one its class makes a star. */
export function isStar(
  planet: PlanetSummary,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
): boolean {
  return (
    planet.star_class !== undefined || isStarBody(planet.class, planetClasses, NO_STAR_CLASSES)
  );
}

function mid(b: Bounds): number {
  return (b.min + b.max) / 2;
}

/** A rolled body's turn from the body before it in its walk, or anywhere on an orbit naming no angle. */
function turnOf(
  layout: BodyLayout | null,
  rolled: RolledBody,
  rolls: ReadonlyMap<number, RolledBody>,
): Turn | null {
  const step = layout?.angle_step ?? null;
  if (step === null) return rolled.orbit > 0 ? { from: 0, step: ANY_ANGLE, anchor: null } : null;
  const anchor = layout?.turns_from ?? null;
  const marks = anchor !== null && (rolls.get(anchor)?.orbit ?? 0) > 0;
  return { from: rolled.from, step, anchor: marks ? anchor : null };
}

interface Placed {
  point: Point;
  placement: BodyPlacement;
  parent: Placed | null;
  /** How far the override moved it from the point the save gives it, which its save moons follow. */
  shift: Point;
}

const NO_SHIFT: Point = { x: 0, y: 0 };

function layOut(
  details: SystemDetails | null,
  roll: SystemRoll | null,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  moonScale: number,
  override?: LayoutOverride,
): SystemLayout {
  const planets = details?.planets ?? [];
  const byId = new Map(planets.map((p) => [p.id, p]));
  const rolls = new Map((roll?.bodies ?? []).map((b) => [b.id, b]));
  const placed = new Map<number, Placed>();
  const inProgress = new Set<number>();

  function place(planet: PlanetSummary): Placed | null {
    const done = placed.get(planet.id);
    if (done) return done;
    if (inProgress.has(planet.id)) return null;
    inProgress.add(planet.id);

    const moved = override?.bodies?.get(planet.id);
    const parentId = moved ? moved.parent : planet.parent;
    let parent: Placed | null = null;
    let missing = false;
    if (parentId !== null && parentId !== planet.id) {
      const parentPlanet = byId.get(parentId);
      if (parentPlanet) parent = place(parentPlanet);
      else missing = true;
    }
    const centre = parent?.point ?? { x: 0, y: 0 };
    const star = isStar(planet, planetClasses);
    const layout = planet.layout;
    const rolled = rolls.get(planet.id);

    let point: Point;
    let radius: number;
    let angle: number;
    let band: Band | null = null;
    let turn: Turn | null = null;
    let shift = NO_SHIFT;
    if (layout?.at) {
      const carried = parent?.shift ?? NO_SHIFT;
      point = { x: layout.at[0] + carried.x, y: layout.at[1] + carried.y };
      radius = layout.orbit?.min ?? 0;
      angle = saveAngle(centre.x, centre.y, point.x, point.y);
    } else {
      const orbit = layout?.orbit ?? null;
      if (orbit && orbit.min !== orbit.max) band = { inner: orbit.min, outer: orbit.max };
      radius = rolled?.orbit ?? (orbit ? mid(orbit) : 0);
      angle = rolled?.angle ?? 0;
      turn = rolled ? turnOf(layout, rolled, rolls) : null;
      point = polar(centre.x, centre.y, radius, angle);
    }
    if (moved) {
      radius = moved.radius;
      angle = wrapDegrees(moved.angle);
      point = polar(centre.x, centre.y, radius, angle);
    }
    if (layout?.at) shift = { x: point.x - layout.at[0], y: point.y - layout.at[1] };

    const ring = !missing && radius > 0 ? { cx: centre.x, cy: centre.y, radius } : null;
    const size = layout?.size ? mid(layout.size) : null;
    const view = planetClasses.get(planet.class);
    const placement: BodyPlacement = {
      id: planet.id,
      x: point.x,
      y: point.y,
      disc: discRadius(size, { moon: planet.moon, star, view, moonScale }),
      star,
      moon: moved ? moved.parent !== null && !(parent?.placement.star ?? false) : planet.moon,
      parent: parent ? parent.placement.id : null,
      ring,
      reaches:
        star || moved !== undefined || !layout?.at || planet.orbit === null || planet.orbit > 0,
      angle,
      light: null,
      band,
      turn,
      radius: ring && {
        min: band?.inner ?? radius,
        max: band?.outer ?? radius,
        step: rolled ? (layout?.orbit_step ?? null) : null,
        base: rolled?.base ?? null,
      },
    };
    const result = { point, placement, parent, shift };
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

  const shownBelts =
    override?.belts ??
    (details?.belts ?? []).map((belt) => ({ kind: belt.kind, radius: belt.inner_radius }));
  const belts = shownBelts.map(({ kind, radius }) => ({
    kind,
    radius,
    inner: radius - BELT_BAND_WIDTH / 2,
    outer: radius + BELT_BAND_WIDTH / 2,
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

  const innerRadius =
    override?.innerRadius ?? details?.inner_radius ?? Math.max(MIN_INNER_RADIUS, outermost);
  const largestDisc = bodies.reduce((m, b) => Math.max(m, b.disc), 0);
  return {
    bodies,
    belts,
    innerRadius,
    fitRadius: Math.max(outermost, innerRadius) + FIT_MARGIN,
    largestDisc: largestDisc || discRadius(null),
  };
}

interface Laid {
  roll: SystemRoll | null;
  planetClasses: ReadonlyMap<string, PlanetClassView>;
  moonScale: number;
  layout: SystemLayout;
}

const NO_DETAILS = {};
const laid = new WeakMap<object, Laid>();

/**
 * Every body's point, circle and angles, the belts, and the radius the camera fits: a save's bodies
 * where it puts them, a scenario's where `roll` lands them, and whatever `override` puts elsewhere.
 * The same details, roll, classes and moon scale give the same layout, so the scene and every
 * readout of it read one; a layout under an override is never kept.
 */
export function systemLayout(
  details: SystemDetails | null,
  roll: SystemRoll | null,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
  moonScale: number,
  override?: LayoutOverride,
): SystemLayout {
  const overridden =
    override?.bodies !== undefined ||
    override?.belts !== undefined ||
    override?.innerRadius !== undefined;
  if (overridden) {
    const shown = layOut(details, roll, planetClasses, moonScale, override);
    if (override.belts !== undefined) return shown;
    // The same belts object as the plain layout's, so the belts drawn from it are left alone.
    return { ...shown, belts: systemLayout(details, roll, planetClasses, moonScale).belts };
  }
  const key = details ?? NO_DETAILS;
  const known = laid.get(key);
  if (
    known &&
    known.roll === roll &&
    known.planetClasses === planetClasses &&
    known.moonScale === moonScale
  ) {
    return known.layout;
  }
  const layout = layOut(details, roll, planetClasses, moonScale);
  laid.set(key, { roll, planetClasses, moonScale, layout });
  return layout;
}

/** The planets `roll` draws for a system whose planets the game rolls, each on its ring about the centre. */
export function placeholderPlanets(
  roll: SystemRoll | null,
  planetClasses: ReadonlyMap<string, PlanetClassView>,
): RolledPlanet[] {
  return (roll?.placeholders ?? []).map(({ class: planetClass, size, orbit, angle }) => ({
    ...polar(0, 0, orbit, angle),
    disc: discRadius(size, { view: planetClasses.get(planetClass) }),
    ring: { cx: 0, cy: 0, radius: orbit },
  }));
}

/** The direction of a hyperlane's exit, from this system's galaxy position to the neighbour's. */
export function exitBearing(from: Point, to: Point): Bearing {
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  const dx = len === 0 ? 1 : (to.x - from.x) / len;
  const dy = len === 0 ? 0 : (to.y - from.y) / len;
  return { dx, dy, angle: saveAngle(0, 0, dx, dy), rotation: screenRotation(dx, dy) };
}
