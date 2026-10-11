import { Container, Sprite, Texture } from "pixi.js";
import { modelSize } from "../../../lib/details/structures";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../../../lib/geometry/geometry";
import {
  getModelPlacement,
  getTexture,
  onTextures,
  requestTextures,
} from "../../../lib/visual/textures";
import type { Camera } from "../../Camera";
import { EMPTY_SYSTEM_CONTEXT, type SceneStructure, type SystemContext } from "../context";
import type { SystemLayer } from "./SystemLayer";

/** How wide a structure's map icon is drawn, in screen pixels, whatever the zoom. */
export const STRUCTURE_ICON_PX = 22;

interface Drawn {
  readonly structure: SceneStructure;
  readonly holder: Container;
  readonly model: Sprite;
  readonly icon: Sprite;
}

/** The first of `keys` that landed, or null while one before it is still loading or none did. */
function firstLanded(keys: readonly string[]): Texture | null {
  for (const key of keys) {
    const texture = getTexture(key);
    if (texture) return texture;
    if (texture === undefined) return null;
  }
  return null;
}

/**
 * Whether `structure` shows its map icon: it has no model, or its model could not be baked. A
 * model still baking shows nothing.
 */
export function showsIcon(structure: SceneStructure): boolean {
  return structure.modelKey === null || getTexture(structure.modelKey) === null;
}

/**
 * Each megastructure and starbase as the sprite baked from its game model, at the size the game
 * draws it, or its map icon where the model is unknown or cannot be baked. Drawn over the bodies,
 * so a Dyson Sphere covers its star and an Arc Furnace its planet.
 */
export class StructuresLayer implements SystemLayer {
  readonly container = new Container();
  private structures: readonly SceneStructure[] = EMPTY_SYSTEM_CONTEXT.structures;
  private drawn: Drawn[] = [];
  private scale = -1;
  private readonly unsubTextures: () => void;

  constructor() {
    this.container.label = "structures";
    this.unsubTextures = onTextures(() => this.dress());
  }

  rebuild(ctx: SystemContext): void {
    if (ctx.structures === this.structures) return;
    this.structures = ctx.structures;
    for (const child of this.container.removeChildren()) child.destroy({ children: true });
    this.drawn = ctx.structures.map((structure) => {
      const holder = new Container();
      holder.label = `${structure.kind}:${structure.id}`;
      holder.position.set(structure.x, structure.y);
      const model = new Sprite(Texture.EMPTY);
      model.label = "model";
      const icon = new Sprite(Texture.EMPTY);
      icon.label = "icon";
      icon.anchor.set(0.5);
      holder.addChild(model, icon);
      this.container.addChild(holder);
      return { structure, holder, model, icon };
    });
    requestTextures(
      ctx.structures.flatMap((s) =>
        s.modelKey === null ? s.iconKeys : [s.modelKey, ...s.iconKeys],
      ),
    );
    this.dress();
  }

  onViewport(cam: Camera): void {
    if (cam.scale === this.scale) return;
    this.scale = cam.scale;
    this.sizeIcons();
  }

  private dress(): void {
    for (const { structure, model, icon } of this.drawn) {
      const key = structure.modelKey;
      const texture = key === null ? null : getTexture(key);
      const placement = key === null ? undefined : getModelPlacement(key);
      model.visible = Boolean(texture && placement);
      if (texture && placement) {
        const { width, height } = modelSize(placement, structure.scale);
        model.texture = texture;
        model.anchor.set(placement.anchor_x, placement.anchor_y);
        model.scale.set(
          (SAVE_X_SIGN * width) / Math.max(texture.width, 1),
          (SAVE_Y_SIGN * height) / Math.max(texture.height, 1),
        );
      }
      const glyph = showsIcon(structure) ? firstLanded(structure.iconKeys) : null;
      icon.visible = glyph !== null;
      if (glyph) icon.texture = glyph;
    }
    this.sizeIcons();
  }

  /** Each icon `STRUCTURE_ICON_PX` wide on screen, mirrored against the root's axis flip. */
  private sizeIcons(): void {
    if (this.scale <= 0) return;
    const side = STRUCTURE_ICON_PX / this.scale;
    for (const { icon } of this.drawn) {
      const k = side / Math.max(icon.texture.width, icon.texture.height, 1);
      icon.scale.set(SAVE_X_SIGN * k, SAVE_Y_SIGN * k);
    }
  }

  destroy(): void {
    this.unsubTextures();
    this.container.destroy({ children: true });
  }
}
