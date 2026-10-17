import { SAVE_X_SIGN, SAVE_Y_SIGN } from "./geometry";
import type { Pt } from "./pt";

/**
 * `p` turned about `pivot` by `degrees`, positive clockwise as the map shows it. The map mirrors
 * world x, so the turn in world coordinates takes the sign of `SAVE_X_SIGN * SAVE_Y_SIGN`.
 */
export function rotateAbout(p: Pt, pivot: Pt, degrees: number): Pt {
  const turn = ((SAVE_X_SIGN * SAVE_Y_SIGN * degrees) / 180) * Math.PI;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const dx = p.x - pivot.x;
  const dy = p.y - pivot.y;
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
}

/** The centre of the box round the systems of `ids` that exist; null when none does. */
export function selectionCentre(
  systems: ReadonlyMap<number, Pt>,
  ids: readonly number[],
): Pt | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const id of ids) {
    const s = systems.get(id);
    if (!s) continue;
    x0 = Math.min(x0, s.x);
    y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x);
    y1 = Math.max(y1, s.y);
  }
  return x0 === Infinity ? null : { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** The convex hull of `points`, anticlockwise in world coordinates, without collinear points. */
export function convexHull(points: readonly Pt[]): Pt[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const ON_EDGE = 1e-6;

/** Whether `p` lies inside or on `hull`, as `convexHull` returns it; a two-point hull is a segment. */
export function inConvexHull(p: Pt, hull: readonly Pt[]): boolean {
  if (hull.length === 0) return false;
  if (hull.length === 1) return hull[0].x === p.x && hull[0].y === p.y;
  if (hull.length === 2) {
    const [a, b] = hull;
    const along = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
    const length2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    return Math.abs(cross(a, b, p)) <= ON_EDGE && along >= 0 && along <= length2;
  }
  return hull.every((a, i) => cross(a, hull[(i + 1) % hull.length], p) >= -ON_EDGE);
}
