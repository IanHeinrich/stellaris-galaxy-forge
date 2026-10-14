import { clamp } from "../geometry/geometry";
import type { Pt } from "../geometry/pt";
import type { GalaxyForm } from "./types";

/** How the density runs across an arm and the gap beside it, over one turn of its phase. */
interface Band {
  /** The share of the turn the arm takes, centred on phase 0. */
  duty: number;
  /** How far the arm's edges soften, as a span of the phase's cosine either side of the edge. */
  soft: number;
  /** The density left in the gap, as a share of the arm's. */
  floor: number;
}

/**
 * Arms round the centre, `count` of them, each winding `wind` radians further round for each
 * radius it reaches outward; spoked slices are arms that don't wind.
 */
interface Arms extends Band {
  count: number;
  wind: number;
}

/**
 * One galaxy shape as a density over the unit disc, from 0 where a fill keeps no points to 1
 * where it keeps them all. The game builds its shapes in the engine, so nothing in the install
 * describes them: these are look-alikes fitted to galaxies the game generated, whose figures
 * `galaxyStats.json` keeps.
 */
export interface GalaxyMap {
  /** The empty core: the density rises from nothing at `core[0]` to full at `core[1]`, as shares of the radius. */
  core: readonly [number, number];
  /** The rim: the density falls from full at `rim[0]` to nothing at `rim[1]`. */
  rim: readonly [number, number];
  /** How much of the density is lost for each radius outward from the core. */
  falloff: number;
  arms: Arms | null;
  /** One side fuller than the other, winding `wind` radians round per radius as arms do; null for an even galaxy. */
  side: (Band & { wind: number }) | null;
}

/** Every galaxy shape's density, in the game's order. */
export const GALAXY_MAPS: Record<GalaxyForm, GalaxyMap> = {
  elliptical: { core: [0.21, 0.23], rim: [0.86, 1], falloff: 0.94, arms: null, side: null },
  spiral_2: {
    core: [0.25, 0.27],
    rim: [0.77, 0.94],
    falloff: 0.85,
    arms: { count: 2, wind: 8.7, duty: 0.46, soft: 1, floor: 0.17 },
    side: null,
  },
  spiral_3: {
    core: [0.21, 0.23],
    rim: [0.65, 0.86],
    falloff: 0.92,
    arms: { count: 3, wind: 7.55, duty: 0.51, soft: 1, floor: 0.25 },
    side: null,
  },
  spiral_4: {
    core: [0.22, 0.3],
    rim: [0.85, 0.94],
    falloff: 0.95,
    arms: { count: 4, wind: 5.4, duty: 0.51, soft: 1, floor: 0.21 },
    side: null,
  },
  spiral_6: {
    core: [0.19, 0.21],
    rim: [0.75, 0.91],
    falloff: 0.79,
    arms: { count: 6, wind: 4.6, duty: 0.56, soft: 1, floor: 0.1 },
    side: null,
  },
  ring: { core: [0.34, 0.64], rim: [0.93, 0.99], falloff: 0, arms: null, side: null },
  bar: {
    core: [0, 0.27],
    rim: [0.7, 0.87],
    falloff: 1.32,
    arms: { count: 2, wind: 2.4, duty: 0.51, soft: 1, floor: 0.13 },
    side: null,
  },
  starburst: {
    core: [0.17, 0.19],
    rim: [0.74, 0.76],
    falloff: 0.75,
    arms: { count: 4, wind: 5.5, duty: 0.46, soft: 0.96, floor: 0.22 },
    side: { wind: 4.4, duty: 0.65, soft: 0.6, floor: 0 },
  },
  cartwheel: {
    core: [0.36, 0.58],
    rim: [0.8, 1],
    falloff: 0,
    arms: { count: 3, wind: 8, duty: 0.41, soft: 1, floor: 0.26 },
    side: null,
  },
  spoked: {
    core: [0, 0.31],
    rim: [0.9, 1],
    falloff: 0.92,
    arms: { count: 7, wind: 0, duty: 0.45, soft: 1, floor: 0.19 },
    side: null,
  },
};

/** Every galaxy shape, in the game's order. */
export const GALAXY_FORMS = Object.keys(GALAXY_MAPS) as GalaxyForm[];

/** The localisation key of each galaxy shape's description in the game's setup screen. */
export const GALAXY_FORM_DESCRIPTIONS: Record<GalaxyForm, string> = {
  elliptical: "GALAXY_SHAPE_ELLIPTICAL_DESC",
  spiral_2: "GALAXY_SHAPE_SPIRAL_2_DESC",
  spiral_3: "GALAXY_SHAPE_SPIRAL_3_DESC",
  spiral_4: "GALAXY_SHAPE_SPIRAL_4_DESC",
  spiral_6: "GALAXY_SHAPE_SPIRAL_6_DESC",
  ring: "GALAXY_SHAPE_RING_DESC",
  bar: "GALAXY_SHAPE_BAR_DESC",
  starburst: "GALAXY_SHAPE_STARBURST_DESC",
  cartwheel: "GALAXY_SHAPE_CARTWHEEL_DESC",
  spoked: "GALAXY_SHAPE_SPOKED_DESC",
};

/** Smoothstep from 0 at `from` to 1 at `to`. */
function rising(from: number, to: number, x: number): number {
  const t = clamp((x - from) / Math.max(to - from, 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}

/** The density at `phase` across an arm and its gap, 1 in the arm and `floor` in the gap. */
function across(phase: number, { duty, soft, floor }: Band): number {
  const edge = Math.cos(Math.PI * duty);
  return floor + (1 - floor) * rising(edge - soft, edge + soft, Math.cos(phase));
}

/** The density of `map` at `r` radii from the centre and `angle` radians round from the shape's rotation. */
export function mapDensity(map: GalaxyMap, r: number, angle: number): number {
  const [c0, c1] = map.core;
  const [e0, e1] = map.rim;
  const radial =
    rising(c0, c1, r) *
    (1 - rising(e0, e1, r)) *
    Math.max(0, 1 - map.falloff * Math.max(0, r - c1));
  if (radial <= 0) return 0;
  const { arms, side } = map;
  const armed = arms ? across(arms.count * (angle - arms.wind * r), arms) : 1;
  const sided = side ? across(angle - side.wind * r, side) : 1;
  return radial * armed * sided;
}

/** The density of galaxy shape `form` at `local`, a point in the shape's own frame in radii. */
export function galaxyDensity(form: GalaxyForm, local: Pt): number {
  return mapDensity(GALAXY_MAPS[form], Math.hypot(local.x, local.y), Math.atan2(local.y, local.x));
}

/** How many rings and spokes of the polar grid `meanDensity` averages over. */
const MEAN_RINGS = 200;
const MEAN_SPOKES = 360;

const means = new Map<GalaxyForm, number>();

/** The mean of `form`'s density over the unit disc: the share of a fill a galaxy keeps. */
export function meanDensity(form: GalaxyForm): number {
  let mean = means.get(form);
  if (mean === undefined) {
    const map = GALAXY_MAPS[form];
    let sum = 0;
    let weight = 0;
    for (let i = 0; i < MEAN_RINGS; i++) {
      const r = (i + 0.5) / MEAN_RINGS;
      for (let j = 0; j < MEAN_SPOKES; j++) {
        sum += r * mapDensity(map, r, ((j + 0.5) / MEAN_SPOKES) * 2 * Math.PI);
      }
      weight += r * MEAN_SPOKES;
    }
    mean = sum / weight;
    means.set(form, mean);
  }
  return mean;
}
