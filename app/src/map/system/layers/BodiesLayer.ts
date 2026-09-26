import { BitmapText, Container, Graphics, Sprite, TextStyle, Texture } from "pixi.js";
import { planetTint } from "../../../lib/details/icons";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../../../lib/geometry/geometry";
import { MAP_FONT } from "../../../lib/visual/style";
import { starGlyph } from "../../../lib/visual/starGlyphs";
import { getTexture, onTextures, requestTextures } from "../../../lib/visual/textures";
import type { Camera } from "../../Camera";
import { dashedCircle } from "../../layers/dashes";
import { STAR_ART_BLEND } from "../../layers/StarClusters";
import {
  EMPTY_SYSTEM_CONTEXT,
  type Atmosphere,
  type SceneBody,
  type SystemContext,
} from "../context";
import { drawnDisc } from "../geometry";
import type { SystemLayer } from "./SystemLayer";
import type { SceneTextures } from "./textures";

/** The glow under a star, its white-hot core and its art, in disc diameters. */
const GLOW_SCALE = 1.9;
const CORE_SCALE = 1;
const STAR_ART_SCALE = 1.4;
const CORE_ALPHA = 0.8;
/** A planet's class icon, in disc diameters. */
const PLANET_ART_SCALE = 1;
/** The on-screen disc diameter, in pixels, past which a planet shows its class's large icon. */
const LARGE_ICON_PX = 48;
const GLOW_ALPHA = 0.9;
/** A ghost's sprites, and the dashes of its outline. */
const GHOST_ALPHA = 0.4;
const GHOST_DASHES = 16;
/**
 * The atmosphere haze: its reach past the limb in disc radii per unit of the class's
 * `atmosphere_width`, never under two pixels, its alpha at the limb per unit of
 * `atmosphere_intensity`, the strokes it fades out over, and how far it starts inside the limb
 * as a share of that reach, so the limb has no edge.
 */
const RIM_WIDTH = 0.3;
const RIM_MIN_PX = 2;
const RIM_ALPHA = 0.45;
const RIM_STEPS = 12;
const RIM_INSET = 0.25;
/** A ring's outer semi-axes in disc radii, and its tilt on screen. */
const RING_MAJOR = 2.4;
const RING_MINOR = RING_MAJOR / 3;
const RING_TILT = -0.3;
/** The ring's warm neutral, and how far it leans towards the body's own tint. */
const RING_COLOUR = 0xd8c6a0;
const RING_TINT_SHARE = 0.3;
const RING_DASHES = 32;
const RING_DASH_INK = 0.6;
/** The question mark over a random class, its height in disc diameters. */
const GLYPH_FONT_PX = 24;
const GLYPH_SCALE = 0.75;
const GLYPH_STYLE = new TextStyle({
  fontFamily: MAP_FONT,
  fontSize: GLYPH_FONT_PX,
  fontWeight: "700",
  fill: 0xffffff,
  stroke: { color: 0x000000, width: 3 },
});

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

function mixed(a: number, b: number, share: number): number {
  const channel = (shift: number) => {
    const from = (a >> shift) & 0xff;
    const to = (b >> shift) & 0xff;
    return Math.round(from + (to - from) * share) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/** A class the initializer leaves to chance, as the scenario body page reads it. */
function randomClass(planetClass: string): boolean {
  return planetClass === "" || planetClass === "random" || planetClass.startsWith("random_");
}

/** An astral scar is light on a black ground, drawn as the stars' art is; it has no surface. */
function luminous(planetClass: string): boolean {
  return /astral_scar/.test(planetClass);
}

/** Its icon is its own outline, an asteroid's rock or an astral scar's glow, so no round shading goes over it. */
function irregular(planetClass: string): boolean {
  return /asteroid/.test(planetClass) || luminous(planetClass);
}

/** Gas giants have no hard surface to catch a highlight. */
function takesGloss(planetClass: string): boolean {
  return !/gas_giant/.test(planetClass);
}

/** The texture key of the class's surface baked as a lit disc; none for a star, a random class or an irregular one. */
function litKey(body: SceneBody): string | null {
  const { planetClass } = body;
  if (body.placement.star || randomClass(planetClass) || irregular(planetClass)) return null;
  return `planet_disc:${planetClass}`;
}

/** The first of `keys` already in the cache, without asking for any. */
function landed(keys: readonly string[]): Texture | null {
  for (const key of keys) {
    const texture = getTexture(key);
    if (texture) return texture;
  }
  return null;
}

/** Stars under planets under moons, so a moon is never hidden behind its planet. */

function drawOrder(body: SceneBody): number {
  return body.placement.star ? 0 : body.moon ? 2 : 1;
}

interface Ring {
  back: Sprite;
  front: Sprite;
  /** The outline of a ring left to chance. */
  dashes: Graphics | null;
}

interface Drawn {
  body: SceneBody;
  glow: Sprite | null;
  core: Sprite | null;
  ring: Ring | null;
  disc: Sprite;
  lit: Sprite | null;
  art: Sprite;
  shade: Sprite | null;
  rim: Graphics | null;
  glyph: BitmapText | null;
  outline: Graphics | null;
  /** Whether the disc was last dressed as large on screen. */
  large: boolean;
}

function sized(sprite: Sprite, diameter: number): void {
  const { width, height } = sprite.texture;
  sprite.scale.set(diameter / Math.max(width, height, 1));
}

/** The dashes of a ring's outer edge, leaving out those the disc hides on the far side. */
function traceRingDashes(g: Graphics, radius: number): void {
  const a = radius * RING_MAJOR;
  const b = radius * RING_MINOR;
  const cos = Math.cos(RING_TILT);
  const sin = Math.sin(RING_TILT);
  const at = (t: number): [number, number] => {
    const x = a * Math.cos(t);
    const y = b * Math.sin(t);
    return [x * cos - y * sin, x * sin + y * cos];
  };
  const step = (2 * Math.PI) / RING_DASHES;
  for (let i = 0; i < RING_DASHES; i++) {
    const start = i * step;
    const end = start + step * RING_DASH_INK;
    const mid = (start + end) / 2;
    if (Math.sin(mid) < 0 && Math.hypot(...at(mid)) < radius) continue;
    g.moveTo(...at(start));
    for (let k = 1; k <= 4; k++) g.lineTo(...at(start + ((end - start) * k) / 4));
  }
}

/**
 * A tinted disc per body with its class icon on top, a core and a glow on each star and the sphere
 * shading over each other body, turned so its lit side faces the star it orbits. A class whose
 * surface the install bakes into a lit disc shows that in place of the tint and the icon. A class
 * with an atmosphere shows a haze outside the limb, and a ringed body its ring, the far half
 * behind the disc. A random class shows a question mark in place of the icon, a ghost is faded
 * inside a dashed outline, and a ring left to chance is faded and dashed.
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
    const sprite = (label: string, texture: Texture) => {
      const s = new Sprite(texture);
      s.label = label;
      s.anchor.set(0.5);
      holder.addChild(s);
      return s;
    };
    const graphics = (label: string) => {
      const g = new Graphics();
      g.label = label;
      holder.addChild(g);
      return g;
    };
    let glow: Sprite | null = null;
    if (placement.star) {
      glow = sprite("glow", this.textures.glow);
      glow.tint = tint;
      glow.alpha = GLOW_ALPHA;
    }
    const ringed = !placement.star && body.ring !== false;
    const ringTint = mixed(RING_COLOUR, tint, RING_TINT_SHARE);
    const ringHalf = (label: string, texture: Texture) => {
      const half = sprite(label, texture);
      half.tint = ringTint;
      half.rotation = RING_TILT;
      if (body.ring === null) half.alpha = GHOST_ALPHA;
      return half;
    };
    const back = ringed ? ringHalf("ringBack", this.textures.ringBack) : null;
    const disc = sprite("disc", this.textures.disc);
    disc.tint = tint;
    let lit: Sprite | null = null;
    if (litKey(body) !== null) {
      lit = sprite("lit", Texture.EMPTY);
      lit.visible = false;
      lit.rotation = placement.light ?? 0;
    }
    let core: Sprite | null = null;
    if (placement.star) {
      core = sprite("core", this.textures.glow);
      core.blendMode = "add";
      core.alpha = CORE_ALPHA;
    }
    const art = sprite("art", Texture.EMPTY);
    art.visible = false;
    // As on the galaxy map: the art's black ground adds nothing, so only its light shows.
    if (placement.star || luminous(body.planetClass)) art.blendMode = STAR_ART_BLEND;
    let shade: Sprite | null = null;
    if (!placement.star && !irregular(body.planetClass)) {
      shade = sprite(
        "shade",
        takesGloss(body.planetClass) ? this.textures.gloss : this.textures.shade,
      );
      shade.blendMode = "multiply";
      shade.rotation = placement.light ?? 0;
    }
    const rim = !placement.star && body.atmosphere ? graphics("rim") : null;
    if (rim) rim.blendMode = "add";
    let ring: Ring | null = null;
    if (back) {
      const front = ringHalf("ringFront", this.textures.ringFront);
      ring = { back, front, dashes: body.ring === null ? graphics("ringDashes") : null };
    }
    let glyph: BitmapText | null = null;
    if (randomClass(body.planetClass)) {
      glyph = new BitmapText({ text: "?", style: GLYPH_STYLE, anchor: 0.5 });
      holder.addChild(glyph);
    }
    let outline: Graphics | null = null;
    if (placement.ghost) {
      const faded = [glow, ring?.back, ring?.front, disc, lit, core, art, shade, rim, glyph];
      for (const part of faded) if (part) part.alpha *= GHOST_ALPHA;
      outline = graphics("outline");
    }
    this.container.addChild(holder);
    const drawn = {
      body,
      glow,
      core,
      ring,
      disc,
      lit,
      art,
      shade,
      rim,
      glyph,
      outline,
      large: false,
    };
    drawn.large = this.isLarge(drawn);
    this.dress(drawn);
    return drawn;
  }

  private isLarge({ body }: Drawn): boolean {
    if (this.scale <= 0 || body.placement.star) return false;
    return 2 * drawnDisc(body.placement.disc, this.scale) * this.scale > LARGE_ICON_PX;
  }

  /**
   * Shows the lit disc and the icon once their textures have landed, and the tinted disc alone
   * until then; asks for them again after the cache was cleared, as when game data reloads. The
   * lit disc stands in for the icon, which only marked the surface. A star keeps its disc, core
   * and glow under its art.
   */
  private dress(drawn: Drawn): void {
    const { body, art, disc, lit } = drawn;
    const key = litKey(body);
    const surface = key === null ? null : this.resolve([key]);
    if (lit) {
      lit.texture = surface ?? Texture.EMPTY;
      lit.visible = surface !== null;
    }
    const [wanted, other] = drawn.large
      ? [body.largeIconKeys, body.iconKeys]
      : [body.iconKeys, body.largeIconKeys];
    const iconless = randomClass(body.planetClass) || surface !== null;
    // Across the large-icon threshold, the icon already in hand stands in until the other lands.
    const texture = iconless ? null : (this.resolve(wanted) ?? landed(other));
    art.texture = texture ?? Texture.EMPTY;
    art.visible = texture !== null;
    if (body.placement.star) return;
    // The tinted disc only holds the place until the surface or the icon lands; an icon's own
    // outline and margin would show it as a band.
    disc.visible = texture === null && surface === null;
  }

  /** The first of `keys` that has landed, or null while none has. */
  private resolve(keys: readonly string[]): Texture | null {
    for (const key of keys) {
      const texture = getTexture(key);
      if (texture === undefined) {
        requestTextures([key]);
        return null;
      }
      if (texture) return texture;
    }
    return null;
  }

  private redress(): void {
    for (const drawn of this.drawn) this.dress(drawn);
    this.resize();
  }

  onViewport(cam: Camera): void {
    if (cam.scale === this.scale) return;
    this.scale = cam.scale;
    this.resize();
  }

  private resize(): void {
    if (this.scale <= 0) return;
    for (const drawn of this.drawn) {
      const large = this.isLarge(drawn);
      if (large !== drawn.large) {
        drawn.large = large;
        this.dress(drawn);
      }
      const { body, glow, core, ring, disc, lit, art, shade, rim, glyph, outline } = drawn;
      const d = 2 * drawnDisc(body.placement.disc, this.scale);
      if (glow) sized(glow, d * GLOW_SCALE);
      if (core) sized(core, d * CORE_SCALE);
      sized(disc, d);
      if (lit) {
        sized(lit, d);
        // The bake is lit from its left; mirrored, its light lies along +x as the mask's does.
        lit.scale.x = -lit.scale.x;
      }
      sized(art, d * (body.placement.star ? STAR_ART_SCALE : PLANET_ART_SCALE));
      if (shade) sized(shade, d);
      if (rim && body.atmosphere) this.drawRim(rim, body.atmosphere, d / 2);
      if (ring) this.sizeRing(ring, body, d / 2);
      if (glyph) glyph.scale.set((d * GLYPH_SCALE) / GLYPH_FONT_PX);
      if (outline) {
        outline.clear();
        dashedCircle(outline, 0, 0, d / 2, GHOST_DASHES);
        outline.stroke({ color: bodyTint(body), pixelLine: true });
      }
    }
  }

  /**
   * Concentric strokes added over the limb, brightest on it and fading both ways, so the haze
   * glows out of the disc's edge instead of outlining it.
   */
  private drawRim(rim: Graphics, atmosphere: Atmosphere, radius: number): void {
    rim.clear();
    const width = Math.max(RIM_WIDTH * atmosphere.width * radius, RIM_MIN_PX / this.scale);
    const step = width / RIM_STEPS;
    const inset = Math.round(RIM_STEPS * RIM_INSET);
    const peak = Math.min(1, RIM_ALPHA * atmosphere.intensity);
    for (let i = -inset; i < RIM_STEPS; i++) {
      const out = i < 0 ? -i / (inset + 1) : (i + 0.5) / RIM_STEPS;
      const fade = (1 - out) ** 2;
      rim
        .circle(0, 0, radius + (i + 0.5) * step)
        .stroke({ color: atmosphere.color, width: step, alpha: peak * fade });
    }
  }

  private sizeRing(ring: Ring, body: SceneBody, radius: number): void {
    for (const half of [ring.back, ring.front]) {
      const { width, height } = half.texture;
      half.scale.set(
        (2 * RING_MAJOR * radius) / Math.max(width, 1),
        (2 * RING_MINOR * radius) / Math.max(height, 1),
      );
    }
    if (ring.dashes) {
      ring.dashes.clear();
      traceRingDashes(ring.dashes, radius);
      ring.dashes.stroke({ color: bodyTint(body), pixelLine: true });
    }
  }

  setHighlighted(): void {}

  destroy(): void {
    this.unsubTextures();
    this.container.destroy({ children: true });
  }
}
