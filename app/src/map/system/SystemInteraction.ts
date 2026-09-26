import { bodyName } from "../../lib/details/labels";
import type { Pt } from "../../lib/geometry/pt";
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
import type { SystemContext } from "./context";
import { pickBody, pickExit } from "./picking";
import { SystemGestureModel, type SystemInput, type SystemIntent } from "./SystemGestureModel";

/** What the scene's pointer controller reads from the scene and asks of it. */
export interface SceneTarget {
  context(): SystemContext;
  /** The body whose shown name plate covers the screen point, or null. */
  plateAt(sx: number, sy: number): number | null;
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
    const planet = ctx.bodyById.get(body)?.planet;
    if (!planet) return null;
    return {
      title: bodyName(planet, ctx.names),
      lines: planetLines(ctx, TEXTURES, [planet]),
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
  private readonly pointer: PointerBridge<SystemInput>;
  /** The last hover and its tooltip, kept while the pointer stays on it and the context stands. */
  private hovered: {
    body: number | null;
    exit: number | null;
    ctx: SystemContext | null;
    tip: Omit<MapTooltip, "x" | "y"> | null;
    sx: number;
    sy: number;
  } = { body: null, exit: null, ctx: null, tip: null, sx: 0, sy: 0 };
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
          if (!this.model.busy()) this.hover(null, null, 0, 0);
        },
      },
    );
  }

  activate(): void {
    this.pointer.bind();
  }

  deactivate(): void {
    this.pointer.unbind();
    this.model.reset();
    this.hover(null, null, 0, 0);
    this.canvas.style.cursor = "";
  }

  /** Forgets the arrow the pointer rests on, whose neighbour an edit has renumbered. */
  dropExit(): void {
    if (this.hovered.exit !== null) this.hover(null, null, 0, 0);
  }

  /** Builds the tooltip shown again from the scene's new context, where the pointer rests. */
  contextChanged(): void {
    const { body, exit, sx, sy } = this.hovered;
    if (body !== null || exit !== null) this.hover(body, exit, sx, sy);
  }

  private openBody(system: number, id: number): void {
    const ctx = this.scene.context();
    const planet = ctx.bodyById.get(id)?.planet;
    if (!planet) return;
    const inspector = useInspectorStore.getState();
    inspector.openFromMap(bodyEntry(system, id, bodyName(planet, ctx.names)));
  }

  private hover(body: number | null, exit: number | null, sx: number, sy: number): void {
    const last = this.hovered;
    const ctx = this.scene.context();
    const moved = body !== last.body || exit !== last.exit;
    if (moved) this.scene.hover(body, exit);
    const tip = moved || ctx !== last.ctx ? tipFor(ctx, body, exit) : last.tip;
    this.hovered = { body, exit, ctx, tip, sx, sy };
    if (tip) this.tip.show({ ...tip, x: sx, y: sy });
    else this.tip.hide();
  }

  private input(kind: InputKind, e: PointerEvent): SystemInput {
    const ctx = this.scene.context();
    const w = this.cam.screenToWorld(e.offsetX, e.offsetY, this.at);
    // A disc wins over a plate drawn across it, so a body under another's plate stays pickable.
    const body = pickBody(ctx.bodies, this.cam, w) ?? this.scene.plateAt(e.offsetX, e.offsetY);
    return {
      kind,
      sx: e.offsetX,
      sy: e.offsetY,
      wx: w.x,
      wy: w.y,
      button: e.button,
      time: e.timeStamp,
      system: ctx.id ?? -1,
      body,
      exit: body === null ? pickExit(ctx.exits, this.cam, w) : null,
    };
  }
}
