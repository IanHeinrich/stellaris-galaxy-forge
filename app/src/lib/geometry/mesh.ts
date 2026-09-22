import Delaunator from "delaunator";

export interface MeshPoint {
  id: number;
  x: number;
  y: number;
}

/** Slider range: β=2 is the relative-neighbourhood graph, β=1 the Gabriel graph, smaller is denser. */
export const MESH_BETA = { sparse: 2, gabriel: 1, dense: 0.1 } as const;

const LOG_SPARSE = Math.log(MESH_BETA.sparse);
const LOG_SPAN = Math.log(MESH_BETA.dense) - LOG_SPARSE;

/** Slider position in [0, 1] to β, linear in log β so the Gabriel graph sits mid-slider. */
export function betaOfSlider(v: number): number {
  if (v <= 0) return MESH_BETA.sparse;
  if (v >= 1) return MESH_BETA.dense;
  return Math.exp(LOG_SPARSE + v * LOG_SPAN);
}

export function sliderOfBeta(beta: number): number {
  return (Math.log(beta) - LOG_SPARSE) / LOG_SPAN;
}

/** β-skeleton edges over the Delaunay triangulation of `points`, as [id, id] pairs with id order a < b. */
export function meshPairs(points: MeshPoint[], beta: number): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const edges = delaunayEdges(points);
  const index = beta <= MESH_BETA.dense || edges.length === 0 ? null : new PointIndex(points);
  for (const [i, j] of edges) {
    if (index === null || !blocked(points, index, i, j, beta)) {
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

  /** Whether `test` holds for some point in the cells the box touches. */
  some(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    test: (i: number) => boolean,
  ): boolean {
    const c0 = Math.max(0, this.col(minX));
    const c1 = Math.min(this.cols - 1, this.col(maxX));
    const r0 = Math.max(0, this.row(minY));
    const r1 = Math.min(this.rows - 1, this.row(maxY));
    for (let c = c0; c <= c1; c++) {
      for (let r = r0; r <= r1; r++) {
        const cell = c * this.rows + r;
        for (let k = this.start[cell]; k < this.start[cell + 1]; k++) {
          if (test(this.items[k])) return true;
        }
      }
    }
    return false;
  }

  private col(x: number): number {
    return Math.floor((x - this.x0) / this.cell);
  }

  private row(y: number): number {
    return Math.floor((y - this.y0) / this.cell);
  }
}

/** True when some other point lies strictly inside both discs of the β region of edge (i, j). */
function blocked(
  points: readonly MeshPoint[],
  index: PointIndex,
  i: number,
  j: number,
  beta: number,
): boolean {
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
  // Padded so rounding in the root never shrinks the box inside the discs it bounds.
  const r = Math.sqrt(r2) * (1 + 1e-9);
  return index.some(
    Math.max(c1x, c2x) - r,
    Math.max(c1y, c2y) - r,
    Math.min(c1x, c2x) + r,
    Math.min(c1y, c2y) + r,
    (p) => {
      if (p === i || p === j) return false;
      const { x, y } = points[p];
      const e1x = x - c1x;
      const e1y = y - c1y;
      if (e1x * e1x + e1y * e1y >= r2) return false;
      const e2x = x - c2x;
      const e2y = y - c2y;
      return e2x * e2x + e2y * e2y < r2;
    },
  );
}
