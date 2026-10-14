import type { Pair } from "../../lib/geometry/pairs";
import { dist2, type Pt } from "../../lib/geometry/pt";
import type { Segment } from "../../lib/geometry/segments";
import { provisionalIndex } from "../../lib/placement/lanes";
import type { PendingShape, Shape, ShapeDragMods, ShapePreview } from "../../lib/shapes/types";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { shapePreview } from "../../store/shapePreview";
import { useToolStore } from "../../store/toolStore";
import type { Camera } from "../Camera";
import type { DrawnPositions } from "../drawnPositions";
import type { ShapeDrawing } from "../layers/highlights/ShapeOverlay";
import { specOf } from "../../lib/shapes/specs";
import type { ShapeDrag } from "./MapIntent";

/** How near the galaxy centre or a system a snapped point has to come, in screen pixels. */
const SNAP_PX = 8;
const ORIGIN: Pt = { x: 0, y: 0 };

/** Where the pending shape is drawn. */
export interface ShapeSink {
  setShape(drawing: ShapeDrawing | null): void;
}

/** The point a move carries along: a line's midpoint, any other shape's centre. */
function centreOf(shape: Shape): Pt {
  return shape.kind === "line"
    ? { x: (shape.a.x + shape.b.x) / 2, y: (shape.a.y + shape.b.y) / 2 }
    : shape.centre;
}

/**
 * The Shape tool's side of `MapIntent`: a drag draws, moves or reshapes the pending shape
 * through the tool store, snapped as its keys say, and Esc puts back the shape it started from.
 * The pending shape and what placing it would add are drawn at most once a frame, and a
 * placed shape's systems stay drawn until its edit lands.
 */
export class ShapeDrags {
  /** The pending shape at the drag's first step, which a cancelled drag puts back. */
  private from: PendingShape | null = null;
  private dragging = false;
  private frame = 0;
  private shown: { pending: PendingShape | null; preview: ShapePreview | null } = {
    pending: null,
    preview: null,
  };

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
    this.dragging = false;
    this.from = null;
    if (!cancelled) return;
    const tools = useToolStore.getState();
    if (from) tools.restoreShape(from);
    else tools.dropShape();
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
    if (force) this.shown = { pending: null, preview: null };
    if (this.frame !== 0) return;
    const { pendingShape, placingShape } = useToolStore.getState();
    const idle = pendingShape === null && placingShape === null;
    if (idle && this.shown.pending === null && this.shown.preview === null) return;
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
    const { pendingShape: pending, placingShape } = useToolStore.getState();
    const preview = pending ? shapePreview() : placingShape;
    if (pending === this.shown.pending && preview === this.shown.preview) return;
    this.shown = { pending, preview };
    const shown = pending !== null || preview !== null;
    this.sink.setShape(
      shown ? { pending, preview, lanes: preview ? this.lanes(preview) : [] } : null,
    );
  }

  /** The preview's lanes as segments, a new point's end where it is placed and an existing system's where it draws. */
  private lanes(preview: ShapePreview): Segment[] {
    const systems = this.drawn.sweptSystems()?.systems ?? useGalaxyStore.getState().systems;
    const end = (id: number): Pt | undefined =>
      id < 0 ? preview.points[provisionalIndex(id)] : systems.get(id);
    return preview.pairs.flatMap(([a, b]: Pair): Segment[] => {
      const p = end(a);
      const q = end(b);
      return p && q ? [{ a: p, b: q }] : [];
    });
  }
}
