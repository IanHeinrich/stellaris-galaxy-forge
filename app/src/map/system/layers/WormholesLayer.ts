import { Container, Sprite, type Texture } from "pixi.js";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../../../lib/geometry/geometry";
import type { Pt } from "../../../lib/geometry/pt";
import { GHOST_ALPHA } from "../../../lib/visual/style";
import type { Camera } from "../../Camera";
import { EMPTY_SYSTEM_CONTEXT, type SceneWormhole, type SystemContext } from "../context";
import { drawnWormhole } from "../geometry";
import { NO_HIGHLIGHT, type SceneHighlight, type SystemLayer } from "./SystemLayer";
import type { SceneTextures } from "./textures";
import { WORMHOLE_ART_SCALE } from "./wormholeField";

type WormholeTextures = Pick<SceneTextures, "wormholeHaze" | "wormholeSwirl" | "wormholeRim">;

/**
 * Each layer of the vortex in the order drawn, with its tint and alpha: deep blue haze, the
 * swirl in a lighter blue, and the rim and pinpoint near white.
 */
const LAYERS: ReadonlyArray<readonly [label: string, keyof WormholeTextures, number, number]> = [
  ["haze", "wormholeHaze", 0x5b7fc4, 0.9],
  ["swirl", "wormholeSwirl", 0x86b4ee, 1],
  ["rim", "wormholeRim", 0xdcefff, 1],
];
const NATURAL_ALPHA = 0.8;
/** A shroud tunnel or anything else that stays where it is. */
const LOCKED_ALPHA = 0.35;
/** The vortex under the pointer grows by this factor and brightens by this one. */
export const HOVER_GROW = 1.2;
const HOVER_BRIGHTEN = 1.25;

interface Drawn {
  readonly id: number;
  readonly holder: Container;
  readonly alpha: number;
  /** The faint copy at a dragged wormhole's save point, which never grows. */
  readonly ghost: boolean;
}

/**
 * A swirling vortex about a dark eye at each of the system's wormholes, added over the dark; a
 * shroud tunnel's is dimmer. A dragged wormhole's save point shows a faint copy.
 */
export class WormholesLayer implements SystemLayer {
  readonly container = new Container();
  private drawn: Drawn[] = [];
  private wormholes: readonly SceneWormhole[] = EMPTY_SYSTEM_CONTEXT.wormholes;
  private dragged: number | null = null;
  private hovered: number | null = NO_HIGHLIGHT.hoverWormhole;
  private scale = -1;

  constructor(private readonly textures: WormholeTextures) {
    this.container.label = "wormholes";
  }

  rebuild(ctx: SystemContext): void {
    const dragged = ctx.drag?.wormhole ?? null;
    if (ctx.wormholes === this.wormholes && dragged === this.dragged) return;
    this.wormholes = ctx.wormholes;
    this.dragged = dragged;
    this.build();
  }

  setHighlighted(ref: SceneHighlight): void {
    if (ref.hoverWormhole === this.hovered) return;
    this.hovered = ref.hoverWormhole;
    this.size();
  }

  onViewport(cam: Camera): void {
    if (cam.scale === this.scale) return;
    this.scale = cam.scale;
    this.size();
  }

  private build(): void {
    for (const child of this.container.removeChildren()) child.destroy({ children: true });
    this.drawn = [];
    for (const hole of this.wormholes) {
      const alpha = hole.natural ? NATURAL_ALPHA : LOCKED_ALPHA;
      if (hole.id === this.dragged) this.vortex(hole.id, hole.saved, GHOST_ALPHA * alpha, true);
      this.vortex(hole.id, hole, alpha, false);
    }
    this.size();
  }

  /** One vortex at `at`, a unit across, its layers mirrored against the root's axis flip. */
  private vortex(id: number, at: Pt, alpha: number, ghost: boolean): void {
    const holder = new Container();
    holder.label = ghost ? "ghost" : "vortex";
    holder.position.set(at.x, at.y);
    for (const [label, key, tint, layerAlpha] of LAYERS) {
      const texture: Texture = this.textures[key];
      const sprite = new Sprite(texture);
      sprite.label = label;
      sprite.anchor.set(0.5);
      sprite.scale.set(1 / Math.max(texture.width, texture.height, 1));
      sprite.tint = tint;
      sprite.alpha = layerAlpha;
      sprite.blendMode = "add";
      holder.addChild(sprite);
    }
    this.container.addChild(holder);
    this.drawn.push({ id, holder, alpha, ghost });
  }

  private size(): void {
    const shown = this.scale > 0;
    const side = shown ? 2 * drawnWormhole(this.scale) * WORMHOLE_ART_SCALE : 0;
    for (const { id, holder, alpha, ghost } of this.drawn) {
      const hovered = !ghost && id === this.hovered;
      const grown = (hovered ? HOVER_GROW : 1) * side;
      holder.visible = shown;
      holder.scale.set(SAVE_X_SIGN * grown, SAVE_Y_SIGN * grown);
      holder.alpha = hovered ? Math.min(1, alpha * HOVER_BRIGHTEN) : alpha;
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
