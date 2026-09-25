import type { BrushTool } from "../../lib/brush/brushTools";
import { provisionalIndex } from "../../lib/brush/lanes";
import type { Pair } from "../../lib/geometry/pairs";
import { stampsAlong } from "../../lib/brush/stroke";
import type { Pt } from "../../lib/geometry/pt";
import { newSeed } from "../../lib/random";
import type { Segment } from "../../lib/geometry/segments";
import { copies, type Symmetry } from "../../lib/geometry/symmetry";
import { useEditorStore } from "../../store/editorStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { effectiveSpacing, useToolStore } from "../../store/toolStore";
import {
  BrushStroke,
  strokeLabel,
  type BrushSettings,
  type StrokeResult,
} from "../../lib/brush/brushStroke";
import type { Camera } from "../Camera";
import type { BrushOverlay, BrushPreview } from "../layers/highlights/BrushOverlay";
import type { SymmetryGuide } from "../layers/highlights/SymmetryGuide";
import type { Systems } from "../RenderContext";
import { SettlingPreview } from "./settlingPreview";

function settingsFor(tool: BrushTool): BrushSettings {
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
  };
}

/** Where what a stroke would do lies on the map; a negative id is the stroke's own point. */
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
  }
}

/**
 * The brush's side of `MapIntent`: the circle at the pointer, one stroke at a time previewed at
 * most once per frame, and the edit it sends on release, whose preview stays until it settles.
 */
export class BrushStrokes {
  private stroke: BrushStroke | null = null;
  /** The symmetry the held stroke was begun with, which a change mid-stroke leaves alone. */
  private held: Symmetry | null = null;
  private tool: BrushTool = "paint";
  private last: Pt | null = null;
  private at: { tool: BrushTool; x: number; y: number } | null = null;
  private frame = 0;
  private readonly preview: SettlingPreview;

  constructor(
    private readonly cam: Camera,
    private readonly overlay: BrushOverlay,
    private readonly guide: SymmetryGuide,
  ) {
    this.preview = new SettlingPreview(() => overlay.setPreview(null));
  }

  hover(tool: BrushTool, x: number, y: number): void {
    this.at = { tool, x, y };
    this.drawCursor();
  }

  /** Draws the circle where the pointer last was, at the current brush size, and its symmetric copies. */
  drawCursor(): void {
    const at = this.at;
    const size = useToolStore.getState().size;
    this.overlay.setCursor(at && { ...at, r: size / 2, symmetry: this.symmetry() });
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

  begin(tool: BrushTool, x: number, y: number): void {
    const { systems, grid } = useGalaxyStore.getState();
    if (!grid) return;
    this.preview.update();
    this.tool = tool;
    const settings = settingsFor(tool);
    this.stroke = new BrushStroke(settings, systems, grid, newSeed());
    this.hold(settings.symmetry);
    this.last = null;
    this.extend(x, y);
  }

  extend(x: number, y: number): void {
    this.hover(this.tool, x, y);
    const stroke = this.stroke;
    if (!stroke) return;
    const next = { x, y };
    stroke.add(stampsAlong(this.last, next, stroke.r));
    this.last = next;
    if (this.frame === 0) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        if (this.stroke) this.draw(this.stroke.result());
      });
    }
  }

  commit(): void {
    const stroke = this.stroke;
    if (!stroke) return;
    this.stopFrame();
    this.stroke = null;
    this.hold(null);
    const result = stroke.result();
    this.draw(result);
    this.preview.settle(send(result));
  }

  cancel(): void {
    this.stroke = null;
    this.hold(null);
    this.stopFrame();
    this.preview.drop();
  }

  end(): void {
    this.at = null;
    this.drawCursor();
  }

  private stopFrame(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private draw(result: StrokeResult): void {
    this.overlay.setPreview(previewOf(result, useGalaxyStore.getState().systems));
    const at = this.at;
    if (!at) {
      this.preview.update();
      return;
    }
    const p = this.cam.worldToScreen(at.x, at.y);
    this.preview.update({ x: p.x, y: p.y, title: strokeLabel(result), lines: [] });
  }
}
