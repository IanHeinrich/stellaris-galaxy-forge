import Delaunator from "delaunator";
import { comparePairs, pairOf, type Pair } from "./pairs";
import { dist2 } from "./pt";
import { UnionFind } from "./unionFind";

export interface MeshPoint {
  id: number;
  x: number;
  y: number;
}

/** The Gabriel graph, whose β is 1. */
export const DEFAULT_LANE_DENSITY = 0.47;

/** Critical β is worked out only this far; past it the β regions are wide and every edge ties. */
const BETA_CAP = 8;

/** Which of `edges` the Euclidean minimum spanning tree of `points` takes. */
function spanningTree(points: readonly MeshPoint[], edges: readonly DelaunayEdge[]): boolean[] {
  const length = edges.map(({ i, j }) => dist2(points[i], points[j]));
  const pair = edges.map(({ i, j }) => pairOf(points[i].id, points[j].id));
  const byLength = edges
    .map((_, k) => k)
    .sort((k, l) => length[k] - length[l] || comparePairs(pair[k], pair[l]));
  const sets = new UnionFind(points.length);
  const inTree = edges.map(() => false);
  for (const k of byLength) inTree[k] = sets.union(edges[k].i, edges[k].j);
  return inTree;
}

/**
 * The lanes a mesh over `points` keeps at `density` in [0, 1], as [id, id] pairs with a < b:
 * the Euclidean minimum spanning tree, and every other Delaunay edge the β-skeleton keeps at
 * `betaOfDensity(density)`. 0 keeps the tree alone and 1 every Delaunay edge.
 */
export function meshPairs(points: readonly MeshPoint[], density: number): Pair[] {
  if (density >= 1) return delaunayPairs(points);
  const edges = delaunayEdges(points);
  const inTree = spanningTree(points, edges);
  const cut = betaOfDensity(density);
  const index = cut === Infinity || inTree.every(Boolean) ? null : new PointIndex(points);
  // Lattice edges tie up to rounding, so a tolerance keeps or drops each tied group whole.
  const kept = (k: number) =>
    inTree[k] || (index !== null && criticalBeta(points, index, edges[k]) >= cut * (1 - 1e-9));
  return edges
    .filter((_, k) => kept(k))
    .map(({ i, j }) => pairOf(points[i].id, points[j].id))
    .sort(comparePairs);
}

/**
 * The β cut at each Lane density: the share of the edges outside the spanning tree whose
 * critical β is at least the cut, measured over random spreads, so each step of the slider
 * adds about as many lanes.
 */
const BETA_OF_DENSITY: ReadonlyArray<readonly [number, number]> = [
  [0, 8],
  [0.05, 3.4],
  [0.1, 2.31],
  [0.2, 1.66],
  [0.3, 1.34],
  [0.4, 1.12],
  [0.47, 1],
  [0.6, 0.994],
  [0.7, 0.977],
  [0.8, 0.942],
  [0.9, 0.845],
  [0.95, 0.72],
  [0.99, 0.29],
  [1, 0.13],
];

/** The β-skeleton cut at `density`: Infinity at 0, 0 at 1, log-linear between the table's rows. */
export function betaOfDensity(density: number): number {
  if (density <= 0) return Infinity;
  if (density >= 1) return 0;
  const at = BETA_OF_DENSITY.findIndex(([d]) => d >= density);
  const [d0, b0] = BETA_OF_DENSITY[at - 1];
  const [d1, b1] = BETA_OF_DENSITY[at];
  return b0 * (b1 / b0) ** ((density - d0) / (d1 - d0));
}

/** The density whose cut is `beta`, for a β the slider stored before it kept a density. */
export function densityOfBeta(beta: number): number {
  if (beta >= BETA_OF_DENSITY[0][1]) return 0;
  const at = BETA_OF_DENSITY.findIndex(([, b]) => b <= beta);
  if (at === -1) return 1;
  const [d0, b0] = BETA_OF_DENSITY[at - 1];
  const [d1, b1] = BETA_OF_DENSITY[at];
  return d0 + ((d1 - d0) * Math.log(beta / b0)) / Math.log(b1 / b0);
}

/** Every Delaunay edge of `points`, as [id, id] pairs with a < b. */
export function delaunayPairs(points: readonly MeshPoint[]): Pair[] {
  return delaunayEdges(points)
    .map(({ i, j }) => pairOf(points[i].id, points[j].id))
    .sort(comparePairs);
}

/** A Delaunay edge as indices into the points, with the third corner of each triangle on it, or -1. */
interface DelaunayEdge {
  i: number;
  j: number;
  left: number;
  right: number;
}

/** Each undirected triangle edge once; collinear input yields the hull chain. */
function delaunayEdges(points: readonly MeshPoint[]): DelaunayEdge[] {
  if (points.length < 2) return [];
  const delaunay = new Delaunator(points.flatMap((p) => [p.x, p.y]));
  const { triangles, halfedges, hull } = delaunay;
  const edges: DelaunayEdge[] = [];
  if (triangles.length === 0) {
    for (let k = 1; k < hull.length; k++) {
      edges.push({ i: hull[k - 1], j: hull[k], left: -1, right: -1 });
    }
    return edges;
  }
  const opposite = (e: number) => triangles[e % 3 === 0 ? e + 2 : e - 1];
  for (let e = 0; e < triangles.length; e++) {
    const twin = halfedges[e];
    if (twin !== -1 && twin < e) continue;
    const next = e % 3 === 2 ? e - 2 : e + 1;
    edges.push({
      i: triangles[e],
      j: triangles[next],
      left: opposite(e),
      right: twin === -1 ? -1 : opposite(twin),
    });
  }
  return edges;
}

/**
 * The largest β, up to `BETA_CAP`, at which no other point lies strictly inside the β region of
 * the edge. The regions grow with β, so the edge's own triangle corners bound it and only the
 * points inside the region at that bound can lower it. Below 1 the bound is exact: no point
 * outside a triangle's empty circumcircle sees the edge at a wider angle than its corner.
 */
function criticalBeta(points: readonly MeshPoint[], index: PointIndex, edge: DelaunayEdge): number {
  const { i, j, left, right } = edge;
  const a = points[i];
  const b = points[j];
  const corner = (k: number) => (k === -1 ? Infinity : blockingBeta(a, b, points[k]));
  let beta = Math.min(corner(left), corner(right), BETA_CAP);
  if (beta <= 1) return beta;
  // Within the strip across the edge, as far out as the region reaches at its midpoint.
  const reach = (Math.sqrt(2 * beta - 1) / 2) * (1 + 1e-9);
  const rx = reach * Math.abs(b.y - a.y);
  const ry = reach * Math.abs(b.x - a.x);
  index.each(
    Math.min(a.x, b.x) - rx,
    Math.min(a.y, b.y) - ry,
    Math.max(a.x, b.x) + rx,
    Math.max(a.y, b.y) + ry,
    (k) => {
      if (k !== i && k !== j) beta = Math.min(beta, blockingBeta(a, b, points[k]));
    },
  );
  return beta;
}

/**
 * The β above which `p` lies strictly inside the β region of edge ab: below 1, the lens of two
 * discs through both ends, which holds `p` once β exceeds the sine of the angle apb; from 1,
 * the lune of two discs through one end each. Infinity when `p` is outside the strip across ab.
 */
function blockingBeta(a: MeshPoint, b: MeshPoint, p: MeshPoint): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const ux = p.x - a.x;
  const uy = p.y - a.y;
  const wx = p.x - b.x;
  const wy = p.y - b.y;
  const along = ux * vx + uy * vy;
  const back = -(wx * vx + wy * vy);
  if (along <= 0 || back <= 0) return Infinity;
  const uu = ux * ux + uy * uy;
  const ww = wx * wx + wy * wy;
  if (ux * wx + uy * wy < 0) return Math.abs(ux * wy - uy * wx) / Math.sqrt(uu * ww);
  return Math.max(uu / along, ww / back);
}

/** Caps the cells along the grid's longer side, so a thin spread of points still gets a small grid. */
const MAX_CELLS_ACROSS = 2048;

/** The indices of `points` bucketed in a uniform grid of about one point per cell. */
class PointIndex {
  private readonly x0: number;
  private readonly y0: number;
  private readonly cell: number;
  private readonly cols: number;
  private readonly rows: number;
  private readonly start: Int32Array;
  private readonly items: Int32Array;

  constructor(points: readonly MeshPoint[]) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of points) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    const w = x1 - x0;
    const h = y1 - y0;
    this.x0 = x0;
    this.y0 = y0;
    this.cell =
      Math.max(Math.sqrt((w * h) / points.length), Math.max(w, h) / MAX_CELLS_ACROSS) || 1;
    this.cols = Math.floor(w / this.cell) + 1;
    this.rows = Math.floor(h / this.cell) + 1;
    const cells = points.map((p) => this.col(p.x) * this.rows + this.row(p.y));
    this.start = new Int32Array(this.cols * this.rows + 1);
    for (const c of cells) this.start[c + 1]++;
    for (let c = 0; c < this.cols * this.rows; c++) this.start[c + 1] += this.start[c];
    const next = this.start.slice(0, -1);
    this.items = new Int32Array(points.length);
    cells.forEach((c, i) => {
      this.items[next[c]++] = i;
    });
  }

  /** Calls `visit` with every point in the cells the box touches. */
  each(minX: number, minY: number, maxX: number, maxY: number, visit: (i: number) => void): void {
    const c0 = Math.max(0, this.col(minX));
    const c1 = Math.min(this.cols - 1, this.col(maxX));
    const r0 = Math.max(0, this.row(minY));
    const r1 = Math.min(this.rows - 1, this.row(maxY));
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const cell = c * this.rows + r;
        for (let k = this.start[cell]; k < this.start[cell + 1]; k++) {
          visit(this.items[k]);
        }
      }
    }
  }

  private col(x: number): number {
    return Math.floor((x - this.x0) / this.cell);
  }

  private row(y: number): number {
    return Math.floor((y - this.y0) / this.cell);
  }
}
