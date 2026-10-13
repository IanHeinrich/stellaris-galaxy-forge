import { DRAG_HINTS, type GeometryIntent } from "../../lib/details/orbitIntent";
import { near, polar, polarAbout, wrapDegrees } from "../../lib/details/orbits";
import type { Pt } from "../../lib/geometry/pt";
import type { SystemContext } from "./context";
import { drawnDisc } from "./geometry";
import type { BodyLook } from "./look";

/** Within this many screen pixels of another ring about the same centre, a drag takes its radius. */
export const SHARED_SNAP_PX = 6;
/** How far past its drawn disc, in screen pixels, a body takes a dragged thing. */
const CAPTURE_PAST_PX = 10;
/** The least reach, in screen pixels, at which a body takes a dragged thing. */
const CAPTURE_MIN_PX = 18;
/** The angle steps Shift snaps to, in degrees. */
const SHIFT_STEP_DEG = 15;

/** A handle the scene draws on a belt or the inner radius, which a drag moves. */
export type HandleRef =
  { readonly kind: "belt"; readonly index: number } | { readonly kind: "innerRadius" };

export function sameHandle(a: HandleRef | null, b: HandleRef | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "belt") return b.kind === "belt" && a.index === b.index;
  return a.kind === b.kind;
}

/**
 * How the ring a dragged body lands on is marked: its own, one it shares with another body, on top
 * of another body, or held where it is while another body refuses it.
 */
export type DragTone = "own" | "shared" | "overlap" | "refused";

/** What the scene marks while something is dragged. */
export interface DragMarks {
  /** The body dragged, whose ring in the shown layout is the one it lands on; null for a handle. */
  readonly body: number | null;
  /** Where the body stood before the drag, drawn faint. */
  readonly ghost: { readonly x: number; readonly y: number; readonly disc: number } | null;
  readonly tone: DragTone;
  /** The body it shares its ring with, stands on top of, or is refused by. */
  readonly other: number | null;
  /** The body it would become a moon of. */
  readonly host: number | null;
  readonly handle: HandleRef | null;
  /** The wormhole dragged, whose save point is drawn faint. */
  readonly wormhole: number | null;
  /** The megastructure dragged. */
  readonly megastructure: number | null;
  /** The bodies a dragged megastructure may be dropped on, each ringed faintly. */
  readonly targets: readonly number[];
}

/** A drag that marks nothing yet, for each drag to add its own marks to. */
export const NO_MARKS: DragMarks = Object.freeze({
  body: null,
  ghost: null,
  tone: "own",
  other: null,
  host: null,
  handle: null,
  wormhole: null,
  megastructure: null,
  targets: [],
});

/** The text at the pointer while something is dragged. */
export interface DragReadout {
  readonly text: string;
  readonly tone?: "warn";
}

/** One move of a drag: where it would put things, what the scene marks and what it says. */
export interface DragStep {
  readonly intent: GeometryIntent;
  readonly marks: DragMarks;
  readonly readout: DragReadout;
  /** What the status bar says. */
  readonly hint: string;
  /** Why releasing here changes nothing; the body stays about its own parent meanwhile. */
  readonly refused?: string;
  /** Whether releasing here would change anything. */
  readonly changed: boolean;
}

/** The pointer as a drag reads it: its scene point, Shift, Ctrl, and screen pixels per world unit. */
export interface DragPointer {
  readonly wx: number;
  readonly wy: number;
  readonly shift: boolean;
  /** Keeps a body about what it orbits, on the axis its travel picked as Ctrl went down. */
  readonly ctrl: boolean;
  readonly scale: number;
}

/** What a drag reads of the scene as it starts. */
export type DragFrame = Pick<
  SystemContext,
  "id" | "layout" | "editing" | "bodyById" | "lockedBodies"
>;

/** Anything a gesture drags. */
export interface Drag {
  move(pointer: DragPointer): DragStep;
}

export const ORIGIN: Pt = { x: 0, y: 0 };

/** `angle` in whole degrees, or in Shift's steps. */
export function snapAngle(angle: number, shift: boolean): number {
  const step = shift ? SHIFT_STEP_DEG : 1;
  return wrapDegrees(Math.round(angle / step) * step);
}

export function whole(value: number): string {
  return String(Math.round(value));
}

export function degrees(angle: number): string {
  return `${Math.round(angle) % 360}°`;
}

/** A readout's change from `from` to `to` in whole units, or `to` alone where they round alike. */
export function change(from: number, to: number): string {
  const was = whole(from);
  const now = whole(to);
  return was === now ? now : `${was} → ${now}`;
}

/** The ring nearest `radius` among `rings`, within `within` world units, or null. */
export function nearestRing(
  rings: readonly { id: number | null; radius: number }[],
  radius: number,
  within: number,
): { id: number | null; radius: number } | null {
  let best: { id: number | null; radius: number } | null = null;
  for (const ring of rings) {
    const gap = Math.abs(ring.radius - radius);
    if (gap <= within && (best === null || gap < Math.abs(best.radius - radius))) best = ring;
  }
  return best;
}

type Axis = "along" | "across";

/** Where Ctrl holds a body: the axis it moves on, and the radius and angle it had as Ctrl went down. */
export interface Hold {
  axis: Axis;
  radius: number;
  angle: number;
}

/** A radius and angle about a centre, in `polar`'s degrees. */
export interface Polar {
  radius: number;
  angle: number;
}

/**
 * Ctrl's hold from `last`, where the last move put a thing about its centre: across when the
 * travel from `start` to `at` runs more out from the centre than round it, else along.
 */
export function holdFrom(last: Polar, start: Pt, at: Pt): Hold {
  const { radius, angle } = last;
  const { x: ux, y: uy } = polar(0, 0, 1, angle);
  const dx = at.x - start.x;
  const dy = at.y - start.y;
  const radial = Math.abs(dx * ux + dy * uy);
  const round = Math.abs(dx * uy - dy * ux);
  return { axis: radial > round ? "across" : "along", radius, angle };
}

/**
 * Where a thing held at `at` lands about `centre`: freely, at the radius `radiusOf` gives and the
 * angle in whole degrees or Shift's steps, or on Ctrl's `hold` axis.
 */
export function heldAbout(
  at: Pt,
  centre: Pt,
  hold: Hold | null,
  shift: boolean,
  radiusOf: () => { radius: number; shared: number | null },
): Polar & { shared: number | null } {
  const turned = () => snapAngle(polarAbout(at, centre).angle, shift);
  if (hold === null) return { angle: turned(), ...radiusOf() };
  if (hold.axis === "along") return { radius: hold.radius, angle: turned(), shared: null };
  return { angle: hold.angle, ...radiusOf() };
}

/** What the status bar says while a thing moves freely or on Ctrl's `hold` axis. */
export function holdHint(hold: Hold | null, free: string): string {
  if (hold === null) return free;
  return hold.axis === "along" ? DRAG_HINTS.along : DRAG_HINTS.across;
}

/** How far, in screen pixels, `at` is from the pointer. */
export function pixelsFromPointer(pointer: DragPointer, at: Pt): number {
  return Math.hypot(at.x - pointer.wx, at.y - pointer.wy) * pointer.scale;
}

/** How near, in screen pixels, the pointer must come for a body of `disc` and `look` to take a dragged thing. */
export function captureReach(
  disc: number,
  look: Pick<BodyLook, "flat" | "model">,
  scale: number,
): number {
  return Math.max(CAPTURE_MIN_PX, drawnDisc(disc, scale, look) * scale + CAPTURE_PAST_PX);
}

/**
 * The item whose point the pointer is nearest, among those it is within `reach` of; `reach`
 * gives null for an item that takes nothing.
 */
export function nearestWithin<T>(
  items: Iterable<T>,
  pointer: DragPointer,
  at: (item: T) => Pt,
  reach: (item: T) => number | null,
): T | null {
  let best: T | null = null;
  let bestPx = Infinity;
  for (const item of items) {
    const limit = reach(item);
    if (limit === null) continue;
    const px = pixelsFromPointer(pointer, at(item));
    if (px <= limit && px < bestPx) {
      best = item;
      bestPx = px;
    }
  }
  return best;
}

/** A thing held freely about the centre: its radius and angle, point, readout and whether it moved. */
export interface FreeStep extends Polar {
  readonly point: Pt;
  readonly readout: DragReadout;
  readonly changed: boolean;
}

/**
 * Where a thing held at `held` lands about the centre, freely: at a whole radius of at least 1 and
 * an angle in whole degrees or Shift's steps, read against where it stood at `was`.
 */
export function freeStep(held: Pt, was: Pt, shift: boolean): FreeStep {
  const radius = Math.max(1, Math.round(Math.hypot(held.x, held.y)));
  const angle = snapAngle(polarAbout(held, ORIGIN).angle, shift);
  const from = polarAbout(was, ORIGIN);
  const same = near(radius, from.radius) && near(wrapDegrees(angle - from.angle + 180), 180);
  return {
    radius,
    angle,
    point: polar(0, 0, radius, angle),
    readout: { text: `r ${change(from.radius, radius)} · ${degrees(angle)}` },
    changed: !same,
  };
}
