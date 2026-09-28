import { BitmapText, Container, Graphics, Mesh, Sprite, TextStyle, Texture } from "pixi.js";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../../../lib/geometry/geometry";
import { mixColor } from "../../../lib/visual/color";
import { MAP_FONT } from "../../../lib/visual/style";
import { getTexture, onTextures, requestTextures } from "../../../lib/visual/textures";
import type { Camera } from "../../Camera";
import { STAR_ART_BLEND } from "../../layers/StarClusters";
import {
  EMPTY_SYSTEM_CONTEXT,
  type Atmosphere,
  type SceneBody,
  type SystemContext,
} from "../context";
import { bodyTier, drawnDisc } from "../geometry";
import { RING_TILT, ringStrip, sizeRing, type RingParts } from "./ring";
import { flareParts, STAR_ART, type FlareShape } from "./starLight";
import type { SceneHighlight, SystemLayer } from "./SystemLayer";
import type { SceneTextures } from "./textures";

/** The glow added round a star, in disc diameters, and how strongly. */
const GLOW_SCALE = 2.4;
const GLOW_ALPHA = 0.55;
/** How strongly an asteroid's icon shows glazed over itself in its kind's colour. */
const GLAZE_ALPHA = 0.6;
/** A black hole's swirl, in disc diameters. */
const HOLE_ART_SCALE = 2.6;
/** A planet's class icon, in disc diameters. */
const PLANET_ART_SCALE = 1;
/** The glow behind a flat body's icon, in icon widths, and how strongly. */
const FLAT_GLOW_SCALE = 1.5;
const FLAT_GLOW_ALPHA = 0.35;
/** The on-screen disc diameter, in pixels, past which a planet shows its class's large icon. */
const LARGE_ICON_PX = 48;
/** A ring left to chance. */
const CHANCE_RING_ALPHA = 0.4;
/** A body cut and waiting for a paste, and each moon that goes with it. */
const CUT_ALPHA = 0.3;
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
/** The game's ring texture, a radial strip wrapped round the ring. */
const RING_KEY = "planet_ring";
/** The baked ring's warm neutral, and how far it leans towards the body's own tint. */
const RING_COLOUR = 0xd8c6a0;
const RING_TINT_SHARE = 0.3;
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

function artScale(body: SceneBody): number {
  if (body.look.blackHole) return HOLE_ART_SCALE;
  return body.placement.star ? STAR_ART[body.look.flare ?? "star"].scale : PLANET_ART_SCALE;
}

/**
 * The first of `keys` that has landed, or null while none has. With `ask`, asks for the first
 * not yet in the cache and stops there; without, only looks.
 */
function landed(keys: readonly string[], ask: boolean): Texture | null {
  for (const key of keys) {
    const texture = getTexture(key);
    if (texture === undefined && ask) {
      requestTextures([key]);
      return null;
    }
    if (texture) return texture;
  }
  return null;
}

interface Flare {
  sprite: Sprite;
  shape: FlareShape;
}

interface Drawn {
  body: SceneBody;
  holder: Container;
  glow: Sprite | null;
  flares: Flare[];
  glaze: Sprite | null;
  ring: RingParts | null;
  disc: Sprite;
  lit: Sprite | null;
  art: Sprite;
  shade: Sprite | null;
  rim: Graphics | null;
  glyph: BitmapText | null;
  /** Whether the disc was last dressed as large on screen. */
  large: boolean;
}

/** Whether `b` is drawn as `a` is, wherever each stands: the same art objects, disc and ring. */
function drawnAlike(a: SceneBody, b: SceneBody): boolean {
  return (
    a.placement.id === b.placement.id &&
    a.placement.disc === b.placement.disc &&
    a.placement.star === b.placement.star &&
    a.look === b.look &&
    a.iconKeys === b.iconKeys &&
    a.largeIconKeys === b.largeIconKeys &&
    a.atmosphere === b.atmosphere &&
    a.ring === b.ring &&
    a.moon === b.moon &&
    a.chance.ring === b.chance.ring &&
    a.chance.planetClass === b.chance.planetClass
  );
}

function sized(sprite: Sprite, diameter: number): void {
  const { width, height } = sprite.texture;
  sprite.scale.set(diameter / Math.max(width, height, 1));
}

/**
 * A tinted disc per body with its class icon on top, a glow under each star and the sphere
 * shading over each other body, turned so its lit side faces the star it orbits. A class whose
 * surface the install bakes into a lit disc shows that in place of the tint and the icon. A class
 * with an atmosphere shows a haze outside the limb, and a ringed body its ring, the far half
 * behind the disc. A random class shows a question mark in place of the icon, and a ring left to
 * chance is faded. A class with no surface to bake shows its icon unshaded, never wider than
 * `FLAT_BODY_MAX_PX`, in a faint glow of its tint. A body cut to move elsewhere is dimmed, and
 * so are its moons.
 */
export class BodiesLayer implements SystemLayer {
  readonly container = new Container();
  private bodies: readonly SceneBody[] = EMPTY_SYSTEM_CONTEXT.bodies;
  private drawn: Drawn[] = [];
  private cut: readonly number[] = [];
  private scale = -1;
  private readonly unsubTextures: () => void;

  constructor(private readonly textures: SceneTextures) {
    this.unsubTextures = onTextures(() => this.redress());
  }

  rebuild(ctx: SystemContext): void {
    if (ctx.bodies === this.bodies) return;
    this.bodies = ctx.bodies;
    if (!this.move(ctx.bodies)) {
      for (const child of this.container.removeChildren()) child.destroy({ children: true });
      const ordered = [...ctx.bodies].sort((a, b) => bodyTier(a) - bodyTier(b));
      this.drawn = ordered.map((body) => this.place(body));
      this.resize();
    }
    this.dim();
  }

  setHighlighted(ref: SceneHighlight): void {
    if (ref.cutBodies === this.cut) return;
    this.cut = ref.cutBodies;
    this.dim();
  }

  /** Dims the cut bodies and the moons that go with them, and brings every other body back. */
  private dim(): void {
    const cut = new Set(this.cut);
    for (const { body, holder } of this.drawn) {
      const { id, moon, parent } = body.placement;
      const dimmed = cut.has(id) || (moon && parent !== null && cut.has(parent));
      holder.alpha = dimmed ? CUT_ALPHA : 1;
    }
  }

  /**
   * Moves each drawn body to where `bodies` put it and turns its light, when nothing else about
   * any of them changed; false, with nothing moved, otherwise.
   */
  private move(bodies: readonly SceneBody[]): boolean {
    if (bodies.length !== this.drawn.length) return false;
    const byId = new Map(bodies.map((b) => [b.placement.id, b]));
    const next = this.drawn.map((drawn) => byId.get(drawn.body.placement.id));
    if (!next.every((body, i) => body && drawnAlike(this.drawn[i].body, body))) return false;
    this.drawn.forEach((drawn, i) => {
      const body = next[i]!;
      const { x, y, light } = body.placement;
      drawn.body = body;
      drawn.holder.position.set(x, y);
      if (drawn.lit) drawn.lit.rotation = light ?? 0;
      if (drawn.shade) drawn.shade.rotation = light ?? 0;
    });
    return true;
  }

  private place(body: SceneBody): Drawn {
    const { placement } = body;
    // Mirrors the root's axis flip, so what is drawn inside stands upright and turns as on screen.
    const holder = new Container();
    holder.position.set(placement.x, placement.y);
    holder.scale.set(SAVE_X_SIGN, SAVE_Y_SIGN);
    const { look, chance } = body;
    const tint = look.tint;
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
    const hole = look.blackHole;
    const shines = placement.star && !hole;
    let glow: Sprite | null = null;
    if (shines || look.flat) {
      glow = sprite("glow", this.textures.corona);
      glow.tint = tint;
      glow.alpha = shines ? GLOW_ALPHA : FLAT_GLOW_ALPHA;
      glow.blendMode = "add";
    }
    const ringed = body.ring;
    const ringTint = mixColor(RING_COLOUR, tint, RING_TINT_SHARE);
    const ringHalf = (label: string, texture: Texture) => {
      const half = sprite(label, texture);
      half.tint = ringTint;
      half.rotation = RING_TILT;
      if (chance.ring) half.alpha = CHANCE_RING_ALPHA;
      return half;
    };
    const ringStripHalf = (label: string, far: boolean) => {
      const half = new Mesh({ geometry: ringStrip(far), texture: Texture.EMPTY });
      half.label = label;
      half.visible = false;
      half.rotation = RING_TILT;
      if (chance.ring) half.alpha = CHANCE_RING_ALPHA;
      holder.addChild(half);
      return half;
    };
    const back = ringed ? ringHalf("ringBack", this.textures.ringBack) : null;
    const backStrip = ringed ? ringStripHalf("ringBackStrip", true) : null;
    const disc = sprite("disc", this.textures.disc);
    disc.tint = hole ? 0x000000 : tint;
    let lit: Sprite | null = null;
    if (look.surfaceKey !== null) {
      lit = sprite("lit", Texture.EMPTY);
      lit.visible = false;
      lit.rotation = placement.light ?? 0;
    }
    const art = sprite("art", Texture.EMPTY);
    art.visible = false;
    // As on the galaxy map: the art's black ground adds nothing, so only its light shows.
    if (placement.star || look.luminous) art.blendMode = STAR_ART_BLEND;
    // A black hole's swirl is its accretion disc, seen round the black of the hole; a star's
    // art is the light about it, with its bright core behind the surface.
    if (placement.star) holder.setChildIndex(art, holder.getChildIndex(disc));
    const flare = look.flare;
    if (shines) art.alpha = STAR_ART[flare ?? "star"].alpha;
    const flares: Flare[] = [];
    for (const part of shines ? flareParts(flare) : []) {
      const s = sprite(part.label, this.textures[part.texture]);
      s.tint = part.tint ?? tint;
      s.alpha = part.alpha;
      s.blendMode = "add";
      s.rotation = part.shape.rotation;
      if (part.behind) holder.setChildIndex(s, holder.getChildIndex(disc));
      flares.push({ sprite: s, shape: part.shape });
    }
    const glazed = look.glaze;
    let glaze: Sprite | null = null;
    if (glazed !== null) {
      glaze = sprite("glaze", Texture.EMPTY);
      glaze.visible = false;
      glaze.tint = glazed;
      glaze.blendMode = "add";
      glaze.alpha = GLAZE_ALPHA;
    }
    let shade: Sprite | null = null;
    if (!placement.star && !look.irregular) {
      shade = sprite("shade", look.gloss ? this.textures.gloss : this.textures.shade);
      shade.blendMode = "multiply";
      shade.rotation = placement.light ?? 0;
    }
    const rim = !placement.star && !look.flat && body.atmosphere ? graphics("rim") : null;
    if (rim) rim.blendMode = "add";
    let ring: RingParts | null = null;
    if (back && backStrip) {
      const front = ringHalf("ringFront", this.textures.ringFront);
      const frontStrip = ringStripHalf("ringFrontStrip", false);
      ring = { back, front, backStrip, frontStrip };
    }
    let glyph: BitmapText | null = null;
    if (chance.planetClass) {
      glyph = new BitmapText({ text: "?", style: GLYPH_STYLE, anchor: 0.5 });
      holder.addChild(glyph);
    }
    this.container.addChild(holder);
    const drawn = {
      body,
      holder,
      glow,
      flares,
      glaze,
      ring,
      disc,
      lit,
      art,
      shade,
      rim,
      glyph,
      large: false,
    };
    drawn.large = this.isLarge(drawn);
    this.dress(drawn);
    return drawn;
  }

  private isLarge({ body }: Drawn): boolean {
    if (this.scale <= 0 || body.placement.star) return false;
    return 2 * drawnDisc(body.placement.disc, this.scale, body.look) * this.scale > LARGE_ICON_PX;
  }

  /**
   * Shows the lit disc and the icon once their textures have landed, and the tinted disc alone
   * until then; asks for them again after the cache was cleared, as when game data reloads. The
   * lit disc stands in for the icon, which only marked the surface. A star keeps its art, the
   * light about it, and shows its surface in place of the tinted disc once that lands. A ring
   * shows the game's texture once it lands, and its baked halves until then.
   */
  private dress(drawn: Drawn): void {
    const { body, art, disc, lit } = drawn;
    if (drawn.ring) this.dressRing(drawn.ring);
    const key = body.look.surfaceKey;
    const surface = key === null ? null : landed([key], true);
    if (lit) {
      lit.texture = surface ?? Texture.EMPTY;
      lit.visible = surface !== null;
    }
    const [wanted, other] = drawn.large
      ? [body.largeIconKeys, body.iconKeys]
      : [body.iconKeys, body.largeIconKeys];
    const star = body.placement.star;
    const iconless = body.chance.planetClass || (surface !== null && !star);
    // Across the large-icon threshold, the icon already in hand stands in until the other lands.
    const texture = iconless ? null : (landed(wanted, true) ?? landed(other, false));
    art.texture = texture ?? Texture.EMPTY;
    art.visible = texture !== null;
    if (drawn.glaze) {
      drawn.glaze.texture = art.texture;
      drawn.glaze.visible = art.visible;
    }
    // The tinted disc only holds the place until the surface or the icon lands; an icon's own
    // outline and margin would show it as a band. A star's art is not its surface.
    disc.visible = surface === null && (star || texture === null);
  }

  private dressRing(ring: RingParts): void {
    const strip = landed([RING_KEY], true);
    for (const half of [ring.backStrip, ring.frontStrip]) {
      half.texture = strip ?? Texture.EMPTY;
      half.visible = strip !== null;
    }
    ring.back.visible = strip === null;
    ring.front.visible = strip === null;
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
      const { body, glow, flares, glaze, ring, disc, lit, art, shade, rim, glyph } = drawn;
      const d = 2 * drawnDisc(body.placement.disc, this.scale, body.look);
      const artWidth = d * artScale(body);
      if (glow) sized(glow, d * (body.look.flat ? FLAT_GLOW_SCALE : GLOW_SCALE));
      sized(disc, d);
      if (lit) {
        sized(lit, d);
        // A planet's bake is lit from its left; mirrored, its light lies along +x as the mask's does.
        if (!body.placement.star) lit.scale.x = -lit.scale.x;
      }
      for (const { sprite, shape } of flares) {
        const { width, height } = sprite.texture;
        sprite.scale.set(
          (d * shape.length) / Math.max(width, 1),
          (d * shape.thickness) / Math.max(height, 1),
        );
        const along = d * (shape.offset ?? 0);
        sprite.position.set(along * Math.cos(shape.rotation), along * Math.sin(shape.rotation));
      }
      sized(art, artWidth);
      if (glaze) sized(glaze, artWidth);
      if (shade) sized(shade, d);
      if (rim && body.atmosphere) this.drawRim(rim, body.atmosphere, d / 2);
      if (ring) sizeRing(ring, d / 2);
      if (glyph) glyph.scale.set((d * GLYPH_SCALE) / GLYPH_FONT_PX);
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

  destroy(): void {
    this.unsubTextures();
    this.container.destroy({ children: true });
  }
}
