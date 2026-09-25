import type { Graphics } from "pixi.js";

// Pixi strokes no dashes, so every dashed shape on the map is traced here and the caller strokes it.

interface At {
  x: number;
  y: number;
}

/** The share of each dash step that is ink on the map's dashed circles. */
const DASH_INK = 0.6;

/** A circle traced as `dashes` dashes, each `ink` of its share of the turn, the first at angle 0. */
export function dashedCircle(
  g: Graphics,
  x: number,
  y: number,
  r: number,
  dashes: number,
  ink = DASH_INK,
): void {
  const step = (Math.PI * 2) / dashes;
  for (let i = 0; i < dashes; i++) {
    const start = i * step;
    g.moveTo(x + r * Math.cos(start), y + r * Math.sin(start)).arc(
      x,
      y,
      r,
      start,
      start + step * ink,
    );
  }
}

/**
 * A straight from `a` to `b` as `dash` world units of ink then `gap` of none, the last dash cut
 * short at `b`, or run on to it with `toEnd`.
 */
export function dashedLine(
  g: Graphics,
  a: At,
  b: At,
  dash: number,
  gap: number,
  toEnd = false,
): void {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length === 0) return;
  const ux = (b.x - a.x) / length;
  const uy = (b.y - a.y) / length;
  for (let at = 0; at < length; at += dash + gap) {
    const last = at + dash + gap >= length;
    const end = last && toEnd ? length : Math.min(at + dash, length);
    g.moveTo(a.x + ux * at, a.y + uy * at).lineTo(a.x + ux * end, a.y + uy * end);
  }
}

/**
 * A straight from `a` to `b` in whole steps of about `dash` plus `gap`, stretched to fit, so the
 * pattern starts and ends at the two ends at every zoom.
 */
export function evenDashedLine(g: Graphics, a: At, b: At, dash: number, gap: number): void {
  const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / (dash + gap)));
  const dx = (b.x - a.x) / steps;
  const dy = (b.y - a.y) / steps;
  const ink = dash / (dash + gap);
  for (let i = 0; i < steps; i++) {
    const x = a.x + dx * i;
    const y = a.y + dy * i;
    g.moveTo(x, y).lineTo(x + dx * ink, y + dy * ink);
  }
}
