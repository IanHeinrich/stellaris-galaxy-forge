import type { Pt } from "../geometry/pt";
import { dir, distance, lerp } from "./frame";

/** The sides of a polyline, each as its two ends; a closed one's last side returns to the first. */
function sides(vertices: readonly Pt[], closed: boolean): Array<[Pt, Pt]> {
  const count = closed ? vertices.length : vertices.length - 1;
  return Array.from({ length: Math.max(0, count) }, (_, i) => [
    vertices[i],
    vertices[(i + 1) % vertices.length],
  ]);
}

/**
 * `n` points along the polyline through `vertices`, every corner one of them and the rest
 * shared out so that each side's points sit as evenly as the sides' lengths allow. With fewer
 * points than corners, they are spread evenly along it instead.
 */
export function cornersThenSides(vertices: readonly Pt[], closed: boolean, n: number): Pt[] {
  if (n < vertices.length || vertices.length < 2) return alongPolyline(vertices, closed, n);
  const edges = sides(vertices, closed);
  const lengths = edges.map(([a, b]) => distance(a, b));
  /** Points inside each side, its ends left out. */
  const inner = edges.map(() => 0);
  for (let left = n - vertices.length; left > 0; left--) {
    let widest = 0;
    for (let i = 1; i < edges.length; i++) {
      if (lengths[i] / (inner[i] + 1) > lengths[widest] / (inner[widest] + 1) + 1e-9) widest = i;
    }
    inner[widest]++;
  }
  const out: Pt[] = [];
  edges.forEach(([a, b], i) => {
    for (let k = 0; k <= inner[i]; k++) out.push(lerp(a, b, k / (inner[i] + 1)));
  });
  if (!closed) out.push(vertices[vertices.length - 1]);
  return out;
}

/**
 * `n` points on the circle about `centre`, the first at `from` degrees. A full turn spaces
 * them evenly round it; an arc of `sweep` degrees, anticlockwise, puts one at each end.
 */
export function arcPoints(
  centre: Pt,
  radius: number,
  from: number,
  sweep: number,
  n: number,
): Pt[] {
  if (n <= 0) return [];
  const step = sweep >= 360 ? 360 / n : n > 1 ? sweep / (n - 1) : 0;
  return Array.from({ length: n }, (_, i) => {
    const d = dir(from + i * step);
    return { x: centre.x + radius * d.x, y: centre.y + radius * d.y };
  });
}

/**
 * `n` points evenly spaced by length along the polyline through `points`, starting at its
 * first point. A closed one is spaced round its whole length; an open one ends at its last point.
 */
export function alongPolyline(points: readonly Pt[], closed: boolean, n: number): Pt[] {
  if (n <= 0 || points.length === 0) return [];
  const edges = sides(points, closed);
  const total = edges.reduce((sum, [a, b]) => sum + distance(a, b), 0);
  if (total === 0 || edges.length === 0) return Array.from({ length: n }, () => points[0]);
  const step = closed ? total / n : n > 1 ? total / (n - 1) : 0;
  const out: Pt[] = [];
  let edge = 0;
  let before = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (edge < edges.length - 1 && before + distance(...edges[edge]) < target) {
      before += distance(...edges[edge]);
      edge++;
    }
    const [a, b] = edges[edge];
    const length = distance(a, b);
    out.push(length === 0 ? a : lerp(a, b, Math.min(1, (target - before) / length)));
  }
  return out;
}

/** The length of the polyline through `points`, round to the first again when `closed`. */
export function polylineLength(points: readonly Pt[], closed: boolean): number {
  return sides(points, closed).reduce((sum, [a, b]) => sum + distance(a, b), 0);
}

/** How near `p` comes to the polyline through `points`. */
export function distanceToPolyline(p: Pt, points: readonly Pt[], closed: boolean): number {
  let best = points.length > 0 ? distance(p, points[0]) : Infinity;
  for (const [a, b] of sides(points, closed)) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t =
      len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, distance(p, { x: a.x + t * dx, y: a.y + t * dy }));
  }
  return best;
}
