export interface Pt {
  x: number;
  y: number;
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Andrew's monotone chain; 1–2 points are returned as-is, the rest in CCW order. */
export function convexHull(points: Pt[]): Pt[] {
  if (points.length <= 2) return points.slice();
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const n = pts.length;
  const hull: Pt[] = [];
  for (let i = 0; i < n; i++) {
    while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], pts[i]) <= 0) {
      hull.pop();
    }
    hull.push(pts[i]);
  }
  const lower = hull.length + 1;
  for (let i = n - 2; i >= 0; i--) {
    while (
      hull.length >= lower &&
      cross(hull[hull.length - 2], hull[hull.length - 1], pts[i]) <= 0
    ) {
      hull.pop();
    }
    hull.push(pts[i]);
  }
  hull.pop();
  return hull;
}

/** The unit outward normal of edge `a -> b`, or the zero vector for a degenerate edge. */
function edgeNormal(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  return len === 0 ? { x: 0, y: 0 } : { x: dy / len, y: -dx / len };
}

/** Offsets each vertex of a CCW polygon outward by `margin`, along the average of its two edge normals. */
export function expandPolygon(poly: Pt[], margin: number): Pt[] {
  const n = poly.length;
  if (n < 3) return poly.map((p) => ({ x: p.x, y: p.y }));
  return poly.map((cur, i) => {
    const prev = poly[(i - 1 + n) % n];
    const next = poly[(i + 1) % n];
    const n1 = edgeNormal(prev, cur);
    const n2 = edgeNormal(cur, next);
    let nx = n1.x + n2.x;
    let ny = n1.y + n2.y;
    const len = Math.hypot(nx, ny);
    if (len > 1e-9) {
      nx /= len;
      ny /= len;
    } else {
      nx = n1.x;
      ny = n1.y;
    }
    return { x: cur.x + nx * margin, y: cur.y + ny * margin };
  });
}
