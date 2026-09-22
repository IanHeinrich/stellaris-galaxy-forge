import type { Pt } from "../geometry/pt";

/** Stamps sit at most this fraction of the radius apart, so a swept edge stays round. */
export const STAMP_STEP = 0.25;

/**
 * The stamps a move from `prev` to `next` adds: evenly spaced at most `r * STAMP_STEP` apart,
 * the last on `next`, none on `prev`. A drag's stamps are the concatenation over its moves,
 * with `prev` null for the first.
 */
export function stampsAlong(prev: Pt | null, next: Pt, r: number): Pt[] {
  if (prev === null) return [{ x: next.x, y: next.y }];
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const n = Math.ceil(Math.hypot(dx, dy) / (r * STAMP_STEP));
  const stamps: Pt[] = [];
  for (let i = 1; i <= n; i++) stamps.push({ x: prev.x + (dx * i) / n, y: prev.y + (dy * i) / n });
  return stamps;
}

/** Whether `p` lies in the union of the discs of radius `r` about the stamps, edge included. */
export function inStroke(p: Pt, stamps: readonly Pt[], r: number): boolean {
  const r2 = r * r;
  return stamps.some((s) => {
    const dx = s.x - p.x;
    const dy = s.y - p.y;
    return dx * dx + dy * dy <= r2;
  });
}
