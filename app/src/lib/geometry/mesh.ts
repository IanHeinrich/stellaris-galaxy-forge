import Delaunator from "delaunator";

export interface MeshPoint {
  id: number;
  x: number;
  y: number;
}

/** Slider range: β=2 is the relative-neighbourhood graph, β=1 the Gabriel graph, smaller is denser. */
export const MESH_BETA = { sparse: 2, gabriel: 1, dense: 0.1 } as const;

/** β-skeleton edges over the Delaunay triangulation of `points`, as [id, id] pairs with id order a < b. */
export function meshPairs(points: MeshPoint[], beta: number): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (const [i, j] of delaunayEdges(points)) {
    if (beta <= MESH_BETA.dense || !blocked(points, i, j, beta)) {
      const a = points[i].id;
      const b = points[j].id;
      pairs.push(a < b ? [a, b] : [b, a]);
    }
  }
  return pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

/** Each undirected triangle edge once, as index pairs; collinear input yields the hull chain. */
function delaunayEdges(points: MeshPoint[]): Array<[number, number]> {
  if (points.length < 2) return [];
  const delaunay = Delaunator.from(
    points,
    (p) => p.x,
    (p) => p.y,
  );
  const { triangles, halfedges, hull } = delaunay;
  const edges: Array<[number, number]> = [];
  if (triangles.length === 0) {
    for (let k = 1; k < hull.length; k++) edges.push([hull[k - 1], hull[k]]);
    return edges;
  }
  for (let e = 0; e < triangles.length; e++) {
    if (halfedges[e] !== -1 && halfedges[e] < e) continue;
    const next = e % 3 === 2 ? e - 2 : e + 1;
    edges.push([triangles[e], triangles[next]]);
  }
  return edges;
}

/** True when some other point lies strictly inside both discs of the β region of edge (i, j). */
function blocked(points: MeshPoint[], i: number, j: number, beta: number): boolean {
  const a = points[i];
  const b = points[j];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  let c1x: number;
  let c1y: number;
  let c2x: number;
  let c2y: number;
  let r2: number;
  // β ≥ 1: the lune of two discs through one endpoint each; below 1: two discs through both.
  if (beta >= 1) {
    const h = beta / 2;
    c1x = a.x + h * dx;
    c1y = a.y + h * dy;
    c2x = b.x - h * dx;
    c2y = b.y - h * dy;
    r2 = h * h * d2;
  } else {
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const k = Math.sqrt(1 / (4 * beta * beta) - 1 / 4);
    c1x = mx - k * dy;
    c1y = my + k * dx;
    c2x = mx + k * dy;
    c2y = my - k * dx;
    r2 = d2 / (4 * beta * beta);
  }
  for (let p = 0; p < points.length; p++) {
    if (p === i || p === j) continue;
    const { x, y } = points[p];
    const e1x = x - c1x;
    const e1y = y - c1y;
    if (e1x * e1x + e1y * e1y >= r2) continue;
    const e2x = x - c2x;
    const e2y = y - c2y;
    if (e2x * e2x + e2y * e2y < r2) return true;
  }
  return false;
}
