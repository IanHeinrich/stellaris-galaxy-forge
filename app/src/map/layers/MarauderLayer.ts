import { BitmapText, Container, Graphics, TextStyle } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SystemNode } from "../../generated/SystemNode";
import { countryRegions, smoothRegion, type Region } from "../../lib/geometry/territory";
import { basesBeside, clanOf, isHome } from "../../lib/marauder";
import { GHOST_ALPHA, MAP_FONT } from "../../lib/visual/style";
import type { Camera } from "../Camera";
import type { MoveGhost } from "../moveGhosts";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { markerScale, type DragState, type MapLayer } from "./MapLayer";
import {
  strokeUnit,
  TERRITORY_EDGE_ALPHA,
  TERRITORY_EDGE_PX,
  TERRITORY_FILL_ALPHA,
} from "./territoryStyle";

/** The seat chips' amber, which the home's tag shares so a home reads as a spawn of the mod's. */
const COLOR = 0xfbbf24;
const ALPHA = 0.95;

/** One colour per clan, by clan number, for the territory the map paints around its systems. */
export const CLAN_COLORS: readonly number[] = [0xef4444, 0x22d3ee, 0xa3e635];

/** The glyph the home's tag carries. */
export const HOME_TAG = "⚔";

/** Tag centre relative to the star, in marker units: the seat chip's mirror, clear of the ring. */
const TAG_OFFSET = { x: 12, y: -12 };
const CHIP = { width: 12, height: 9, radius: 2 };

const NO_GHOSTS: ReadonlyMap<number, MoveGhost> = new Map();

/** One shared instance: PixiJS keys a stroked dynamic bitmap font by the style object. */
const TAG_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 8,
  fontWeight: "700",
  fill: 0x111827,
});

interface Pt {
  x: number;
  y: number;
}

/** Only a scenario places clans by initializer; a save's clans are painted as its owners. */
function drawn(ctx: RenderContext): boolean {
  return ctx.kind === "scenario";
}

function clanColor(clan: number): number {
  return CLAN_COLORS[clan - 1] ?? CLAN_COLORS[0];
}

function drawChip(g: Graphics): void {
  const { x, y } = TAG_OFFSET;
  g.clear();
  g.roundRect(x - CHIP.width / 2, y - CHIP.height / 2, CHIP.width, CHIP.height, CHIP.radius).fill({
    color: COLOR,
    alpha: ALPHA,
  });
}

/**
 * The clans' territories, computed the way the owners' are: every system re-owned by the clan
 * it belongs to (a home and the bases hyperlaned to it) or by nobody, so each clan's systems
 * claim their discs and lane bands and every other system clips them. Dragged systems are
 * taken at their ghost.
 */
export function clanRegions(
  systems: Systems,
  ghosts: ReadonlyMap<number, MoveGhost>,
  ctx: RenderContext,
): Map<number, Region> {
  const owner = new Map<number, number>();
  for (const s of systems.values()) {
    if (!isHome(s) || s.marauder === null) continue;
    const clan = clanOf(s.marauder);
    owner.set(s.id, clan);
    for (const base of basesBeside(s, systems)) owner.set(base.id, clan);
  }
  if (owner.size === 0) return new Map();
  const reowned: SystemNode[] = [];
  for (const s of systems.values()) {
    const ghost = ghosts.get(s.id);
    reowned.push({ ...s, x: ghost?.x ?? s.x, y: ghost?.y ?? s.y, owner: owner.get(s.id) ?? null });
  }
  const params = {
    radius: ctx.border.system_radius,
    laneHalfWidth: ctx.border.hyperlane_thickness / 2,
  };
  return countryRegions(reowned, params, new Set(owner.values()));
}

/**
 * The marauder clans a scenario places, above the systems: a tag beside each clan home.
 */
export class MarauderLayer implements MapLayer {
  readonly id = "marauders" as const;
  readonly container = new Container();
  private readonly tagsContainer = new Container({ label: "tags", eventMode: "none" });
  private readonly chips = new Map<number, Graphics>();
  private readonly labels = new Map<number, BitmapText>();
  private readonly freeLabels: BitmapText[] = [];
  private ctx: RenderContext = EMPTY_CONTEXT;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private ghosts: ReadonlyMap<number, MoveGhost> = NO_GHOSTS;
  private readonly scale = { x: 1, y: 1 };

  constructor() {
    this.container.eventMode = "none";
    this.container.addChild(this.tagsContainer);
  }

  rebuild(ctx: RenderContext): void {
    const prev = this.ctx;
    this.ctx = ctx;
    this.systems = ctx.systems;
    if (ctx.systems === prev.systems && drawn(ctx) === drawn(prev)) return;
    for (const id of [...this.chips.keys()]) {
      if (!ctx.systems.has(id)) this.remove(id);
    }
    for (const s of ctx.systems.values()) this.place(s);
  }

  applyDelta(d: GalaxyDelta): void {
    for (const id of d.removed ?? []) this.remove(id);
    for (const s of d.systems) this.place(s);
  }

  onViewport(cam: Camera): void {
    cam.childScale(markerScale(cam.scale), this.scale);
    for (const chip of this.chips.values()) chip.scale.set(this.scale.x, this.scale.y);
    for (const [id, label] of this.labels) {
      const chip = this.chips.get(id);
      if (chip) this.placeLabel(label, chip.position);
    }
  }

  /** A dragged home's tag follows its drag ghost, dimmed. */
  setDragState(drag: DragState | null): void {
    const byId = drag?.byId ?? NO_GHOSTS;
    const affected = new Set([...this.ghosts.keys(), ...byId.keys()]);
    this.ghosts = byId;
    for (const id of affected) {
      const s = this.systems.get(id);
      if (s) this.place(s);
    }
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private place(s: SystemNode): void {
    if (!isHome(s) || !drawn(this.ctx)) {
      this.remove(s.id);
      return;
    }
    const ghost = this.ghosts.get(s.id);
    const at = ghost ?? s;
    const alpha = ghost ? GHOST_ALPHA : 1;
    let chip = this.chips.get(s.id);
    if (!chip) {
      chip = new Graphics();
      drawChip(chip);
      this.tagsContainer.addChild(chip);
      this.chips.set(s.id, chip);
    }
    chip.position.set(at.x, at.y);
    chip.alpha = alpha;
    chip.scale.set(this.scale.x, this.scale.y);
    let label = this.labels.get(s.id);
    if (!label) {
      label = this.freeLabels.pop() ?? this.makeLabel();
      label.visible = true;
      this.tagsContainer.addChild(label);
      this.labels.set(s.id, label);
    }
    this.placeLabel(label, at);
    label.alpha = alpha;
  }

  /** The glyph sits on the chip, whose offset from the star grows with the marker's scale. */
  private placeLabel(label: BitmapText, at: Pt): void {
    label.position.set(at.x + TAG_OFFSET.x * this.scale.x, at.y + TAG_OFFSET.y * this.scale.y);
    label.scale.set(this.scale.x, this.scale.y);
  }

  private makeLabel(): BitmapText {
    const label = new BitmapText({ text: HOME_TAG, style: TAG_STYLE });
    label.anchor.set(0.5);
    return label;
  }

  private remove(id: number): void {
    const chip = this.chips.get(id);
    if (chip) {
      this.chips.delete(id);
      chip.destroy();
    }
    const label = this.labels.get(id);
    if (label) {
      this.labels.delete(id);
      label.visible = false;
      this.freeLabels.push(label);
    }
  }
}

interface ClanShape {
  smoothed: Region;
  fill: Graphics;
  edge: Graphics;
}

/**
 * The clans' territories, beneath the lanes and systems and painted the way a save's owners
 * are: each clan's home and the bases hyperlaned to it, filled and edged in the clan's colour.
 * There are at most three, so every change redraws them all.
 */
export class MarauderTerritoryLayer implements MapLayer {
  readonly id = "marauders" as const;
  readonly container = new Container();
  private readonly fills = new Container({ label: "fills" });
  private readonly edges = new Container({ label: "edges" });
  private readonly shapes = new Map<number, ClanShape>();
  private ctx: RenderContext = EMPTY_CONTEXT;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private ghosts: ReadonlyMap<number, MoveGhost> = NO_GHOSTS;
  private unit = 1;

  constructor() {
    this.container.eventMode = "none";
    this.container.addChild(this.fills, this.edges);
  }

  rebuild(ctx: RenderContext): void {
    const prev = this.ctx;
    this.ctx = ctx;
    this.systems = ctx.systems;
    if (ctx.systems === prev.systems && drawn(ctx) === drawn(prev) && ctx.border === prev.border) {
      return;
    }
    this.redraw();
  }

  applyDelta(): void {
    this.redraw();
  }

  /** The edge holds its screen width, so every shape is redrawn when the snapped width changes. */
  onViewport(cam: Camera): void {
    const unit = strokeUnit(cam.scale);
    if (unit === this.unit) return;
    this.unit = unit;
    for (const [clan, shape] of this.shapes) this.drawEdge(clan, shape);
  }

  /** A dragged system's clan is repainted about its ghost, dimmed. */
  setDragState(drag: DragState | null): void {
    this.ghosts = drag?.byId ?? NO_GHOSTS;
    this.redraw();
  }

  setVisible(v: boolean): void {
    this.container.visible = v;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private redraw(): void {
    const regions = drawn(this.ctx)
      ? clanRegions(this.systems, this.ghosts, this.ctx)
      : new Map<number, Region>();
    for (const clan of [...this.shapes.keys()]) if (!regions.has(clan)) this.remove(clan);
    for (const [clan, region] of regions) this.show(clan, region);
  }

  private show(clan: number, region: Region): void {
    let shape = this.shapes.get(clan);
    if (!shape) {
      shape = { smoothed: [], fill: new Graphics(), edge: new Graphics() };
      this.fills.addChild(shape.fill);
      this.edges.addChild(shape.edge);
      this.shapes.set(clan, shape);
    }
    shape.smoothed = smoothRegion(region);
    const dragged = this.ghosts.size > 0;
    shape.fill.alpha = dragged ? GHOST_ALPHA : 1;
    shape.edge.alpha = dragged ? GHOST_ALPHA : 1;
    shape.fill.clear();
    for (const polygon of shape.smoothed) {
      shape.fill
        .poly(polygon[0], true)
        .fill({ color: clanColor(clan), alpha: TERRITORY_FILL_ALPHA });
    }
    this.drawEdge(clan, shape);
  }

  private drawEdge(clan: number, { edge, smoothed }: ClanShape): void {
    edge.clear();
    for (const polygon of smoothed) edge.poly(polygon[0], true);
    edge.stroke({
      color: clanColor(clan),
      width: TERRITORY_EDGE_PX * this.unit,
      alpha: TERRITORY_EDGE_ALPHA,
      join: "round",
    });
  }

  private remove(clan: number): void {
    const shape = this.shapes.get(clan);
    if (!shape) return;
    this.shapes.delete(clan);
    shape.fill.destroy();
    shape.edge.destroy();
  }
}
