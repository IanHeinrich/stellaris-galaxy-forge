import { bodyName } from "../../lib/details/labels";
import type { Pt } from "../../lib/geometry/pt";
import { getTexture, requestTextures } from "../../lib/visual/textures";
import { bodyEntry, useInspectorStore } from "../../store/inspectorStore";
import { useMapChromeStore, type MapTooltip } from "../../store/mapChromeStore";
import { canEnterSystem, useSceneStore } from "../../store/sceneStore";
import type { Camera } from "../Camera";
import type { InputKind } from "../interaction/MapIntent";
import type { Textures } from "../layers/details/cell";
import { planetLines } from "../layers/details/planets";
import { OwnedTooltip } from "../ownedTooltip";
import { renderContext } from "../RenderContext";
import type { SystemContext } from "./context";
import { pickBody, pickExit } from "./picking";
import { SystemGestureModel, type SystemInput, type SystemIntent } from "./SystemGestureModel";

/** What the scene's pointer controller reads from the scene and asks of it. */
export interface SceneTarget {
  context(): SystemContext;
  hover(body: number | null, exit: number | null): void;
  selectLane(neighbour: number | null): void;
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
): Omit<MapTooltip, "x" | "y"> | null {
  if (body !== null) {
    const planet = ctx.bodies.find((b) => b.placement.id === body)?.planet;
    if (!planet) return null;
    return {
      title: ctx.templateName(planet),
      lines: planetLines(renderContext(), TEXTURES, [planet]),
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
  private readonly listeners: Array<() => void> = [];
  private panFrom: { sx: number; sy: number } | null = null;
  /** The tooltip of the body or arrow last hovered, kept while the pointer stays on it. */
  private hovered: {
    body: number | null;
    exit: number | null;
    tip: Omit<MapTooltip, "x" | "y"> | null;
  } = { body: null, exit: null, tip: null };
  private readonly at: Pt = { x: 0, y: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly cam: Camera,
    private readonly scene: SceneTarget,
  ) {
    this.intent = {
      hover: (body, exit, sx, sy) => this.hover(body, exit, sx, sy),
      selectLane: (neighbour) => this.scene.selectLane(neighbour),
      enterSystem: (id) => {
        if (canEnterSystem()) useSceneStore.getState().enterSystem(id);
      },
      contextMenu: (target, x, y) => {
        this.hover(null, null, x, y);
        useMapChromeStore.getState().openContextMenu({ target, x, y });
      },
      openBody: (system, id) => this.openBody(system, id),
      showSystem: () => useInspectorStore.getState().popTo(0),
    };
  }

  activate(): void {
    if (this.listeners.length > 0) return;
    this.bindPointer();
  }

  deactivate(): void {
    for (const off of this.listeners.splice(0)) off();
    this.model.reset();
    this.panFrom = null;
    this.hover(null, null, 0, 0);
    this.canvas.style.cursor = "";
  }

  private openBody(system: number, id: number): void {
    const ctx = this.scene.context();
    const planet = ctx.bodies.find((b) => b.placement.id === id)?.planet;
    if (!planet) return;
    const inspector = useInspectorStore.getState();
    inspector.openFromMap(bodyEntry(system, id, bodyName(planet, ctx.names)));
  }

  private hover(body: number | null, exit: number | null, sx: number, sy: number): void {
    const last = this.hovered;
    if (body !== last.body || exit !== last.exit) {
      this.hovered = { body, exit, tip: tipFor(this.scene.context(), body, exit) };
      this.scene.hover(body, exit);
    }
    const tip = this.hovered.tip;
    if (tip) this.tip.show({ ...tip, x: sx, y: sy });
    else this.tip.hide();
  }

  private input(kind: InputKind, e: PointerEvent): SystemInput {
    const ctx = this.scene.context();
    const w = this.cam.screenToWorld(e.offsetX, e.offsetY, this.at);
    const body = pickBody(ctx.bodies, this.cam, w);
    return {
      kind,
      sx: e.offsetX,
      sy: e.offsetY,
      wx: w.x,
      wy: w.y,
      button: e.button,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      time: e.timeStamp,
      system: ctx.id ?? -1,
      body,
      exit: body === null ? pickExit(ctx.exits, this.cam, w) : null,
    };
  }

  private handle(input: SystemInput): "consumed" | "pan" {
    const result = this.model.handle(input, this.intent);
    this.canvas.style.cursor = this.model.cursor();
    return result;
  }

  private bindPointer(): void {
    const canvas = this.canvas;
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
    ) => {
      canvas.addEventListener(type, handler);
      this.listeners.push(() => canvas.removeEventListener(type, handler));
    };

    on("pointerdown", (e) => {
      useMapChromeStore.getState().closeContextMenu();
      const input = this.input("down", e);
      this.panFrom = { sx: input.sx, sy: input.sy };
      canvas.setPointerCapture(e.pointerId);
      this.handle(input);
    });
    on("pointermove", (e) => {
      const input = this.input("move", e);
      if (this.handle(input) === "pan" && this.panFrom) {
        this.cam.panBy(input.sx - this.panFrom.sx, input.sy - this.panFrom.sy);
        this.panFrom = { sx: input.sx, sy: input.sy };
      }
    });
    on("pointerup", (e) => {
      this.panFrom = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      this.handle(this.input("up", e));
    });
    on("pointercancel", (e) => {
      this.panFrom = null;
      this.handle(this.input("cancel", e));
    });
    on("pointerleave", () => {
      if (!this.model.busy()) this.hover(null, null, 0, 0);
    });
  }
}
