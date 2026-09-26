import type { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  EARTH,
  LUNA,
  MARS,
  SCENARIO_STAR,
  SUN,
  context,
  drawOps,
  fixed,
  saveBody,
  scenarioBody,
  viewport,
} from "../fixture";
import { OrbitsLayer } from "./OrbitsLayer";

/** The radii of the dashed arcs `g` strokes. */
function arcRadii(g: Graphics): number[] {
  const radii = new Set<number>();
  for (const op of drawOps(g)) {
    if (op.action !== "stroke") continue;
    for (const segment of op.segments) {
      if (segment.length >= 5) radii.add(Math.round(segment[4]));
    }
  }
  return [...radii].sort((a, b) => a - b);
}

/** The radii of the whole circles `g` strokes, each laid down as `[x, y, r]`. */
function circleRadii(g: Graphics): number[] {
  const radii: number[] = [];
  for (const op of drawOps(g)) {
    if (op.action !== "stroke" || !op.steps.every((step) => step === "circle")) continue;
    const numbers = op.segments.flat();
    for (let i = 2; i < numbers.length; i += 3) radii.push(Math.round(numbers[i]));
  }
  return radii.sort((a, b) => a - b);
}

describe("the system scene's orbits layer", () => {
  it("strokes each orbit whole and faint about its parent, and the inner radius dashed on its own", () => {
    const layer = new OrbitsLayer();
    layer.rebuild(context({ planets: [SUN, EARTH, LUNA, MARS] }));
    viewport(layer, 2);
    expect(circleRadii(layer.rings)).toEqual([12, 90, 130]);
    const [rings] = drawOps(layer.rings).filter((op) => op.action === "stroke");
    expect(rings.alpha).toBeLessThan(0.2);
    expect(circleRadii(layer.inner)).toEqual([]);
    expect(arcRadii(layer.inner)).toEqual([160]);
  });

  it("strokes an orbit bodies share once, within a pixel, so it shows no brighter than the rest", () => {
    const layer = new OrbitsLayer();
    const twin = saveBody(5, "pc_barren", [0, -130], 130, 1);
    // The save's orbits of bodies on one ring differ by a fraction of a unit.
    const near = saveBody(6, "pc_barren", [-130.3, 0], 130.3, 1);
    layer.rebuild(context({ planets: [SUN, EARTH, MARS, twin, near] }));
    viewport(layer, 2);
    expect(circleRadii(layer.rings)).toEqual([90, 130]);
  });

  it("strokes each ring whole at the radius drawn, whatever its bodies' ranges, with no bands", () => {
    const layer = new OrbitsLayer();
    const banded = scenarioBody(
      2,
      "pc_arid",
      { orbit: { min: 60, max: 100 }, angle: fixed(45) },
      1,
    );
    const turning = scenarioBody(
      3,
      "pc_desert",
      { orbit: fixed(130), angle: { min: 0, max: 90 } },
      1,
    );
    const ghost = scenarioBody(4, "pc_arid", { orbit: fixed(170) }, 1);
    layer.rebuild(context({ planets: [SCENARIO_STAR, banded, turning, ghost] }));
    viewport(layer, 2);

    expect(circleRadii(layer.rings)).toEqual([80, 130, 170]);
    expect(
      layer.container.children.every((g) =>
        drawOps(g as Graphics).every((op) => op.action !== "fill"),
      ),
    ).toBe(true);
  });
});
