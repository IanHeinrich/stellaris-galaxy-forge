import type { BrushTool } from "../../lib/brush/brushTools";
import { flippedShape, rippleRings, type RippleRing } from "../../lib/brush/heightBrush";
import { provisionalIndex } from "../../lib/brush/lanes";
import type { Pair } from "../../lib/geometry/pairs";
import { stampsAlong } from "../../lib/brush/stroke";
import type { Pt } from "../../lib/geometry/pt";
import { NO_HEIGHT_PREVIEW, type HeightPreview } from "../../lib/height";
import { newSeed } from "../../lib/random";
import type { Segment } from "../../lib/geometry/segments";
import { copies, type Symmetry } from "../../lib/geometry/symmetry";
import { useEditorStore } from "../../store/editorStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useHeightPreviewStore } from "../../store/heightPreviewStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { effectiveSpacing, heightBrush, useToolStore } from "../../store/toolStore";
import {
  BrushStroke,
  strokeLabel,
  type BrushSettings,
  type StrokeResult,
} from "../../lib/brush/brushStroke";
import type { Camera } from "../Camera";
import type { DrawnPositions } from "../drawnPositions";
import type { BrushOverlay, BrushPreview } from "../layers/highlights/BrushOverlay";
import type { SymmetryGuide } from "../layers/highlights/SymmetryGuide";
import type { Systems } from "../RenderContext";
import { SettlingPreview } from "./settlingPreview";

function settingsFor(tool: BrushTool, flipped: boolean): BrushSettings {
  const t = useToolStore.getState();
  return {
    tool,
    size: t.size,
    spacing: effectiveSpacing(t.size, t.spacing),
    laneMode: t.laneMode,
    eraseTarget: t.eraseTarget,
    eraseSpecials: t.eraseSpecials,
    symmetry: t.symmetry,
    beta: useMapChromeStore.getState().meshBeta,
    height: heightBrush(flipped),
  };
}

/** Where the brush is: the tool a press there would use, and whether Alt flips it. */
interface BrushAt {
  tool: BrushTool;
  x: number;
  y: number;
  flipped: boolean;
}

/** The rings of the ripple a click at `at` would drop; none for any other brush. */
function ringsAt(at: BrushAt, r: number): RippleRing[] {
  const t = useToolStore.getState();
  if (at.tool !== "height" || t.heightMode !== "ripple") return [];
  return rippleRings(r, flippedShape(t.ripple, at.flipped));
}

/** Whether a stroke of `settings` drops once, where the button is let go: a ripple does. */
function dropsOnce(settings: BrushSettings): boolean {
  return settings.tool === "height" && settings.height.mode === "ripple";
}

/** Where what a stroke would do draws, `systems` where they draw; a negative id is the stroke's own point. */
function previewOf(result: StrokeResult, systems: Systems): BrushPreview {
  const empty: BrushPreview = { points: [], lanes: [], doomed: [], kept: [], cut: [], swept: [] };
  const at = (ids: readonly number[]) => ids.flatMap((id) => systems.get(id) ?? []);
  const segments = (pairs: readonly Pair[], end: (id: number) => Pt | undefined) =>
    pairs.flatMap(([a, b]): Segment[] => {
      const p = end(a);
      const q = end(b);
      return p && q ? [{ a: p, b: q }] : [];
    });
  const existing = (id: number) => systems.get(id);
  switch (result.kind) {
    case "paint": {
      const end = (id: number): Pt | undefined =>
        id < 0 ? result.points[provisionalIndex(id)] : systems.get(id);
      return { ...empty, points: result.points, lanes: segments(result.pairs, end) };
    }
    case "erase":
      return { ...empty, doomed: at(result.doomed), kept: at(result.kept) };
    case "cut":
      return { ...empty, cut: segments(result.lanes, existing) };
    case "connect":
      return { ...empty, swept: at(result.swept), lanes: segments(result.pairs, existing) };
    case "height":
      return empty;
  }
}

function send(result: StrokeResult): Promise<boolean> {
  const editor = useEditorStore.getState();
  switch (result.kind) {
    case "paint":
      return editor.paintStroke(result.points, result.pairs);
    case "erase":
      return editor.eraseStroke(result.doomed);
    case "cut":
      return editor.cutLanes(result.lanes);
    case "connect":
      return editor.connectStroke(result.pairs);
    case "height":
      return editor.sculptHeights(result.over);
  }
}

/**
 * The brush's side of `MapIntent`: the circle at the pointer, one stroke at a time previewed at
 * most once per frame, and the edit it sends on release, whose preview stays until it settles.
 * The height brush previews through the map's height preview, under the resting pointer as well
 * as during a stroke, and a held ripple follows the pointer until it is let go.
 */
export class BrushStrokes {
  private stroke: BrushStroke | null = null;
  /** The symmetry the held stroke was begun with, which a change mid-stroke leaves alone. */
  private held: Symmetry | null = null;
  private tool: BrushTool = "paint";
  private flipped = false;
  /** Lays the held ripple afresh where the pointer is now; null for any other stroke. */
  private redrop: (() => BrushStroke) | null = null;
  private last: Pt | null = null;
  private at: BrushAt | null = null;
  private frame = 0;
  /** Whether a height edit is on its way, whose preview stays until it lands. */
  private settling = false;
  /** The latest height edit sent, so only its landing takes the preview down. */
  private sent = 0;
  private readonly preview: SettlingPreview;

  constructor(
    private readonly cam: Camera,
    private readonly overlay: BrushOverlay,
    private readonly guide: SymmetryGuide,
    private readonly drawn: DrawnPositions,
  ) {
    this.preview = new SettlingPreview(() => overlay.setPreview(null));
  }

  hover(tool: BrushTool, x: number, y: number, flipped: boolean): void {
    this.at = { tool, x, y, flipped };
    this.drawCursor();
  }

  /**
   * Draws the circle where the pointer last was, at the current brush size, and its symmetric
   * copies; the height brush also previews what a press there would do.
   */
  drawCursor(): void {
    const at = this.at;
    const r = useToolStore.getState().size / 2;
    this.overlay.setCursor(
      at && {
        tool: at.tool,
        x: at.x,
        y: at.y,
        r,
        symmetry: this.symmetry(),
        rings: ringsAt(at, r),
      },
    );
    if (at?.tool === "height" && !this.stroke) this.requestFrame();
  }

  /** The symmetry guides, in every tool while symmetry is on. */
  drawGuide(): void {
    const symmetry = this.symmetry();
    this.guide.set(copies(symmetry) > 1 ? symmetry : null);
  }

  private symmetry(): Symmetry {
    return this.held ?? useToolStore.getState().symmetry;
  }

  private hold(symmetry: Symmetry | null): void {
    this.held = symmetry;
    this.drawGuide();
    this.drawCursor();
  }

  begin(tool: BrushTool, x: number, y: number, flipped: boolean): void {
    const { systems, grid } = useGalaxyStore.getState();
    const swept = this.drawn.sweptSystems();
    if (!grid || !swept) return;
    this.preview.update();
    this.tool = tool;
    this.flipped = flipped;
    const settings = settingsFor(tool, flipped);
    const seed = newSeed();
    const stroke = () => new BrushStroke(settings, systems, grid, seed, swept);
    this.stroke = stroke();
    this.redrop = dropsOnce(settings) ? stroke : null;
    this.hold(settings.symmetry);
    this.last = null;
    this.extend(x, y);
  }

  extend(x: number, y: number): void {
    this.hover(this.tool, x, y, this.flipped);
    if (!this.stroke) return;
    const next = { x, y };
    if (this.redrop) {
      this.stroke = this.redrop();
      this.stroke.add([next]);
    } else {
      this.stroke.add(stampsAlong(this.last, next, this.stroke.r));
    }
    this.last = next;
    this.requestFrame();
  }

  commit(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    this.stopFrame();
    this.stroke = null;
    this.redrop = null;
    this.hold(null);
    const result = stroke.result();
    this.draw(result);
    const sent = send(result);
    if (result.kind === "height") this.settleHeights(sent);
    this.preview.settle(sent);
  }

  cancel(): void {
    this.stroke = null;
    this.redrop = null;
    this.hold(null);
    this.stopFrame();
    this.preview.drop();
    this.clearHeights();
  }

  end(): void {
    this.at = null;
    this.drawCursor();
    if (!this.stroke && !this.settling) this.clearHeights();
  }

  /** Draws the held stroke, or the height brush's preview under the pointer, on the next frame. */
  private requestFrame(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.stroke) this.draw(this.stroke.result());
      else this.previewHover();
    });
  }

  private stopFrame(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Shows what one stamp of the height brush where the pointer rests would do. */
  private previewHover(): void {
    const at = this.at;
    const { systems, grid } = useGalaxyStore.getState();
    if (!at || at.tool !== "height" || this.settling || !grid) return;
    const stroke = new BrushStroke(settingsFor(at.tool, at.flipped), systems, grid, 0, {
      systems,
      grid,
    });
    stroke.add([{ x: at.x, y: at.y }]);
    const result = stroke.result();
    if (result.kind === "height") this.showHeights(result.heights);
  }

  private showHeights(heights: HeightPreview): void {
    useHeightPreviewStore.getState().showBrush(heights);
  }

  private clearHeights(): void {
    this.showHeights(NO_HEIGHT_PREVIEW);
  }

  /**
   * Keeps a height stroke's preview until its edit lands, unless a newer stroke has been sent by
   * then, then previews under the pointer again.
   */
  private settleHeights(sent: Promise<boolean>): void {
    const mine = ++this.sent;
    this.settling = true;
    void sent.finally(() => {
      if (mine !== this.sent) return;
      this.settling = false;
      if (this.stroke) return;
      this.clearHeights();
      this.drawCursor();
    });
  }

  private draw(result: StrokeResult): void {
    if (result.kind === "height") this.showHeights(result.heights);
    const drawn = this.drawn.sweptSystems()?.systems ?? useGalaxyStore.getState().systems;
    this.overlay.setPreview(previewOf(result, drawn));
    const at = this.at;
    if (!at) {
      this.preview.update();
      return;
    }
    const p = this.cam.worldToScreen(at.x, at.y);
    this.preview.update({ x: p.x, y: p.y, title: strokeLabel(result), lines: [] });
  }
}
