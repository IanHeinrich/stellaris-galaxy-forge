import type { Pt } from "./pt";
import { copies, counterpartAt, imageOf, type NearestIndex, type Symmetry } from "./symmetry";

/** One point of an orbit, where it stood when the orbit was found. */
export interface OrbitMember {
  id: number;
  x: number;
  y: number;
  /** The copy this member is of its orbit's lead. */
  k: number;
}

/** A point and its counterparts under a symmetry, which move together. */
export interface Orbit {
  lead: OrbitMember;
  members: OrbitMember[];
  /**
   * The copies that put the lead back on itself, 0 among them: more than one for a point on a
   * mirror's axis or at the centre of a rotation.
   */
  fixedBy: number[];
}

/**
 * Point `id` and each counterpart `index` finds for it under `sym`, as one orbit led by `id`;
 * null when `points` lacks it or `taken` already holds it. Every member joins `taken`.
 */
export function orbitOf(
  id: number,
  points: ReadonlyMap<number, Pt>,
  index: NearestIndex | null,
  sym: Symmetry,
  taken: Set<number>,
): Orbit | null {
  const p = points.get(id);
  if (!p || taken.has(id)) return null;
  const lead = { id, x: p.x, y: p.y, k: 0 };
  const members = [lead];
  const fixedBy = [0];
  taken.add(id);
  for (let k = 1; k < copies(sym); k++) {
    const c = index && counterpartAt(index, p, sym, k);
    if (c === id) fixedBy.push(k);
    if (c === null || taken.has(c)) continue;
    const at = points.get(c)!;
    members.push({ id: c, x: at.x, y: at.y, k });
    taken.add(c);
  }
  return { lead, members, fixedBy };
}

/**
 * The points of `ids` grouped with their counterparts, one orbit each, led by the first of its
 * points in `ids`.
 */
export function orbitsOf(
  ids: readonly number[],
  points: ReadonlyMap<number, Pt>,
  index: NearestIndex | null,
  sym: Symmetry,
): Orbit[] {
  const taken = new Set<number>();
  return ids.flatMap((id) => orbitOf(id, points, index, sym, taken) ?? []);
}

/**
 * How copy `k` of `orbit` moves when its lead is moved by `d`. The lead keeps only the part of
 * `d` its own images agree on, so a point on a mirror's axis slides along it and the centre of a
 * rotation stays put.
 */
export function memberShift(orbit: Orbit, d: Pt, sym: Symmetry, k: number): Pt {
  let x = 0;
  let y = 0;
  for (const j of orbit.fixedBy) {
    const e = imageOf(d, sym, j);
    x += e.x;
    y += e.y;
  }
  const n = orbit.fixedBy.length;
  return imageOf({ x: x / n, y: y / n }, sym, k);
}
