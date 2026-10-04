/** The smooth-min's softness, fitted to the holes and corridors of the game's borders. */
export const SOFTNESS = 0.155;
/** Entries of the falloff table per unit of distance over softness. */
export const FALLOFF_STEPS = 256;

/** A system or a lane, and how its influence falls off. */
export interface Source {
  ax: number;
  ay: number;
  dx: number;
  dy: number;
  /** 1 / length², 0 for a system. */
  invLen2: number;
  /** Turns a distance into a position in the falloff table. */
  scale: number;
  /** The table position at the source's reach, beyond which it gives nothing. */
  limit: number;
  /** The reach in world units, a texel more than the falloff's so a border's neighbours share it. */
  reach: number;
  code: number;
  tiles: number[];
}

export function laneKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** By owner, then by place, so a tile sums its sources in the same order however it got them. */
export function bySource(a: Source, b: Source): number {
  return a.code - b.code || a.ax - b.ax || a.ay - b.ay || a.dx - b.dx || a.dy - b.dy;
}

export function pointSegmentDist2(px: number, py: number, s: Source): number {
  const rx = px - s.ax;
  const ry = py - s.ay;
  let t = (rx * s.dx + ry * s.dy) * s.invLen2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = rx - t * s.dx;
  const ey = ry - t * s.dy;
  return ex * ex + ey * ey;
}

/** The squared distance from the source's segment to the rectangle, 0 where they meet. */
export function segmentRectDist2(
  s: Source,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  if (crossesRect(s, x0, y0, x1, y1)) return 0;
  const bx = s.ax + s.dx;
  const by = s.ay + s.dy;
  return Math.min(
    pointRectDist2(s.ax, s.ay, x0, y0, x1, y1),
    pointRectDist2(bx, by, x0, y0, x1, y1),
    pointSegmentDist2(x0, y0, s),
    pointSegmentDist2(x1, y0, s),
    pointSegmentDist2(x0, y1, s),
    pointSegmentDist2(x1, y1, s),
  );
}

function pointRectDist2(px: number, py: number, x0: number, y0: number, x1: number, y1: number) {
  const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
  const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
  return dx * dx + dy * dy;
}

/** Liang–Barsky: whether any of the segment lies in the rectangle. */
function crossesRect(s: Source, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0;
  let t1 = 1;
  const sides: [number, number][] = [
    [-s.dx, s.ax - x0],
    [s.dx, x1 - s.ax],
    [-s.dy, s.ay - y0],
    [s.dy, y1 - s.ay],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}
