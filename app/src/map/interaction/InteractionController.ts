import type { BrushTool } from "../../lib/brush/brushTools";
import type { Pt } from "../../lib/geometry/pt";
import { isEditableTarget } from "../../lib/keys";
import type { Tool } from "../../lib/tools";
import { useEditorStore } from "../../store/editorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { canEnterSystem, useSceneStore } from "../../store/sceneStore";
import { getPaintLayer } from "../../store/fileSessionStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { useToolStore, type ToolState } from "../../store/toolStore";
import type { Camera } from "../Camera";
import type { DrawnPositions } from "../drawnPositions";
import type { HighlightsLayer } from "../layers/HighlightsLayer";
import type { MapLayer } from "../layers/MapLayer";
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
import { AddedTooltip } from "./addedTooltip";
import { BrushModel } from "./BrushModel";
import { BrushStrokes } from "./brushStrokes";
import { FeZoneDrag } from "./feZoneDrag";
import { GestureModel } from "./GestureModel";
import { GestureReporter } from "./gesture";
import type { InputKind, LaneSource, MapInput, MapIntent, MapModel } from "./MapIntent";
import { MoveDrag } from "./moveDrag";
import { NebulaDrag } from "./nebulaDrag";
import { PointerBridge } from "./pointerBridge";
import { groupOf } from "./press";

const editor = () => useEditorStore.getState();

/** The inspector section a click on a ring opens; the section's own id. */
const FE_ZONE_SECTION = "system.feZone";

/** Opens a section the user has folded, leaving one that is open alone. */
function expandSection(id: string): void {
  const inspector = useInspectorStore.getState();
  if (inspector.collapsed(id, false)) inspector.toggleSection(id, false);
}

/** One control model per tool, the brushes each reading the erase target at the press. */
function models(): Record<Tool, MapModel> & { select: GestureModel } {
  const eraseTarget = () => useToolStore.getState().eraseTarget;
  const brush = (tool: BrushTool) => new BrushModel(tool, eraseTarget);
  return {
    select: new GestureModel(),
    paint: brush("paint"),
    erase: brush("erase"),
    connect: brush("connect"),
    cut: brush("cut"),
    height: brush("height"),
  };
}

/** Whether any of the height brush's options moved, which change what it previews. */
function heightOptionsChanged(state: ToolState, previous: ToolState): boolean {
  return (
    state.heightMode !== previous.heightMode ||
    state.heightValue !== previous.heightValue ||
    state.raiseStrength !== previous.raiseStrength ||
    state.smoothStrength !== previous.smoothStrength ||
    state.ripple !== previous.ripple
  );
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
  private readonly moves: MoveDrag;
  private model: MapModel = this.models.select;
  /** The pointer in pick space, where systems and lanes are found as they draw; rewritten per pick. */
  private readonly pickAt: Pt = { x: 0, y: 0 };
  private readonly intent: MapIntent;
  private readonly pointer: PointerBridge<MapInput>;
  private readonly addedTip = new AddedTooltip();
  /** What a lane drag would start from once the button is down; the snap skips it. */
  private laneFrom: LaneSource | null = null;
  /** Offset from the pointer to the pressed system's or nebula's centre, so a move keeps the grab point. */
  private grab = { dx: 0, dy: 0 };
  private hoverEdge: MapEdge | null = null;
  /** The last move over the canvas, so Alt going down or up can be replayed there. */
  private lastMove: MapInput | null = null;
  private readonly gesture = new GestureReporter();
  /** The pointer in world units, rewritten per event rather than allocated. */
  private readonly at: Pt = { x: 0, y: 0 };
  private readonly index: PickIndex;
  private readonly cleanups: Array<() => void> = [];
  /** The key listeners, which only the active scene's controller holds, as it holds the pointer. */
  private readonly keyListeners: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cam: Camera,
    private readonly highlights: HighlightsLayer,
    layers: readonly MapLayer[],
    private readonly drawn: DrawnPositions,
  ) {
    this.index = new PickIndex(drawn);
    this.brushes = new BrushStrokes(cam, highlights.brush, highlights.guide, drawn);
    this.nebulae = new NebulaDrag(cam, highlights);
    this.feZones = new FeZoneDrag(cam, highlights);
    this.moves = new MoveDrag(layers, drawn);
    this.intent = this.buildIntent();
    this.pointer = new PointerBridge(
      canvas,
      cam,
      (kind, e) => this.input(kind, e),
      {
        handle: (input) => this.model.handle(input, this.intent),
        cursor: () => this.model.cursor(),
      },
      {
        pressed: (input) => this.pressed(input),
        moved: (input, panned) => this.moved(input, panned),
        released: () => {
          this.laneFrom = null;
        },
        left: () => {
          this.lastMove = null;
          this.hover(null);
          if (!this.model.busy()) this.brushes.end();
        },
        remeasure: (input) => this.remeasure(input),
      },
    );

    this.model = this.models[useToolStore.getState().tool];
    this.activate();
    this.brushes.drawGuide();
    this.cleanups.push(
      trackGalaxy(this.index),
      drawn.onChange(({ moved, leaned }) => {
        if (leaned) this.index.build(useGalaxyStore.getState().systems);
        else this.index.moved(moved);
      }),
      useToolStore.subscribe((state, previous) => {
        if (state.tool !== previous.tool) this.swapModel(this.models[state.tool]);
        if (state.symmetry !== previous.symmetry) this.brushes.drawGuide();
        if (
          state.size !== previous.size ||
          state.symmetry !== previous.symmetry ||
          heightOptionsChanged(state, previous)
        ) {
          this.brushes.drawCursor();
        }
      }),
    );
  }

  private buildIntent(): MapIntent {
    const { highlights } = this;
    const systems = () => useGalaxyStore.getState().systems;
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
      enterSystem: (id) => {
        if (canEnterSystem()) useSceneStore.getState().enterSystem(id);
      },
      previewMarquee: (x0, y0, x1, y1) => {
        highlights.setMarquee({
          x0: Math.min(x0, x1),
          y0: Math.min(y0, y1),
          x1: Math.max(x0, x1),
          y1: Math.max(y0, y1),
        });
      },
      endMarquee: () => highlights.setMarquee(null),
      selectInRect: (x0, y0, x1, y1, mode) => {
        const ids: number[] = [];
        for (const s of systems().values()) {
          const y = this.drawn.y(s);
          if (s.x >= x0 && s.x <= x1 && y >= y0 && y <= y1) ids.push(s.id);
        }
        void editor().setSelection(ids, mode);
      },
      previewMove: (id, x, y) => this.moves.move(id, x + this.grab.dx, y + this.grab.dy),
      commitMove: (id, x, y) => this.moves.commitMove(id, x + this.grab.dx, y + this.grab.dy),
      previewMoveGroup: (ids, dx, dy) => this.moves.moveGroup(ids, dx, dy),
      commitMoveGroup: (ids, dx, dy) => this.moves.commitGroup(ids, dx, dy),
      cancelMove: () => this.moves.cancel(),
      previewLane: (from, x, y, target) => {
        highlights.laneDrag.setRubber({ from, x, y, target });
        this.gesture.connect();
      },
      endLane: () => {
        highlights.laneDrag.setRubber(null);
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
      contextMenu: (target, x, y) => {
        this.hover(null);
        useMapChromeStore.getState().openContextMenu({ target, x, y });
      },
      hoverBrush: (tool, x, y, flipped) => this.brushes.hover(tool, x, y, flipped),
      beginStroke: (tool, x, y, flipped) => this.brushes.begin(tool, x, y, flipped),
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
    this.pointer.drop();
    this.laneFrom = null;
    this.model.reset(this.intent);
  }

  activate(): void {
    if (this.pointer.bound) return;
    this.pointer.bind();
    this.bindKeyboard();
  }

  /** Keeps a drag under the pointer when the camera moved without it. */
  follow(): void {
    this.pointer.follow();
  }

  deactivate(): void {
    this.unbind();
    this.dropDrag();
    this.brushes.cancel();
    this.hover(null);
    this.lastMove = null;
  }

  private unbind(): void {
    this.pointer.unbind();
    for (const off of this.keyListeners.splice(0)) off();
  }

  dispose(): void {
    this.unbind();
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
      time: e.timeStamp,
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

  /** `input` at the same screen point under the camera as it stands now, picked again. */
  private remeasure(input: MapInput): MapInput {
    const w = this.cam.screenToWorld(input.sx, input.sy, this.at);
    const moved = { ...input, wx: w.x, wy: w.y, selection: editor().selection };
    return this.model === this.models.select ? this.pick(moved, w) : moved;
  }

  /**
   * What is under the pointer: systems and lanes where they draw, zones and nebulae on the
   * plane. A brush reads only where the pointer is, so it never asks.
   */
  private pick(input: MapInput, w: Pt): MapInput {
    const { systems, nebulae } = useGalaxyStore.getState();
    const grid = this.drawn.pickGrid();
    const at = this.drawn.toPick(w, this.pickAt);
    const picked = grid ? pickSystem(grid, this.cam, at) : { system: null, zone: null };
    const system = picked.system;
    const layers = useMapChromeStore.getState().layers;
    const zones = layers.feZones && getPaintLayer();
    const { edge, midpointHit } =
      system === null
        ? pickEdge(this.index, this.cam, at, this.hoverEdge, zones)
        : { edge: null, midpointHit: false };
    const feZone =
      zones && system === null && edge === null ? pickFeZone(this.index, this.cam, w) : null;
    const nebula =
      layers.nebulae && system === null && edge === null && feZone === null
        ? pickNebula(nebulae, this.cam, w, editor().selectedNebula)
        : null;
    const rightClick = input.kind === "down" && input.button === 2;
    const prevented =
      rightClick && system === null && edge === null
        ? pickPrevented(systems, this.cam, at, this.drawn.pickAt)
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
          : snapTarget({
              grid,
              index: this.index,
              systems,
              cam: this.cam,
              at,
              plane: w,
              from: this.laneFrom,
              zones,
            }),
      nebula,
      prevented,
    };
  }

  /** What the pointer rests on, or nothing while it pans or drags. */
  private hover(input: MapInput | null): void {
    const edge = input?.edge ?? null;
    this.hoverEdge = edge;
    editor().setHover(input?.system ?? null);
    if (input) this.addedTip.update(input.system, input.sx, input.sy);
    else this.addedTip.drop();
    this.highlights.setHoverEdge(edge);
    this.highlights.laneDrag.setHoverFeZone(input?.feZone?.anchor ?? null);
    this.highlights.laneDrag.setPortHot(input?.zone === "port");
    this.gesture.hover(edge !== null);
  }

  /** What a lane drag would start from, and where on the system or nebula the press grabbed it. */
  private pressed(input: MapInput): void {
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
    this.grab = grabbed ? { dx: grabbed.x - input.wx, dy: grabbed.y - input.wy } : { dx: 0, dy: 0 };
  }

  private moved(input: MapInput, panned: boolean): void {
    this.lastMove = input;
    if (panned || this.model.busy() || this.model !== this.models.select) {
      this.hover(null);
    } else {
      this.hover(input);
    }
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
    this.keyListeners.push(() => {
      window.removeEventListener("keydown", down, { capture: true });
      window.removeEventListener("keyup", up, { capture: true });
    });
  }

  /** Alt went down or up with the pointer still: the model sees the move again under it. */
  private altChanged(alt: boolean): void {
    const last = this.lastMove;
    if (!last || last.alt === alt || this.model.busy()) return;
    this.lastMove = { ...last, alt };
    this.pointer.handle(this.lastMove);
  }
}
