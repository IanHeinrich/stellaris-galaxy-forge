import { Graphics, type Renderer, type Texture } from "pixi.js";
import { acquireGlow, releaseGlow } from "../../layers/SystemsLayer";

/** The textures the scene draws its bodies and belts with, baked once per scene. */
export interface SceneTextures {
  /** A white disc, tinted per body. */
  disc: Texture;
  /** The star glow the galaxy's stars use, shared with them. */
  glow: Texture;
  /** The sphere shading, lit from +x, multiplied over a disc. */
  shade: Texture;
  /** The same shading with a specular dot near the lit edge. */
  gloss: Texture;
  /** One small rock, tinted per belt. */
  rock: Texture;
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

function grey(v: number): number {
  const c = Math.round(Math.min(255, Math.max(0, v)));
  return (c << 16) | (c << 8) | c;
}

function bake(renderer: Renderer, draw: (g: Graphics) => void): Texture {
  const g = new Graphics();
  draw(g);
  const texture = renderer.generateTexture({ target: g, resolution: 2 });
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

export function bakeSceneTextures(renderer: Renderer): SceneTextures {
  return {
    disc: bake(renderer, (g) => g.circle(DISC_R, DISC_R, DISC_R).fill({ color: 0xffffff })),
    glow: acquireGlow(renderer),
    shade: bake(renderer, (g) => drawShade(g, false)),
    gloss: bake(renderer, (g) => drawShade(g, true)),
    rock: bake(renderer, drawRock),
  };
}

/** Destroys the textures `bakeSceneTextures` made and lets go of the shared glow. */
export function releaseSceneTextures(renderer: Renderer, textures: SceneTextures): void {
  for (const texture of [textures.disc, textures.shade, textures.gloss, textures.rock]) {
    texture.destroy(true);
  }
  releaseGlow(renderer);
}
