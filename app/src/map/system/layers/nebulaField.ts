import { seeded } from "../../../lib/random";

/** The field's side in texels: it is soft, so the scene stretches it well past this. */
export const FIELD_SIZE = 320;

/** Lattice cells once round the circle at the coarsest octave, and across the radius. */
const TURN_CELLS = 6;
const RADIUS_CELLS = 6;
const OCTAVES = 5;
/** How far the streaks turn from the centre to the edge, in turns: a loose vortex. */
const TWIST = 0.45;
/** How far the filaments bend, in cells of the coarsest octave, along the circle and across it. */
const WARP_TURN = 0.9;
const WARP_RADIUS = 0.45;

/** The clearing about the centre, and where the field comes up to full, as shares of the radius. */
const CLEAR_TO = 0.04;
const FULL_FROM = 0.36;
/** How much of the field shows in the clearing. */
const CLEAR_FLOOR = 0.12;
/** The fade to nothing at the texture's own edge. */
const FADE_FROM = 0.78;
/** How hard the brightest strands are rounded off, so none of them stands out as a core. */
const SOFTEN = 1.6;

const TABLE = 256;

function smoothstep(from: number, to: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * Gradient noise in about [-1, 1], repeating every `period` cells along x so a ring of it has no
 * seam. `period` is at most the table's size.
 */
class RingNoise {
  private readonly perm = new Uint8Array(2 * TABLE);
  private readonly gx = new Float32Array(TABLE);
  private readonly gy = new Float32Array(TABLE);

  constructor(seed: number) {
    const rand = seeded(seed);
    const order = Array.from({ length: TABLE }, (_, i) => i);
    for (let i = TABLE - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < 2 * TABLE; i++) this.perm[i] = order[i % TABLE];
    for (let i = 0; i < TABLE; i++) {
      const a = rand() * 2 * Math.PI;
      this.gx[i] = Math.cos(a);
      this.gy[i] = Math.sin(a);
    }
  }

  private dot(ix: number, iy: number, dx: number, dy: number): number {
    const h = this.perm[this.perm[ix] + (iy & (TABLE - 1))];
    return this.gx[h] * dx + this.gy[h] * dy;
  }

  at(x: number, y: number, period: number): number {
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const dx = x - fx;
    const dy = y - fy;
    const x0 = ((fx % period) + period) % period;
    const x1 = x0 + 1 === period ? 0 : x0 + 1;
    const u = dx * dx * dx * (dx * (dx * 6 - 15) + 10);
    const v = dy * dy * dy * (dy * (dy * 6 - 15) + 10);
    const a = this.dot(x0, fy, dx, dy);
    const b = this.dot(x1, fy, dx - 1, dy);
    const c = this.dot(x0, fy + 1, dx, dy - 1);
    const d = this.dot(x1, fy + 1, dx - 1, dy - 1);
    const top = a + (b - a) * u;
    return 1.41 * (top + (c + (d - c) * u - top) * v);
  }

  /** Octaves summed at half the weight and twice the frequency each, in about [-1, 1]. */
  fbm(x: number, y: number, period: number, octaves: number, shift: number): number {
    let sum = 0;
    let weight = 0.5;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      sum += weight * this.at(x * f, y * f + shift + 17 * o, period * f);
      norm += weight;
      weight *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }

  /** Like `fbm`, but each octave folded about zero, so the field breaks into thin bright ridges. */
  ridged(x: number, y: number, period: number, octaves: number, shift: number): number {
    let sum = 0;
    let weight = 0.5;
    let norm = 0;
    let f = 1;
    for (let o = 0; o < octaves; o++) {
      const ridge = 1 - Math.abs(this.at(x * f, y * f + shift + 29 * o, period * f));
      sum += weight * ridge * ridge * ridge;
      norm += weight;
      weight *= 0.5;
      f *= 2;
    }
    return sum / norm;
  }
}

/** Faint near the centre, full from the planets' zone out, and gone at the texture's edge. */
function radialMask(r: number): number {
  const clearing = CLEAR_FLOOR + (1 - CLEAR_FLOOR) * smoothstep(CLEAR_TO, FULL_FROM, r);
  return clearing * (1 - smoothstep(FADE_FROM, 1, r));
}

/**
 * A square nebula field, `size` texels a side, as premultiplied white RGBA: wispy streaks that
 * swirl about the centre, with a clearing in the middle and nothing at the edge. The same seed
 * always gives the same field.
 *
 * The noise runs in polar coordinates, stretched along the circle and twisted with the radius,
 * so the streaks lie tangentially; the circle is a whole number of lattice cells, so the angle
 * wraps without a seam.
 */
export function nebulaField(seed: number, size = FIELD_SIZE): Uint8Array {
  const noise = new RingNoise(seed);
  const field = new Float32Array(size * size);
  const half = size / 2;
  let peak = 0;
  for (let j = 0; j < size; j++) {
    const y = (j + 0.5 - half) / half;
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5 - half) / half;
      const r = Math.hypot(x, y);
      const mask = radialMask(r);
      if (mask <= 0) continue;
      const u = (Math.atan2(y, x) / (2 * Math.PI) + 0.5 + TWIST * r) * TURN_CELLS;
      const v = r * RADIUS_CELLS;
      const wu = u + WARP_TURN * noise.fbm(u, v, TURN_CELLS, 3, 101);
      const wv = v + WARP_RADIUS * noise.fbm(u, v, TURN_CELLS, 3, 211);
      const density = smoothstep(-0.7, 0.7, noise.fbm(wu, wv, TURN_CELLS, OCTAVES, 0));
      const strands = noise.ridged(2 * wu, 3 * wv, 2 * TURN_CELLS, OCTAVES - 1, 307);
      const value = mask * density * density * (0.2 + 0.8 * strands);
      field[j * size + i] = value;
      peak = Math.max(peak, value);
    }
  }
  const out = new Uint8Array(size * size * 4);
  const soft = 1 - Math.exp(-SOFTEN);
  for (let k = 0; k < field.length; k++) {
    const a = Math.round((255 * (1 - Math.exp((-SOFTEN * field[k]) / peak))) / soft);
    out.fill(a, 4 * k, 4 * k + 4);
  }
  return out;
}
