import type { Nebula } from "../generated/Nebula";
import type { SystemNode } from "../generated/SystemNode";
import type { Systems } from "./RenderContext";

/** A world-space box, `minX <= maxX` and `minY <= maxY`. */
export interface Frame {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * What Shift+F frames: the selected systems, or the selected nebula's ring when no system is
 * selected; null when neither is, and the whole galaxy is fitted instead. `yOf` is where a
 * system draws, which a tilt lifts off its own y.
 */
export function selectionFrame(
  systems: Systems,
  selection: readonly number[],
  nebula: Nebula | undefined,
  yOf: (s: SystemNode) => number = (s) => s.y,
): Frame | null {
  const frame = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const take = (x: number, y: number, r = 0) => {
    frame.minX = Math.min(frame.minX, x - r);
    frame.minY = Math.min(frame.minY, y - r);
    frame.maxX = Math.max(frame.maxX, x + r);
    frame.maxY = Math.max(frame.maxY, y + r);
  };
  for (const id of selection) {
    const s = systems.get(id);
    if (s) take(s.x, yOf(s));
  }
  if (frame.minX === Infinity && nebula) take(nebula.x, nebula.y, nebula.radius);
  return frame.minX === Infinity ? null : frame;
}
