export interface Pt {
  x: number;
  y: number;
}

/** The squared distance between two points. */
export function dist2(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * `v` to the five decimals a file keeps, as it reads back once written. An exact tie, which a
 * binary fraction such as 1/64 can be, goes to the even digit as the core's writer rounds it.
 */
export function asWritten(v: number): number {
  const t = v * 200_000;
  if (Number.isInteger(t) && t % 2 !== 0 && t % 3125 === 0 && t / 200_000 === v) {
    const down = (t - 1) / 2;
    return (down % 2 === 0 ? down : down + 1) / 1e5 || 0;
  }
  return Number(v.toFixed(5)) || 0;
}

/** `p` as it reads back once written, each coordinate `asWritten`. */
export function writtenPt(p: Pt): Pt {
  return { x: asWritten(p.x), y: asWritten(p.y) };
}

/** How far writing two points can move the distance between them: half a last decimal on each coordinate, with room for float noise. */
export const WRITTEN_DRIFT = 2e-5;
