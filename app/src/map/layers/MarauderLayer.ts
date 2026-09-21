import { BitmapText, Container, Graphics, TextStyle } from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SystemNode } from "../../generated/SystemNode";
import { basesBeside, clanOf } from "../../lib/marauder";
import { GHOST_ALPHA, MAP_FONT } from "../../lib/visual/style";
import type { Camera } from "../Camera";
import type { MoveGhost } from "../moveGhosts";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { GHOST_STAR_RADIUS, seededBy } from "./ghostSeed";
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

/** One colour per clan, by clan number, for the territory the map paints around its home. */
export const CLAN_COLORS: readonly number[] = [0xef4444, 0x22d3ee, 0xa3e635];

/** How far a clan's territory reaches from its home, in world units: the mod's bases lie within 30. */
export const TERRITORY_RADIUS = 35;
/** How far past its farthest linked base the territory reaches. */
const TERRITORY_MARGIN = 8;

/** The glyph the home's tag carries. */
export const HOME_TAG = "⚔";

/** Tag centre relative to the star, in marker units: the seat chip's mirror, clear of the ring. */
const TAG_OFFSET = { x: 12, y: -12 };
const CHIP = { width: 12, height: 9, radius: 2 };

/** How far from the home the mod's two raid bases are previewed, in world units. */
export const BASE_DISTANCES: readonly number[] = [20, 25];
const DASH = 2;
/** How much fainter the base ghosts are drawn than the tag. */
const BASE_GHOST_ALPHA_FRACTION = 1 / 3;

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

/** Only a scenario written for the mod places clans by initializer; a save's are painted as owners. */
function drawn(ctx: RenderContext): boolean {
  return ctx.kind === "scenario" && ctx.paintLayer;
}

function isHome(s: SystemNode): boolean {
  return s.marauder !== null && "home" in s.marauder;
}

function colorOf(home: SystemNode): number {
  const clan = home.marauder === null ? 1 : clanOf(home.marauder);
  return CLAN_COLORS[clan - 1] ?? CLAN_COLORS[0];
}

/** Where the two bases are previewed, offset from the home, by the home's id. */
export function baseGhosts(id: number): Pt[] {
  const rand = seededBy(id);
  const first = rand() * Math.PI * 2;
  const second = first + Math.PI / 2 + rand() * Math.PI;
  return BASE_DISTANCES.map((distance, i) => {
    const angle = i === 0 ? first : second;
    return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance };
  });
}

function dashedTo(g: Graphics, to: Pt): void {
  const length = Math.hypot(to.x, to.y);
  const ux = to.x / length;
  const uy = to.y / length;
  for (let d = 0; d < length; d += DASH * 2) {
    const end = Math.min(d + DASH, length);
    g.moveTo(ux * d, uy * d).lineTo(ux * end, uy * end);
  }
}

/** The two ghost bases and their dashed lanes back to the home, drawn about the home. */
function drawBaseGhosts(g: Graphics, id: number): void {
  g.clear();
  const bases = baseGhosts(id);
  for (const base of bases) dashedTo(g, base);
  g.stroke({ color: COLOR, alpha: 1, pixelLine: true });
  for (const base of bases) g.circle(base.x, base.y, GHOST_STAR_RADIUS).fill(COLOR);
}

function drawChip(g: Graphics): void {
  const { x, y } = TAG_OFFSET;
  g.clear();
  g.roundRect(x - CHIP.width / 2, y - CHIP.height / 2, CHIP.width, CHIP.height, CHIP.radius).fill({
    color: COLOR,
    alpha: ALPHA,
  });
}

/** How far a clan's territory reaches: at least the mod's, and past every base linked to the home. */
export function territoryRadius(home: SystemNode, at: Pt, systems: Systems): number {
  let radius = TERRITORY_RADIUS;
  for (const base of basesBeside(home, systems)) {
    radius = Math.max(radius, Math.hypot(base.x - at.x, base.y - at.y) + TERRITORY_MARGIN);
  }
  return radius;
}

function drawTerritory(g: Graphics, radius: number, color: number, unit: number): void {
  g.clear();
  g.circle(0, 0, radius)
    .fill({ color, alpha: TERRITORY_FILL_ALPHA })
    .stroke({ color, alpha: TERRITORY_EDGE_ALPHA, width: TERRITORY_EDGE_PX * unit });
}

/** The systems that carry a clan home, placed one by one and re-placed together after a delta. */
abstract class HomesLayer implements MapLayer {
  readonly id = "marauders" as const;
  readonly container = new Container();
  protected ctx: RenderContext = EMPTY_CONTEXT;
  protected systems: Systems = EMPTY_CONTEXT.systems;
  protected ghosts: ReadonlyMap<number, MoveGhost> = NO_GHOSTS;
  private readonly placed = new Set<number>();

  constructor() {
    this.container.eventMode = "none";
  }

  rebuild(ctx: RenderContext): void {
    const prev = this.ctx;
    this.ctx = ctx;
    this.systems = ctx.systems;
    if (ctx.systems === prev.systems && drawn(ctx) === drawn(prev)) return;
    for (const id of [...this.placed]) {
      if (!ctx.systems.has(id)) this.drop(id);
    }
    for (const s of ctx.systems.values()) this.place(s);
  }

  /** A base gained or lost beside a home changes what the home draws, so every home is re-placed. */
  applyDelta(d: GalaxyDelta): void {
    for (const id of d.removed ?? []) this.drop(id);
    const changed = new Set(d.systems.map((s) => s.id));
    for (const s of d.systems) this.place(s);
    for (const id of [...this.placed]) {
      const s = this.systems.get(id);
      if (s && !changed.has(id)) this.place(s);
    }
  }

  abstract onViewport(cam: Camera): void;

  /** A dragged home's drawing follows its drag ghost, dimmed. */
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
      this.drop(s.id);
      return;
    }
    const ghost = this.ghosts.get(s.id);
    this.placed.add(s.id);
    this.placeHome(s, ghost ?? s, ghost ? GHOST_ALPHA : 1);
  }

  private drop(id: number): void {
    this.placed.delete(id);
    this.remove(id);
  }

  protected abstract placeHome(s: SystemNode, at: Pt, alpha: number): void;
  protected abstract remove(id: number): void;
}

/**
 * The marauder clans a Paint a Galaxy scenario places, above the systems: a tag beside each
 * clan home, and, while no raid base of its clan is linked to it, two ghost bases with dashed
 * lanes where the mod adds them on day one.
 */
export class MarauderLayer extends HomesLayer {
  private readonly ghostsContainer = new Container({ label: "baseGhosts", eventMode: "none" });
  private readonly tagsContainer = new Container({ label: "tags", eventMode: "none" });
  private readonly baseGhosts = new Map<number, Graphics>();
  private readonly freeBaseGhosts: Graphics[] = [];
  private readonly chips = new Map<number, Graphics>();
  private readonly labels = new Map<number, BitmapText>();
  private readonly freeLabels: BitmapText[] = [];
  private readonly scale = { x: 1, y: 1 };

  constructor() {
    super();
    this.container.addChild(this.ghostsContainer);
    this.container.addChild(this.tagsContainer);
  }

  onViewport(cam: Camera): void {
    cam.childScale(markerScale(cam.scale), this.scale);
    for (const chip of this.chips.values()) chip.scale.set(this.scale.x, this.scale.y);
    for (const [id, label] of this.labels) {
      const chip = this.chips.get(id);
      if (chip) this.placeLabel(label, chip.position);
    }
  }

  protected placeHome(s: SystemNode, at: Pt, alpha: number): void {
    this.placeTag(s.id, at, alpha);
    if (basesBeside(s, this.systems).length === 0) this.placeBaseGhosts(s.id, at, alpha);
    else this.releaseBaseGhosts(s.id);
  }

  private placeTag(id: number, at: Pt, alpha: number): void {
    let chip = this.chips.get(id);
    if (!chip) {
      chip = new Graphics();
      drawChip(chip);
      this.tagsContainer.addChild(chip);
      this.chips.set(id, chip);
    }
    chip.position.set(at.x, at.y);
    chip.alpha = alpha;
    chip.scale.set(this.scale.x, this.scale.y);
    let label = this.labels.get(id);
    if (!label) {
      label = this.freeLabels.pop() ?? this.makeLabel();
      label.visible = true;
      this.tagsContainer.addChild(label);
      this.labels.set(id, label);
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

  private placeBaseGhosts(id: number, at: Pt, alpha: number): void {
    let g = this.baseGhosts.get(id);
    if (!g) {
      g = this.freeBaseGhosts.pop() ?? new Graphics();
      drawBaseGhosts(g, id);
      g.visible = true;
      this.ghostsContainer.addChild(g);
      this.baseGhosts.set(id, g);
    }
    g.position.set(at.x, at.y);
    g.alpha = alpha * BASE_GHOST_ALPHA_FRACTION;
  }

  private releaseBaseGhosts(id: number): void {
    const g = this.baseGhosts.get(id);
    if (!g) return;
    this.baseGhosts.delete(id);
    g.visible = false;
    this.freeBaseGhosts.push(g);
  }

  protected remove(id: number): void {
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
    this.releaseBaseGhosts(id);
  }
}

/**
 * The clans' territories, beneath the lanes and systems and painted the way a save's owners
 * are: a disc in the clan's colour about each home, wide enough to cover the raid bases linked
 * to it, so a clan is found at any zoom.
 */
export class MarauderTerritoryLayer extends HomesLayer {
  private readonly discs = new Map<number, Graphics>();
  private readonly radii = new Map<number, number>();
  private unit = 1;

  /** The edge holds its screen width, so every disc is redrawn when the snapped width changes. */
  onViewport(cam: Camera): void {
    const unit = strokeUnit(cam.scale);
    if (unit === this.unit) return;
    this.unit = unit;
    for (const [id, g] of this.discs) {
      const s = this.systems.get(id);
      if (s) drawTerritory(g, this.radii.get(id) ?? TERRITORY_RADIUS, colorOf(s), unit);
    }
  }

  protected placeHome(s: SystemNode, at: Pt, alpha: number): void {
    let g = this.discs.get(s.id);
    if (!g) {
      g = new Graphics();
      this.container.addChild(g);
      this.discs.set(s.id, g);
    }
    const radius = territoryRadius(s, at, this.systems);
    this.radii.set(s.id, radius);
    drawTerritory(g, radius, colorOf(s), this.unit);
    g.position.set(at.x, at.y);
    g.alpha = alpha;
  }

  protected remove(id: number): void {
    const g = this.discs.get(id);
    if (!g) return;
    this.discs.delete(id);
    this.radii.delete(id);
    g.destroy();
  }
}
