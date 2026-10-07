import { beltLabel, bodyName } from "../../lib/details/labels";
import { DRAG_HINTS, GEOMETRY_REASONS, type GeometryIntent } from "../../lib/details/orbitIntent";
import type { Pt } from "../../lib/geometry/pt";
import { isEditableTarget } from "../../lib/keys";
import { requestTextures } from "../../lib/visual/textures";
import { bodyEntry, useInspectorStore, wormholeEntry } from "../../store/inspectorStore";
import { useMapChromeStore, type MapTooltip } from "../../store/mapChromeStore";
import { noteScenePointer, planetsCanMove } from "../../store/planetMoveStore";
import { canEnterSystem, useSceneStore } from "../../store/sceneStore";
import type { Camera } from "../Camera";
import type { InputKind } from "../interaction/MapIntent";
import { PointerBridge } from "../interaction/pointerBridge";
import { queuedTextures } from "../layers/details/cell";
import type { Tip } from "../layers/details/Hover";
import { planetLines } from "../layers/details/planets";
import { OwnedTooltip } from "../ownedTooltip";
import { sameHandle, type DragStep, type HandleRef } from "./bodyDrag";
import type { SystemContext } from "./context";
import { handleOwnerAt, idOf, pickTarget, sameTarget, type SceneTarget } from "./picking";
import { SystemGestureModel, type SystemInput, type SystemIntent } from "./SystemGestureModel";

const CTRL_KEYS: ReadonlySet<string> = new Set(["Control", "Meta"]);

/** What the scene's pointer controller reads from the scene and asks of it. */
export interface InteractionScene {
  /** What the scene shows, a preview included. */
  context(): SystemContext;
  /** What the scene shows without a preview, which a drag starts from. */
  frame(): SystemContext;
  /** The body whose shown name plate covers the screen point, or null. */
  plateAt(sx: number, sy: number): number | null;
  /** The tooltip of the mark or resource icon under the screen point on `body`'s name plate, or null. */
  markTipAt(body: number, sx: number, sy: number): Tip | null;
  hover(target: SceneTarget | null): void;
  /** Shows the handles of one band, the one the pointer is over or the one dragged, or none. */
  revealHandles(owner: HandleRef | null): void;
  selectLane(neighbour: number | null): void;
  /** Shows where a drag would put things, or drops what was shown. */
  preview(step: DragStep | null): void;
  /** Sends the drag's intent, and keeps its preview until the edit lands. */
  commit(intent: GeometryIntent): void;
  /** Whether a released drag's preview is still up, waiting for its edit to land. */
  holding(): boolean;
}

/** The tooltip for what the pointer rests on, without its place, or null for nothing. */
function tipFor(
  ctx: SystemContext,
  target: SceneTarget | null,
): Omit<MapTooltip, "x" | "y"> | null {
  if (target === null) return null;
  switch (target.kind) {
    case "body": {
      const planet = ctx.bodyById.get(target.id)?.planet;
      if (!planet) return null;
      const queued = new Set<string>();
      const lines = planetLines(ctx, queuedTextures(queued), [planet]);
      if (queued.size > 0) requestTextures(queued);
      return { title: bodyName(planet, ctx.names), lines };
    }
    case "wormhole": {
      const hole = ctx.wormholes.find((w) => w.id === target.id);
      if (!hole) return null;
      const hint = hole.movable
        ? DRAG_HINTS.movableWormhole
        : hole.natural
          ? null
          : GEOMETRY_REASONS.lockedWormhole;
      return { title: hole.name, lines: hint === null ? [] : [hint] };
    }
    case "handle": {
      const held = ctx.handles.find((h) => sameHandle(h.ref, target.ref));
      if (!held) return null;
      const r = `r ${Math.round(held.radius)}`;
      const kind = held.beltKind;
      return {
        title: kind === null ? `Inner radius · ${r}` : `Belt · ${beltLabel(kind)} · ${r}`,
        lines: [],
      };
    }
    case "exit": {
      const lane = ctx.exits.find((e) => e.neighbour === target.id);
      if (!lane) return null;
      return { title: lane.name, lines: [{ label: "Lane length", value: String(lane.length) }] };
    }
  }
}

/** Whether a left drag from `target` moves something: a body or wormhole that can move, or a handle. */
function movable(ctx: SystemContext, target: SceneTarget | null): boolean {
  if (target === null) return false;
  switch (target.kind) {
    case "body": {
      const own = ctx.editing.bodies.get(target.id);
      return own?.move === true || own?.detachOnly === true;
    }
    case "wormhole":
      return ctx.wormholes.some((hole) => hole.id === target.id && hole.movable);
    case "handle":
      return true;
    case "exit":
      return false;
  }
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
    target: SceneTarget | null;
    ctx: SystemContext | null;
    tip: Omit<MapTooltip, "x" | "y"> | null;
    sx: number;
    sy: number;
  } = { target: null, ctx: null, tip: null, sx: 0, sy: 0 };
  private readonly at: Pt = { x: 0, y: 0 };
  /** The last move the pointer made, which a change of Shift or Ctrl feeds to the model again. */
  private lastMove: SystemInput | null = null;
  /** Why the last drag was refused, said in the status bar until the pointer rests elsewhere. */
  private refusal: string | null = null;
  private readonly keyListeners: Array<() => void> = [];
  /** Whether the last press held Shift or Ctrl, which makes a click on a body toggle it. */
  private pressToggles = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cam: Camera,
    private readonly scene: InteractionScene,
  ) {
    this.intent = {
      hover: (target, sx, sy) => this.hover(target, sx, sy),
      selectLane: (neighbour) => this.scene.selectLane(neighbour),
      enterSystem: (id) => {
        if (canEnterSystem()) useSceneStore.getState().enterSystem(id);
      },
      contextMenu: (target, x, y) => {
        this.hover(null, x, y);
        if (target.kind === "body" && !this.selected(target.id)) {
          this.selectAlone(target.system, target.id);
        }
        useMapChromeStore.getState().openContextMenu({ target, x, y });
      },
      openBody: (system, id) => this.openBody(system, id),
      openWormhole: (system, id) => this.openWormhole(system, id),
      showSystem: () => {
        useSceneStore.getState().clearBodies();
        useInspectorStore.getState().popTo(0);
      },
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
          noteScenePointer(null);
          if (this.model.busy()) return;
          this.hover(null, 0, 0);
          this.scene.revealHandles(null);
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
    this.hover(null, 0, 0);
    this.scene.revealHandles(null);
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
    if (this.hovered.target?.kind === "exit") this.hover(null, 0, 0);
  }

  /** Builds the tooltip shown again from the scene's new context, where the pointer rests. */
  contextChanged(): void {
    const { target, sx, sy } = this.hovered;
    if (target !== null) this.hover(target, sx, sy);
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

  /** A click on a body selects it and opens its page; with Shift or Ctrl it toggles it instead. */
  private openBody(system: number, id: number): void {
    if (!this.scene.context().bodyById.get(id)?.planet) return;
    // A drag opens its body's page as it starts, while the model is still busy with the press.
    if (this.pressToggles && !this.model.busy() && planetsCanMove()) {
      useSceneStore.getState().toggleBody(system, id);
    } else {
      this.selectAlone(system, id);
    }
  }

  /** A click on a wormhole selects it alone and opens its page. */
  private openWormhole(system: number, id: number): void {
    const hole = this.scene.context().wormholes.find((w) => w.id === id);
    if (!hole) return;
    useSceneStore.getState().clearBodies();
    useInspectorStore.getState().openFromMap(wormholeEntry(system, id, hole.plateName));
  }

  private selectAlone(system: number, id: number): void {
    useSceneStore.getState().selectBody(system, id);
    this.showBody(system, id);
  }

  private showBody(system: number, id: number): void {
    const ctx = this.scene.context();
    const planet = ctx.bodyById.get(id)?.planet;
    if (!planet) return;
    useInspectorStore.getState().openFromMap(bodyEntry(system, id, bodyName(planet, ctx.names)));
  }

  private selected(id: number): boolean {
    return useSceneStore.getState().bodySelection?.ids.includes(id) === true;
  }

  private hover(target: SceneTarget | null, sx: number, sy: number): void {
    const last = this.hovered;
    const ctx = this.scene.context();
    const moved = !sameTarget(target, last.target);
    if (moved) {
      this.scene.hover(target);
      this.dropRefusal();
    }
    const own = moved || ctx !== last.ctx ? tipFor(ctx, target) : last.tip;
    this.hovered = { target, ctx, tip: own, sx, sy };
    const body = idOf(target, "body");
    const tip = (body === null ? null : this.scene.markTipAt(body, sx, sy)) ?? own;
    if (tip) this.tip.show({ ...tip, x: sx, y: sy });
    else this.tip.hide();
  }

  private input(kind: InputKind, e: PointerEvent): SystemInput {
    const ctx = this.scene.context();
    const w = this.cam.screenToWorld(e.offsetX, e.offsetY, this.at);
    const shown = ctx.drag?.handle ?? handleOwnerAt(ctx, this.cam, w);
    this.scene.revealHandles(shown);
    const plateAt = () => this.scene.plateAt(e.offsetX, e.offsetY);
    const target = pickTarget(ctx, this.cam, w, plateAt, shown);
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
      system: ctx.id,
      target,
      draggable: !this.scene.holding() && movable(ctx, target),
    };
    if (kind === "down") this.pressToggles = input.shift || input.ctrl;
    if (kind === "move") {
      this.lastMove = input;
      noteScenePointer(ctx.id === null ? null : { system: ctx.id, x: w.x, y: w.y });
      // A move with no button held means the release went elsewhere.
      if (e.buttons === 0) this.cancelDrag();
    }
    return input;
  }
}
