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
  if (vertices.length < 2) return alongPolyline(vertices, closed, n);
  return cornersThenPieces(sides(vertices, closed), closed, n);
}

/** The chain of `pieces` as one polyline, each corner once. */
function chained(pieces: ReadonlyArray<readonly Pt[]>, closed: boolean): Pt[] {
  const out = pieces.flatMap((piece) => piece.slice(0, -1));
  const last = pieces[pieces.length - 1];
  if (!closed && last) out.push(last[last.length - 1]);
  return out;
}

/**
 * `n` points along a chain of `pieces`, each a polyline from one corner to the next, every
 * corner one of them and the rest shared out so that each piece's points sit as evenly as the
 * pieces' lengths allow. A closed chain's last piece ends where its first starts. With fewer
 * points than corners, they are spread evenly along it instead.
 */
export function cornersThenPieces(
  pieces: ReadonlyArray<readonly Pt[]>,
  closed: boolean,
  n: number,
): Pt[] {
  const corners = closed ? pieces.length : pieces.length + 1;
  if (n < corners) return alongPolyline(chained(pieces, closed), closed, n);
  const lengths = pieces.map((piece) => polylineLength(piece, false));
  /** Points inside each piece, its ends left out. */
  const inner = pieces.map(() => 0);
  for (let left = n - corners; left > 0; left--) {
    let widest = 0;
    for (let i = 1; i < pieces.length; i++) {
      if (lengths[i] / (inner[i] + 1) > lengths[widest] / (inner[widest] + 1) + 1e-9) widest = i;
    }
    inner[widest]++;
  }
  const out: Pt[] = [];
  pieces.forEach((piece, i) => {
    if (piece.length === 2) {
      for (let k = 0; k <= inner[i]; k++) out.push(lerp(piece[0], piece[1], k / (inner[i] + 1)));
    } else {
      out.push(...alongPolyline(piece, false, inner[i] + 2).slice(0, -1));
    }
  });
  if (!closed) out.push(...chained(pieces, false).slice(-1));
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
