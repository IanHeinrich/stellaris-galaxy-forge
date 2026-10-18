import type { Pair } from "../../lib/geometry/pairs";
import { dist2, type Pt } from "../../lib/geometry/pt";
import type { Segment } from "../../lib/geometry/segments";
import { provisionalIndex } from "../../lib/placement/lanes";
import { systemsInside } from "../../lib/shapes/erase";
import type { PendingShape, Shape, ShapeDragMods, ShapePreview } from "../../lib/shapes/types";
import { useEditorStore } from "../../store/editorStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { shapePreview } from "../../store/shapePreview";
import { useToolStore } from "../../store/toolStore";
import type { Camera } from "../Camera";
import type { DrawnPositions } from "../drawnPositions";
import type { ShapeDrawing, ShapeErasing } from "../layers/highlights/ShapeOverlay";
import { centreOf, laidShape, specOf } from "../../lib/shapes/specs";
import type { ShapeDrag } from "./MapIntent";

/** How near the galaxy centre or a system a snapped point has to come, in screen pixels. */
const SNAP_PX = 8;
const ORIGIN: Pt = { x: 0, y: 0 };

/** An Alt-drag's shape, and the systems inside it that letting go erases. */
interface Erasing extends ShapeErasing {
  ids: number[];
}

/** Where the pending shape is drawn. */
export interface ShapeSink {
  setShape(drawing: ShapeDrawing | null): void;
}

/**
 * The Shape tool's side of `MapIntent`: a drag draws, moves or reshapes the pending shape
 * through the tool store, snapped as its keys say, and Esc puts back the shape it started from.
 * An Alt-drag draws a shape of its own and, let go, erases the systems inside it, leaving the
 * pending shape as it was.
 * The pending shape and what placing it would add are drawn at most once a frame, and a
 * placed shape's systems stay drawn until its edit lands. With neither, the Special picker's
 * highlighted cluster is drawn the same way.
 */
export class ShapeDrags {
  /** The pending shape at the drag's first step, which a cancelled drag puts back. */
  private from: PendingShape | null = null;
  private dragging = false;
  private erasing: Erasing | null = null;
  private frame = 0;
  private shown: {
    pending: PendingShape | null;
    preview: ShapePreview | null;
    erasing: Erasing | null;
  } = { pending: null, preview: null, erasing: null };

  constructor(
    private readonly cam: Camera,
    private readonly sink: ShapeSink,
    private readonly drawn: DrawnPositions,
  ) {}

  drag(drag: ShapeDrag, x: number, y: number, mods: ShapeDragMods): void {
    const tools = useToolStore.getState();
    if (!this.dragging) {
      this.dragging = true;
      this.from = tools.pendingShape;
    }
    const to = { x, y };
    const from = this.from?.shape;
    switch (drag.kind) {
      case "draw":
        tools.drawShape(this.snapped(drag.anchor, mods), to, mods);
        return;
      case "erase":
        this.erasing = this.erasingTo(this.snapped(drag.anchor, mods), to, mods);
        this.requestFrame(false);
        return;
      case "move": {
        if (!from) return;
        const c = centreOf(from);
        const moved = this.snapped({ x: c.x + x - drag.press.x, y: c.y + y - drag.press.y }, mods);
        tools.moveShape(from, { x: moved.x - c.x, y: moved.y - c.y });
        return;
      }
      case "handle": {
        if (!from) return;
        const handle = specOf(from)
          .handles(from)
          .find((h) => h.id === drag.id);
        const at = handle?.look === "centre" ? this.snapped(to, mods) : to;
        tools.dragShapeHandle(from, drag.id, at, mods);
        return;
      }
    }
  }

  end(cancelled: boolean): void {
    if (!this.dragging) return;
    const from = this.from;
    const erased = cancelled ? [] : (this.erasing?.ids ?? []);
    this.dragging = false;
    this.from = null;
    this.erasing = null;
    this.requestFrame(false);
    if (erased.length > 0) void useEditorStore.getState().eraseStroke(erased);
    const tools = useToolStore.getState();
    if (cancelled) {
      if (from) tools.restoreShape(from);
      else tools.dropShape();
    }
    tools.settleShape();
  }

  /**
   * The shape an Alt-drag from `anchor` to `to` draws, of the pending shape's kind or the last
   * kind drawn, and the systems inside it where they draw that an erase takes.
   */
  private erasingTo(anchor: Pt, to: Pt, mods: ShapeDragMods): Erasing {
    const { pendingShape, shapeMemory, eraseSpecials } = useToolStore.getState();
    const { shape: prev, fill } = pendingShape ?? shapeMemory.kinds[shapeMemory.kind];
    const shape: Shape = laidShape(specOf(prev).fromDrag(anchor, to, mods, prev), fill);
    const systems = this.drawn.sweptSystems()?.systems ?? useGalaxyStore.getState().systems;
    const inside = systemsInside(shape, systems.values(), eraseSpecials);
    return { shape, doomed: inside.map(({ x, y }) => ({ x, y })), ids: inside.map((s) => s.id) };
  }

  /** Redraws the pending shape whenever what it is drawn from may have changed; returns the unsubscribe. */
  watch(): () => void {
    const request = () => this.requestFrame(false);
    const offs = [
      useToolStore.subscribe(request),
      useGalaxyStore.subscribe(request),
      useMapChromeStore.subscribe(request),
      this.drawn.onChange(() => this.requestFrame(true)),
    ];
    this.requestFrame(false);
    return () => {
      for (const off of offs) off();
      this.stopFrame();
    };
  }

  /**
   * `p` moved onto the galaxy centre or the nearest system where it draws, whichever is nearer
   * within the snap radius; `p` itself with snapping off or nothing near.
   */
  private snapped(p: Pt, mods: ShapeDragMods): Pt {
    if (!mods.snap) return p;
    const reach = SNAP_PX / this.cam.scale;
    let best: Pt | null = null;
    let bestD2 = reach * reach;
    if (dist2(ORIGIN, p) <= bestD2) {
      best = ORIGIN;
      bestD2 = dist2(ORIGIN, p);
    }
    const near = this.drawn.sweptSystems()?.grid.nearestSystem(p.x, p.y, reach);
    if (near && dist2(near, p) < bestD2) {
      best = useGalaxyStore.getState().systems.get(near.id) ?? near;
    }
    return best ? { x: best.x, y: best.y } : p;
  }

  private requestFrame(force: boolean): void {
    if (force) this.shown = { pending: null, preview: null, erasing: null };
    if (this.frame !== 0) return;
    const { pendingShape, placingShape } = useToolStore.getState();
    const cluster = useMapChromeStore.getState().clusterPreview;
    const idle =
      pendingShape === null && placingShape === null && cluster === null && this.erasing === null;
    const { pending, preview, erasing } = this.shown;
    if (idle && pending === null && preview === null && erasing === null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private stopFrame(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private draw(): void {
    const tools = useToolStore.getState();
    const erasing = this.erasing;
    // An Alt-drag shows only its own shape while it lasts.
    const pending = erasing ? null : tools.pendingShape;
    const preview = erasing
      ? null
      : pending
        ? shapePreview()
        : (tools.placingShape ?? useMapChromeStore.getState().clusterPreview);
    const was = this.shown;
    if (pending === was.pending && preview === was.preview && erasing === was.erasing) return;
    this.shown = { pending, preview, erasing };
    if (pending === null && preview === null && erasing === null) {
      this.sink.setShape(null);
      return;
    }
    this.sink.setShape({
      pending,
      preview,
      lanes: preview ? this.segments(preview, preview.pairs) : [],
      crossing: preview?.arranged ? this.segments(preview, preview.arranged.crossing) : [],
      erasing,
    });
  }

  /** `pairs` of the preview as segments, a new point's end where it is placed and an existing system's where it draws. */
  private segments(preview: ShapePreview, pairs: readonly Pair[]): Segment[] {
    const systems = this.drawn.sweptSystems()?.systems ?? useGalaxyStore.getState().systems;
    const end = (id: number): Pt | undefined =>
      id < 0 ? preview.points[provisionalIndex(id)] : systems.get(id);
    return pairs.flatMap(([a, b]: Pair): Segment[] => {
      const p = end(a);
      const q = end(b);
      return p && q ? [{ a: p, b: q }] : [];
    });
  }
}
