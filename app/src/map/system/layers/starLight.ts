/**
 * The light the scene draws round its stars, made on the CPU as white texels with premultiplied
 * alpha, to be tinted and added over the dark: a soft glow, a pulsar's beams, a neutron star's
 * jets and a few curling wisps.
 */

export const GLOW_SIZE = 128;
export const BEAM_WIDTH = 256;
export const BEAM_HEIGHT = 64;
export const PLUME_WIDTH = 256;
export const PLUME_HEIGHT = 128;
export const WISPS_SIZE = 256;

/**
 * How long the beams and the jets are from end to end, in disc diameters. Each is drawn centred
 * on its star, so the part inside the limb is hidden behind the surface.
 */
export const BEAM_LENGTH = 4;
export const PLUME_LENGTH = 4.4;

/** How fast the glow falls away from its centre, as the exponent at its edge. */
const GLOW_FALLOFF = 3.4;
/** A beam's half width where it leaves the star, as a share of the texture's half height. */
const BEAM_SPREAD = 0.62;
/**
 * A jet's half width at the pole and how much of it is left at the far end, as shares of the
 * texture's half height, and how bright its body is beside its filaments.
 */
const PLUME_SPREAD = 0.62;
const PLUME_TIP = 0.35;
const PLUME_BODY = 0.7;
/** The filaments inside a jet: where each sits across it, as a share of its half width. */
const FILAMENTS = [-0.5, -0.18, 0.08, 0.34, 0.58];
const FILAMENT_WIDTH = 0.06;

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

/**
 * How far out along a light `length` disc diameters long the point `x` lies: 0 at the limb and
 * inside it, 1 at the far end.
 */
function outward(x: number, length: number): number {
  const limb = 1 / length;
  return Math.max(0, (Math.abs(x) - limb) / (1 - limb));
}

/** Soft on both sides of a line whose half width is `half`: a Gaussian, near nothing at `half`. */
function across(y: number, half: number): number {
  return Math.exp(-3 * (y / Math.max(half, 1e-3)) ** 2);
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
 * A pulsar's two beams along x, one each way from the middle: widest where they leave the limb,
 * tapering to a point at the ends and fading as they go.
 */
export function beamTexels(): Uint8Array {
  return field(BEAM_WIDTH, BEAM_HEIGHT, (x, y) => {
    const s = outward(x, BEAM_LENGTH);
    const half = BEAM_SPREAD * (1 - s) ** 0.8;
    return (1 - s) ** 1.3 * across(y, half);
  });
}

/**
 * A neutron star's two jets along x: broad and soft at the poles, narrowing and fading outwards,
 * with a few thinner bright filaments running through them.
 */
export function plumeTexels(): Uint8Array {
  return field(PLUME_WIDTH, PLUME_HEIGHT, (x, y) => {
    const s = outward(x, PLUME_LENGTH);
    const half = PLUME_SPREAD * (1 - (1 - PLUME_TIP) * s);
    let filaments = 0;
    for (const [i, share] of FILAMENTS.entries()) {
      const drift = 0.05 * Math.sin(7 * s + 2.3 * i);
      const centre = (share + drift) * half;
      const flicker = 0.65 + 0.35 * Math.sin(11 * s + 1.7 * i);
      filaments += flicker * across(y - centre, FILAMENT_WIDTH * (1 - 0.5 * s));
    }
    const body = PLUME_BODY * across(y, half);
    const fade = (1 - s) ** 1.6 * (1 - smoothstep(0.85, 1, s));
    return fade * (body + (1 - PLUME_BODY) * filaments * across(y, 1.3 * half));
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
