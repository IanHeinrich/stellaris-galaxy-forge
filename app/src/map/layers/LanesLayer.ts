import { Container, Graphics } from "pixi.js";
import type { BypassLink } from "../../generated/BypassLink";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SystemNode } from "../../generated/SystemNode";
import { pairKey } from "../../lib/geometry/pairs";
import { cellKey } from "../../lib/spatialGrid";
import type { Camera } from "../Camera";
import { DETAIL_SCALE } from "../../lib/visual/labels";
import type { MoveGhost } from "../moveGhosts";
import { LaneTable } from "../laneTable";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { DrawnPositions, type DrawnChange } from "../drawnPositions";
import { ORIGIN_LANE_ALPHA } from "../../lib/visual/style";
import { evenDashedLine } from "./dashes";
import { sameDragged, type DragState, type MapLayer } from "./MapLayer";

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

/** The bypass a Hyper Relay stands in the save as. */
const RELAY_BYPASS = "relay_bypass";
/**
 * A lane between two relays, in pixels. The game's `HYPERLANE_THICKNESS_RELAY` is only twice its
 * default, but its lanes are wider than this map's hairlines, so twice a hairline barely shows.
 */
export const RELAY_LANE_PX = 3.5;
/** Widths a relay lane is restroked at per doubling of zoom, so a zoom seldom redraws it. */
const RELAY_STEPS = 8;

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

/** The systems holding a Hyper Relay. */
function relaySystems(bypasses: readonly BypassLink[]): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const link of bypasses) {
    if (link.type === "other" && link.kind === RELAY_BYPASS) ids.add(link.system);
  }
  return ids;
}

function sameMembers(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** World units per side of the tiles the lanes are drawn in, so an edit redraws only its own. */
const TILE = 200;

type LaneKind = "lane" | "bridge" | "prevented";

interface LaneEntry {
  readonly key: string;
  readonly ends: readonly [number, number];
  readonly kind: LaneKind;
  readonly tile: number;
}

interface Tile {
  readonly entries: Set<LaneEntry>;
  readonly prevented: Graphics;
  readonly lanes: Graphics;
  readonly relays: Graphics;
  readonly bridges: Graphics;
}

function tileOf(x: number, y: number): number {
  return cellKey(Math.floor(x / TILE), Math.floor(y / TILE));
}

/**
 * Every undirected lane once, as hairlines that stay 1px at any zoom, drawn in tiles: a delta
 * or a drag redraws only the tiles holding a lane of a system it touches. A lane between two
 * Hyper Relays stays `RELAY_LANE_PX` wide instead, under any wayline band laid over it.
 */
export class LanesLayer implements MapLayer {
  readonly id = "lanes" as const;
  readonly container = new Container();
  /** The prevented pairs' dashes under every tile's lanes, and the bridges over them. */
  private readonly preventedLayer = new Container({ label: "prevented" });
  private readonly lanesLayer = new Container({ label: "lanes" });
  private readonly relaysLayer = new Container({ label: "relays" });
  private readonly bridgesLayer = new Container({ label: "bridges" });
  private readonly tiles = new Map<number, Tile>();
  private readonly table = new LaneTable<LaneEntry>();
  private galaxy = EMPTY_CONTEXT.galaxy;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private bypasses = EMPTY_CONTEXT.bypasses;
  private relays: ReadonlySet<number> = new Set();
  private dragged: ReadonlyMap<number, MoveGhost> = NO_DRAG;
  private ease = 0;
  private relayStep = 0;

  constructor(private readonly drawn = new DrawnPositions()) {
    this.container.addChild(
      this.preventedLayer,
      this.lanesLayer,
      this.relaysLayer,
      this.bridgesLayer,
    );
  }

  rebuild(ctx: RenderContext): void {
    const loaded = ctx.galaxy !== this.galaxy;
    this.galaxy = ctx.galaxy;
    this.systems = ctx.systems;
    const relaid = this.readRelays(ctx.bypasses);
    if (loaded) this.refile();
    else if (relaid) for (const tile of this.tiles.keys()) this.drawTile(tile);
  }

  applyDelta(d: GalaxyDelta): void {
    const dirty = new Set<number>();
    const again = this.table.release(d, (entry) => {
      this.tiles.get(entry.tile)?.entries.delete(entry);
      dirty.add(entry.tile);
    });
    for (const id of again) {
      const s = this.systems.get(id);
      if (s) for (const tile of this.derive(s)) dirty.add(tile);
    }
    for (const tile of dirty) this.drawTile(tile);
  }

  /** Dims the lanes of the systems being dragged; their ghost lanes take their place. */
  setDragState(drag: DragState | null): void {
    const dragged = drag?.byId ?? NO_DRAG;
    const same = sameDragged(dragged, this.dragged);
    if (same) return;
    const dirty = new Set<number>();
    for (const ids of [this.dragged.keys(), dragged.keys()]) {
      for (const id of ids) for (const entry of this.table.of(id)) dirty.add(entry.tile);
    }
    this.dragged = dragged;
    for (const tile of dirty) this.drawTile(tile);
  }

  onViewport(cam: Camera): void {
    const ease = laneEase(cam.scale);
    const relayStep = Math.round(Math.log2(cam.scale) * RELAY_STEPS);
    if (ease !== this.ease) {
      this.ease = ease;
      this.relayStep = relayStep;
      for (const tile of this.tiles.keys()) this.drawTile(tile);
    } else if (relayStep !== this.relayStep) {
      this.relayStep = relayStep;
      for (const tile of this.tiles.values()) this.drawRelays(tile);
    }
  }

  /** Redraws only the tiles holding a lane of a system drawn somewhere else now. */
  onDrawn({ moved }: DrawnChange): void {
    const dirty = new Set<number>();
    for (const id of moved) for (const entry of this.table.of(id)) dirty.add(entry.tile);
    for (const tile of dirty) this.drawTile(tile);
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
    this.relaysLayer.removeChildren().forEach((c) => c.destroy());
    this.bridgesLayer.removeChildren().forEach((c) => c.destroy());
    this.tiles.clear();
    this.table.clear();
    for (const s of this.systems.values()) this.derive(s);
    for (const tile of this.tiles.keys()) this.drawTile(tile);
  }

  /** Reads which systems hold a relay from `bypasses`; true when that changed. */
  private readRelays(bypasses: readonly BypassLink[]): boolean {
    if (bypasses === this.bypasses) return false;
    this.bypasses = bypasses;
    const relays = relaySystems(bypasses);
    const changed = !sameMembers(relays, this.relays);
    this.relays = relays;
    return changed;
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
    const key = `${kind === "prevented" ? "p" : "l"}${pairKey(s.id, to)}`;
    if (this.table.has(key)) return null;
    const b = this.systems.get(to);
    if (!b) this.table.waitFor(to, s.id);
    const at = b ? { x: (s.x + b.x) / 2, y: (s.y + b.y) / 2 } : s;
    const entry: LaneEntry = { key, ends: [s.id, to], kind, tile: tileOf(at.x, at.y) };
    this.table.add(entry);
    this.tileAt(entry.tile).entries.add(entry);
    return entry.tile;
  }

  private tileAt(key: number): Tile {
    let tile = this.tiles.get(key);
    if (!tile) {
      tile = {
        entries: new Set(),
        prevented: new Graphics(),
        lanes: new Graphics(),
        relays: new Graphics(),
        bridges: new Graphics(),
      };
      this.tiles.set(key, tile);
      this.preventedLayer.addChild(tile.prevented);
      this.lanesLayer.addChild(tile.lanes);
      this.relaysLayer.addChild(tile.relays);
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
      tile.relays.destroy();
      tile.bridges.destroy();
      return;
    }
    tile.prevented.clear();
    tile.lanes.clear();
    tile.bridges.clear();
    this.drawPrevented(tile);
    for (const kind of ["lane", "bridge"] as const) {
      const g = kind === "bridge" ? tile.bridges : tile.lanes;
      const style = this.styleOf(kind);
      for (const faded of [false, true]) {
        const any = this.trace(g, tile, (e) => e.kind === kind && !this.relayed(e), faded);
        if (any) {
          g.stroke({ ...style, alpha: faded ? ORIGIN_LANE_ALPHA : style.alpha, pixelLine: true });
        }
      }
    }
    this.drawRelays(tile);
  }

  /** The tile's relay lanes, at the width that keeps them `RELAY_LANE_PX` on screen. */
  private drawRelays(tile: Tile): void {
    const g = tile.relays;
    g.clear();
    const width = RELAY_LANE_PX / 2 ** (this.relayStep / RELAY_STEPS);
    for (const kind of ["lane", "bridge"] as const) {
      const style = this.styleOf(kind);
      for (const faded of [false, true]) {
        const any = this.trace(g, tile, (e) => e.kind === kind && this.relayed(e), faded);
        if (any) g.stroke({ ...style, alpha: faded ? ORIGIN_LANE_ALPHA : style.alpha, width });
      }
    }
  }

  private styleOf(kind: "lane" | "bridge"): LaneStyle {
    return kind === "bridge"
      ? mixStyle(BRIDGE_FAR, BRIDGE_NEAR, this.ease)
      : mixStyle(LANE_FAR, LANE_NEAR, this.ease);
  }

  /** Lays the path of each of the tile's entries `which` picks, dimmed or not; true for any. */
  private trace(
    g: Graphics,
    tile: Tile,
    which: (entry: LaneEntry) => boolean,
    faded: boolean,
  ): boolean {
    let any = false;
    for (const entry of tile.entries) {
      if (!which(entry) || this.faded(entry) !== faded) continue;
      const a = this.systems.get(entry.ends[0]);
      const b = this.systems.get(entry.ends[1]);
      if (!a || !b) continue;
      const from = this.drawn.at(a);
      const to = this.drawn.at(b);
      g.moveTo(from.x, from.y).lineTo(to.x, to.y);
      any = true;
    }
    return any;
  }

  /** A lane with a Hyper Relay at both ends. */
  private relayed(entry: LaneEntry): boolean {
    return entry.ends.every((id) => this.relays.has(id));
  }

  /** The tile's prevented pairs, a dragged system's dimmed as its lanes are. */
  private drawPrevented(tile: Tile): void {
    const g = tile.prevented;
    for (const faded of [false, true]) {
      let any = false;
      for (const entry of tile.entries) {
        if (entry.kind !== "prevented" || this.faded(entry) !== faded) continue;
        const a = this.systems.get(entry.ends[0]);
        const b = this.systems.get(entry.ends[1]);
        if (!a || !b) continue;
        evenDashedLine(g, this.drawn.at(a), this.drawn.at(b), DASH, GAP);
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
    return entry.ends.some((id) => this.dragged.has(id));
  }
}
