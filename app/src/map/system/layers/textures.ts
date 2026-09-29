import { BufferImageSource, Graphics, Rectangle, Texture, type Renderer } from "pixi.js";
import { nebulaTexels } from "./nebulaField";
import { RING_INNER } from "./ring";
import {
  beamTexels,
  glowTexels,
  haloTexels,
  plumeTexels,
  swirlTexels,
  wispTexels,
} from "./starLight";
import type { Texels } from "./texels";
import { wormholeHazeTexels, wormholeRimTexels, wormholeSwirlTexels } from "./wormholeField";

/** The textures the scene draws its bodies and belts with, baked once per scene. */
export interface SceneTextures {
  /** A white disc, tinted per body. */
  disc: Texture;
  /** A soft glow with no core, tinted and added round a star in the system view. */
  corona: Texture;
  /** A pulsar's two thin beams along x, each fading and narrowing away from the star. */
  beam: Texture;
  /** A neutron star's two broad jets along x, soft and threaded with filaments. */
  plume: Texture;
  /** Faint curling strands round an empty middle, about a neutron star. */
  wisps: Texture;
  /** Light bleeding past a star's limb, brightest on it. */
  halo: Texture;
  /** Two soft spiral arms of haze round a pulsar. */
  swirl: Texture;
  /** The sphere shading, lit from +x, multiplied over a disc. */
  shade: Texture;
  /** The same shading with a specular dot near the lit edge. */
  gloss: Texture;
  /** The pieces a belt is scattered from, white or grey and tinted per piece. */
  belt: BeltTextures;
  /**
   * A planet's ring seen face on, as its far (upper) and near (lower) halves, each in the frame
   * of the whole ring so the two line up; squashed into an ellipse and tinted per body.
   */
  ringBack: Texture;
  ringFront: Texture;
  /**
   * The nebula field: white wisps swirling about the centre, clear in the middle and fading to
   * nothing at the edge, tinted and turned per system.
   */
  nebula: Texture;
  /**
   * A natural wormhole's three layers, sharing one frame: its wide soft haze, its swirl of cloud
   * about a dark eye, and the ring hugging the eye with the pinpoint inside it.
   */
  wormholeHaze: Texture;
  wormholeSwirl: Texture;
  wormholeRim: Texture;
}

/** The pieces an asteroid belt is drawn with, one texture each, shared by every belt. */
export interface BeltTextures {
  /** An uneven rock, lighter on one face. */
  rock: Texture;
  /** A thin sliver of ice. */
  shard: Texture;
  /** A long six-sided crystal with a lighter facet down one side. */
  crystal: Texture;
  /** A box with bands across it, as a cargo container is. */
  container: Texture;
  /** A rounded, wobbly body, lighter towards its core. */
  blob: Texture;
  /** A soft speck of dust. */
  speck: Texture;
  /** A four-pointed sparkle, added over the belt. */
  glint: Texture;
  /** A soft round glow with no edge, added over the belt. */
  glow: Texture;
}

export type BeltPiece = keyof BeltTextures;

const DISC_R = 32;
const SHADE_R = 32;
const SHADE_STEPS = 16;
/** Grey of the unlit side, and of the brightest point of the lit one. */
const NIGHT = 0x2c;
const DAY = 0xf4;
/** How far towards the light the lit side's centre sits, in radii. */
const LIT_OFFSET = 0.32;
/** Half the angle the lighter limb spans on the lit edge, in radians. */
const LIMB_SPAN = 1.2;
const ROCK_R = 4;
/** The belt pieces' own sizes, in texture pixels before the resolution. */
const PIECE_R = 8;
const GLOW_STEPS = 10;
const RING_R = 64;
/** Fine grooves, faint and uneven, as the game's rings are. */
const RING_BANDS = 44;
const RING_ALPHA_MIN = 0.05;
const RING_ALPHA_SPAN = 0.22;
/** Where across the band, from inner to outer, the dark gap lies, and its half width. */
const RING_GAP = 0.64;
const RING_GAP_HALF = 0.05;
/** The points round a circle of the shading, the limb's grey, and a rock's shadowed faces' grey. */
const CIRCLE_POINTS = 64;
const LIMB_GREY = 0xd8;
const ROCK_GREY = 0xc8;

function grey(v: number): number {
  const c = Math.round(Math.min(255, Math.max(0, v)));
  return (c << 16) | (c << 8) | c;
}

function bake(renderer: Renderer, draw: (g: Graphics) => void, frame?: Rectangle): Texture {
  const g = new Graphics();
  draw(g);
  const texture = renderer.generateTexture({ target: g, resolution: 2, frame });
  g.destroy();
  return texture;
}

/** A circle about (cx, cy) with each point pulled in to the shading disc, so it never spills past it. */
function clippedCircle(cx: number, cy: number, r: number): number[] {
  const points: number[] = [];
  const limit = SHADE_R * 0.999;
  for (let i = 0; i < CIRCLE_POINTS; i++) {
    const a = (i / CIRCLE_POINTS) * 2 * Math.PI;
    let x = cx + r * Math.cos(a) - SHADE_R;
    let y = cy + r * Math.sin(a) - SHADE_R;
    const d = Math.hypot(x, y);
    if (d > limit) {
      x *= limit / d;
      y *= limit / d;
    }
    points.push(x + SHADE_R, y + SHADE_R);
  }
  return points;
}

/**
 * Dark at the edge and on the far side, brightest a little towards +x, with a thin lighter limb
 * on the lit edge. Multiplied over a disc, white leaves it as it is and grey darkens it.
 */
function drawShade(g: Graphics, gloss: boolean): void {
  const R = SHADE_R;
  g.circle(R, R, R).fill({ color: grey(NIGHT) });
  for (let i = 0; i < SHADE_STEPS; i++) {
    const t = i / (SHADE_STEPS - 1);
    const r = R * (1.05 - 0.8 * t);
    const cx = R + R * LIT_OFFSET * (1 - 0.4 * t);
    const v = NIGHT + (DAY - NIGHT) * Math.pow(t, 0.6);
    g.poly(clippedCircle(cx, R, r)).fill({ color: grey(v) });
  }
  const limb = R * 0.94;
  g.moveTo(R + limb * Math.cos(-LIMB_SPAN), R + limb * Math.sin(-LIMB_SPAN))
    .arc(R, R, limb, -LIMB_SPAN, LIMB_SPAN)
    .stroke({ color: grey(LIMB_GREY), width: R * 0.07, alpha: 0.8 });
  if (gloss) g.circle(R + R * 0.48, R - R * 0.28, R * 0.1).fill({ color: 0xffffff });
}

/** An uneven five-sided rock, lighter on one face. */
function drawRock(g: Graphics): void {
  const R = ROCK_R;
  const corners = [1, 0.75, 0.95, 0.7, 0.9];
  const points = corners.flatMap((k, i) => {
    const a = (i / corners.length) * 2 * Math.PI;
    return [R + R * k * Math.cos(a), R + R * k * Math.sin(a)];
  });
  g.poly(points).fill({ color: grey(ROCK_GREY) });
  g.poly([R, R, points[0], points[1], points[2], points[3]]).fill({ color: 0xffffff });
}

/** A pale sliver: a long thin quad, lit along one edge. */
function drawShard(g: Graphics): void {
  const R = PIECE_R;
  const points = [R, 0, R * 1.45, R * 0.9, R, 2 * R, R * 0.65, R * 1.05];
  g.poly(points).fill({ color: grey(0xd0) });
  g.poly([R, 0, R * 1.45, R * 0.9, R, R * 1.1]).fill({ color: 0xffffff });
}

/** A crystal three times as long as it is wide, pointed at both ends, with a lighter facet. */
function drawCrystal(g: Graphics): void {
  const w = PIECE_R * 0.7;
  const h = PIECE_R * 2.4;
  const tip = w * 0.9;
  const outline = [w / 2, 0, w, tip, w, h - tip, w / 2, h, 0, h - tip, 0, tip];
  g.poly(outline).fill({ color: grey(0xa8) });
  g.poly([w / 2, 0, w, tip, w, h - tip, w / 2, h]).fill({ color: 0xffffff });
  g.moveTo(w / 2, 0)
    .lineTo(w / 2, h)
    .stroke({ color: 0xffffff, width: 0.6, alpha: 0.8 });
}

/** A box twice as long as it is deep, with darker bands across it and a lit top edge. */
function drawContainer(g: Graphics): void {
  const w = PIECE_R * 2;
  const h = PIECE_R;
  g.rect(0, 0, w, h).fill({ color: grey(0xd8) });
  for (const x of [w * 0.33, w * 0.66]) g.rect(x - 0.6, 0, 1.2, h).fill({ color: grey(0x80) });
  g.rect(0, 0, w, h * 0.22).fill({ color: 0xffffff });
  g.rect(0, h * 0.8, w, h * 0.2).fill({ color: grey(0x90) });
}

/** A wobbly round body, dim at its edge and bright at its core. */
function drawBlob(g: Graphics): void {
  const R = PIECE_R;
  const lobes = [1, 0.86, 0.95, 0.8, 0.92, 0.84, 0.98, 0.88];
  const ring = (scale: number, dx: number, dy: number) =>
    lobes.flatMap((k, i) => {
      const a = (i / lobes.length) * 2 * Math.PI;
      return [R + dx + R * k * scale * Math.cos(a), R + dy + R * k * scale * Math.sin(a)];
    });
  g.poly(ring(1, 0, 0)).fill({ color: grey(0x88), alpha: 0.85 });
  g.poly(ring(0.72, -R * 0.08, -R * 0.06)).fill({ color: grey(0xb8) });
  g.circle(R * 0.84, R * 0.86, R * 0.36).fill({ color: 0xffffff });
}

/** A small round speck with a fainter rim. */
function drawSpeck(g: Graphics): void {
  const R = PIECE_R / 2;
  g.circle(R, R, R).fill({ color: 0xffffff, alpha: 0.4 });
  g.circle(R, R, R * 0.6).fill({ color: 0xffffff });
}

/** Four thin points about a bright centre. */
function drawGlint(g: Graphics): void {
  const R = PIECE_R;
  const t = R * 0.14;
  g.poly([
    R,
    0,
    R + t,
    R - t,
    2 * R,
    R,
    R + t,
    R + t,
    R,
    2 * R,
    R - t,
    R + t,
    0,
    R,
    R - t,
    R - t,
  ]).fill({ color: 0xffffff });
  g.circle(R, R, R * 0.22).fill({ color: 0xffffff });
}

/** Stacked faint circles, brightest in the middle and fading to nothing at the edge. */
function drawGlow(g: Graphics): void {
  const R = PIECE_R;
  for (let i = 0; i < GLOW_STEPS; i++) {
    g.circle(R, R, R * (1 - i / GLOW_STEPS)).fill({ color: 0xffffff, alpha: 0.1 });
  }
}

function bakeBeltTextures(renderer: Renderer): BeltTextures {
  return {
    rock: bake(renderer, drawRock),
    shard: bake(renderer, drawShard),
    crystal: bake(renderer, drawCrystal),
    container: bake(renderer, drawContainer),
    blob: bake(renderer, drawBlob),
    speck: bake(renderer, drawSpeck),
    glint: bake(renderer, drawGlint),
    glow: bake(renderer, drawGlow),
  };
}

/**
 * Half the ring, the far half above the centre and the near half below it: concentric bands
 * from the inner edge out, faint and grooved, brightest mid-band, with a dark gap and a soft fade
 * at both edges.
 */
function drawRingHalf(g: Graphics, far: boolean): void {
  const R = RING_R;
  const [from, to] = far ? [Math.PI, 2 * Math.PI] : [0, Math.PI];
  const inner = R * RING_INNER;
  const step = (R - inner) / RING_BANDS;
  for (let i = 0; i < RING_BANDS; i++) {
    const t = (i + 0.5) / RING_BANDS;
    const r = inner + (i + 0.5) * step;
    const gap = Math.abs(t - RING_GAP) < RING_GAP_HALF ? 0.2 : 1;
    const groove = 0.55 + 0.45 * Math.cos(t * 37) * Math.cos(t * 13);
    const alpha = (RING_ALPHA_MIN + RING_ALPHA_SPAN * Math.sin(Math.PI * t) * groove) * gap;
    const v = 0xa0 + 0x50 * (0.5 + 0.5 * Math.cos(t * 23));
    g.moveTo(R + r * Math.cos(from), R + r * Math.sin(from))
      .arc(R, R, r, from, to)
      .stroke({ color: grey(v), width: step, alpha });
  }
}

/** Texels made on the CPU: they need no renderer. */
function texelTexture({ texels: resource, width, height }: Texels): Texture {
  const source = new BufferImageSource({
    resource,
    width,
    height,
    format: "rgba8unorm",
    alphaMode: "premultiplied-alpha",
  });
  return new Texture({ source });
}

export function bakeSceneTextures(renderer: Renderer): SceneTextures {
  const ringFrame = () => new Rectangle(0, 0, 2 * RING_R, 2 * RING_R);
  return {
    disc: bake(renderer, (g) => g.circle(DISC_R, DISC_R, DISC_R).fill({ color: 0xffffff })),
    corona: texelTexture(glowTexels()),
    beam: texelTexture(beamTexels()),
    plume: texelTexture(plumeTexels()),
    wisps: texelTexture(wispTexels()),
    halo: texelTexture(haloTexels()),
    swirl: texelTexture(swirlTexels()),
    shade: bake(renderer, (g) => drawShade(g, false)),
    gloss: bake(renderer, (g) => drawShade(g, true)),
    belt: bakeBeltTextures(renderer),
    ringBack: bake(renderer, (g) => drawRingHalf(g, true), ringFrame()),
    ringFront: bake(renderer, (g) => drawRingHalf(g, false), ringFrame()),
    nebula: texelTexture(nebulaTexels()),
    wormholeHaze: texelTexture(wormholeHazeTexels()),
    wormholeSwirl: texelTexture(wormholeSwirlTexels()),
    wormholeRim: texelTexture(wormholeRimTexels()),
  };
}

/** Destroys the textures `bakeSceneTextures` made. */
export function releaseSceneTextures({ belt, ...textures }: SceneTextures): void {
  for (const texture of [...Object.values(textures), ...Object.values(belt)]) texture.destroy(true);
}
