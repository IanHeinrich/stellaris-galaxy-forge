import type { BrushTool } from "../../lib/brush/brushTools";
import type { Pt } from "../../lib/geometry/pt";
import { isEditableTarget } from "../../lib/keys";
import type { Tool } from "../../lib/tools";
import { useEditorStore } from "../../store/editorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { getPaintLayer } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useInspectorStore } from "../../store/inspectorStore";
import {
  movedIds,
  movePlan,
  plannedMoveOp,
  plannedMoves,
  type MoveOp,
  type MovePlan,
} from "../../store/symmetricEdits";
import { useToolStore } from "../../store/toolStore";
import type { Camera } from "../Camera";
import type { HighlightsLayer } from "../layers/HighlightsLayer";
import type { DragState, MapLayer } from "../layers/MapLayer";
import type { MoveGhost } from "../moveGhosts";
import {
  pickEdge,
  pickFeZone,
  pickNebula,
  pickPrevented,
  pickSystem,
  snapTarget,
} from "../picking";
import type { MapEdge } from "../picking/edges";
import { PickIndex } from "../picking/pickIndex";
import { trackGalaxy } from "../picking/trackGalaxy";
import { BrushModel } from "./BrushModel";
import { BrushStrokes } from "./brushStrokes";
import { FeZoneDrag } from "./feZoneDrag";
import { GestureModel } from "./GestureModel";
import { GestureReporter } from "./gesture";
import type { InputKind, LaneSource, MapInput, MapIntent, MapModel } from "./MapIntent";
import { NebulaDrag } from "./nebulaDrag";
import { groupOf } from "./press";
import { SettlingPreview } from "./settlingPreview";

const editor = () => useEditorStore.getState();

/** The inspector section a click on a ring opens; the section's own id. */
const FE_ZONE_SECTION = "system.feZone";

/** Opens a section the user has folded, leaving one that is open alone. */
function expandSection(id: string): void {
  const inspector = useInspectorStore.getState();
  if (inspector.collapsed(id, false)) inspector.toggleSection(id, false);
}

function dragState(ghosts: MoveGhost[]): DragState | null {
  if (ghosts.length === 0) return null;
  return { ghosts, byId: new Map(ghosts.map((g) => [g.id, g])) };
}

/** One control model per tool, the brushes each reading the erase target at the press. */
function models(): Record<Tool, MapModel> {
  const eraseTarget = () => useToolStore.getState().eraseTarget;
  const brush = (tool: BrushTool) => new BrushModel(tool, eraseTarget);
  return {
    select: new GestureModel(),
    paint: brush("paint"),
    erase: brush("erase"),
    connect: brush("connect"),
    cut: brush("cut"),
  };
}

/**
 * Turns the canvas's pointer events into `MapInput`, feeds them to the active tool's model
 * (ADRs 0003 and 0005) and implements `MapIntent` against the stores and the highlights layer.
 */
export class InteractionController {
  private readonly models = models();
  private readonly brushes: BrushStrokes;
  private readonly nebulae: NebulaDrag;
  private readonly feZones: FeZoneDrag;
  private readonly moves: SettlingPreview;
  private model: MapModel = this.models.select;
  private readonly intent: MapIntent;
  private panFrom: { sx: number; sy: number } | null = null;
  /** What a lane drag would start from once the button is down; the snap skips it. */
  private laneFrom: LaneSource | null = null;
  /** Offset from the pointer to the pressed system's or nebula's centre, so a move keeps the grab point. */
  private grab = { dx: 0, dy: 0 };
  private hoverEdge: MapEdge | null = null;
  /** The last move over the canvas, so Alt going down or up can be replayed there. */
  private lastMove: MapInput | null = null;
  private readonly gesture = new GestureReporter();
  /** The counterparts the drag in progress carries, found once when it starts. */
  private movePlan: MovePlan | null = null;
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
    this.brushes = new BrushStrokes(cam, highlights.brush, highlights.guide);
    this.nebulae = new NebulaDrag(cam, highlights);
    this.feZones = new FeZoneDrag(cam, highlights);
    this.moves = new SettlingPreview(() => this.showGhosts([]));
    this.intent = this.buildIntent();

    this.model = this.models[useToolStore.getState().tool];
    this.bindPointer();
    this.bindKeyboard();
    this.brushes.drawGuide();
    this.cleanups.push(
      trackGalaxy(this.index),
      useToolStore.subscribe((state, previous) => {
        if (state.tool !== previous.tool) this.swapModel(this.models[state.tool]);
        if (state.symmetry !== previous.symmetry) this.brushes.drawGuide();
        if (state.size !== previous.size || state.symmetry !== previous.symmetry) {
          this.brushes.drawCursor();
        }
      }),
    );
  }

  private showGhosts(ghosts: MoveGhost[]): void {
    const drag = dragState(ghosts);
    for (const layer of this.layers) layer.setDragState?.(drag);
  }

  private buildIntent(): MapIntent {
    const { cam, highlights } = this;
    const systems = () => useGalaxyStore.getState().systems;
    const plan = (ids: readonly number[]) => (this.movePlan ??= movePlan(ids));
    const showMoves = (ids: readonly number[], moves: MoveGhost[]) => {
      this.moves.update();
      this.showGhosts(plannedMoves(plan(ids), moves));
    };
    const commit = (op: MoveOp) => {
      const planned = plannedMoveOp(plan(movedIds(op)), op);
      this.movePlan = null;
      this.moves.settle(editor().applyOp(planned));
    };
    const groupGhosts = (ids: number[], dx: number, dy: number): MoveGhost[] =>
      ids.flatMap((id) => {
        const s = systems().get(id);
        return s ? [{ id, x: s.x + dx, y: s.y + dy }] : [];
      });
    const linkAll = (anchor: number, ids: number[]) => editor().linkToFeZoneAll(anchor, ids);

    return {
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
      previewMove: (id, x, y) =>
        showMoves([id], [{ id, x: x + this.grab.dx, y: y + this.grab.dy }]),
      commitMove: (id, x, y) =>
        commit({ type: "MoveSystem", id, x: x + this.grab.dx, y: y + this.grab.dy }),
      previewMoveGroup: (ids, dx, dy) => showMoves(ids, groupGhosts(ids, dx, dy)),
      commitMoveGroup: (ids, dx, dy) =>
        commit({ type: "MoveSystems", moves: groupGhosts(ids, dx, dy) }),
      cancelMove: () => {
        this.movePlan = null;
        this.moves.drop();
      },
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
          void editor().applySymmetric({
            type: "AddLane",
            a: from.ids[0],
            b: target.id,
            bridge: false,
          });
        }
      },
      selectNebula: (index) => editor().selectNebula(index),
      previewNebula: (index, x, y) =>
        this.nebulae.move(index, x + this.grab.dx, y + this.grab.dy, x, y),
      commitNebula: (index, x, y) =>
        this.nebulae.commitMove(index, x + this.grab.dx, y + this.grab.dy),
      previewNebulaRadius: (index, x, y) => this.nebulae.resize(index, x, y),
      commitNebulaRadius: (index, x, y) => this.nebulae.commitResize(index, x, y),
      endNebula: () => this.nebulae.end(),
      selectFeZone: (anchor) => {
        void editor().select(anchor);
        expandSection(FE_ZONE_SECTION);
      },
      previewFeZone: (anchor, x, y) => this.feZones.move(anchor, x, y),
      commitFeZone: (anchor, x, y) => this.feZones.commit(anchor, x, y),
      endFeZone: () => this.feZones.end(),
      cut: (edge) => {
        this.hover(null);
        if (edge.kind === "lane") {
          void editor().applySymmetric({ type: "RemoveLane", a: edge.lane.a, b: edge.lane.b });
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
  }

  /** Drops whatever the outgoing model had half done before the next one takes the pointer. */
  private swapModel(next: MapModel): void {
    this.dropDrag();
    this.hover(null);
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
      prevented: null,
    };
    return this.model === this.models.select ? this.pick(input, w) : input;
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
    const rightClick = input.kind === "down" && input.button === 2;
    const prevented =
      rightClick && system === null && edge === null ? pickPrevented(systems, this.cam, w) : null;
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
      prevented,
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
      this.lastMove = input;
      if (this.handle(input) === "pan" && this.panFrom) {
        this.cam.panBy(input.sx - this.panFrom.sx, input.sy - this.panFrom.sy);
        this.panFrom = { sx: input.sx, sy: input.sy };
        this.hover(null);
      } else if (this.model.busy() || this.model !== this.models.select) {
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
      this.lastMove = null;
      this.hover(null);
      if (!this.model.busy()) this.brushes.end();
    });
  }

  private bindKeyboard(): void {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt") this.altChanged(true);
      if (e.key !== "Escape" || isEditableTarget(e.target)) return;
      if (this.model.busy()) e.stopImmediatePropagation();
      this.dropDrag();
      this.canvas.style.cursor = this.model.cursor();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt") this.altChanged(false);
    };
    window.addEventListener("keydown", down, { capture: true });
    window.addEventListener("keyup", up, { capture: true });
    this.cleanups.push(() => {
      window.removeEventListener("keydown", down, { capture: true });
      window.removeEventListener("keyup", up, { capture: true });
    });
  }

  /** Alt went down or up with the pointer still: the model sees the move again under it. */
  private altChanged(alt: boolean): void {
    const last = this.lastMove;
    if (!last || last.alt === alt || this.model.busy()) return;
    this.lastMove = { ...last, alt };
    this.handle(this.lastMove);
  }
}
