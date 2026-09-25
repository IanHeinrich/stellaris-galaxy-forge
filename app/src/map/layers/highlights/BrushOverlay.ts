import { Container, Graphics } from "pixi.js";
import { BRUSH_TOOLS, type BrushTool } from "../../../lib/brush/brushTools";
import type { Pt } from "../../../lib/geometry/pt";
import type { Segment } from "../../../lib/geometry/segments";
import { images, type Symmetry } from "../../../lib/geometry/symmetry";
import { ACCENT_COLOR, CAUTION_COLOR, REFUSED_COLOR } from "../../../lib/visual/style";
import { dashedCircle } from "../dashes";

const LANE = { color: ACCENT_COLOR, alpha: 0.9 };
const DASHES = 48;
const DOT_PX = 3;
const RING_PX = 7;
const CUT_PX = 3;
/** The copies of the brush circle a symmetric stroke also lays, fainter than the one at the pointer. */
const IMAGE_ALPHA = 0.45;

/** The brush circle at the pointer, `r` its world radius, with a copy at each image under `symmetry`. */
export interface BrushCursor {
  tool: BrushTool;
  x: number;
  y: number;
  r: number;
  symmetry: Symmetry;
}

/** What a held stroke would do, in world positions. */
export interface BrushPreview {
  /** New systems and the lanes to them. */
  points: readonly Pt[];
  lanes: readonly Segment[];
  /** Systems an erase stroke removes, and the special ones it spares. */
  doomed: readonly Pt[];
  kept: readonly Pt[];
  /** Lanes an erase or cut stroke cuts. */
  cut: readonly Segment[];
  /** Systems a connect stroke has swept, whose new lanes are `lanes`. */
  swept: readonly Pt[];
}

/**
 * The brush circle and what a held stroke would add, remove or cut: a brush that adds in the
 * accent, one that removes in the refusal red.
 */
export class BrushOverlay {
  readonly container = new Container({ label: "brush" });
  private readonly lines = new Graphics({ label: "brushLines" });
  private readonly marks = new Graphics({ label: "brushMarks" });
  private readonly circle = new Graphics({ label: "brushCircle" });
  private preview: BrushPreview | null = null;
  private camScale = 1;

  constructor() {
    this.container.addChild(this.lines, this.marks, this.circle);
  }

  setCursor(cursor: BrushCursor | null): void {
    const g = this.circle;
    g.clear();
    if (!cursor) return;
    dashedCircle(g, cursor.x, cursor.y, cursor.r, DASHES);
    const color = BRUSH_TOOLS[cursor.tool].adds ? ACCENT_COLOR : REFUSED_COLOR;
    g.stroke({ color, alpha: 0.9, pixelLine: true });
    const copies = images(cursor, cursor.symmetry).slice(1);
    for (const p of copies) dashedCircle(g, p.x, p.y, cursor.r, DASHES);
    if (copies.length > 0) g.stroke({ color, alpha: IMAGE_ALPHA, pixelLine: true });
  }

  setPreview(preview: BrushPreview | null): void {
    this.preview = preview;
    const g = this.lines;
    g.clear();
    if (preview) {
      for (const { a, b } of preview.lanes) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      if (preview.lanes.length > 0) g.stroke({ ...LANE, pixelLine: true });
    }
    this.drawMarks();
  }

  /** The marks keep their size in screen pixels. */
  onScale(camScale: number): void {
    if (camScale === this.camScale) return;
    this.camScale = camScale;
    this.drawMarks();
  }

  /** The stroke's new systems as dots, its doomed, spared and swept systems as rings, and the lanes it cuts. */
  private drawMarks(): void {
    const g = this.marks;
    g.clear();
    const p = this.preview;
    if (!p) return;
    const px = 1 / this.camScale;
    for (const { a, b } of p.cut) g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    if (p.cut.length > 0) g.stroke({ color: REFUSED_COLOR, alpha: 0.9, width: CUT_PX * px });
    for (const s of p.points) g.circle(s.x, s.y, DOT_PX * px);
    if (p.points.length > 0) g.fill({ color: ACCENT_COLOR, alpha: 0.9 });
    for (const s of p.doomed) g.circle(s.x, s.y, RING_PX * px);
    if (p.doomed.length > 0) g.stroke({ color: REFUSED_COLOR, alpha: 0.9, width: 2 * px });
    for (const s of p.kept) g.circle(s.x, s.y, RING_PX * px);
    if (p.kept.length > 0) g.stroke({ color: CAUTION_COLOR, alpha: 0.9, width: 2 * px });
    for (const s of p.swept) g.circle(s.x, s.y, RING_PX * px);
    if (p.swept.length > 0) g.stroke({ color: ACCENT_COLOR, alpha: 0.9, width: 2 * px });
  }
}
