import type { Graphics } from "pixi.js";

/** A circle traced as `dashes` dashes, each three fifths of its share of the turn; the caller strokes it. */
export function dashedCircle(g: Graphics, x: number, y: number, r: number, dashes: number): void {
  const step = (Math.PI * 2) / dashes;
  for (let i = 0; i < dashes; i++) {
    const start = i * step;
    g.moveTo(x + r * Math.cos(start), y + r * Math.sin(start)).arc(
      x,
      y,
      r,
      start,
      start + step * 0.6,
    );
  }
}
