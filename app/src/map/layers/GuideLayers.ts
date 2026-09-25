import { BitmapText, Container, type FederatedPointerEvent, Graphics, TextStyle } from "pixi.js";
import type { Guide } from "../../generated/Guide";
import type { LGate } from "../../generated/LGate";
import { lClusterGuide, mapExtent } from "../../lib/guides";
import type { LayerId } from "../../lib/visual/layerIds";
import { ACCENT_COLOR, MAP_FONT } from "../../lib/visual/style";
import { useLGateStore } from "../../store/lgateStore";
import { OwnedTooltip } from "../ownedTooltip";
import type { Camera } from "../Camera";
import { lgateOutcomeLine } from "../../lib/lgate";
import { EMPTY_CONTEXT, type RenderContext } from "../RenderContext";
import { dashedCircle, dashedLine } from "./dashes";
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

/** The L-Cluster's reveal link, coloured to read as something to click. */
const LINK_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 9,
  fontWeight: "700",
  fill: ACCENT_COLOR,
});

/** Screen pixels between the circle's top and the link just inside it. */
const LINK_GAP_PX = 6;
const LINK_ALPHA = 0.8;
const REVEAL_LABEL = "Reveal outcome";
const HIDE_LABEL = "Hide";
const REVEAL_TOOLTIP = "Reveal which outcome the L-Cluster rolled on day one";
const HIDE_TOOLTIP = "Hide the outcome again";

/** Where a shape sits: its centre and the y of its top, in world units. */
interface Placed {
  x: number;
  y: number;
  top: number;
}

function dashedSquare(g: Graphics, half: number): void {
  const corners = [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ];
  corners.forEach((a, i) => dashedLine(g, a, corners[(i + 1) % 4], DASH, GAP));
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
    const extent = mapExtent(ctx.kind, ctx.radius);
    if (extent === null) return null;
    if (extent.shape === "square") {
      dashedSquare(g, extent.half);
      return { x: 0, y: 0, top: -extent.half };
    }
    dashedCircle(g, 0, 0, extent.radius, CIRCLE_DASHES);
    return { x: 0, y: 0, top: -extent.radius };
  }
}

/**
 * Where the game builds the L-Cluster: the fixed circle it spawns into for every galaxy size,
 * or, on a save that already has one, the circle about the systems marked as the cluster. When
 * the document has an L-Gate outcome, a link just inside the circle's top reveals or hides it,
 * in step with the reveal `useLGateStore` holds; a click never reaches the map.
 */
export class LClusterLayer extends GuideLayer {
  readonly id = "lCluster" as const;
  private guide: Guide | null = null;
  private lgate: LGate | null = null;
  private revealed = useLGateStore.getState().revealed;
  private readonly link: BitmapText;
  private linkHovered = false;
  private readonly tip = new OwnedTooltip();

  constructor() {
    super(L_CLUSTER_LABEL);
    // The base guide never answers the pointer; this one's link does, so its container must.
    this.container.eventMode = "passive";
    this.link = new BitmapText({ text: "", style: LINK_STYLE });
    this.link.label = "lgateLink";
    this.link.anchor.set(0.5, 0);
    this.link.alpha = LINK_ALPHA;
    this.link.eventMode = "static";
    this.link.cursor = "pointer";
    this.link.on("pointerdown", (e: FederatedPointerEvent) => this.clickLink(e));
    this.link.on("pointerover", (e: FederatedPointerEvent) => this.hoverLink(e));
    this.link.on("pointerout", () => this.unhoverLink());
    this.container.addChild(this.link);
  }

  /** The circle the layer last drew, in world units; null while nothing is drawn. */
  get circle(): Guide | null {
    return this.guide;
  }

  /** Whether the link shows the outcome or offers to; followed from `useLGateStore` by the map view. */
  setLGateRevealed(revealed: boolean): void {
    if (revealed === this.revealed) return;
    this.revealed = revealed;
    this.placeLink();
  }

  protected same(ctx: RenderContext, prev: RenderContext): boolean {
    return ctx.galaxy === prev.galaxy && ctx.kind === prev.kind && ctx.systems === prev.systems;
  }

  protected draw(g: Graphics, ctx: RenderContext): Placed | null {
    this.guide = lClusterGuide(ctx.kind, ctx.systems.values());
    dashedCircle(g, 0, 0, this.guide.radius, CIRCLE_DASHES);
    return { x: this.guide.x, y: this.guide.y, top: this.guide.y - this.guide.radius };
  }

  rebuild(ctx: RenderContext): void {
    super.rebuild(ctx);
    this.lgate = ctx.lgate;
    this.placeLink();
  }

  onViewport(cam: Camera): void {
    super.onViewport(cam);
    this.placeLink();
  }

  destroy(): void {
    this.unhoverLink();
    super.destroy();
  }

  private placeLink(): void {
    if (this.lgate === null || this.placed === null) {
      this.link.visible = false;
      return;
    }
    this.link.text = this.revealed
      ? `${lgateOutcomeLine(this.lgate)} · ${HIDE_LABEL}`
      : REVEAL_LABEL;
    this.link.scale.set(this.scale.x, this.scale.y);
    this.link.position.set(this.placed.x, this.placed.top + LINK_GAP_PX * this.scale.y);
    this.link.visible = true;
  }

  private clickLink(e: FederatedPointerEvent): void {
    // The map's own pointer handling listens on the canvas outside PixiJS's event system, so
    // the native event must be stopped too or the click would start a marquee or a drag.
    e.stopImmediatePropagation();
    if (e.nativeEvent instanceof Event) e.nativeEvent.stopImmediatePropagation();
    if (this.revealed) useLGateStore.getState().hide();
    else useLGateStore.getState().reveal();
    this.unhoverLink();
  }

  private hoverLink(e: FederatedPointerEvent): void {
    this.linkHovered = true;
    this.link.alpha = 1;
    this.tip.show({
      x: e.global.x,
      y: e.global.y,
      title: L_CLUSTER_LABEL,
      lines: [this.revealed ? HIDE_TOOLTIP : REVEAL_TOOLTIP],
    });
  }

  private unhoverLink(): void {
    if (!this.linkHovered) return;
    this.linkHovered = false;
    this.link.alpha = LINK_ALPHA;
    this.tip.hide();
  }
}
