import { BitmapText, Container, type FederatedPointerEvent, Graphics, TextStyle } from "pixi.js";
import type { Guide } from "../../generated/Guide";
import type { LGate } from "../../generated/LGate";
import { lClusterGuide, SCENARIO_HALF_EXTENT } from "../../lib/guides";
import type { LayerId } from "../../lib/visual/layerIds";
import { ACCENT_COLOR, MAP_FONT } from "../../lib/visual/style";
import { useLGateStore } from "../../store/lgateStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import type { Camera } from "../Camera";
import { lgateOutcomeLine } from "../../lib/lgate";
import { EMPTY_CONTEXT, type RenderContext } from "../RenderContext";
import type { MapLayer } from "./MapLayer";

/** A neutral grey no other layer draws in, faint enough to sit under everything. */
const LINE = { color: 0x9ca3af, alpha: 0.45 };
const DASH = 8;
const GAP = 6;
const CIRCLE_DASHES = 48;

export const MAP_BORDER_LABEL = "Map border";
export const L_CLUSTER_LABEL = "L-Cluster";

/** One shared instance: PixiJS keys a stroked dynamic bitmap font by the style object. */
const LABEL_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 9,
  fontWeight: "700",
  fill: 0x9ca3af,
});

/** Screen pixels between the shape's top and the label above it. */
const LABEL_GAP_PX = 4;

/** One shared instance for the L-Cluster reveal chip's own text, coloured to read as actionable. */
const CHIP_TEXT_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 9,
  fontWeight: "700",
  fill: ACCENT_COLOR,
});

/** Screen pixels between the "L-Cluster" label and the reveal chip beside it. */
const CHIP_GAP_PX = 8;
const CHIP_PAD_X_PX = 6;
const CHIP_PAD_Y_PX = 3;
const CHIP_RADIUS_PX = 3;
const CHIP_FILL = { color: 0x0b0f14, alpha: 0.85 };
const CHIP_BORDER = { color: ACCENT_COLOR, alpha: 0.9 };
const REVEAL_LABEL = "Reveal outcome";
const HIDE_LABEL = "Hide";
const REVEAL_TOOLTIP = "Reveal which outcome the L-Cluster rolled on day one";

/** Where a shape sits: its centre and the y of its top, in world units. */
interface Placed {
  x: number;
  y: number;
  top: number;
}

function dashedLine(g: Graphics, ax: number, ay: number, bx: number, by: number): void {
  const length = Math.hypot(bx - ax, by - ay);
  const ux = (bx - ax) / length;
  const uy = (by - ay) / length;
  for (let at = 0; at < length; at += DASH + GAP) {
    const end = Math.min(at + DASH, length);
    g.moveTo(ax + ux * at, ay + uy * at).lineTo(ax + ux * end, ay + uy * end);
  }
}

function dashedSquare(g: Graphics, half: number): void {
  dashedLine(g, -half, -half, half, -half);
  dashedLine(g, half, -half, half, half);
  dashedLine(g, half, half, -half, half);
  dashedLine(g, -half, half, -half, -half);
}

function dashedCircle(g: Graphics, radius: number): void {
  const step = (Math.PI * 2) / CIRCLE_DASHES;
  for (let i = 0; i < CIRCLE_DASHES; i++) {
    const start = i * step;
    g.moveTo(radius * Math.cos(start), radius * Math.sin(start)).arc(
      0,
      0,
      radius,
      start,
      start + step * 0.6,
    );
  }
}

/**
 * A faint dashed shape, named by a small label just above its top. It is redrawn only when what
 * it is drawn from changes, and never answers the pointer.
 */
abstract class GuideLayer implements MapLayer {
  abstract readonly id: LayerId;
  readonly container = new Container();
  private readonly shape = new Graphics();
  /** The shape's name, in world units so a subclass can lay out more beside it (`LClusterLayer`'s chip). */
  protected readonly label: BitmapText;
  protected readonly scale = { x: 1, y: 1 };
  protected placed: Placed | null = null;
  private shown = true;
  private ctx: RenderContext = EMPTY_CONTEXT;

  constructor(text: string) {
    this.container.eventMode = "none";
    this.label = new BitmapText({ text, style: LABEL_STYLE });
    this.label.anchor.set(0.5, 1);
    this.container.addChild(this.shape);
    this.container.addChild(this.label);
  }

  rebuild(ctx: RenderContext): void {
    const prev = this.ctx;
    this.ctx = ctx;
    if (this.same(ctx, prev)) return;
    this.shape.clear();
    this.placed = ctx.galaxy === null ? null : this.draw(this.shape, ctx);
    if (this.placed !== null) {
      this.shape.stroke({ ...LINE, pixelLine: true });
      this.shape.position.set(this.placed.x, this.placed.y);
    }
    this.placeLabel();
    this.container.visible = this.shown && this.placed !== null;
  }

  applyDelta(): void {
    // A delta comes with a fresh context, and `rebuild` reads the systems from that.
  }

  onViewport(cam: Camera): void {
    cam.childScale(1, this.scale);
    this.label.scale.set(this.scale.x, this.scale.y);
    this.placeLabel();
  }

  setVisible(v: boolean): void {
    this.shown = v;
    this.container.visible = v && this.placed !== null;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  /** Whether the shape drawn from `prev` still stands for `ctx`. */
  protected abstract same(ctx: RenderContext, prev: RenderContext): boolean;

  /**
   * Lays the shape's path down about the graphics' origin and says where it sits. Null when the
   * document gives it nothing to draw.
   */
  protected abstract draw(g: Graphics, ctx: RenderContext): Placed | null;

  private placeLabel(): void {
    if (this.placed === null) return;
    this.label.position.set(this.placed.x, this.placed.top - LABEL_GAP_PX * this.scale.y);
  }
}

/**
 * Where the map ends: the ±500 square a scenario's coordinates must fall in, or the circle of
 * a save's galaxy radius, which the out-of-bounds check measures against.
 */
export class MapBorderLayer extends GuideLayer {
  readonly id = "mapBorder" as const;

  constructor() {
    super(MAP_BORDER_LABEL);
  }

  protected same(ctx: RenderContext, prev: RenderContext): boolean {
    return ctx.galaxy === prev.galaxy && ctx.kind === prev.kind && ctx.radius === prev.radius;
  }

  protected draw(g: Graphics, ctx: RenderContext): Placed | null {
    if (ctx.kind !== "save") {
      dashedSquare(g, SCENARIO_HALF_EXTENT);
      return { x: 0, y: 0, top: -SCENARIO_HALF_EXTENT };
    }
    if (ctx.radius <= 0) return null;
    dashedCircle(g, ctx.radius);
    return { x: 0, y: 0, top: -ctx.radius };
  }
}

/**
 * Where the game builds the L-Cluster: the fixed circle it spawns into for every galaxy size,
 * or, on a save that already has one, the circle about the systems marked as the cluster. When
 * the document has an L-Gate outcome, a small chip beside the label reveals or hides it, in step
 * with the global preference `useLGateStore` holds; a click never reaches the map underneath.
 */
export class LClusterLayer extends GuideLayer {
  readonly id = "lCluster" as const;
  private guide: Guide | null = null;
  private lgate: LGate | null = null;
  private revealed = useLGateStore.getState().revealed;
  private readonly chip = new Graphics({ label: "lgateChip" });
  private readonly chipText: BitmapText;
  private chipHovered = false;

  constructor() {
    super(L_CLUSTER_LABEL);
    // The base guide never answers the pointer; this one's chip does, so its container must.
    this.container.eventMode = "passive";
    this.chip.eventMode = "static";
    this.chip.cursor = "pointer";
    this.chip.on("pointerdown", (e: FederatedPointerEvent) => this.clickChip(e));
    this.chip.on("pointerover", (e: FederatedPointerEvent) => this.hoverChip(e));
    this.chip.on("pointerout", () => this.unhoverChip());
    this.chipText = new BitmapText({ text: "", style: CHIP_TEXT_STYLE });
    this.chipText.label = "lgateChipText";
    this.chipText.anchor.set(0.5, 0.5);
    this.chipText.eventMode = "none";
    this.container.addChild(this.chip, this.chipText);
  }

  /** The circle the layer last drew, in world units; null while nothing is drawn. */
  get circle(): Guide | null {
    return this.guide;
  }

  /** Whether the chip shows the outcome or offers to; followed from `useLGateStore` by the map view. */
  setLGateRevealed(revealed: boolean): void {
    if (revealed === this.revealed) return;
    this.revealed = revealed;
    this.layoutChip();
  }

  protected same(ctx: RenderContext, prev: RenderContext): boolean {
    return ctx.galaxy === prev.galaxy && ctx.kind === prev.kind && ctx.systems === prev.systems;
  }

  protected draw(g: Graphics, ctx: RenderContext): Placed | null {
    this.guide = lClusterGuide(ctx.kind, ctx.systems.values());
    dashedCircle(g, this.guide.radius);
    return { x: this.guide.x, y: this.guide.y, top: this.guide.y - this.guide.radius };
  }

  rebuild(ctx: RenderContext): void {
    super.rebuild(ctx);
    this.lgate = ctx.lgate;
    this.layoutChip();
  }

  onViewport(cam: Camera): void {
    super.onViewport(cam);
    this.layoutChip();
  }

  destroy(): void {
    this.unhoverChip();
    super.destroy();
  }

  /** Redraws the chip beside the label, and keeps the label itself carrying the outcome once revealed. */
  private layoutChip(): void {
    this.label.text =
      this.lgate && this.revealed
        ? `${L_CLUSTER_LABEL} · ${lgateOutcomeLine(this.lgate)}`
        : L_CLUSTER_LABEL;
    if (this.lgate === null || this.placed === null) {
      this.chip.visible = false;
      this.chipText.visible = false;
      return;
    }
    this.chipText.text = this.revealed ? HIDE_LABEL : REVEAL_LABEL;
    this.chipText.scale.set(this.scale.x, this.scale.y);
    const padX = CHIP_PAD_X_PX * this.scale.x;
    const padY = CHIP_PAD_Y_PX * this.scale.y;
    const w = this.chipText.width + padX * 2;
    const h = this.chipText.height + padY * 2;
    const cx = this.label.x + this.label.width / 2 + CHIP_GAP_PX * this.scale.x + w / 2;
    const cy = this.label.y - this.label.height / 2;
    this.chip
      .clear()
      .roundRect(-w / 2, -h / 2, w, h, CHIP_RADIUS_PX * this.scale.x)
      .fill(CHIP_FILL)
      .stroke({ ...CHIP_BORDER, width: this.scale.x });
    this.chip.position.set(cx, cy);
    this.chipText.position.set(cx, cy);
    this.chip.visible = true;
    this.chipText.visible = true;
  }

  private clickChip(e: FederatedPointerEvent): void {
    // The map's own pointer handling listens on the canvas outside PixiJS's event system, so
    // stopping propagation on the FederatedPointerEvent alone would not keep this click from
    // starting a marquee or a drag; the underlying native event must be stopped too.
    e.stopImmediatePropagation();
    if (e.nativeEvent instanceof Event) e.nativeEvent.stopImmediatePropagation();
    if (this.revealed) useLGateStore.getState().hide();
    else useLGateStore.getState().reveal();
    this.unhoverChip();
  }

  private hoverChip(e: FederatedPointerEvent): void {
    if (this.revealed) return;
    this.chipHovered = true;
    useMapChromeStore.getState().showTooltip({
      x: e.global.x,
      y: e.global.y,
      title: L_CLUSTER_LABEL,
      lines: [REVEAL_TOOLTIP],
    });
  }

  private unhoverChip(): void {
    if (!this.chipHovered) return;
    this.chipHovered = false;
    useMapChromeStore.getState().hideTooltip();
  }
}
