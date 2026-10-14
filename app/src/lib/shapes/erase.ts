import type { SystemNode } from "../../generated/SystemNode";
import { isSpecialSystem } from "../brush/special";
import { specOf } from "./specs";
import type { Shape } from "./types";

/**
 * The systems inside what `shape`'s fill fills, which an Alt-drag with the Shape tool erases,
 * ascending. As with the Erase brush, a special system is left unless `includeSpecials`. A line
 * has no inside, so it takes none.
 */
export function systemsInside(
  shape: Shape,
  systems: Iterable<SystemNode>,
  includeSpecials: boolean,
): SystemNode[] {
  const spec = specOf(shape);
  const box = spec.bounds(shape);
  const inside: SystemNode[] = [];
  for (const s of systems) {
    if (s.x < box.x0 || s.x > box.x1 || s.y < box.y0 || s.y > box.y1) continue;
    if (!spec.contains(shape, s)) continue;
    if (includeSpecials || !isSpecialSystem(s)) inside.push(s);
  }
  return inside.sort((a, b) => a.id - b.id);
}
