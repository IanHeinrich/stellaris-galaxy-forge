/**
 * A natural wormhole seen from above, as three fields of white texels with premultiplied alpha,
 * each tinted and added over the dark: a wide soft haze, a swirl of cloud about a dark eye, and
 * the light that hugs the eye with a pinpoint inside it. Each fades softly into the next. All three share one frame, so they are
 * drawn at the same size about the same point.
 */

import { smoothstep } from "./ease";
import { RingNoise } from "./nebulaField";
import { field, once } from "./texels";

const HAZE_SIZE = 256;
const DETAIL_SIZE = 320;
/** Every wormhole draws the same fields. */
const WORMHOLE_SEED = 0x0b5e55ed;

/** How far the fields' half side reaches past the swirl's visible edge, where it is picked. */
export const WORMHOLE_ART_SCALE = 2.2;

/** The swirl's visible edge, the dark eye and the rim's brightest line, as shares of the half side. */
const VORTEX = 1 / WORMHOLE_ART_SCALE;
const EYE = 0.25 * VORTEX;
const RIM = 0.33 * VORTEX;
/** How softly the rim fades into the eye, how far it spreads out into the swirl, and its peak. */
const RIM_INSIDE = 0.02;
const RIM_OUTSIDE = 0.028;
const RIM_ALPHA = 0.7;

/** Lattice cells once round the circle and across the half side: long streaks along the circle. */
const TURN_CELLS = 6;
const RADIUS_CELLS = 16;
const OCTAVES = 5;
/** How far the swirl turns across the half side, in turns. */
const TWIST = 1.3;
/** How much of the swirl's cloud pattern is left at its edge, where it has thinned to a haze. */
const EDGE_CONTRAST = 0.35;
const RAGGED = 0.05;
/** Where the swirl starts to fade to its edge, as a share of the half side. */
const SWIRL_FADE_FROM = RIM + 0.25 * (VORTEX - RIM);
/** Where the swirl and the haze start to rise out of the eye, as a share of the half side. */
const EYE_EDGE = 0.7 * EYE;
/** How much of the swirl's cloud shows faintly in the eye. */
const SWIRL_IN_EYE = 0.35;
/**
 * The band of swirl hugging the rim, the brightest cloud of the vortex: how far past the rim it
 * peaks, its half width, and how much it lifts the swirl there, all as shares of the half side.
 */
const HUG_OFFSET = 0.04;
const HUG_WIDTH = 0.05;
const HUG_LIFT = 0.8;

/** The haze's own coarser clouds, and how much of it shows between them. */
const HAZE_TURN_CELLS = 4;
const HAZE_RADIUS_CELLS = 4;
const HAZE_FLOOR = 0.5;

/**
 * The pinpoint in the eye and the softer glow round it, and the faint light rising from it
 * towards the top of the field, with a wider glow about it.
 */
const CORE_RADIUS = 0.012;
const CORE_GLOW_RADIUS = 0.04;
const CORE_GLOW = 0.3;
const STREAK_LENGTH = 1.1 * EYE;
const STREAK_WIDTH = 0.012;
const STREAK_ALPHA = 0.45;
const STREAK_GLOW = 0.2;

let shared: RingNoise | null = null;
const noise = () => (shared ??= new RingNoise(WORMHOLE_SEED));

/** Where the angle and radius of (x, y) fall on the noise lattice, turned more the further out. */
function lattice(x: number, y: number, turnCells: number, radiusCells: number, twist: number) {
  const r = Math.hypot(x, y);
  const u = (Math.atan2(y, x) / (2 * Math.PI) + 0.5 + twist * r) * turnCells;
  return { r, u, v: r * radiusCells };
}

/** Deep blue haze filling the eye and thinning out from the rim to the field's edge. */
export const wormholeHazeTexels = once(() => {
  const ring = noise();
  return field(HAZE_SIZE, HAZE_SIZE, (x, y) => {
    const { r, u, v } = lattice(x, y, HAZE_TURN_CELLS, HAZE_RADIUS_CELLS, TWIST / 2);
    if (r >= 1) return 0;
    const cloud = smoothstep(-0.6, 0.6, ring.fbm(u, v, HAZE_TURN_CELLS, 3, 401));
    const fall = (1 - smoothstep(RIM, 1, r)) * (1 - smoothstep(0.8, 1, r));
    return fall * (HAZE_FLOOR + (1 - HAZE_FLOOR) * cloud);
  });
});

/**
 * Streaks of cloud spiralling out from the eye: brightest in a band just outside the rim,
 * thinning and softening outwards to a ragged edge, and faint across the eye.
 */
export const wormholeSwirlTexels = once(() => {
  const ring = noise();
  return field(DETAIL_SIZE, DETAIL_SIZE, (x, y) => {
    const { r, u, v } = lattice(x, y, TURN_CELLS, RADIUS_CELLS, TWIST);
    if (r >= 1) return 0;
    const edge = r + RAGGED * ring.fbm(2 * u, 2 * v, 2 * TURN_CELLS, 3, 227);
    const out = Math.min(1, Math.max(0, (r - RIM) / (VORTEX - RIM)));
    const fall = (1 - 0.5 * out) * (1 - smoothstep(SWIRL_FADE_FROM, VORTEX + RAGGED, edge));
    if (fall <= 0) return 0;
    const cloud = smoothstep(-0.45, 0.55, ring.fbm(u, v, TURN_CELLS, OCTAVES, 0));
    const strands = ring.ridged(2 * u, 3 * v, 2 * TURN_CELLS, OCTAVES - 1, 307);
    const contrast = 1 - (1 - EDGE_CONTRAST) * out;
    const detail = 0.5 + contrast * ((0.3 + 0.7 * cloud) * (0.6 + 0.4 * strands) - 0.5);
    const rise = SWIRL_IN_EYE + (1 - SWIRL_IN_EYE) * smoothstep(EYE_EDGE, RIM, r);
    const hug = 1 + HUG_LIFT * Math.exp(-(((r - RIM - HUG_OFFSET) / HUG_WIDTH) ** 2));
    return rise * hug * fall * detail;
  });
});

/**
 * The near-white light: a thin ring hugging the eye, fading softly into it, and a pinpoint at its
 * centre with a short faint streak rising from it, both glowing into the eye.
 */
export const wormholeRimTexels = once(() => {
  const ring = noise();
  return field(DETAIL_SIZE, DETAIL_SIZE, (x, y) => {
    const { r, u, v } = lattice(x, y, TURN_CELLS, RADIUS_CELLS, TWIST);
    if (r >= 1) return 0;
    const spread = r < RIM ? RIM_INSIDE : RIM_OUTSIDE;
    const flicker = 0.9 + 0.1 * ring.fbm(u, v, TURN_CELLS, 3, 509);
    const rim = RIM_ALPHA * flicker * Math.exp(-(((r - RIM) / spread) ** 2));
    const core =
      Math.exp(-((r / CORE_RADIUS) ** 2)) + CORE_GLOW * Math.exp(-((r / CORE_GLOW_RADIUS) ** 2));
    const rise = -y / STREAK_LENGTH;
    const streak =
      rise > 0 && rise < 1
        ? (1 - rise) *
          (STREAK_ALPHA * Math.exp(-((x / STREAK_WIDTH) ** 2)) +
            STREAK_GLOW * Math.exp(-((x / (3 * STREAK_WIDTH)) ** 2)))
        : 0;
    return rim + core + streak;
  });
});
