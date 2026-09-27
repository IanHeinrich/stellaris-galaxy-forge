import { bodyName } from "../../lib/details/labels";
import type { GeometryIntent } from "../../lib/details/orbitEdits";
import type { Pt } from "../../lib/geometry/pt";
import { isEditableTarget } from "../../lib/keys";
import { getTexture, requestTextures } from "../../lib/visual/textures";
import { bodyEntry, useInspectorStore } from "../../store/inspectorStore";
import { useMapChromeStore, type MapTooltip } from "../../store/mapChromeStore";
import { canEnterSystem, useSceneStore } from "../../store/sceneStore";
import type { Camera } from "../Camera";
import type { InputKind } from "../interaction/MapIntent";
import { PointerBridge } from "../interaction/pointerBridge";
import type { Textures } from "../layers/details/cell";
import { planetLines } from "../layers/details/planets";
import { OwnedTooltip } from "../ownedTooltip";
import { beltLabel, sameHandle, type DragStep, type HandleRef } from "./bodyDrag";
import type { SystemContext } from "./context";
import { pickBody, pickExit, pickHandle } from "./picking";
import { SystemGestureModel, type SystemInput, type SystemIntent } from "./SystemGestureModel";

const CTRL_KEYS: ReadonlySet<string> = new Set(["Control", "Meta"]);

/** What the scene's pointer controller reads from the scene and asks of it. */
export interface SceneTarget {
  /** What the scene shows, a preview included. */
  context(): SystemContext;
  /** What the scene shows without a preview, which a drag starts from. */
  frame(): SystemContext;
  /** The body whose shown name plate covers the screen point, or null. */
  plateAt(sx: number, sy: number): number | null;
  hover(body: number | null, exit: number | null, handle: HandleRef | null): void;
  selectLane(neighbour: number | null): void;
  /** Shows where a drag would put things, or drops what was shown. */
  preview(step: DragStep | null): void;
  /** Sends the drag's intent, and keeps its preview until the edit lands. */
  commit(intent: GeometryIntent): void;
  /** Whether a released drag's preview is still up, waiting for its edit to land. */
  holding(): boolean;
}

/** The icon textures the tooltip's lines draw, each asked for the first time it is wanted. */
const TEXTURES: Textures = {
  texture(key) {
    const texture = getTexture(key);
    if (texture === undefined) requestTextures([key]);
    return texture;
  },
  resolve(keys) {
    for (const key of keys) {
      const texture = this.texture(key);
      if (texture !== null) return texture;
    }
    return null;
  },
};

/** The tooltip for what the pointer rests on, without its place, or null for nothing. */
function tipFor(
  ctx: SystemContext,
  body: number | null,
  exit: number | null,
  handle: HandleRef | null,
): Omit<MapTooltip, "x" | "y"> | null {
  if (body !== null) {
    const planet = ctx.bodyById.get(body)?.planet;
    if (!planet) return null;
    return {
      title: bodyName(planet, ctx.names),
      lines: planetLines(ctx, TEXTURES, [planet]),
    };
  }
  const held = handle === null ? undefined : ctx.handles.find((h) => sameHandle(h.ref, handle));
  if (held) {
    const r = `r ${Math.round(held.radius)}`;
    const kind = held.beltKind;
    return {
      title: kind === null ? `Inner radius · ${r}` : `Belt · ${beltLabel(kind)} · ${r}`,
      lines: [],
    };
  }
  const lane = exit === null ? undefined : ctx.exits.find((e) => e.neighbour === exit);
  if (!lane) return null;
  return { title: lane.name, lines: [{ label: "Lane length", value: String(lane.length) }] };
}

/**
 * Turns the canvas's pointer events into `SystemInput` for the scene's gesture model, while the
 * scene is shown, and carries out what the model asks against the scene and the stores.
 */
export class SystemInteraction {
  private readonly model = new SystemGestureModel();
  private readonly intent: SystemIntent;
  private readonly tip = new OwnedTooltip();
  /** What a drag reads out at the pointer. */
  private readonly readout = new OwnedTooltip();
  private readonly pointer: PointerBridge<SystemInput>;
  /** The last hover and its tooltip, kept while the pointer stays on it and the context stands. */
  private hovered: {
    body: number | null;
    exit: number | null;
    handle: HandleRef | null;
    ctx: SystemContext | null;
    tip: Omit<MapTooltip, "x" | "y"> | null;
    sx: number;
    sy: number;
  } = { body: null, exit: null, handle: null, ctx: null, tip: null, sx: 0, sy: 0 };
  private readonly at: Pt = { x: 0, y: 0 };
  /** The last move the pointer made, which a change of Shift or Ctrl feeds to the model again. */
  private lastMove: SystemInput | null = null;
  /** Why the last drag was refused, said in the status bar until the pointer rests elsewhere. */
  private refusal: string | null = null;
  private readonly keyListeners: Array<() => void> = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cam: Camera,
    private readonly scene: SceneTarget,
  ) {
    this.intent = {
      hover: (body, exit, handle, sx, sy) => this.hover(body, exit, handle, sx, sy),
      selectLane: (neighbour) => this.scene.selectLane(neighbour),
      enterSystem: (id) => {
        if (canEnterSystem()) useSceneStore.getState().enterSystem(id);
      },
      contextMenu: (target, x, y) => {
        this.hover(null, null, null, x, y);
        useMapChromeStore.getState().openContextMenu({ target, x, y });
      },
      openBody: (system, id) => this.openBody(system, id),
      showSystem: () => useInspectorStore.getState().popTo(0),
      frame: () => this.scene.frame(),
      preview: (step) => this.preview(step),
      commit: (intent) => {
        this.readout.hide();
        this.scene.commit(intent);
      },
      refuse: (reason) => this.refuse(reason),
    };
    this.pointer = new PointerBridge(
      canvas,
      cam,
      (kind, e) => this.input(kind, e),
      {
        handle: (input) => this.model.handle(input, this.intent),
        cursor: () => this.model.cursor(),
      },
      {
        left: () => {
          if (!this.model.busy()) this.hover(null, null, null, 0, 0);
        },
      },
    );
  }

  activate(): void {
    this.pointer.bind();
    this.bindKeys();
  }

  deactivate(): void {
    for (const off of this.keyListeners.splice(0)) off();
    this.pointer.unbind();
    this.model.cancel(this.intent);
    this.model.reset();
    this.hover(null, null, null, 0, 0);
    this.canvas.style.cursor = "";
  }

  /** Drops a drag in progress, as Esc does. */
  cancelDrag(): void {
    if (!this.model.dragging()) return;
    this.model.cancel(this.intent);
    this.canvas.style.cursor = this.model.cursor();
  }

  /** Forgets the arrow the pointer rests on, whose neighbour an edit has renumbered. */
  dropExit(): void {
    if (this.hovered.exit !== null) this.hover(null, null, null, 0, 0);
  }

  /** Builds the tooltip shown again from the scene's new context, where the pointer rests. */
  contextChanged(): void {
    const { body, exit, handle, sx, sy } = this.hovered;
    if (body !== null || exit !== null || handle !== null) this.hover(body, exit, handle, sx, sy);
  }

  /** Esc drops a gesture and goes no further; Shift or Ctrl going down or up moves a drag again. */
  private bindKeys(): void {
    const down = (e: KeyboardEvent) => {
      this.modifierChanged(e.key, true);
      if (e.key !== "Escape" || isEditableTarget(e.target) || !this.model.busy()) return;
      e.stopImmediatePropagation();
      this.model.cancel(this.intent);
      this.canvas.style.cursor = this.model.cursor();
    };
    const up = (e: KeyboardEvent) => {
      this.modifierChanged(e.key, false);
    };
    // The pointer's release may never reach a window that lost focus mid-drag.
    const blur = () => this.cancelDrag();
    window.addEventListener("keydown", down, { capture: true });
    window.addEventListener("keyup", up, { capture: true });
    window.addEventListener("blur", blur);
    this.keyListeners.push(() => {
      window.removeEventListener("keydown", down, { capture: true });
      window.removeEventListener("keyup", up, { capture: true });
      window.removeEventListener("blur", blur);
    });
  }

  /** Shift or Ctrl went down or up with the pointer still: a drag sees its last move again under it. */
  private modifierChanged(key: string, held: boolean): void {
    const last = this.lastMove;
    if (!last || !this.model.dragging()) return;
    const shift = key === "Shift" ? held : last.shift;
    const ctrl = CTRL_KEYS.has(key) ? held : last.ctrl;
    if (shift === last.shift && ctrl === last.ctrl) return;
    const w = this.cam.screenToWorld(last.sx, last.sy, this.at);
    this.lastMove = { ...last, shift, ctrl, wx: w.x, wy: w.y, scale: this.cam.scale };
    this.pointer.handle(this.lastMove);
  }

  private preview(step: DragStep | null): void {
    this.scene.preview(step);
    const last = this.lastMove;
    if (!step || !last) {
      this.readout.hide();
      return;
    }
    const { text, tone } = step.readout;
    this.readout.show({ title: text, lines: [], x: last.sx, y: last.sy, ...(tone && { tone }) });
  }

  private refuse(reason: string): void {
    this.refusal = reason;
    useMapChromeStore.getState().setSceneHint(reason);
  }

  /** Takes the last refusal out of the status bar, if it is still what the bar says. */
  private dropRefusal(): void {
    if (this.refusal === null) return;
    const chrome = useMapChromeStore.getState();
    if (chrome.sceneHint === this.refusal) chrome.setSceneHint(null);
    this.refusal = null;
  }

  private openBody(system: number, id: number): void {
    const ctx = this.scene.context();
    const planet = ctx.bodyById.get(id)?.planet;
    if (!planet) return;
    const inspector = useInspectorStore.getState();
    inspector.openFromMap(bodyEntry(system, id, bodyName(planet, ctx.names)));
  }

  private hover(
    body: number | null,
    exit: number | null,
    handle: HandleRef | null,
    sx: number,
    sy: number,
  ): void {
    const last = this.hovered;
    const ctx = this.scene.context();
    const moved = body !== last.body || exit !== last.exit || !sameHandle(handle, last.handle);
    if (moved) {
      this.scene.hover(body, exit, handle);
      this.dropRefusal();
    }
    const tip = moved || ctx !== last.ctx ? tipFor(ctx, body, exit, handle) : last.tip;
    this.hovered = { body, exit, handle, ctx, tip, sx, sy };
    if (tip) this.tip.show({ ...tip, x: sx, y: sy });
    else this.tip.hide();
  }

  private input(kind: InputKind, e: PointerEvent): SystemInput {
    const ctx = this.scene.context();
    const w = this.cam.screenToWorld(e.offsetX, e.offsetY, this.at);
    // A disc wins over a plate drawn across it, so a body under another's plate stays pickable.
    const body = pickBody(ctx.bodies, this.cam, w) ?? this.scene.plateAt(e.offsetX, e.offsetY);
    const handle = body === null ? pickHandle(ctx.handles, this.cam, w) : null;
    const own = body === null ? undefined : ctx.editing.bodies.get(body);
    const movable = own?.move === true || own?.detachOnly === true;
    const input: SystemInput = {
      kind,
      sx: e.offsetX,
      sy: e.offsetY,
      wx: w.x,
      wy: w.y,
      button: e.button,
      shift: e.shiftKey === true,
      ctrl: e.ctrlKey === true || e.metaKey === true,
      scale: this.cam.scale,
      time: e.timeStamp,
      system: ctx.id ?? -1,
      body,
      handle,
      exit: body === null && handle === null ? pickExit(ctx.exits, this.cam, w) : null,
      draggable: !this.scene.holding() && (movable || handle !== null),
    };
    if (kind === "move") {
      this.lastMove = input;
      // A move with no button held means the release went elsewhere.
      if (e.buttons === 0) this.cancelDrag();
    }
    return input;
  }
}
