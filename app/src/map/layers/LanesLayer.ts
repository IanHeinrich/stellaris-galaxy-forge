import { Container, Graphics } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SystemNode } from "../../generated/SystemNode";
import { cellKey } from "../../lib/spatialGrid";
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

/** World units per side of the tiles the lanes are drawn in, so an edit redraws only its own. */
const TILE = 200;

type LaneKind = "lane" | "bridge" | "prevented";

interface LaneEntry {
  readonly key: string;
  readonly a: number;
  readonly b: number;
  readonly kind: LaneKind;
  readonly tile: number;
}

interface Tile {
  readonly entries: Set<LaneEntry>;
  readonly prevented: Graphics;
  readonly lanes: Graphics;
  readonly bridges: Graphics;
}

function tileOf(x: number, y: number): number {
  return cellKey(Math.floor(x / TILE), Math.floor(y / TILE));
}

function addTo<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

/**
 * Every undirected lane once, as hairlines that stay 1px at any zoom, drawn in tiles: a delta
 * or a drag redraws only the tiles holding a lane of a system it touches.
 */
export class LanesLayer implements MapLayer {
  readonly id = "lanes" as const;
  readonly container = new Container();
  /** The prevented pairs' dashes under every tile's lanes, and the bridges over them. */
  private readonly preventedLayer = new Container({ label: "prevented" });
  private readonly lanesLayer = new Container({ label: "lanes" });
  private readonly bridgesLayer = new Container({ label: "bridges" });
  private readonly tiles = new Map<number, Tile>();
  private readonly entries = new Map<string, LaneEntry>();
  private readonly byId = new Map<number, Set<LaneEntry>>();
  /** Systems a lane or pair names that the document does not hold, and the systems naming them. */
  private readonly dangling = new Map<number, Set<number>>();
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private dragged: ReadonlyMap<number, MoveGhost> = NO_DRAG;
  private ease = 0;

  constructor() {
    this.container.addChild(this.preventedLayer, this.lanesLayer, this.bridgesLayer);
  }

  rebuild(ctx: RenderContext): void {
    const loaded = ctx.galaxy !== this.galaxy;
    this.galaxy = ctx.galaxy;
    this.systems = ctx.systems;
    if (loaded) this.refile();
  }

  applyDelta(d: GalaxyDelta): void {
    const dirty = new Set<number>();
    const again = new Set<number>();
    for (const id of [...(d.removed ?? []), ...d.systems.map((s) => s.id)]) {
      for (const entry of [...(this.byId.get(id) ?? [])]) {
        this.drop(entry);
        dirty.add(entry.tile);
        again.add(entry.a);
        again.add(entry.b);
      }
      for (const from of this.dangling.get(id) ?? []) again.add(from);
      this.dangling.delete(id);
    }
    for (const s of d.systems) again.add(s.id);
    for (const id of again) {
      const s = this.systems.get(id);
      if (s) for (const tile of this.derive(s)) dirty.add(tile);
    }
    for (const tile of dirty) this.drawTile(tile);
  }

  /** Dims the lanes of the systems being dragged; their ghost lanes take their place. */
  setDragState(drag: DragState | null): void {
    const dragged = drag?.byId ?? NO_DRAG;
    const same =
      dragged.size === this.dragged.size && [...dragged.keys()].every((id) => this.dragged.has(id));
    if (same) return;
    const dirty = new Set<number>();
    for (const ids of [this.dragged.keys(), dragged.keys()]) {
      for (const id of ids) for (const entry of this.byId.get(id) ?? []) dirty.add(entry.tile);
    }
    this.dragged = dragged;
    for (const tile of dirty) this.drawTile(tile);
  }

  onViewport(cam: Camera): void {
    const ease = laneEase(cam.scale);
    if (ease === this.ease) return;
    this.ease = ease;
    for (const tile of this.tiles.keys()) this.drawTile(tile);
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private refile(): void {
    this.preventedLayer.removeChildren().forEach((c) => c.destroy());
    this.lanesLayer.removeChildren().forEach((c) => c.destroy());
    this.bridgesLayer.removeChildren().forEach((c) => c.destroy());
    this.tiles.clear();
    this.entries.clear();
    this.byId.clear();
    this.dangling.clear();
    for (const s of this.systems.values()) this.derive(s);
    for (const tile of this.tiles.keys()) this.drawTile(tile);
  }

  /**
   * Files each lane and prevented pair `s` draws, a pair both ends name under the lower id,
   * and returns the tiles it filed into.
   */
  private derive(s: SystemNode): Set<number> {
    const tiles = new Set<number>();
    for (const lane of s.lanes) {
      if (s.id > lane.to && this.systems.get(lane.to)?.lanes.some((l) => l.to === s.id)) continue;
      const tile = this.file(s, lane.to, lane.bridge ? "bridge" : "lane");
      if (tile !== null) tiles.add(tile);
    }
    for (const to of s.prevented) {
      if (s.id > to && this.systems.get(to)?.prevented.includes(s.id)) continue;
      const tile = this.file(s, to, "prevented");
      if (tile !== null) tiles.add(tile);
    }
    return tiles;
  }

  private file(s: SystemNode, to: number, kind: LaneKind): number | null {
    const [lo, hi] = s.id < to ? [s.id, to] : [to, s.id];
    const key = `${kind === "prevented" ? "p" : "l"}${lo}:${hi}`;
    if (this.entries.has(key)) return null;
    const b = this.systems.get(to);
    if (!b) addTo(this.dangling, to, s.id);
    const at = b ? { x: (s.x + b.x) / 2, y: (s.y + b.y) / 2 } : s;
    const entry: LaneEntry = { key, a: s.id, b: to, kind, tile: tileOf(at.x, at.y) };
    this.entries.set(key, entry);
    addTo(this.byId, entry.a, entry);
    addTo(this.byId, entry.b, entry);
    this.tileAt(entry.tile).entries.add(entry);
    return entry.tile;
  }

  private drop(entry: LaneEntry): void {
    this.entries.delete(entry.key);
    this.byId.get(entry.a)?.delete(entry);
    this.byId.get(entry.b)?.delete(entry);
    this.tiles.get(entry.tile)?.entries.delete(entry);
  }

  private tileAt(key: number): Tile {
    let tile = this.tiles.get(key);
    if (!tile) {
      tile = {
        entries: new Set(),
        prevented: new Graphics(),
        lanes: new Graphics(),
        bridges: new Graphics(),
      };
      this.tiles.set(key, tile);
      this.preventedLayer.addChild(tile.prevented);
      this.lanesLayer.addChild(tile.lanes);
      this.bridgesLayer.addChild(tile.bridges);
    }
    return tile;
  }

  private drawTile(key: number): void {
    const tile = this.tiles.get(key);
    if (!tile) return;
    if (tile.entries.size === 0) {
      this.tiles.delete(key);
      tile.prevented.destroy();
      tile.lanes.destroy();
      tile.bridges.destroy();
      return;
    }
    tile.prevented.clear();
    tile.lanes.clear();
    tile.bridges.clear();
    this.drawPrevented(tile);
    const laneStyle = mixStyle(LANE_FAR, LANE_NEAR, this.ease);
    const bridgeStyle = mixStyle(BRIDGE_FAR, BRIDGE_NEAR, this.ease);
    for (const kind of ["lane", "bridge"] as const) {
      const g = kind === "bridge" ? tile.bridges : tile.lanes;
      for (const faded of [false, true]) {
        let any = false;
        for (const entry of tile.entries) {
          if (entry.kind !== kind || this.faded(entry) !== faded) continue;
          const a = this.systems.get(entry.a);
          const b = this.systems.get(entry.b);
          if (!a || !b) continue;
          g.moveTo(a.x, a.y).lineTo(b.x, b.y);
          any = true;
        }
        const style = kind === "bridge" ? bridgeStyle : laneStyle;
        if (any) {
          g.stroke({ ...style, alpha: faded ? ORIGIN_LANE_ALPHA : style.alpha, pixelLine: true });
        }
      }
    }
  }

  /** The tile's prevented pairs, a dragged system's dimmed as its lanes are. */
  private drawPrevented(tile: Tile): void {
    const g = tile.prevented;
    for (const faded of [false, true]) {
      let any = false;
      for (const entry of tile.entries) {
        if (entry.kind !== "prevented" || this.faded(entry) !== faded) continue;
        const a = this.systems.get(entry.a);
        const b = this.systems.get(entry.b);
        if (!a || !b) continue;
        dash(g, a.x, a.y, b.x, b.y);
        any = true;
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

  private faded(entry: LaneEntry): boolean {
    return this.dragged.has(entry.a) || this.dragged.has(entry.b);
  }
}
