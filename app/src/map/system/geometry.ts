import type { Sprite, Texture } from "pixi.js";
import type { Bounds } from "../../generated/Bounds";
import { WORMHOLE_RADIUS } from "../../lib/details/discs";
import type { BodyPlacement, Ring } from "../../lib/details/orbits";
import { modelSize } from "../../lib/details/structures";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../../lib/geometry/geometry";
import type { Pt } from "../../lib/geometry/pt";
import { getModelPlacement, getTexture, onTextures } from "../../lib/visual/textures";
import { markerScale } from "../layers/MapLayer";
import type { Exit, SceneBody } from "./context";
import type { BodyLook } from "./look";

/** The smallest a body's disc radius is drawn, in screen pixels, before the marker factor. */
const BODY_FLOOR_PX = 3;
/** The smallest a wormhole's vortex is drawn, in screen pixels, before the marker factor. */
const WORMHOLE_FLOOR_PX = 8;
/**
 * The widest a flat body is drawn, in screen pixels: its 76 pixel icon at about 1.25 times, past
 * which it would only blur.
 */
export const FLAT_BODY_MAX_PX = 96;
/** The selected body's ring: how far past the drawn disc it stands, and its width, in screen pixels. */
export const SELECTED_GAP_PX = 7;
export const SELECTED_WIDTH_PX = 2;
/** Between the inner-radius circle and the base of a hyperlane arrow, in screen pixels. */
export const EXIT_GAP_PX = 6;
/** A hyperlane arrow's length from base to tip, and its base's width, in screen pixels. */
export const EXIT_LENGTH_PX = 14;
const EXIT_WIDTH_PX = 12;
/** Past the tip, where the arrow's label starts, in screen pixels. */
export const EXIT_LABEL_GAP_PX = 4;
/** How far past the inner radius an arrow and its label reach, which the fit keeps in view. */
export const EXIT_REACH_PX = 40;

/** Screen pixels per dash step along a dashed ring, and the fewest and most dashes it takes. */
const DASH_STEP_PX = 10;
const MIN_DASHES = 24;
const MAX_DASHES = 720;

/** How many dashes a ring of `radius` is traced in at `scale`, about one per step on screen. */
export function ringDashes(radius: number, scale: number): number {
  const steps = Math.round((2 * Math.PI * radius * scale) / DASH_STEP_PX);
  return Math.min(MAX_DASHES, Math.max(MIN_DASHES, steps));
}

/** Whether two rings are drawn as one: centres and radii all within `within` world units. */
export function sameRing(a: Ring, b: Ring, within: number): boolean {
  return (
    Math.abs(a.cx - b.cx) < within &&
    Math.abs(a.cy - b.cy) < within &&
    Math.abs(a.radius - b.radius) < within
  );
}

/** One ring as it is drawn: the first body on it, and the radii of every body on it joined. */
export interface RingGroup {
  readonly id: number;
  readonly ring: Ring;
  readonly span: Bounds;
}

/**
 * Each ring of `placements` once, in their order. The save's orbits on one ring differ by a
 * fraction of a unit, so rings within `px` world units are one.
 */
export function ringGroups(placements: readonly BodyPlacement[], px: number): RingGroup[] {
  const groups: RingGroup[] = [];
  for (const { id, ring, radius } of placements) {
    if (!ring || !radius) continue;
    const at = groups.findIndex((other) => sameRing(ring, other.ring, px));
    if (at < 0) groups.push({ id, ring, span: radius });
    else groups[at] = { ...groups[at], span: joined(groups[at].span, radius) };
  }
  return groups;
}

function joined(a: Bounds, b: Bounds): Bounds {
  return { min: Math.min(a.min, b.min), max: Math.max(a.max, b.max) };
}

/**
 * Stars, then planets, then moons: the order bodies are drawn in, so a moon is never hidden
 * behind its planet, and the order their labels are placed in.
 */
export function bodyTier(body: SceneBody): number {
  return body.placement.star ? 0 : body.moon ? 2 : 1;
}

/** A landed model sprite at some multiple of its placement's size, in save units. */
export interface LandedModel {
  readonly texture: Texture;
  readonly width: number;
  readonly height: number;
  /** Where the model's origin falls in the sprite, as a share of its size from the top left. */
  readonly anchor: { readonly x: number; readonly y: number };
  /** The sprite's middle, right of and below the model's origin as the sprite stands upright. */
  readonly centre: { readonly x: number; readonly y: number };
  /** How far below the model's origin the sprite reaches, upright. */
  readonly below: number;
  /** Half the sprite's longer side. */
  readonly radius: number;
}

/** The model sprite `key` drawn `scale` times its placement's size; null until it lands. */
export function landedModel(key: string | null, scale: number): LandedModel | null {
  if (key === null) return null;
  const texture = getTexture(key);
  const placement = getModelPlacement(key);
  if (!texture || !placement) return null;
  const { width, height } = modelSize(placement, scale);
  const { anchor_x: ax, anchor_y: ay } = placement;
  return {
    texture,
    width,
    height,
    anchor: { x: ax, y: ay },
    centre: { x: (0.5 - ax) * width, y: (0.5 - ay) * height },
    below: (1 - ay) * height,
    radius: Math.max(width, height) / 2,
  };
}

/** No turn of the axes: for a sprite in a holder the scene's axis flip already applies to. */
export const UPRIGHT = { x: 1, y: 1 } as const;
/** The save's axis signs: for a sprite outside the flip. */
export const SAVE_AXES = { x: SAVE_X_SIGN, y: SAVE_Y_SIGN } as const;

/** Shows `model` on `sprite`, anchored at the model's origin, its axes turned by `axes`. */
export function dressModelSprite(
  sprite: Sprite,
  model: LandedModel,
  axes: { readonly x: number; readonly y: number },
): void {
  const { texture, width, height, anchor } = model;
  sprite.texture = texture;
  sprite.anchor.set(anchor.x, anchor.y);
  sprite.scale.set(
    (axes.x * width) / Math.max(texture.width, 1),
    (axes.y * height) / Math.max(texture.height, 1),
  );
}

/** Half the longer side of the landed model sprite `key`, in save units; null until it lands. */
export function modelRadius(key: string): number | null {
  return landedModel(key, 1)?.radius ?? null;
}

/**
 * Calls `then` whenever the model of one of the bodies `bodies` gives lands or is dropped, which
 * changes how far that body reaches; returns the unsubscribe.
 */
export function onBodyModels(
  bodies: () => readonly Pick<SceneBody, "look">[],
  then: () => void,
): () => void {
  return onTextures((keys) => {
    const settled = new Set(keys);
    if (bodies().some((b) => b.look.model !== null && settled.has(b.look.model))) then();
  });
}

/**
 * A body's drawn disc radius in world units at `scale`: its own, or the screen-pixel floor, and
 * for a body of a flat `look` no more than half `FLAT_BODY_MAX_PX` on screen. A body drawn from
 * its model reaches half the model sprite's longer side once it lands.
 */
export function drawnDisc(
  disc: number,
  scale: number,
  look?: Pick<BodyLook, "flat"> & Partial<Pick<BodyLook, "model">>,
): number {
  const floor = (BODY_FLOOR_PX * markerScale(scale)) / scale;
  const model = look?.model ? modelRadius(look.model) : null;
  if (model !== null) return Math.max(model, floor);
  const r = Math.max(disc, floor);
  return look?.flat ? Math.min(r, FLAT_BODY_MAX_PX / 2 / scale) : r;
}

/** The look of a body drawn as a bare disc, with no model and no flat art: a rolled planet's. */
export const DISC_ONLY: Pick<BodyLook, "flat" | "model"> = Object.freeze({
  flat: false,
  model: null,
});

/** A wormhole's drawn vortex radius in world units at `scale`: its own, or the screen-pixel floor. */
export function drawnWormhole(scale: number): number {
  return Math.max(WORMHOLE_RADIUS, (WORMHOLE_FLOOR_PX * markerScale(scale)) / scale);
}

/** The point `px` screen pixels past the inner radius along `exit`, in world units. */
export function alongExit(exit: Exit, scale: number, px: number, out: Pt = { x: 0, y: 0 }): Pt {
  const r = exit.radius + px / scale;
  out.x = exit.dx * r;
  out.y = exit.dy * r;
  return out;
}

/** The middle of the arrow for `exit`, where a pick measures from. */
export function exitCentre(exit: Exit, scale: number, out: Pt = { x: 0, y: 0 }): Pt {
  return alongExit(exit, scale, EXIT_GAP_PX + EXIT_LENGTH_PX / 2, out);
}

/** The arrow's three corners in world units, tip first. */
export function exitTriangle(exit: Exit, scale: number, grow = 0): number[] {
  const base = EXIT_GAP_PX - grow;
  const tip = alongExit(exit, scale, base + EXIT_LENGTH_PX + 2 * grow);
  const mid = alongExit(exit, scale, base);
  const half = (EXIT_WIDTH_PX / 2 + grow) / scale;
  return [
    tip.x,
    tip.y,
    mid.x - exit.dy * half,
    mid.y + exit.dx * half,
    mid.x + exit.dy * half,
    mid.y - exit.dx * half,
  ];
}
