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

/**
 * The mean position of the systems of `ids` that exist, which a turn about it leaves where it is;
 * null when none does.
 */
export function selectionCentroid(
  systems: ReadonlyMap<number, Pt>,
  ids: readonly number[],
): Pt | null {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const id of ids) {
    const s = systems.get(id);
    if (!s) continue;
    x += s.x;
    y += s.y;
    count++;
  }
  return count === 0 ? null : { x: x / count, y: y / count };
}
