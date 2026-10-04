import type { Pt } from "./pt";

/** Multipolygon: polygons → rings (the outer ring, then its holes) → unclosed points. */
export type Region = Pt[][][];

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The ring's area, negative for an anticlockwise ring. */
export function ringArea(ring: readonly Pt[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j].x + ring[i].x) * (ring[j].y - ring[i].y);
  }
  return sum / 2;
}

/** Whether `p` lies inside `ring`, by the even-odd rule. */
export function inRing(p: Pt, ring: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

export function boxOf(ring: readonly Pt[]): Rect {
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of ring) {
    if (p.x < box.x0) box.x0 = p.x;
    if (p.y < box.y0) box.y0 = p.y;
    if (p.x > box.x1) box.x1 = p.x;
    if (p.y > box.y1) box.y1 = p.y;
  }
  return box;
}

/** Anticlockwise rings as outer rings, each clockwise one a hole in the smallest that holds it. */
export function grouped(rings: Pt[][]): Region {
  const outers: { ring: Pt[]; area: number; box: Rect }[] = [];
  const holes: Pt[][] = [];
  for (const ring of rings) {
    const area = ringArea(ring);
    if (area < 0) outers.push({ ring, area: -area, box: boxOf(ring) });
    else holes.push(ring);
  }
  outers.sort((a, b) => a.area - b.area);
  const region: Region = outers.map((o) => [o.ring]);
  for (const hole of holes) {
    const p = hole[0];
    const at = outers.findIndex(
      ({ ring, box }) =>
        p.x >= box.x0 && p.x <= box.x1 && p.y >= box.y0 && p.y <= box.y1 && inRing(p, ring),
    );
    if (at >= 0) region[at].push(hole);
  }
  return region;
}

/**
 * The territory less its inner part, as `trimmedInner` leaves it: the band, as polygons with
 * holes. The inner region's rings are turned round, so its outer rings become the band's holes
 * and its holes, which hold the territory's own, become outer rings of the band.
 */
export function bandOf(territory: Region, inner: Region): Region {
  const rings = territory.flat();
  for (const ring of inner.flat()) rings.push([...ring].reverse());
  return grouped(rings);
}

/**
 * The inner part without the holes that hold none of the territory's own. Where the field runs
 * shallow in a sparse middle, the band's inner edge can close round a patch that is no hole of
 * the territory, and the game draws no band there.
 */
export function trimmedInner(territory: Region, inner: Region): Region {
  const holes = territory.flatMap((polygon) => polygon.slice(1));
  return inner.map(([outer, ...rest]) => [
    outer,
    ...rest.filter((ring) => holes.some((hole) => inRing(hole[0], ring))),
  ]);
}
