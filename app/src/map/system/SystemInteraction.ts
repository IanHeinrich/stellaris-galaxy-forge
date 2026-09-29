import { bodyName } from "../../lib/details/labels";
import { DRAG_HINTS, GEOMETRY_REASONS, type GeometryIntent } from "../../lib/details/orbitEdits";
import type { Pt } from "../../lib/geometry/pt";
import { isEditableTarget } from "../../lib/keys";
import { getTexture, requestTextures } from "../../lib/visual/textures";
import { bodyEntry, useInspectorStore, wormholeEntry } from "../../store/inspectorStore";
import { useMapChromeStore, type MapTooltip } from "../../store/mapChromeStore";
import { planetsCanMove, usePlanetMoveStore } from "../../store/planetMoveStore";
import { canEnterSystem, useSceneStore } from "../../store/sceneStore";
import type { Camera } from "../Camera";
import type { InputKind } from "../interaction/MapIntent";
import { PointerBridge } from "../interaction/pointerBridge";
import type { Textures } from "../layers/details/cell";
import type { Tip } from "../layers/details/Hover";
import { planetLines } from "../layers/details/planets";
import { OwnedTooltip } from "../ownedTooltip";
import { beltLabel, sameHandle, type DragStep, type HandleRef } from "./bodyDrag";
import type { SystemContext } from "./context";
import { handleOwnerAt, pickBody, pickExit, pickHandle, pickWormhole } from "./picking";
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
  /** The tooltip of the mark or resource icon under the screen point on `body`'s name plate, or null. */
  markTipAt(body: number, sx: number, sy: number): Tip | null;
  hover(
    body: number | null,
    exit: number | null,
    handle: HandleRef | null,
    wormhole: number | null,
  ): void;
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
  wormhole: number | null,
): Omit<MapTooltip, "x" | "y"> | null {
  if (body !== null) {
    const planet = ctx.bodyById.get(body)?.planet;
    if (!planet) return null;
    return {
      title: bodyName(planet, ctx.names),
      lines: planetLines(ctx, TEXTURES, [planet]),
    };
  }
  const hole = wormhole === null ? undefined : ctx.wormholes.find((w) => w.id === wormhole);
  if (hole) {
    const hint = hole.movable
      ? DRAG_HINTS.movableWormhole
      : hole.natural
        ? null
        : GEOMETRY_REASONS.lockedWormhole;
    return { title: hole.name, lines: hint === null ? [] : [hint] };
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
    wormhole: number | null;
    ctx: SystemContext | null;
    tip: Omit<MapTooltip, "x" | "y"> | null;
    sx: number;
    sy: number;
  } = { body: null, exit: null, handle: null, wormhole: null, ctx: null, tip: null, sx: 0, sy: 0 };
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
    private readonly scene: SceneTarget,
  ) {
    this.intent = {
      hover: (body, exit, handle, wormhole, sx, sy) =>
        this.hover(body, exit, handle, sx, sy, wormhole),
      selectLane: (neighbour) => this.scene.selectLane(neighbour),
      enterSystem: (id) => {
        if (canEnterSystem()) useSceneStore.getState().enterSystem(id);
      },
      contextMenu: (target, x, y) => {
        this.hover(null, null, null, x, y);
        if (target.kind === "body" && !this.selected(target.id)) {
          this.selectAlone(target.system, target.id);
        }
        useMapChromeStore.getState().openContextMenu({ target, x, y });
      },
      openBody: (system, id) => this.openBody(system, id),
      openWormhole: (system, id) => this.openWormhole(system, id),
      showSystem: () => {
        usePlanetMoveStore.getState().clearBodies();
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
          if (this.model.busy()) return;
          this.hover(null, null, null, 0, 0);
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
    this.hover(null, null, null, 0, 0);
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
    if (this.hovered.exit !== null) this.hover(null, null, null, 0, 0);
  }

  /** Builds the tooltip shown again from the scene's new context, where the pointer rests. */
  contextChanged(): void {
    const { body, exit, handle, wormhole, sx, sy } = this.hovered;
    if (body !== null || exit !== null || handle !== null || wormhole !== null) {
      this.hover(body, exit, handle, sx, sy, wormhole);
    }
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
      usePlanetMoveStore.getState().toggleBody(system, id);
    } else {
      this.selectAlone(system, id);
    }
  }

  /** A click on a wormhole selects it alone and opens its page. */
  private openWormhole(system: number, id: number): void {
    const hole = this.scene.context().wormholes.find((w) => w.id === id);
    if (!hole) return;
    usePlanetMoveStore.getState().clearBodies();
    useInspectorStore.getState().openFromMap(wormholeEntry(system, id, hole.plateName));
  }

  private selectAlone(system: number, id: number): void {
    usePlanetMoveStore.getState().selectBody(system, id);
    this.showBody(system, id);
  }

  private showBody(system: number, id: number): void {
    const ctx = this.scene.context();
    const planet = ctx.bodyById.get(id)?.planet;
    if (!planet) return;
    useInspectorStore.getState().openFromMap(bodyEntry(system, id, bodyName(planet, ctx.names)));
  }

  private selected(id: number): boolean {
    return usePlanetMoveStore.getState().selection?.ids.includes(id) === true;
  }

  private hover(
    body: number | null,
    exit: number | null,
    handle: HandleRef | null,
    sx: number,
    sy: number,
    wormhole: number | null = null,
  ): void {
    const last = this.hovered;
    const ctx = this.scene.context();
    const moved =
      body !== last.body ||
      exit !== last.exit ||
      wormhole !== last.wormhole ||
      !sameHandle(handle, last.handle);
    if (moved) {
      this.scene.hover(body, exit, handle, wormhole);
      this.dropRefusal();
    }
    const own = moved || ctx !== last.ctx ? tipFor(ctx, body, exit, handle, wormhole) : last.tip;
    this.hovered = { body, exit, handle, wormhole, ctx, tip: own, sx, sy };
    const tip = (body === null ? null : this.scene.markTipAt(body, sx, sy)) ?? own;
    if (tip) this.tip.show({ ...tip, x: sx, y: sy });
    else this.tip.hide();
  }

  private input(kind: InputKind, e: PointerEvent): SystemInput {
    const ctx = this.scene.context();
    const w = this.cam.screenToWorld(e.offsetX, e.offsetY, this.at);
    // A disc wins over a plate drawn across it, so a body under another's plate stays pickable.
    const body = pickBody(ctx.bodies, this.cam, w) ?? this.scene.plateAt(e.offsetX, e.offsetY);
    const wormhole = body === null ? pickWormhole(ctx.wormholes, this.cam, w) : null;
    const shown = ctx.drag?.handle ?? handleOwnerAt(ctx, this.cam, w);
    this.scene.revealHandles(shown);
    const free = body === null && wormhole === null;
    const handle = free ? pickHandle(ctx.handles, this.cam, w, shown) : null;
    const own = body === null ? undefined : ctx.editing.bodies.get(body);
    const movable =
      own?.move === true ||
      own?.detachOnly === true ||
      ctx.wormholes.some((hole) => hole.id === wormhole && hole.movable);
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
      wormhole,
      handle,
      exit: free && handle === null ? pickExit(ctx.exits, this.cam, w) : null,
      draggable: !this.scene.holding() && (movable || handle !== null),
    };
    if (kind === "down") this.pressToggles = input.shift || input.ctrl;
    if (kind === "move") {
      this.lastMove = input;
      // A move with no button held means the release went elsewhere.
      if (e.buttons === 0) this.cancelDrag();
    }
    return input;
  }
}
