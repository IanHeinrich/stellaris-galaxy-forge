import { BitmapText, Container, Graphics, TextStyle } from "pixi.js";
import type { StarClassView } from "../../../generated/StarClassView";
import type { MapExtent } from "../../../lib/guides";
import { SAVE_Y_SIGN } from "../../../lib/geometry/geometry";
import type { Rect } from "../../../lib/geometry/polygon";
import type { Pt } from "../../../lib/geometry/pt";
import type { Segment } from "../../../lib/geometry/segments";
import { galaxyFrame } from "../../../lib/shapes/drag";
import { shapeReadout } from "../../../lib/shapes/shapeCopy";
import type {
  HandleLook,
  Outline,
  PendingShape,
  Shape,
  ShapeHandle,
  ShapePreview,
} from "../../../lib/shapes/types";
import { starGlyph } from "../../../lib/visual/starGlyphs";
import { ACCENT_COLOR, HANDLE_COLOR, MAP_FONT } from "../../../lib/visual/style";
import type { Camera } from "../../Camera";
import { runPoints } from "../../../lib/shapes/outline";
import { specOf } from "../../../lib/shapes/specs";
import { dashedCircle } from "../dashes";
import { drawDots, drawLanes } from "./placementMarks";

/** A point left out beside an existing system: hollow, in the muted grey. */
const LEFT_OUT = { color: 0x7f8ca3, alpha: 0.9, radiusPx: 3.4, widthPx: 1.2 };
/** A point past the map's edge, left out. */
const OUTSIDE = { color: 0xff8c66, alpha: 0.9, radiusPx: 3 };
/** An Alt-drag's shape, the rings round the systems it erases, and a kept lane that would cross another. */
const WARN = { color: OUTSIDE.color, alpha: 0.9, radiusPx: 5, widthPx: 1.4 };
/** The galaxy's edge a shape's size is measured against, faint under everything. */
const EDGE = { color: 0x9ca3af, alpha: 0.3 };
const EDGE_DASHES = 96;
/** The pending shape's own line, under its points, so a fill shows where it ends. */
const OUTLINE = { color: ACCENT_COLOR, alpha: 0.3 };
/** Points along the outline: enough for a smooth circle and a spiral's arms, and a polygon's corners are among them. */
const OUTLINE_POINTS = 360;
/** Each look's half-size in screen pixels: the centre square's half side, a round handle's radius. */
const HANDLE_PX: Record<HandleLook, number> = { centre: 5, size: 5.5, turn: 4 };
const HANDLE_STROKE_PX = 1.4;
/** Screen pixels from the lowest handle or point's centre down to the readout's top, clear of the largest handle. */
const READOUT_GAP_PX = 14;

/** Adds each run of `outline` with two or more points to `g`'s path; false when there is none. */
function polyRuns(g: Graphics, { points, runs }: Outline): boolean {
  const drawn = runs.filter((run) => run.count >= 2);
  for (const run of drawn) {
    g.poly(
      runPoints(points, run).flatMap((p) => [p.x, p.y]),
      run.closed,
    );
  }
  return drawn.length > 0;
}

/** One shared instance: PixiJS keys a dynamic bitmap font by the style object. */
const READOUT_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: 11,
  fill: 0xd6dde8,
});

/** An Alt-drag's shape, and where the systems inside it that it erases draw. */
export interface ShapeErasing {
  shape: Shape;
  doomed: readonly Pt[];
}

/**
 * The pending shape and what placing it would add, `preview` null until it is worked out; or,
 * with `pending` null, a placed shape's preview held until its edit lands; or an Alt-drag's
 * shape alone.
 */
export interface ShapeDrawing {
  pending: PendingShape | null;
  preview: ShapePreview | null;
  /** The preview's lanes, each end where it draws. */
  lanes: readonly Segment[];
  /** The lanes an arrange keeps that would cross another, drawn over `lanes` in orange. */
  crossing: readonly Segment[];
  erasing: ShapeErasing | null;
}

/**
 * The Shape tool's pending shape: the systems it would add as points, each in its star's colour
 * where the preview rolled stars and gold otherwise, the points it leaves out hollow beside
 * existing systems and orange past the edge, its lanes, its handles at a fixed size on screen,
 * its own line and the galaxy's edge faintly, and the readout centred below all of it. Arranging,
 * a kept lane that would cross another is orange. A placed shape's points and lanes stay until
 * its edit lands, without the rest. An Alt-drag draws its shape's edge in orange, with an
 * orange ring round each system it erases.
 */
export class ShapeOverlay {
  readonly container = new Container({ label: "shape" });
  private readonly edge = new Graphics({ label: "shapeEdge" });
  private readonly outline = new Graphics({ label: "shapeOutline" });
  private readonly lines = new Graphics({ label: "shapeLines" });
  private readonly marks = new Graphics({ label: "shapeMarks" });
  private readonly handles = new Graphics({ label: "shapeHandles" });
  private readonly readout = new BitmapText({ text: "", style: READOUT_STYLE });
  private drawing: ShapeDrawing | null = null;
  private extent: MapExtent | null = null;
  private starClasses: ReadonlyMap<string, StarClassView> = new Map();
  /** Where the readout hangs: below the lowest handle or point on screen, centred across the shape. */
  private below: Pt = { x: 0, y: 0 };
  private camScale = 1;
  private readonly scale = { x: 1, y: 1 };

  constructor() {
    this.container.eventMode = "none";
    this.readout.anchor.set(0.5, 0);
    this.readout.visible = false;
    this.container.addChild(
      this.edge,
      this.outline,
      this.lines,
      this.marks,
      this.handles,
      this.readout,
    );
  }

  setShape(drawing: ShapeDrawing | null): void {
    this.drawing = drawing;
    this.lines.clear();
    if (drawing) {
      drawLanes(this.lines, drawing.lanes);
      for (const { a, b } of drawing.crossing) this.lines.moveTo(a.x, a.y).lineTo(b.x, b.y);
      if (drawing.crossing.length > 0) {
        this.lines.stroke({ color: WARN.color, alpha: WARN.alpha, pixelLine: true });
      }
    }
    this.drawOutline();
    this.drawEdge();
    this.drawMarks();
  }

  /** The map's edge, which the galaxy edge ring and the readout's size are measured from. */
  setExtent(extent: MapExtent | null): void {
    if (sameExtent(extent, this.extent)) return;
    this.extent = extent;
    this.drawEdge();
    this.drawMarks();
  }

  /** The install's star classes, which colour the stars the preview rolled. */
  setStarClasses(starClasses: ReadonlyMap<string, StarClassView>): void {
    if (starClasses === this.starClasses) return;
    this.starClasses = starClasses;
    this.drawMarks();
  }

  /** The marks and handles keep their size in screen pixels, and the readout its type size. */
  onViewport(cam: Camera): void {
    cam.childScale(1, this.scale);
    this.readout.scale.set(this.scale.x, this.scale.y);
    if (cam.scale === this.camScale) {
      this.placeReadout();
      return;
    }
    this.camScale = cam.scale;
    this.drawMarks();
  }

  private drawOutline(): void {
    const g = this.outline;
    g.clear();
    const erasing = this.drawing?.erasing;
    if (erasing) {
      if (!polyRuns(g, specOf(erasing.shape).edge(erasing.shape, OUTLINE_POINTS))) return;
      g.stroke({ color: WARN.color, alpha: WARN.alpha, pixelLine: true });
      return;
    }
    const pending = this.drawing?.pending;
    if (!pending) return;
    const { shape, fill } = pending;
    const spec = specOf(shape);
    const outline =
      fill.kind === "outline"
        ? spec.outline(shape, OUTLINE_POINTS)
        : spec.edge(shape, OUTLINE_POINTS);
    if (!polyRuns(g, outline)) return;
    g.stroke({ ...OUTLINE, pixelLine: true });
  }

  private drawEdge(): void {
    const g = this.edge;
    g.clear();
    if (!this.drawing?.pending || !this.extent) return;
    const { centre, radius } = galaxyFrame(this.extent);
    dashedCircle(g, centre.x, centre.y, radius, EDGE_DASHES);
    g.stroke({ ...EDGE, pixelLine: true });
  }

  /** Everything drawn to a screen size: the points, the handles and the readout. */
  private drawMarks(): void {
    const g = this.marks;
    g.clear();
    this.handles.clear();
    const d = this.drawing;
    if (!d) {
      this.readout.visible = false;
      return;
    }
    const px = 1 / this.camScale;
    for (const at of d.erasing?.doomed ?? []) g.circle(at.x, at.y, WARN.radiusPx * px);
    if (d.erasing && d.erasing.doomed.length > 0) {
      g.stroke({ color: WARN.color, alpha: WARN.alpha, width: WARN.widthPx * px });
    }
    const p = d.preview;
    if (p) {
      for (const { at } of p.left) g.circle(at.x, at.y, LEFT_OUT.radiusPx * px);
      if (p.left.length > 0) {
        g.stroke({ color: LEFT_OUT.color, alpha: LEFT_OUT.alpha, width: LEFT_OUT.widthPx * px });
      }
      for (const at of p.outside) g.circle(at.x, at.y, OUTSIDE.radiusPx * px);
      if (p.outside.length > 0) g.fill({ color: OUTSIDE.color, alpha: OUTSIDE.alpha });
      drawDots(
        g,
        p.points,
        px,
        p.classes?.map((c) => starGlyph(c, this.starClasses).tint),
      );
    }
    const shape = d.pending?.shape;
    const handles = shape ? specOf(shape).handles(shape) : [];
    for (const h of handles) drawHandle(this.handles, h, px);
    this.drawReadout(handles);
  }

  private drawReadout(handles: readonly ShapeHandle[]): void {
    const d = this.drawing;
    if (!d?.pending || !d.preview || !this.extent) {
      this.readout.visible = false;
      return;
    }
    this.readout.text = shapeReadout(d.pending, d.preview, galaxyFrame(this.extent));
    this.below = belowAll(specOf(d.pending.shape).bounds(d.pending.shape), [
      ...handles.map((h) => h.at),
      ...d.preview.points,
      ...d.preview.left.map((l) => l.at),
      ...d.preview.outside,
    ]);
    this.readout.visible = true;
    this.placeReadout();
  }

  private placeReadout(): void {
    this.readout.position.set(this.below.x, this.below.y + READOUT_GAP_PX * this.scale.y);
  }
}

/** A handle in its look: the square centre, a round size handle, or the small turn handle. */
function drawHandle(g: Graphics, h: ShapeHandle, px: number): void {
  const r = HANDLE_PX[h.look] * px;
  switch (h.look) {
    case "centre":
      g.rect(h.at.x - r, h.at.y - r, 2 * r, 2 * r);
      break;
    case "size":
    case "turn":
      g.circle(h.at.x, h.at.y, r);
      break;
  }
  g.fill({ color: HANDLE_COLOR }).stroke({ color: ACCENT_COLOR, width: HANDLE_STROKE_PX * px });
}

/**
 * The middle of `box` across, at the lowest of its edges and `marks` on screen: world y runs down
 * the screen or up it with `SAVE_Y_SIGN`.
 */
function belowAll(box: Rect, marks: readonly Pt[]): Pt {
  let low = SAVE_Y_SIGN > 0 ? box.y1 : box.y0;
  for (const p of marks) low = SAVE_Y_SIGN > 0 ? Math.max(low, p.y) : Math.min(low, p.y);
  return { x: (box.x0 + box.x1) / 2, y: low };
}

function sameExtent(a: MapExtent | null, b: MapExtent | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.shape === "circle") return b.shape === "circle" && a.radius === b.radius;
  return b.shape === "square" && a.half === b.half;
}
