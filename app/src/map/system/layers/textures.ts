import { BufferImageSource, Graphics, Rectangle, Texture, type Renderer } from "pixi.js";
import { acquireGlow, releaseGlow } from "../../layers/SystemsLayer";
import { FIELD_SIZE, nebulaField } from "./nebulaField";
import {
  GLOW_SIZE,
  STREAK_HEIGHT,
  STREAK_WIDTH,
  WISPS_SIZE,
  glowTexels,
  streakTexels,
  wispTexels,
} from "./starLight";

/** The textures the scene draws its bodies and belts with, baked once per scene. */
export interface SceneTextures {
  /** A white disc, tinted per body. */
  disc: Texture;
  /** The star glow the galaxy's stars use, shared with them. */
  glow: Texture;
  /** A soft glow with no core, tinted and added round a star in the system view. */
  corona: Texture;
  /** A thread of light along x, fading out both ways: a pulsar's beams, a neutron star's jets. */
  streak: Texture;
  /** Faint curling strands round an empty middle, about a neutron star. */
  wisps: Texture;
  /** The sphere shading, lit from +x, multiplied over a disc. */
  shade: Texture;
  /** The same shading with a specular dot near the lit edge. */
  gloss: Texture;
  /** One small rock, tinted per belt. */
  rock: Texture;
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
}

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
const RING_R = 64;
/** The ring's inner edge, as a share of its outer one. */
const RING_INNER = 1.39 / 2.12;
/** Fine grooves, faint and uneven, as the game's rings are. */
const RING_BANDS = 44;
const RING_ALPHA_MIN = 0.05;
const RING_ALPHA_SPAN = 0.22;
/** Where across the band, from inner to outer, the dark gap lies, and its half width. */
const RING_GAP = 0.64;
const RING_GAP_HALF = 0.05;
/** Every system's nebula draws the same field, turned and mirrored per system. */
const NEBULA_SEED = 0x5ca1ab1e;
/** The texels made on the CPU, made once and shared by every scene's textures. */
let nebulaTexels: Uint8Array | null = null;
let coronaTexels: Uint8Array | null = null;
let streakField: Uint8Array | null = null;
let wispField: Uint8Array | null = null;

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
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * 2 * Math.PI;
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
    .stroke({ color: grey(0xd8), width: R * 0.07, alpha: 0.8 });
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
  g.poly(points).fill({ color: 0xc8c8c8 });
  g.poly([R, R, points[0], points[1], points[2], points[3]]).fill({ color: 0xffffff });
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

/** White texels with premultiplied alpha, made on the CPU: they need no renderer. */
function texelTexture(resource: Uint8Array, width: number, height: number): Texture {
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
    glow: acquireGlow(renderer),
    corona: texelTexture((coronaTexels ??= glowTexels()), GLOW_SIZE, GLOW_SIZE),
    streak: texelTexture((streakField ??= streakTexels()), STREAK_WIDTH, STREAK_HEIGHT),
    wisps: texelTexture((wispField ??= wispTexels()), WISPS_SIZE, WISPS_SIZE),
    shade: bake(renderer, (g) => drawShade(g, false)),
    gloss: bake(renderer, (g) => drawShade(g, true)),
    rock: bake(renderer, drawRock),
    ringBack: bake(renderer, (g) => drawRingHalf(g, true), ringFrame()),
    ringFront: bake(renderer, (g) => drawRingHalf(g, false), ringFrame()),
    nebula: texelTexture((nebulaTexels ??= nebulaField(NEBULA_SEED)), FIELD_SIZE, FIELD_SIZE),
  };
}

/** Destroys the textures `bakeSceneTextures` made and lets go of the shared glow. */
export function releaseSceneTextures(renderer: Renderer, textures: SceneTextures): void {
  const { disc, corona, streak, wisps, shade, gloss, rock, ringBack, ringFront, nebula } = textures;
  for (const texture of [
    disc,
    corona,
    streak,
    wisps,
    shade,
    gloss,
    rock,
    ringBack,
    ringFront,
    nebula,
  ]) {
    texture.destroy(true);
  }
  releaseGlow(renderer);
}
