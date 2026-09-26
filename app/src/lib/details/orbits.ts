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
import { isStarBody } from "./starBody";

/** The game's moon to planet scale (`MOON_SCALE` in `00_defines.txt`). */
export const MOON_SCALE = 0.7;
/** World units of disc radius per `planet_size`: a size-30 star is 9, Earth (16) 4.8 at 90 out. */
export const DISC_PER_SIZE = 0.3;
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

/** A body's disc radius in world units from its `planet_size`. */
export function discRadius(size: number | null, moon: boolean): number {
  const r = (size ?? FALLBACK_SIZE) * DISC_PER_SIZE * (moon ? MOON_SCALE : 1);
  return Math.max(r, MIN_DISC_RADIUS);
}

function defaultIsStar(planetClass: string): boolean {
  return isStarBody(planetClass, new Map(), new Map());
}

function mid(b: { min: number; max: number }): number {
  return (b.min + b.max) / 2;
}

interface Placed {
  point: Point;
  placement: BodyPlacement;
  parent: Placed | null;
}

/** Every body's point, circle and angles, the belts, and the radius the camera fits. */
export function systemLayout(
  details: SystemDetails | null,
  isStar: (planetClass: string) => boolean = defaultIsStar,
): SystemLayout {
  const planets = details?.planets ?? [];
  const byId = new Map(planets.map((p) => [p.id, p]));
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
    const star = isStar(planet.class);
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
      angle = angleRange ? mid(angleRange) : 0;
      point = polar(centre.x, centre.y, radius, angle);
    }

    const placement: BodyPlacement = {
      id: planet.id,
      x: point.x,
      y: point.y,
      disc: discRadius(layout?.size?.min ?? null, moon),
      star,
      parent: parent ? parent.placement.id : null,
      ring: !missing && radius > 0 ? { cx: centre.x, cy: centre.y, radius } : null,
      angle,
      light: null,
      band,
      arc,
      ghost,
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

/** Pixels per world unit at which `fitRadius` reaches the edge of the view's short side. */
export function fitScale(fitRadius: number, width: number, height: number): number {
  return Math.min(width, height) / (2 * Math.max(fitRadius, 1));
}

/** Out to a quarter of the fit scale; in until the largest disc's diameter fills the short side. */
export function zoomLimits(
  fitRadius: number,
  width: number,
  height: number,
  largestDisc: number,
): { minScale: number; maxScale: number } {
  return {
    minScale: fitScale(fitRadius, width, height) / 4,
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
