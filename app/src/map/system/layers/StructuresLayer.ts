import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../../../lib/geometry/geometry";
import { getTexture, onTextures, requestTextures } from "../../../lib/visual/textures";
import type { Camera } from "../../Camera";
import { EMPTY_SYSTEM_CONTEXT, type SystemContext } from "../context";
import { dressModelSprite, landedModel, SAVE_AXES } from "../geometry";
import type { SceneStructure } from "../structures";
import { drawHalo } from "./halo";
import type { SystemLayer } from "./SystemLayer";

/** How wide a structure's map icon is drawn, in screen pixels, whatever the zoom. */
export const STRUCTURE_ICON_PX = 22;

/** A stand-in for a structure the game places at random shows faint, as placeholder planets do. */
const STAND_IN_ALPHA = 0.35;

interface Drawn {
  structure: SceneStructure;
  readonly holder: Container;
  readonly model: Sprite;
  readonly icon: Sprite;
  /** The dashed halo round a structure the game may not place; null for any other. */
  readonly halo: Graphics | null;
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

/** Whether `a` and `b` draw the same models and icons for the same structures, in order. */
function sameLooks(a: readonly SceneStructure[], b: readonly SceneStructure[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (s, i) =>
        s.kind === b[i].kind &&
        s.id === b[i].id &&
        s.modelKey === b[i].modelKey &&
        s.chance.mayNotSpawn === b[i].chance.mayNotSpawn &&
        s.chance.random === b[i].chance.random &&
        s.iconKeys.length === b[i].iconKeys.length &&
        s.iconKeys.every((key, k) => key === b[i].iconKeys[k]),
    )
  );
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
 * so a Dyson Sphere covers its star and an Arc Furnace its planet. One the game may not place
 * has a dashed halo, and a stand-in for one it places at random is faint.
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
    const before = this.structures;
    this.structures = ctx.structures;
    if (sameLooks(before, ctx.structures)) {
      this.move();
      return;
    }
    const previous = this.container.removeChildren();
    const shown = new Map<string, Sprite>(
      this.drawn.flatMap((d) =>
        d.model.visible ? [[`${d.structure.kind}:${d.structure.id}`, d.model] as const] : [],
      ),
    );
    this.drawn = ctx.structures.map((structure) => {
      const holder = new Container();
      holder.label = `${structure.kind}:${structure.id}`;
      holder.position.set(structure.x, structure.y);
      const model = new Sprite(Texture.EMPTY);
      model.label = "model";
      const last = shown.get(holder.label);
      if (last) {
        model.texture = last.texture;
        model.anchor.copyFrom(last.anchor);
        model.scale.copyFrom(last.scale);
      }
      model.visible = last !== undefined;
      const icon = new Sprite(Texture.EMPTY);
      icon.label = "icon";
      icon.anchor.set(0.5);
      holder.addChild(model, icon);
      if (structure.chance.random) holder.alpha = STAND_IN_ALPHA;
      const halo = structure.chance.mayNotSpawn ? new Graphics() : null;
      if (halo) {
        halo.label = "halo";
        holder.addChild(halo);
      }
      this.container.addChild(holder);
      return { structure, holder, model, icon, halo };
    });
    for (const child of previous) child.destroy({ children: true });
    requestTextures(
      ctx.structures.flatMap((s) =>
        s.modelKey === null ? s.iconKeys : [s.modelKey, ...s.iconKeys],
      ),
    );
    this.dress();
  }

  /** Stands each holder at its structure's new point, and resizes the models when a size changed. */
  private move(): void {
    let resized = false;
    this.drawn.forEach((drawn, i) => {
      const structure = this.structures[i];
      resized ||= structure.scale !== drawn.structure.scale;
      drawn.structure = structure;
      drawn.holder.position.set(structure.x, structure.y);
    });
    if (resized) this.dress();
  }

  onViewport(cam: Camera): void {
    if (cam.scale === this.scale) return;
    this.scale = cam.scale;
    this.sizeIcons();
  }

  private dress(): void {
    for (const { structure, model, icon } of this.drawn) {
      const key = structure.modelKey;
      const landed = landedModel(key, structure.scale);
      // The last bake stays up while a new one for a turned or changed model is made.
      const baking = key !== null && getTexture(key) === undefined && model.visible;
      if (!baking) model.visible = landed !== null;
      if (landed) dressModelSprite(model, landed, SAVE_AXES);
      const glyph = showsIcon(structure) ? firstLanded(structure.iconKeys) : null;
      icon.visible = glyph !== null;
      if (glyph) icon.texture = glyph;
    }
    this.sizeIcons();
  }

  /**
   * Each icon `STRUCTURE_ICON_PX` wide on screen, mirrored against the root's axis flip, and each
   * halo round its model or icon.
   */
  private sizeIcons(): void {
    if (this.scale <= 0) return;
    const side = STRUCTURE_ICON_PX / this.scale;
    for (const { structure, model, icon, halo } of this.drawn) {
      const k = side / Math.max(icon.texture.width, icon.texture.height, 1);
      icon.scale.set(SAVE_X_SIGN * k, SAVE_Y_SIGN * k);
      if (halo) {
        const { x, y, radius } = haloCircle(structure, model.visible, side);
        drawHalo(halo, radius, this.scale, x, y);
      }
    }
  }

  destroy(): void {
    this.unsubTextures();
    this.container.destroy({ children: true });
  }
}

/**
 * The circle a structure's halo stands just outside, about its holder: its model sprite's middle
 * and larger half, else its icon's half about its point.
 */
function haloCircle(
  structure: SceneStructure,
  modelShown: boolean,
  iconSide: number,
): { x: number; y: number; radius: number } {
  const landed = modelShown ? landedModel(structure.modelKey, structure.scale) : null;
  if (landed === null) return { x: 0, y: 0, radius: iconSide / 2 };
  const { centre, radius } = landed;
  return { x: SAVE_X_SIGN * centre.x, y: SAVE_Y_SIGN * centre.y, radius };
}
