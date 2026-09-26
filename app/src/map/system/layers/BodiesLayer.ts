import {
  BitmapText,
  Container,
  Graphics,
  Mesh,
  MeshGeometry,
  Sprite,
  TextStyle,
  Texture,
} from "pixi.js";
import { planetTint } from "../../../lib/details/icons";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../../../lib/geometry/geometry";
import { MAP_FONT } from "../../../lib/visual/style";
import { starFlare, starGlyph, type StarFlare } from "../../../lib/visual/starGlyphs";
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
import { ICY_TINT } from "./BeltsLayer";
import type { SystemLayer } from "./SystemLayer";
import { BEAM_LENGTH, HALO_SCALE, PLUME_LENGTH, SWIRL_SCALE } from "./starLight";
import type { SceneTextures } from "./textures";

/** The glow added round a star, in disc diameters, and how strongly. */
const GLOW_SCALE = 2.4;
const GLOW_ALPHA = 0.55;
/**
 * A star's galaxy art behind its surface, in disc diameters, and how strongly it shows: faint,
 * so its spikes barely show past the limb. A neutron star's shell sits close about the body.
 */
const STAR_ART: Record<StarFlare | "star", { scale: number; alpha: number }> = {
  star: { scale: 2.6, alpha: 0.18 },
  pulsar: { scale: 2.8, alpha: 0.35 },
  neutron: { scale: 1.5, alpha: 0.15 },
};
/**
 * The game's bloom bleeds a star's light past its limb. A bloom hugging the limb stands in for
 * it: mild and in the class's colour round an ordinary star, strong and near white round a
 * pulsar or a neutron star, where it joins the beams to the body.
 */
const HALO: FlareShape = { length: HALO_SCALE, thickness: HALO_SCALE, rotation: 0 };
const STAR_HALO_ALPHA = 0.35;
const EXOTIC_HALO_TINT = 0xe6f1ff;
const EXOTIC_HALO_ALPHA = 0.45;
/**
 * The game glazes a pulsar's and a neutron star's surface with thousands of pale blue particles;
 * a wash of pale blue added over the disc stands in for them.
 */
const WASH: FlareShape = { length: 1, thickness: 1, rotation: 0 };
const WASH_TINT = 0xb4d0ff;
const WASH_ALPHA = 0.35;
/**
 * The light a pulsar or a neutron star throws off its poles: its length and thickness in disc
 * diameters, and its turn on screen. The beams and jets pass behind the star, so none of them
 * crosses its surface, and a bloom sits over the limb where each leaves it. A pulsar's beams are
 * thin and lie along the beams of its galaxy art; a neutron star's jets are broad soft plumes,
 * straight up and down, with wisps curling round the body.
 */
const PULSAR_TURN = 1.07;
const PULSAR_BEAMS: FlareShape = { length: BEAM_LENGTH, thickness: 0.5, rotation: PULSAR_TURN };
const PULSAR_BLOOM = 0.75;
/** The pale haze swirling round a pulsar, reaching well past the limb. */
const PULSAR_SWIRL: FlareShape = { length: SWIRL_SCALE, thickness: SWIRL_SCALE, rotation: 0 };
const SWIRL_TINT = 0xcfe2ff;
const SWIRL_ALPHA = 0.35;
const NEUTRON_TURN = Math.PI / 2;
const NEUTRON_JETS: FlareShape = { length: PLUME_LENGTH, thickness: 1.4, rotation: NEUTRON_TURN };
const NEUTRON_BLOOM = 0.9;
/** Faint thin strands of pale blue, flung out one and a half to three disc radii. */
const NEUTRON_WISPS: FlareShape = { length: 3.4, thickness: 3.4, rotation: 0 };
const WISPS_TINT = 0x9ec4ff;
/** A wide soft blue glow round a neutron star, through which the wisps and orbits show. */
const NEUTRON_AURA: FlareShape = { length: 6, thickness: 6, rotation: 0 };
const AURA_TINT = 0x7fa8ff;
const AURA_ALPHA = 0.25;
const FLARE_TINT = 0xcfe4ff;
const FLARE_ALPHA = 0.75;
const BLOOM_TINT = 0xeef6ff;
const BLOOM_ALPHA = 0.6;
const WISPS_ALPHA = 0.2;
/** A black hole's swirl, in disc diameters. */
const HOLE_ART_SCALE = 2.6;
/** A planet's class icon, in disc diameters. */
const PLANET_ART_SCALE = 1;
/** The on-screen disc diameter, in pixels, past which a planet shows its class's large icon. */
const LARGE_ICON_PX = 48;
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
/**
 * A ring's outer semi-axes in disc radii, and its tilt on screen: seen from well above, as the
 * game shows it. The game's ring mesh spans 1.39 to 2.12 planet radii.
 */
const RING_MAJOR = 2.12;
const RING_MINOR = RING_MAJOR * 0.75;
const RING_TILT = -0.08;
const RING_INNER = 1.39 / 2.12;
/** The game's ring texture, a radial strip wrapped round the ring, and the steps round each half. */
const RING_KEY = "planet_ring";
const RING_SEGMENTS = 32;
/** The baked ring's warm neutral, and how far it leans towards the body's own tint. */
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

/** A black hole, drawn black with its swirl behind it, where every other star shines. */
function blackHole(body: SceneBody): boolean {
  return body.placement.star && body.starClass !== null && starGlyph(body.starClass).ring;
}

function flareOf(body: SceneBody): StarFlare | null {
  return body.placement.star && body.starClass !== null ? starFlare(body.starClass) : null;
}

function artScale(body: SceneBody): number {
  if (blackHole(body)) return HOLE_ART_SCALE;
  return body.placement.star ? STAR_ART[flareOf(body) ?? "star"].scale : PLANET_ART_SCALE;
}

/**
 * The game's asteroid kinds share one icon and differ only in their models; a glaze of the icon
 * added over itself in the kind's colour tells them apart.
 */
const ASTEROID_GLAZES: Array<[RegExp, number]> = [
  [/ice_asteroid/, ICY_TINT],
  [/crystal_asteroid/, 0xd9b3ff],
];
const GLAZE_ALPHA = 0.6;

function glazeTint(planetClass: string): number | null {
  return ASTEROID_GLAZES.find(([pattern]) => pattern.test(planetClass))?.[1] ?? null;
}

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

/**
 * The texture key of the class's surface baked as a disc: a star's lit from within, a planet's
 * lit from one side. None for a black hole, a random class or an irregular one.
 */
function litKey(body: SceneBody): string | null {
  const { planetClass, surfaceClass } = body;
  if (blackHole(body) || randomClass(planetClass) || irregular(planetClass)) return null;
  return body.placement.star ? `star_disc:${surfaceClass}` : `planet_disc:${surfaceClass}`;
}

/** The first of `keys` already in the cache, without asking for any. */
function landed(keys: readonly string[]): Texture | null {
  for (const key of keys) {
    const texture = getTexture(key);
    if (texture) return texture;
  }
  return null;
}

/**
 * Half the unit ring, the far half on -y as the baked halves have it, with u running round the
 * whole ring and v from 0 at the outer edge to 1 at the inner, as the game's mesh maps its strip.
 */
function ringStripGeometry(far: boolean): MeshGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const from = far ? Math.PI : 0;
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const t = from + (Math.PI * i) / RING_SEGMENTS;
    const u = t / (2 * Math.PI);
    positions.push(Math.cos(t), Math.sin(t), RING_INNER * Math.cos(t), RING_INNER * Math.sin(t));
    uvs.push(u, 0, u, 1);
    if (i > 0) {
      const k = 2 * i;
      indices.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  }
  return new MeshGeometry({
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  });
}

/** The two halves' geometry, made once and shared by every ring. */
const ringStrips = new Map<boolean, MeshGeometry>();

function ringStrip(far: boolean): MeshGeometry {
  let geometry = ringStrips.get(far);
  if (!geometry) ringStrips.set(far, (geometry = ringStripGeometry(far)));
  return geometry;
}

/** Stars under planets under moons, so a moon is never hidden behind its planet. */

function drawOrder(body: SceneBody): number {
  return body.placement.star ? 0 : body.moon ? 2 : 1;
}

interface Ring {
  /** The baked halves, shown until the game's ring texture lands, or when it cannot. */
  back: Sprite;
  front: Sprite;
  /** The game's ring texture on each half. */
  backStrip: Mesh;
  frontStrip: Mesh;
  /** The outline of a ring left to chance. */
  dashes: Graphics | null;
}

/**
 * A beam, a jet, a bloom or the wisps: its length and thickness in disc diameters, its turn, and
 * how far from the star's centre it sits along that turn, in disc diameters.
 */
interface FlareShape {
  length: number;
  thickness: number;
  rotation: number;
  offset?: number;
}

/** The blooms over the limb at both ends of lights turned `rotation`, `size` discs across. */
function blooms(rotation: number, size: number): FlareShape[] {
  return [0.5, -0.5].map((offset) => ({ length: size, thickness: size, rotation, offset }));
}

interface Flare {
  sprite: Sprite;
  shape: FlareShape;
}

interface Drawn {
  body: SceneBody;
  glow: Sprite | null;
  flares: Flare[];
  glaze: Sprite | null;
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
 * A tinted disc per body with its class icon on top, a glow under each star and the sphere
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
    const hole = blackHole(body);
    const shines = placement.star && !hole;
    let glow: Sprite | null = null;
    if (shines) {
      glow = sprite("glow", this.textures.corona);
      glow.tint = tint;
      glow.alpha = GLOW_ALPHA;
      glow.blendMode = "add";
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
    const ringStripHalf = (label: string, far: boolean) => {
      const half = new Mesh({ geometry: ringStrip(far), texture: Texture.EMPTY });
      half.label = label;
      half.visible = false;
      half.rotation = RING_TILT;
      if (body.ring === null) half.alpha = GHOST_ALPHA;
      holder.addChild(half);
      return half;
    };
    const back = ringed ? ringHalf("ringBack", this.textures.ringBack) : null;
    const backStrip = ringed ? ringStripHalf("ringBackStrip", true) : null;
    const disc = sprite("disc", this.textures.disc);
    disc.tint = hole ? 0x000000 : tint;
    let lit: Sprite | null = null;
    if (litKey(body) !== null) {
      lit = sprite("lit", Texture.EMPTY);
      lit.visible = false;
      lit.rotation = placement.light ?? 0;
    }
    const art = sprite("art", Texture.EMPTY);
    art.visible = false;
    // As on the galaxy map: the art's black ground adds nothing, so only its light shows.
    if (placement.star || luminous(body.planetClass)) art.blendMode = STAR_ART_BLEND;
    // A black hole's swirl is its accretion disc, seen round the black of the hole; a star's
    // art is the light about it, with its bright core behind the surface.
    if (placement.star) holder.setChildIndex(art, holder.getChildIndex(disc));
    const flare = flareOf(body);
    if (shines) art.alpha = STAR_ART[flare ?? "star"].alpha;
    const flares: Flare[] = [];
    const addFlare = (label: string, texture: Texture, shape: FlareShape, alpha: number) => {
      const s = sprite(label, texture);
      s.tint = FLARE_TINT;
      s.alpha = alpha;
      s.blendMode = "add";
      s.rotation = shape.rotation;
      flares.push({ sprite: s, shape });
      return s;
    };
    const behind = (label: string, texture: Texture, shape: FlareShape, alpha: number) => {
      const s = addFlare(label, texture, shape, alpha);
      holder.setChildIndex(s, holder.getChildIndex(disc));
      return s;
    };
    if (flare === "pulsar") {
      behind("haze", this.textures.swirl, PULSAR_SWIRL, SWIRL_ALPHA).tint = SWIRL_TINT;
      behind("beams", this.textures.beam, PULSAR_BEAMS, FLARE_ALPHA);
    }
    if (flare === "neutron") {
      behind("jets", this.textures.plume, NEUTRON_JETS, FLARE_ALPHA);
      behind("aura", this.textures.corona, NEUTRON_AURA, AURA_ALPHA).tint = AURA_TINT;
      behind("wisps", this.textures.wisps, NEUTRON_WISPS, WISPS_ALPHA).tint = WISPS_TINT;
    }
    if (flare) addFlare("wash", this.textures.disc, WASH, WASH_ALPHA).tint = WASH_TINT;
    if (shines) {
      const halo = addFlare("halo", this.textures.halo, HALO, STAR_HALO_ALPHA);
      halo.tint = flare ? EXOTIC_HALO_TINT : tint;
      if (flare) halo.alpha = EXOTIC_HALO_ALPHA;
    }
    const poles = flare === "pulsar" ? blooms(PULSAR_TURN, PULSAR_BLOOM) : [];
    if (flare === "neutron") poles.push(...blooms(NEUTRON_TURN, NEUTRON_BLOOM));
    for (const shape of poles) {
      addFlare("bloom", this.textures.corona, shape, BLOOM_ALPHA).tint = BLOOM_TINT;
    }
    const glazed = glazeTint(body.planetClass);
    let glaze: Sprite | null = null;
    if (glazed !== null) {
      glaze = sprite("glaze", Texture.EMPTY);
      glaze.visible = false;
      glaze.tint = glazed;
      glaze.blendMode = "add";
      glaze.alpha = GLAZE_ALPHA;
    }
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
    if (back && backStrip) {
      const front = ringHalf("ringFront", this.textures.ringFront);
      const frontStrip = ringStripHalf("ringFrontStrip", false);
      const dashes = body.ring === null ? graphics("ringDashes") : null;
      ring = { back, front, backStrip, frontStrip, dashes };
    }
    let glyph: BitmapText | null = null;
    if (randomClass(body.planetClass)) {
      glyph = new BitmapText({ text: "?", style: GLYPH_STYLE, anchor: 0.5 });
      holder.addChild(glyph);
    }
    let outline: Graphics | null = null;
    if (placement.ghost) {
      const faded = [
        glow,
        ...flares.map((f) => f.sprite),
        ring?.back,
        ring?.front,
        ring?.backStrip,
        ring?.frontStrip,
        disc,
        lit,
        art,
        glaze,
        shade,
        rim,
        glyph,
      ];
      for (const part of faded) if (part) part.alpha *= GHOST_ALPHA;
      outline = graphics("outline");
    }
    this.container.addChild(holder);
    const drawn = {
      body,
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
   * lit disc stands in for the icon, which only marked the surface. A star keeps its art, the
   * light about it, and shows its surface in place of the tinted disc once that lands. A ring
   * shows the game's texture once it lands, and its baked halves until then.
   */
  private dress(drawn: Drawn): void {
    const { body, art, disc, lit } = drawn;
    if (drawn.ring) this.dressRing(drawn.ring);
    const key = litKey(body);
    const surface = key === null ? null : this.resolve([key]);
    if (lit) {
      lit.texture = surface ?? Texture.EMPTY;
      lit.visible = surface !== null;
    }
    const [wanted, other] = drawn.large
      ? [body.largeIconKeys, body.iconKeys]
      : [body.iconKeys, body.largeIconKeys];
    const star = body.placement.star;
    const iconless = randomClass(body.planetClass) || (surface !== null && !star);
    // Across the large-icon threshold, the icon already in hand stands in until the other lands.
    const texture = iconless ? null : (this.resolve(wanted) ?? landed(other));
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

  private dressRing(ring: Ring): void {
    const strip = this.resolve([RING_KEY]);
    for (const half of [ring.backStrip, ring.frontStrip]) {
      half.texture = strip ?? Texture.EMPTY;
      half.visible = strip !== null;
    }
    ring.back.visible = strip === null;
    ring.front.visible = strip === null;
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
      const { body, glow, flares, glaze, ring, disc, lit, art, shade, rim, glyph } = drawn;
      const { outline } = drawn;
      const d = 2 * drawnDisc(body.placement.disc, this.scale);
      if (glow) sized(glow, d * GLOW_SCALE);
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
      sized(art, d * artScale(body));
      if (glaze) sized(glaze, d * artScale(body));
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
    for (const half of [ring.backStrip, ring.frontStrip]) {
      half.scale.set(RING_MAJOR * radius, RING_MINOR * radius);
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
