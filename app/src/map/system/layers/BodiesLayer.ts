import { Container, Sprite, type Texture } from "pixi.js";
import { planetTint } from "../../../lib/details/icons";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../../../lib/geometry/geometry";
import { starGlyph } from "../../../lib/visual/starGlyphs";
import { getTexture, onTextures, requestTextures } from "../../../lib/visual/textures";
import type { Camera } from "../../Camera";
import { STAR_ART_BLEND } from "../../layers/StarClusters";
import { EMPTY_SYSTEM_CONTEXT, type SceneBody, type SystemContext } from "../context";
import { drawnDisc } from "../geometry";
import type { SystemLayer } from "./SystemLayer";
import type { SceneTextures } from "./textures";

/** The glow under a star, and a star's art, in disc diameters. */
const GLOW_SCALE = 3.2;
const STAR_ART_SCALE = 2.2;
/** A planet's class icon, in disc diameters. */
const PLANET_ART_SCALE = 1;
const GLOW_ALPHA = 0.9;

/** The class families `planetTint` leaves to its neutral grey, by the colour the scene gives each. */
const FAMILY_TINTS: Array<[pattern: RegExp, tint: number]> = [
  [/gas_giant/, 0xc9a26b],
  [/asteroid/, 0x8a8178],
  [/barren/, 0x8c8279],
  [/frozen/, 0xcfe3f0],
  [/toxic/, 0x9bc34a],
  [/molten/, 0xd9623b],
  [/ocean/, 0x3a7fd0],
  [/continental/, 0x4f9d5a],
  [/tropical/, 0x3fae6b],
  [/arid/, 0xd09a4e],
  [/desert/, 0xe0bf7a],
  [/savannah/, 0xb9b25a],
  [/tundra/, 0xa7b9a0],
  [/alpine/, 0xd8e4ea],
  [/arctic/, 0xe6f0f7],
];

function bodyTint(body: SceneBody): number {
  if (body.starClass !== null) return starGlyph(body.starClass).tint;
  for (const [pattern, tint] of FAMILY_TINTS) {
    if (pattern.test(body.planetClass)) return tint;
  }
  return planetTint(body.planetClass);
}

/** Gas giants and asteroids have no hard surface to catch a highlight. */
function takesGloss(planetClass: string): boolean {
  return !/gas_giant|asteroid/.test(planetClass);
}

/** Stars under planets under moons, so a moon is never hidden behind its planet. */
function drawOrder(body: SceneBody): number {
  return body.placement.star ? 0 : body.moon ? 2 : 1;
}

interface Drawn {
  body: SceneBody;
  glow: Sprite | null;
  disc: Sprite;
  art: Sprite;
  shade: Sprite | null;
}

function sized(sprite: Sprite, diameter: number): void {
  const { width, height } = sprite.texture;
  sprite.scale.set(diameter / Math.max(width, height, 1));
}

/**
 * A tinted disc per body with its class icon on top, a glow under each star and the sphere
 * shading over each other body, turned so its lit side faces the star it orbits.
 */
export class BodiesLayer implements SystemLayer {
  readonly id = "bodies" as const;
  readonly container = new Container();
  private bodies: readonly SceneBody[] = EMPTY_SYSTEM_CONTEXT.bodies;
  private drawn: Drawn[] = [];
  private scale = -1;
  private readonly unsubTextures: () => void;

  constructor(private readonly textures: SceneTextures) {
    this.unsubTextures = onTextures(() => this.redress());
  }

  rebuild(ctx: SystemContext): void {
    if (ctx.bodies === this.bodies) return;
    this.bodies = ctx.bodies;
    for (const child of this.container.removeChildren()) child.destroy({ children: true });
    const ordered = [...ctx.bodies].sort((a, b) => drawOrder(a) - drawOrder(b));
    this.drawn = ordered.map((body) => this.place(body));
    this.resize();
  }

  private place(body: SceneBody): Drawn {
    const { placement } = body;
    // Mirrors the root's axis flip, so what is drawn inside stands upright and turns as on screen.
    const holder = new Container();
    holder.position.set(placement.x, placement.y);
    holder.scale.set(SAVE_X_SIGN, SAVE_Y_SIGN);
    const tint = bodyTint(body);
    const sprite = (texture: Texture) => {
      const s = new Sprite(texture);
      s.anchor.set(0.5);
      holder.addChild(s);
      return s;
    };
    let glow: Sprite | null = null;
    if (placement.star) {
      glow = sprite(this.textures.glow);
      glow.tint = tint;
      glow.alpha = GLOW_ALPHA;
    }
    const disc = sprite(this.textures.disc);
    disc.tint = tint;
    const art = sprite(this.textures.disc);
    art.visible = false;
    // As on the galaxy map: the art's black ground adds nothing, so only its light shows.
    if (placement.star) art.blendMode = STAR_ART_BLEND;
    let shade: Sprite | null = null;
    if (!placement.star) {
      shade = sprite(takesGloss(body.planetClass) ? this.textures.gloss : this.textures.shade);
      shade.blendMode = "multiply";
      shade.rotation = placement.light ?? 0;
    }
    this.container.addChild(holder);
    const drawn = { body, glow, disc, art, shade };
    this.dress(drawn);
    return drawn;
  }

  /** Puts the icon's texture on once it has landed; the disc stands alone until then. */
  private dress(drawn: Drawn): void {
    for (const key of drawn.body.iconKeys) {
      const texture = getTexture(key);
      if (texture === undefined) {
        requestTextures([key]);
        return;
      }
      if (texture) {
        drawn.art.texture = texture;
        drawn.art.visible = true;
        if (drawn.glow) drawn.glow.visible = false;
        if (drawn.body.placement.star) drawn.disc.visible = false;
        return;
      }
    }
  }

  private redress(): void {
    for (const drawn of this.drawn) if (!drawn.art.visible) this.dress(drawn);
    this.resize();
  }

  onViewport(cam: Camera): void {
    if (cam.scale === this.scale) return;
    this.scale = cam.scale;
    this.resize();
  }

  private resize(): void {
    if (this.scale <= 0) return;
    for (const { body, glow, disc, art, shade } of this.drawn) {
      const d = 2 * drawnDisc(body.placement.disc, this.scale);
      if (glow) sized(glow, d * GLOW_SCALE);
      sized(disc, d);
      sized(art, d * (body.placement.star ? STAR_ART_SCALE : PLANET_ART_SCALE));
      if (shade) sized(shade, d);
    }
  }

  setHighlighted(): void {}

  destroy(): void {
    this.unsubTextures();
    this.container.destroy({ children: true });
  }
}
