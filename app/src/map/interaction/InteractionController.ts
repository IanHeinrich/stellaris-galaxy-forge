import type { Op } from "../../generated/Op";
import { isEditableTarget } from "../../lib/keys";
import { useEditorStore } from "../../store/editorStore";
import { useMapChromeStore, type MapTooltip } from "../../store/mapChromeStore";
import { getPaintLayer } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { useToolStore, type Tool } from "../../store/toolStore";
import { feDirectionLabel, feZoneRefusal } from "../../lib/feZone";
import type { Pt } from "../../lib/geometry/pt";
import type { Camera } from "../Camera";
import type { HighlightsLayer } from "../layers/HighlightsLayer";
import type { DragState, MapLayer } from "../layers/MapLayer";
import type { MoveGhost } from "../moveGhosts";
import { feZonePreview, type FeZonePreview } from "../feZonePreview";
import { nebulaPreview, type NebulaGeometry, type NebulaPreview } from "../nebulaPreview";
import { pickEdge, pickFeZone, pickNebula, pickSystem, snapTarget } from "../picking";
import type { MapEdge } from "../picking/edges";
import { PickIndex } from "../picking/pickIndex";
import { BrushModel } from "./BrushModel";
import { BrushStrokes } from "./brushStrokes";
import { GestureModel } from "./GestureModel";
import { GestureReporter } from "./gesture";
import type { InputKind, LaneSource, MapInput, MapIntent, MapModel } from "./MapIntent";
import { groupOf } from "./press";

const editor = () => useEditorStore.getState();

/** What the cursor says while a nebula drag is open: its members, and the swing either way. */
function readout(preview: NebulaPreview): string {
  const unit = preview.total === 1 ? "system" : "systems";
  return `${preview.total} ${unit} (+${preview.joining.length} −${preview.leaving.length})`;
}

/** The inspector section a click on a ring opens; the section's own id. */
const FE_ZONE_SECTION = "system.feZone";

/** What the cursor says while a ring is dragged: where it would snap, and what is in the way. */
function zoneReadout(preview: FeZonePreview): MapTooltip["lines"] {
  if (preview.blocked) {
    return [feZoneRefusal(preview.blocked, (s) => useGalaxyStore.getState().systemName(s.id))];
  }
  return preview.offMap ? [feZoneRefusal(null, () => "")] : [];
}

/** Opens a section the user has folded, leaving one that is open alone. */
function expandSection(id: string): void {
  const inspector = useInspectorStore.getState();
  if (inspector.collapsed(id, false)) inspector.toggleSection(id, false);
}

function dragState(ghosts: MoveGhost[]): DragState | null {
  if (ghosts.length === 0) return null;
  return { ghosts, byId: new Map(ghosts.map((g) => [g.id, g])) };
}

/**
 * Turns the canvas's pointer events into `MapInput`, feeds them to the active tool's model
 * (ADRs 0003 and 0005) and implements `MapIntent` against the stores and the highlights layer.
 */
export class InteractionController {
  private readonly selectModel: MapModel = new GestureModel();
  private readonly paintModel: MapModel = new BrushModel("paint");
  private readonly eraseModel: MapModel = new BrushModel("erase");
  private readonly connectModel: MapModel = new BrushModel("connect");
  private readonly cutModel: MapModel = new BrushModel("cut");
  private readonly brushes: BrushStrokes;
  private model: MapModel = this.selectModel;
  private readonly intent: MapIntent;
  private panFrom: { sx: number; sy: number } | null = null;
  /** What a lane drag would start from once the button is down; the snap skips it. */
  private laneFrom: LaneSource | null = null;
  /** Offset from the pointer to the pressed system's or nebula's centre, so a move keeps the grab point. */
  private grab = { dx: 0, dy: 0 };
  private hoverEdge: MapEdge | null = null;
  private readonly gesture = new GestureReporter();
  private moveSeq = 0;
  private nebulaSeq = 0;
  private feZoneSeq = 0;
  /** The readout this controller put up, so a drag only ever takes down its own tooltip. */
  private nebulaTip: MapTooltip | null = null;
  /** The pointer in world units, rewritten per event rather than allocated. */
  private readonly at: Pt = { x: 0, y: 0 };
  private readonly index = new PickIndex();
  private readonly cleanups: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cam: Camera,
    private readonly highlights: HighlightsLayer,
    private readonly layers: readonly MapLayer[] = [],
  ) {
    const systems = () => useGalaxyStore.getState().systems;
    const showGhosts = (ghosts: MoveGhost[]) => {
      this.moveSeq++;
      const drag = dragState(ghosts);
      for (const layer of this.layers) layer.setDragState?.(drag);
    };
    const commit = (op: Op) => {
      const seq = ++this.moveSeq;
      void editor()
        .applyOp(op)
        .finally(() => {
          if (this.moveSeq === seq) showGhosts([]);
        });
    };
    const groupGhosts = (ids: number[], dx: number, dy: number): MoveGhost[] =>
      ids.flatMap((id) => {
        const s = systems().get(id);
        return s ? [{ id, x: s.x + dx, y: s.y + dy }] : [];
      });

    const nebulaeNow = () => useGalaxyStore.getState().nebulae;
    const centreOf = (index: number): NebulaGeometry => {
      const n = nebulaeNow()[index];
      return { x: n?.x ?? 0, y: n?.y ?? 0, radius: n?.radius ?? 0 };
    };
    const radiusTo = (index: number, x: number, y: number): NebulaGeometry => {
      const c = centreOf(index);
      return { ...c, radius: Math.hypot(x - c.x, y - c.y) };
    };
    const clearNebula = () => {
      highlights.setNebulaPreview(null);
      const chrome = useMapChromeStore.getState();
      if (this.nebulaTip && chrome.tooltip === this.nebulaTip) chrome.hideTooltip();
      this.nebulaTip = null;
    };
    const showNebulaPreview = (index: number, geometry: NebulaGeometry, wx: number, wy: number) => {
      this.nebulaSeq++;
      const grid = useGalaxyStore.getState().grid;
      const preview = nebulaPreview(systems(), grid, nebulaeNow(), index, geometry);
      highlights.setNebulaPreview(preview);
      const at = cam.worldToScreen(wx, wy);
      this.nebulaTip = { x: at.x, y: at.y, title: readout(preview), lines: [] };
      useMapChromeStore.getState().showTooltip(this.nebulaTip);
    };
    const settleNebula = (applied: Promise<unknown>) => {
      const seq = ++this.nebulaSeq;
      void applied.finally(() => {
        if (this.nebulaSeq === seq) clearNebula();
      });
    };

    const clearFeZone = () => {
      highlights.setFeZonePreview(null);
      const chrome = useMapChromeStore.getState();
      if (this.nebulaTip && chrome.tooltip === this.nebulaTip) chrome.hideTooltip();
      this.nebulaTip = null;
    };
    const showFeZonePreview = (anchor: number, wx: number, wy: number) => {
      this.feZoneSeq++;
      const preview = feZonePreview(systems(), anchor, { x: wx, y: wy });
      highlights.setFeZonePreview(preview);
      if (!preview) return;
      const at = cam.worldToScreen(wx, wy);
      this.nebulaTip = {
        x: at.x,
        y: at.y,
        title: `${feDirectionLabel(preview.direction)} · ${preview.distance}`,
        lines: zoneReadout(preview),
      };
      useMapChromeStore.getState().showTooltip(this.nebulaTip);
    };
    const settleFeZone = (applied: Promise<unknown>) => {
      const seq = ++this.feZoneSeq;
      void applied.finally(() => {
        if (this.feZoneSeq === seq) clearFeZone();
      });
    };
    const linkAll = (anchor: number, ids: number[]) => editor().linkToFeZoneAll(anchor, ids);

    this.intent = {
      select: (id) => {
        void editor().select(id);
      },
      toggleSelect: (id) => {
        void editor().toggleSelect(id);
      },
      selectLane: (lane) => editor().selectLane(lane),
      clearSelection: () => {
        void editor().select(null);
        editor().selectLane(null);
      },
      previewMarquee: (sx0, sy0, sx1, sy1) => {
        const a = cam.screenToWorld(sx0, sy0);
        const b = cam.screenToWorld(sx1, sy1);
        highlights.setMarquee({
          x0: Math.min(a.x, b.x),
          y0: Math.min(a.y, b.y),
          x1: Math.max(a.x, b.x),
          y1: Math.max(a.y, b.y),
        });
      },
      endMarquee: () => highlights.setMarquee(null),
      selectInRect: (x0, y0, x1, y1, mode) => {
        const ids: number[] = [];
        for (const s of systems().values()) {
          if (s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) ids.push(s.id);
        }
        void editor().setSelection(ids, mode);
      },
      previewMove: (id, x, y) => showGhosts([{ id, x: x + this.grab.dx, y: y + this.grab.dy }]),
      commitMove: (id, x, y) =>
        commit({ type: "MoveSystem", id, x: x + this.grab.dx, y: y + this.grab.dy }),
      previewMoveGroup: (ids, dx, dy) => showGhosts(groupGhosts(ids, dx, dy)),
      commitMoveGroup: (ids, dx, dy) =>
        commit({ type: "MoveSystems", moves: groupGhosts(ids, dx, dy) }),
      cancelMove: () => showGhosts([]),
      previewLane: (from, x, y, target) => {
        highlights.setRubberLane({ from, x, y, target });
        this.gesture.connect();
      },
      endLane: () => {
        highlights.setRubberLane(null);
        this.gesture.endConnect();
      },
      connect: (from, target) => {
        if (target.kind === "feZone") {
          if (from.kind === "systems") void linkAll(target.anchor, from.ids);
        } else if (from.kind === "feZone") {
          void linkAll(from.anchor, [target.id]);
        } else if (from.ids.length > 1) {
          void editor().connectSelectedTo(target.id);
        } else {
          void editor().applyOp({ type: "AddLane", a: from.ids[0], b: target.id, bridge: false });
        }
      },
      selectNebula: (index) => editor().selectNebula(index),
      previewNebula: (index, x, y) =>
        showNebulaPreview(
          index,
          { ...centreOf(index), x: x + this.grab.dx, y: y + this.grab.dy },
          x,
          y,
        ),
      commitNebula: (index, x, y) =>
        settleNebula(editor().moveNebula(index, x + this.grab.dx, y + this.grab.dy)),
      previewNebulaRadius: (index, x, y) => showNebulaPreview(index, radiusTo(index, x, y), x, y),
      commitNebulaRadius: (index, x, y) => {
        const { radius } = radiusTo(index, x, y);
        if (radius > 0) settleNebula(editor().setNebulaRadius(index, radius));
        else clearNebula();
      },
      endNebula: () => clearNebula(),
      selectFeZone: (anchor) => {
        void editor().select(anchor);
        expandSection(FE_ZONE_SECTION);
      },
      previewFeZone: (anchor, x, y) => showFeZonePreview(anchor, x, y),
      commitFeZone: (anchor, x, y) => {
        const preview = feZonePreview(systems(), anchor, { x, y });
        if (!preview) {
          clearFeZone();
          return;
        }
        settleFeZone(editor().moveFeZone(anchor, preview.direction, preview.distance));
      },
      endFeZone: () => clearFeZone(),
      cut: (edge) => {
        this.hover(null);
        if (edge.kind === "lane") {
          void editor().applyOp({ type: "RemoveLane", a: edge.lane.a, b: edge.lane.b });
        } else {
          void editor().unlinkFromFeZone(edge.anchor, edge.system);
        }
      },
      contextMenu: (target, x, y) => useMapChromeStore.getState().openContextMenu({ target, x, y }),
      hoverBrush: (tool, x, y) => this.brushes.hover(tool, x, y),
      beginStroke: (tool, x, y) => this.brushes.begin(tool, x, y),
      extendStroke: (x, y) => this.brushes.extend(x, y),
      commitStroke: () => this.brushes.commit(),
      cancelStroke: () => this.brushes.cancel(),
      endBrush: () => this.brushes.end(),
    };
    this.brushes = new BrushStrokes(cam, highlights);

    this.model = this.modelFor(useToolStore.getState().tool);
    this.bindPointer();
    this.bindKeyboard();
    this.index.build(systems());
    this.cleanups.push(
      useToolStore.subscribe((state, previous) => {
        if (state.tool !== previous.tool) this.swapModel(this.modelFor(state.tool));
        if (state.size !== previous.size) this.brushes.drawCursor();
      }),
      useGalaxyStore.subscribe((state, previous) => {
        if (state.version === previous.version) return;
        if (state.galaxy === previous.galaxy && state.lastDelta) {
          this.index.apply(state.lastDelta, state.systems);
        } else {
          this.index.build(state.systems);
        }
      }),
    );
  }

  /** The control model behind `tool`. */
  private modelFor(tool: Tool): MapModel {
    switch (tool) {
      case "paint":
        return this.paintModel;
      case "erase":
        return this.eraseModel;
      case "connect":
        return this.connectModel;
      case "cut":
        return this.cutModel;
      case "select":
        return this.selectModel;
    }
  }

  /** Drops whatever the outgoing model had half done before the next one takes the pointer. */
  private swapModel(next: MapModel): void {
    this.dropDrag();
    this.model = next;
    this.canvas.style.cursor = this.model.cursor();
  }

  private dropDrag(): void {
    this.panFrom = null;
    this.laneFrom = null;
    this.model.reset(this.intent);
  }

  dispose(): void {
    for (const c of this.cleanups.splice(0)) c();
    this.canvas.style.cursor = "";
    this.hoverEdge = null;
    this.gesture.dispose();
    this.brushes.cancel();
  }

  private input(kind: InputKind, e: PointerEvent): MapInput {
    const w = this.cam.screenToWorld(e.offsetX, e.offsetY, this.at);
    const input: MapInput = {
      kind,
      sx: e.offsetX,
      sy: e.offsetY,
      wx: w.x,
      wy: w.y,
      button: e.button,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      alt: e.altKey,
      selection: editor().selection,
      system: null,
      zone: null,
      edge: null,
      midpointHit: false,
      feZone: null,
      snap: null,
      nebula: null,
    };
    return this.model === this.selectModel ? this.pick(input, w) : input;
  }

  /** What is under the pointer; a brush reads only where the pointer is, so it never asks. */
  private pick(input: MapInput, w: Pt): MapInput {
    const { grid, systems, nebulae } = useGalaxyStore.getState();
    const picked = grid ? pickSystem(grid, this.cam, w) : { system: null, zone: null };
    const system = picked.system;
    const layers = useMapChromeStore.getState().layers;
    const zones = layers.feZones && getPaintLayer();
    const { edge, midpointHit } =
      system === null
        ? pickEdge(this.index, systems, this.cam, w, this.hoverEdge, zones)
        : { edge: null, midpointHit: false };
    const feZone =
      zones && system === null && edge === null ? pickFeZone(this.index, this.cam, w) : null;
    const nebula =
      layers.nebulae && system === null && edge === null && feZone === null
        ? pickNebula(nebulae, this.cam, w, editor().selectedNebula)
        : null;
    return {
      ...input,
      system,
      zone: system === null ? (feZone?.zone ?? null) : picked.zone,
      edge,
      midpointHit,
      feZone,
      snap:
        this.laneFrom === null || !grid
          ? null
          : snapTarget(grid, this.index, systems, this.cam, w, this.laneFrom, zones),
      nebula,
    };
  }

  private handle(input: MapInput): "consumed" | "pan" {
    const result = this.model.handle(input, this.intent);
    this.canvas.style.cursor = this.model.cursor();
    return result;
  }

  /** What the pointer rests on, or nothing while it pans or drags. */
  private hover(input: MapInput | null): void {
    const edge = input?.edge ?? null;
    this.hoverEdge = edge;
    editor().setHover(input?.system ?? null);
    this.highlights.setHoverEdge(edge);
    this.highlights.setHoverFeZone(input?.feZone?.anchor ?? null);
    this.highlights.setPortHot(input?.zone === "port");
    this.gesture.hover(edge !== null);
  }

  private bindPointer(): void {
    const canvas = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
    ) => {
      canvas.addEventListener(type, handler);
      this.cleanups.push(() => canvas.removeEventListener(type, handler));
    };

    on("pointerdown", (e) => {
      useMapChromeStore.getState().closeContextMenu();
      const input = this.input("down", e);
      const pressed =
        input.system === null ? null : useGalaxyStore.getState().systems.get(input.system);
      this.laneFrom = pressed
        ? { kind: "systems", ids: groupOf(input.selection, pressed.id) ?? [pressed.id] }
        : input.feZone
          ? { kind: "feZone", anchor: input.feZone.anchor }
          : null;
      const grabbed =
        pressed ??
        (input.nebula?.part === "ring"
          ? useGalaxyStore.getState().nebulae[input.nebula.index]
          : undefined);
      this.grab = grabbed
        ? { dx: grabbed.x - input.wx, dy: grabbed.y - input.wy }
        : { dx: 0, dy: 0 };
      this.panFrom = { sx: input.sx, sy: input.sy };
      canvas.setPointerCapture(e.pointerId);
      this.handle(input);
    });
    on("pointermove", (e) => {
      const input = this.input("move", e);
      if (this.handle(input) === "pan" && this.panFrom) {
        this.cam.panBy(input.sx - this.panFrom.sx, input.sy - this.panFrom.sy);
        this.panFrom = { sx: input.sx, sy: input.sy };
        this.hover(null);
      } else if (this.model.busy() || this.model !== this.selectModel) {
        this.hover(null);
      } else {
        this.hover(input);
      }
    });
    on("pointerup", (e) => {
      this.panFrom = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      this.handle(this.input("up", e));
      this.laneFrom = null;
    });
    on("pointercancel", (e) => {
      this.panFrom = null;
      this.handle(this.input("cancel", e));
      this.laneFrom = null;
    });
    on("pointerleave", () => {
      this.hover(null);
      if (!this.model.busy()) this.brushes.end();
    });
  }

  private bindKeyboard(): void {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || isEditableTarget(e.target)) return;
      if (this.model.busy()) e.stopImmediatePropagation();
      this.dropDrag();
      this.canvas.style.cursor = this.model.cursor();
    };
    window.addEventListener("keydown", down, { capture: true });
    this.cleanups.push(() => window.removeEventListener("keydown", down, { capture: true }));
  }
}
