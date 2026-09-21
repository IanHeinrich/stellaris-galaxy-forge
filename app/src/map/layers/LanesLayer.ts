import { Container, Graphics } from "pixi.js";
import type { Camera } from "../Camera";
import { DETAIL_SCALE } from "../../lib/visual/labels";
import type { MoveGhost } from "../moveGhosts";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { ORIGIN_LANE_ALPHA } from "../../lib/visual/style";
import type { DragState, MapLayer } from "./MapLayer";

export interface LaneStyle {
  color: number;
  alpha: number;
}

/** Zoomed out the network reads like the game's teal web; by `DETAIL_SCALE` it has receded. */
const LANE_FAR: LaneStyle = { color: 0x3fb5a3, alpha: 0.85 };
const LANE_NEAR: LaneStyle = { color: 0x3b5b8a, alpha: 0.75 };
const BRIDGE_FAR: LaneStyle = { color: 0x7fd8c8, alpha: 0.6 };
const BRIDGE_NEAR: LaneStyle = { color: 0x6aa0d8, alpha: 0.45 };
/** A pair `prevent_hyperlane` forbids: the lane's own hue, dimmer, and broken. */
export const PREVENTED_LANE: LaneStyle = { color: 0x3b5b8a, alpha: 0.3 };
/** World units of ink and of gap in a prevented pair's dashes. */
const DASH = 2;
const GAP = 2;

/** Pixels per world unit at which the lanes start easing from the far look to the near one. */
const EASE_FROM_SCALE = 1;
const EASE_STEPS = 16;

const NO_DRAG: ReadonlyMap<number, MoveGhost> = new Map();

function mixChannel(a: number, b: number, shift: number, t: number): number {
  const ca = (a >> shift) & 0xff;
  const cb = (b >> shift) & 0xff;
  return Math.round(ca + (cb - ca) * t) << shift;
}

function mixStyle(far: LaneStyle, near: LaneStyle, t: number): LaneStyle {
  return {
    color:
      mixChannel(far.color, near.color, 16, t) |
      mixChannel(far.color, near.color, 8, t) |
      mixChannel(far.color, near.color, 0, t),
    alpha: far.alpha + (near.alpha - far.alpha) * t,
  };
}

/** Pixi strokes no dashes, so the line is stepped in world units and breaks at every zoom. */
function dash(g: Graphics, ax: number, ay: number, bx: number, by: number): void {
  const steps = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / (DASH + GAP)));
  const dx = (bx - ax) / steps;
  const dy = (by - ay) / steps;
  const ink = DASH / (DASH + GAP);
  for (let i = 0; i < steps; i++) {
    const x = ax + dx * i;
    const y = ay + dy * i;
    g.moveTo(x, y).lineTo(x + dx * ink, y + dy * ink);
  }
}

/** 0 at and below `EASE_FROM_SCALE`, 1 at and above `DETAIL_SCALE`, log-linear between, quantised. */
function laneEase(camScale: number): number {
  const t = Math.log(camScale / EASE_FROM_SCALE) / Math.log(DETAIL_SCALE / EASE_FROM_SCALE);
  return Math.round(Math.min(1, Math.max(0, t)) * EASE_STEPS) / EASE_STEPS;
}

/** The lane look at `camScale`, for a layer drawing a lane the game will lay in the lanes' own style. */
export function laneStyleAt(camScale: number): LaneStyle {
  return mixStyle(LANE_FAR, LANE_NEAR, laneEase(camScale));
}

/** `style` pulled `t` of the way toward `tint`, keeping its alpha. */
export function tinted(style: LaneStyle, tint: number, t: number): LaneStyle {
  return mixStyle(style, { color: tint, alpha: style.alpha }, t);
}

/** Every undirected lane once, as hairlines that stay 1px at any zoom. */
export class LanesLayer implements MapLayer {
  readonly id = "lanes" as const;
  private readonly lines = new Graphics();
  readonly container: Container = this.lines;
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private dragged: ReadonlyMap<number, MoveGhost> = NO_DRAG;
  private ease = 0;

  rebuild(ctx: RenderContext): void {
    const loaded = ctx.galaxy !== this.galaxy;
    this.galaxy = ctx.galaxy;
    this.systems = ctx.systems;
    if (loaded) this.draw();
  }

  applyDelta(): void {
    this.draw();
  }

  /** Dims the lanes of the systems being dragged; their ghost lanes take their place. */
  setDragState(drag: DragState | null): void {
    const dragged = drag?.byId ?? NO_DRAG;
    const same =
      dragged.size === this.dragged.size && [...dragged.keys()].every((id) => this.dragged.has(id));
    if (same) return;
    this.dragged = dragged;
    this.draw();
  }

  onViewport(cam: Camera): void {
    const ease = laneEase(cam.scale);
    if (ease === this.ease) return;
    this.ease = ease;
    this.draw();
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy();
  }

  private draw(): void {
    const g = this.lines;
    g.clear();
    const laneStyle = mixStyle(LANE_FAR, LANE_NEAR, this.ease);
    const bridgeStyle = mixStyle(BRIDGE_FAR, BRIDGE_NEAR, this.ease);
    this.drawPrevented();
    for (const faded of [false, true]) {
      for (const bridge of [false, true]) {
        let any = false;
        for (const a of this.systems.values()) {
          for (const lane of a.lanes) {
            if (lane.bridge !== bridge) continue;
            if ((this.dragged.has(a.id) || this.dragged.has(lane.to)) !== faded) continue;
            if (a.id > lane.to && this.systems.get(lane.to)?.lanes.some((l) => l.to === a.id)) {
              continue;
            }
            const b = this.systems.get(lane.to);
            if (!b) continue;
            g.moveTo(a.x, a.y).lineTo(b.x, b.y);
            any = true;
          }
        }
        const style = bridge ? bridgeStyle : laneStyle;
        if (any) {
          g.stroke({ ...style, alpha: faded ? ORIGIN_LANE_ALPHA : style.alpha, pixelLine: true });
        }
      }
    }
  }

  /** Every prevented pair once, under the lanes, a dragged system's dimmed as its lanes are. */
  private drawPrevented(): void {
    const g = this.lines;
    for (const faded of [false, true]) {
      let any = false;
      for (const a of this.systems.values()) {
        for (const to of a.prevented) {
          if ((this.dragged.has(a.id) || this.dragged.has(to)) !== faded) continue;
          if (a.id > to && this.systems.get(to)?.prevented.includes(a.id)) continue;
          const b = this.systems.get(to);
          if (!b) continue;
          dash(g, a.x, a.y, b.x, b.y);
          any = true;
        }
      }
      if (any) {
        g.stroke({
          ...PREVENTED_LANE,
          alpha: faded ? ORIGIN_LANE_ALPHA : PREVENTED_LANE.alpha,
          pixelLine: true,
        });
      }
    }
  }
}
