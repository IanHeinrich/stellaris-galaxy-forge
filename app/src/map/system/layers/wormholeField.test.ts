import { describe, expect, it } from "vitest";
import type { Texels } from "./texels";
import {
  WORMHOLE_ART_SCALE,
  wormholeHazeTexels,
  wormholeRimTexels,
  wormholeSwirlTexels,
} from "./wormholeField";

const VORTEX = 1 / WORMHOLE_ART_SCALE;

/**
 * The mean alpha of the texels of `field` whose centres lie between `from` and `to`, as shares of
 * the half side.
 */
function ring({ texels, width }: Texels, from: number, to: number): number {
  const half = width / 2;
  let sum = 0;
  let count = 0;
  for (let j = 0; j < width; j++) {
    for (let i = 0; i < width; i++) {
      const r = Math.hypot(i + 0.5 - half, j + 0.5 - half) / half;
      if (r < from || r >= to) continue;
      sum += texels[4 * (j * width + i) + 3];
      count++;
    }
  }
  return sum / count;
}

describe("a wormhole's fields", () => {
  const haze = wormholeHazeTexels();
  const swirl = wormholeSwirlTexels();
  const rim = wormholeRimTexels();
  const all = [haze, swirl, rim];

  it("leave the eye dim about a bright pinpoint, and are brightest on the rim", () => {
    const eye = (field: Texels) => ring(field, 0.08 * VORTEX, 0.18 * VORTEX);
    const onRim = (field: Texels) => ring(field, 0.3 * VORTEX, 0.36 * VORTEX);
    for (const field of [swirl, rim]) expect(eye(field)).toBeLessThan(onRim(field) / 2);
    expect(eye(haze)).toBeGreaterThan(0);
    expect(ring(rim, 0, 0.01)).toBeGreaterThan(200);
  });

  it("thin out from the rim: the swirl gone past its edge, the haze reaching further, and nothing at the rim", () => {
    expect(ring(swirl, 0.35 * VORTEX, 0.5 * VORTEX)).toBeGreaterThan(
      2 * ring(swirl, 0.8 * VORTEX, VORTEX),
    );
    expect(ring(swirl, 1.2 * VORTEX, 1)).toBe(0);
    expect(ring(haze, 1.2 * VORTEX, 1.6 * VORTEX)).toBeGreaterThan(10);
    for (const field of all) expect(ring(field, 0.99, 2)).toBe(0);
  });
});
