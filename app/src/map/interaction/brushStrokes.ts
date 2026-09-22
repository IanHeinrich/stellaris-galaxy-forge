import type { Pair, Segment } from "../../lib/brush/lanes";
import { stampsAlong } from "../../lib/brush/stroke";
import type { Pt } from "../../lib/geometry/pt";
import type { Symmetry } from "../../lib/geometry/symmetry";
import { useEditorStore } from "../../store/editorStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useMapChromeStore, type MapTooltip } from "../../store/mapChromeStore";
import { effectiveSpacing, useToolStore } from "../../store/toolStore";
import {
  BrushStroke,
  strokeLabel,
  type BrushSettings,
  type BrushTool,
  type StrokeResult,
} from "../../lib/brush/brushStroke";
import type { Camera } from "../Camera";
import type { BrushPreview, HighlightsLayer } from "../layers/HighlightsLayer";
import type { Systems } from "../RenderContext";

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
export function previewOf(result: StrokeResult, systems: Systems): BrushPreview {
  const empty: BrushPreview = { points: [], lanes: [], doomed: [], kept: [], cut: [], swept: [] };
  const at = (ids: readonly number[]) => ids.flatMap((id) => systems.get(id) ?? []);
  const segments = (pairs: readonly Pair[]) =>
    pairs.flatMap(([a, b]): Segment[] => {
      const p = systems.get(a);
      const q = systems.get(b);
      return p && q ? [[p, q]] : [];
    });
  switch (result.kind) {
    case "paint": {
      const end = (id: number): Pt | undefined =>
        id < 0 ? result.points[-id - 1] : systems.get(id);
      const lanes = result.pairs.flatMap(([a, b]): Segment[] => {
        const p = end(a);
        const q = end(b);
        return p && q ? [[p, q]] : [];
      });
      return { ...empty, points: result.points, lanes };
    }
    case "erase":
      return { ...empty, doomed: at(result.doomed), kept: at(result.kept) };
    case "cut":
      return { ...empty, cut: segments(result.lanes) };
    case "connect":
      return { ...empty, swept: at(result.swept), lanes: segments(result.pairs) };
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
 * most once per frame, and the edit it sends on release. The preview stays until that edit
 * settles, so the map never shows the stroke gone before its systems arrive.
 */
export class BrushStrokes {
  private stroke: BrushStroke | null = null;
  /** The symmetry the held stroke was begun with, which a change mid-stroke leaves alone. */
  private held: Symmetry | null = null;
  private tool: BrushTool = "paint";
  private last: Pt | null = null;
  private at: { tool: BrushTool; x: number; y: number } | null = null;
  private frame = 0;
  private seq = 0;
  private tip: MapTooltip | null = null;

  constructor(
    private readonly cam: Camera,
    private readonly highlights: HighlightsLayer,
  ) {}

  hover(tool: BrushTool, x: number, y: number): void {
    this.at = { tool, x, y };
    this.drawCursor();
  }

  /** Draws the circle where the pointer last was, at the current brush size, and its symmetric copies. */
  drawCursor(): void {
    const at = this.at;
    const size = useToolStore.getState().size;
    this.highlights.setBrushCursor(at && { ...at, r: size / 2, symmetry: this.symmetry() });
  }

  /** The symmetry guides, in every tool while symmetry is on. */
  drawGuide(): void {
    const symmetry = this.symmetry();
    this.highlights.setSymmetryGuide(symmetry.kind === "off" ? null : symmetry);
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
    this.seq++;
    this.tool = tool;
    const seed = Math.floor(Math.random() * 2 ** 32);
    const settings = settingsFor(tool);
    this.stroke = new BrushStroke(settings, systems, grid, seed);
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
    const seq = ++this.seq;
    void send(result).finally(() => {
      if (this.seq === seq) this.clear();
    });
  }

  cancel(): void {
    this.seq++;
    this.stroke = null;
    this.hold(null);
    this.stopFrame();
    this.clear();
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
    this.highlights.setBrushPreview(previewOf(result, useGalaxyStore.getState().systems));
    const at = this.at;
    if (!at) return;
    const p = this.cam.worldToScreen(at.x, at.y);
    this.tip = { x: p.x, y: p.y, title: strokeLabel(result), lines: [] };
    useMapChromeStore.getState().showTooltip(this.tip);
  }

  private clear(): void {
    this.highlights.setBrushPreview(null);
    const chrome = useMapChromeStore.getState();
    if (this.tip && chrome.tooltip === this.tip) chrome.hideTooltip();
    this.tip = null;
  }
}
