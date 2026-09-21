import {
  BitmapText,
  Container,
  type FederatedPointerEvent,
  Graphics,
  Rectangle,
  TextStyle,
} from "pixi.js";
import type { GalaxyDelta } from "../../generated/GalaxyDelta";
import type { SystemNode } from "../../generated/SystemNode";
import { BASE_SITES, basesBeside, clanOf, isHome } from "../../lib/marauder";
import { MARAUDER_COLOR } from "../../lib/visual/ownerColors";
import { GHOST_ALPHA, MAP_FONT } from "../../lib/visual/style";
import type { Camera } from "../Camera";
import { useMapChromeStore } from "../../store/mapChromeStore";
import type { MoveGhost } from "../moveGhosts";
import { EMPTY_CONTEXT, type RenderContext, type Systems } from "../RenderContext";
import { markerScale, type DragState, type MapLayer } from "./MapLayer";

const CHIP_ALPHA = 0.95;

/** The glyph the home's tag carries. */
export const HOME_TAG = "⚔";

/** Tag centre relative to the star, in marker units: the seat chip's mirror, clear of the ring. */
const TAG_OFFSET = { x: 12, y: -12 };
const CHIP = { width: 12, height: 9, radius: 2 };
const HIT_PAD = 2;

/** The chip's own hit area, around its offset centre, so the star's hover and drag stay free. */
const HIT = new Rectangle(
  TAG_OFFSET.x - CHIP.width / 2 - HIT_PAD,
  TAG_OFFSET.y - CHIP.height / 2 - HIT_PAD,
  CHIP.width + 2 * HIT_PAD,
  CHIP.height + 2 * HIT_PAD,
);

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

/** Only a scenario places clans by initializer; a save's clans are its own countries. */
function drawn(ctx: RenderContext): boolean {
  return ctx.kind === "scenario";
}

function drawChip(g: Graphics): void {
  const { x, y } = TAG_OFFSET;
  g.clear();
  g.roundRect(x - CHIP.width / 2, y - CHIP.height / 2, CHIP.width, CHIP.height, CHIP.radius).fill({
    color: MARAUDER_COLOR,
    alpha: CHIP_ALPHA,
  });
}

/** The tooltip's line on the raid bases hyperlaned to the home, and how many of the two are not. */
function raidBasesLine(names: readonly string[]): string {
  if (names.length === 0) return "Raid bases: missing";
  const listed = names.join(", ");
  return names.length < BASE_SITES.length
    ? `Raid bases: ${listed}, one missing`
    : `Raid bases: ${listed}`;
}

/**
 * The marauder clans a scenario places, above the systems: a tag beside each clan home, which
 * names the clan and its raid bases while the pointer is on it. The clans' territories are
 * the owners layer's, from the composed ownership.
 */
export class MarauderLayer implements MapLayer {
  readonly id = "marauders" as const;
  readonly container = new Container();
  private readonly tagsContainer = new Container({ label: "tags" });
  private readonly chips = new Map<number, Graphics>();
  private readonly labels = new Map<number, BitmapText>();
  private readonly freeLabels: BitmapText[] = [];
  private ctx: RenderContext = EMPTY_CONTEXT;
  private systems: Systems = EMPTY_CONTEXT.systems;
  private ghosts: ReadonlyMap<number, MoveGhost> = NO_GHOSTS;
  private hovered: number | null = null;
  private readonly scale = { x: 1, y: 1 };

  constructor() {
    this.container.eventMode = "passive";
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
      chip = this.makeChip(s.id);
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

  private makeChip(id: number): Graphics {
    const g = new Graphics();
    drawChip(g);
    g.eventMode = "static";
    g.cursor = "help";
    g.hitArea = HIT;
    g.on("pointerover", (e: FederatedPointerEvent) => this.hover(id, e.global));
    g.on("pointerout", () => this.unhover(id));
    this.tagsContainer.addChild(g);
    return g;
  }

  private hover(id: number, at: Pt): void {
    const s = this.systems.get(id);
    if (!s || !isHome(s) || s.marauder === null) return;
    this.hovered = id;
    const bases = basesBeside(s, this.systems).map((base) => this.ctx.nodeName(base.name));
    useMapChromeStore.getState().showTooltip({
      x: at.x,
      y: at.y,
      title: `Marauder clan ${clanOf(s.marauder)} home`,
      lines: [raidBasesLine(bases)],
    });
  }

  private unhover(id: number): void {
    if (this.hovered !== id) return;
    this.hovered = null;
    useMapChromeStore.getState().hideTooltip();
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
      this.unhover(id);
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
