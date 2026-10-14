import type { Graphics } from "pixi.js";
import type { Pt } from "../../../lib/geometry/pt";
import type { Segment } from "../../../lib/geometry/segments";
import { ACCENT_COLOR } from "../../../lib/visual/style";

/** A new lane's line. */
const LANE = { color: ACCENT_COLOR, alpha: 0.9 };
/** A new system's dot radius, in screen pixels. */
const DOT_PX = 3;
const RING_PX = 7;

/** `lanes` as one-pixel lines in the lane style. */
export function drawLanes(g: Graphics, lanes: readonly Segment[]): void {
  for (const { a, b } of lanes) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  if (lanes.length > 0) g.stroke({ ...LANE, pixelLine: true });
}

/** New systems as accent dots, `px` world units to a screen pixel. */
export function drawDots(g: Graphics, points: readonly Pt[], px: number): void {
  for (const s of points) g.circle(s.x, s.y, DOT_PX * px);
  if (points.length > 0) g.fill({ color: ACCENT_COLOR, alpha: 0.9 });
}

/** Rings in `color` round existing systems, `px` world units to a screen pixel. */
export function drawRings(g: Graphics, points: readonly Pt[], color: number, px: number): void {
  for (const s of points) g.circle(s.x, s.y, RING_PX * px);
  if (points.length > 0) g.stroke({ color, alpha: 0.9, width: 2 * px });
}
