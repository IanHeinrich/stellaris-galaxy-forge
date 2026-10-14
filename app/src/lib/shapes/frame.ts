import type { Pt } from "../geometry/pt";

/** A shape's own frame: its centre, and its rotation in degrees as `Math.atan2` measures them. */
export interface ShapeFrame {
  origin: Pt;
  rotation: number;
}

const RAD = Math.PI / 180;

/** The unit vector at `degrees`. */
export function dir(degrees: number): Pt {
  return { x: Math.cos(degrees * RAD), y: Math.sin(degrees * RAD) };
}

/** The angle from `from` to `to`, in degrees in [0, 360). */
export function angleOf(from: Pt, to: Pt): number {
  return norm360(Math.atan2(to.y - from.y, to.x - from.x) / RAD);
}

/** `degrees` in [0, 360). */
export function norm360(degrees: number): number {
  const d = ((degrees % 360) + 360) % 360;
  return d === 360 ? 0 : d;
}

/** The point `local` names in `frame`, in world coordinates. */
export function toWorld(frame: ShapeFrame, local: Pt): Pt {
  const { x: c, y: s } = dir(frame.rotation);
  return {
    x: frame.origin.x + local.x * c - local.y * s,
    y: frame.origin.y + local.x * s + local.y * c,
  };
}

/** The world point `p` in `frame`'s own coordinates. */
export function toLocal(frame: ShapeFrame, p: Pt): Pt {
  const { x: c, y: s } = dir(frame.rotation);
  const dx = p.x - frame.origin.x;
  const dy = p.y - frame.origin.y;
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a: Pt, b: Pt, t: number): Pt {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
