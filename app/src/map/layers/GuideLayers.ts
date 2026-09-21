import { BitmapText, Container, Graphics, TextStyle } from "pixi.js";
import type { Guide } from "../../generated/Guide";
import { lClusterGuide, SCENARIO_HALF_EXTENT } from "../../lib/guides";
import type { LayerId } from "../../lib/visual/layerIds";
import { MAP_FONT } from "../../lib/visual/style";
import type { Camera } from "../Camera";
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
  private readonly label: BitmapText;
  private readonly scale = { x: 1, y: 1 };
  private placed: Placed | null = null;
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
 * or, on a save that already has one, the circle about the systems marked as the cluster.
 */
export class LClusterLayer extends GuideLayer {
  readonly id = "lCluster" as const;
  private guide: Guide | null = null;

  constructor() {
    super(L_CLUSTER_LABEL);
  }

  /** The circle the layer last drew, in world units; null while nothing is drawn. */
  get circle(): Guide | null {
    return this.guide;
  }

  protected same(ctx: RenderContext, prev: RenderContext): boolean {
    return ctx.galaxy === prev.galaxy && ctx.kind === prev.kind && ctx.systems === prev.systems;
  }

  protected draw(g: Graphics, ctx: RenderContext): Placed | null {
    this.guide = lClusterGuide(ctx.kind, ctx.systems.values());
    dashedCircle(g, this.guide.radius);
    return { x: this.guide.x, y: this.guide.y, top: this.guide.y - this.guide.radius };
  }
}
