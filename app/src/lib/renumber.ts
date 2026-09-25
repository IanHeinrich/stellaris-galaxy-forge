/**
 * An edit's renumbering, `[before, after]` pairs read together: `after` is null for a system the
 * edit removed. Each id maps to the id it now has, null when its system is gone.
 */
export type Renumbering = ReadonlyArray<readonly [number, number | null]>;

/** Where `id` went: itself when the edit left it alone. */
export function renumberedId(pairs: Renumbering, id: number): number | null {
  for (const [before, after] of pairs) if (before === id) return after;
  return id;
}

/** `ids` as the edit left them, the removed ones dropped; the same array when nothing moved. */
export function renumberedIds(pairs: Renumbering, ids: readonly number[]): number[] {
  const next: number[] = [];
  let moved = false;
  for (const id of ids) {
    const after = renumberedId(pairs, id);
    if (after !== id) moved = true;
    if (after !== null) next.push(after);
  }
  return moved ? next : (ids as number[]);
}

/** A lane as the edit left it, its ends kept `a < b`; null when either end is gone. */
export function renumberedLane<L extends { a: number; b: number }>(
  pairs: Renumbering,
  lane: L,
): L | null {
  const a = renumberedId(pairs, lane.a);
  const b = renumberedId(pairs, lane.b);
  if (a === null || b === null) return null;
  if (a === lane.a && b === lane.b) return lane;
  return { ...lane, a: Math.min(a, b), b: Math.max(a, b) };
}
