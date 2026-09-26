/**
 * The light the scene draws round its stars, made on the CPU as white texels with premultiplied
 * alpha, to be tinted and added over the dark: a soft glow, a streak and a few curling wisps.
 */

export const GLOW_SIZE = 128;
export const STREAK_WIDTH = 256;
export const STREAK_HEIGHT = 32;
export const WISPS_SIZE = 256;

/** How fast the glow falls away from its centre, as the exponent at its edge. */
const GLOW_FALLOFF = 3.4;
/** A streak's bright thread and the haze round it, as shares of its half height. */
const THREAD = 0.14;
const HAZE = 0.5;
const THREAD_SHARE = 0.7;
/** How much wider the haze grows towards the streak's ends. */
const FLARE_OUT = 0.8;

/**
 * Each wisp is a stretch of spiral about the centre: where it starts and how far round it runs,
 * in radians, its radius there and how far it drifts out over that run, both as shares of the
 * texture's half side, and its thickness.
 */
const WISPS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [0.2, 1.9, 0.52, 0.22, 0.035],
  [2.3, 1.5, 0.48, 0.3, 0.03],
  [3.6, 2.1, 0.55, 0.2, 0.04],
  [5.3, 1.2, 0.5, 0.26, 0.025],
  [1.2, 1.0, 0.7, 0.18, 0.02],
  [4.4, 1.1, 0.72, 0.16, 0.02],
];

function smoothstep(from: number, to: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** `alpha(x, y)` for each texel of a `width` by `height` field, `x` and `y` from -1 to 1. */
function field(width: number, height: number, alpha: (x: number, y: number) => number): Uint8Array {
  const texels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const x = ((col + 0.5) / width) * 2 - 1;
      const y = ((row + 0.5) / height) * 2 - 1;
      const a = Math.round(255 * Math.min(1, Math.max(0, alpha(x, y))));
      texels.set([a, a, a, a], (row * width + col) * 4);
    }
  }
  return texels;
}

/** Brightest at the centre, falling away smoothly to nothing at the edge. */
export function glowTexels(): Uint8Array {
  const edge = Math.exp(-GLOW_FALLOFF);
  return field(GLOW_SIZE, GLOW_SIZE, (x, y) => {
    const r = Math.hypot(x, y);
    return r >= 1 ? 0 : (Math.exp(-GLOW_FALLOFF * r) - edge) / (1 - edge);
  });
}

/**
 * A thin bright thread along x in a haze that widens towards the ends, fading from the middle
 * out both ways: laid through a star, it is two streaks leaving it on opposite sides.
 */
export function streakTexels(): Uint8Array {
  return field(STREAK_WIDTH, STREAK_HEIGHT, (x, y) => {
    const out = Math.abs(x);
    const along = (1 - out) ** 1.5;
    const thread = Math.exp(-((y / THREAD) ** 2));
    const haze = Math.exp(-((y / (HAZE * (1 + FLARE_OUT * out))) ** 2));
    return along * (THREAD_SHARE * thread + (1 - THREAD_SHARE) * haze);
  });
}

/** Faint curling strands round an empty middle, each fading in and out along its length. */
export function wispTexels(): Uint8Array {
  return field(WISPS_SIZE, WISPS_SIZE, (x, y) => {
    const r = Math.hypot(x, y);
    const angle = Math.atan2(y, x);
    let sum = 0;
    for (const [start, span, radius, drift, thickness] of WISPS) {
      const turned = (((angle - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (turned > span) continue;
      const s = turned / span;
      const along = Math.sin(Math.PI * s);
      const off = r - (radius + drift * s);
      sum += along * Math.exp(-((off / thickness) ** 2));
    }
    return sum * (1 - smoothstep(0.85, 1, r));
  });
}
