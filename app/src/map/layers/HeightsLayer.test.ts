import { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { absoluteHeight } from "../../lib/height";
import { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES } from "../../lib/capabilities";
import { systemNode } from "../../test/builders";
import { HeightsLayer, heightText } from "./HeightsLayer";
import { layerIdsFor } from "./registry";
import { Camera } from "../Camera";
import { liftedY } from "../tilt";
import {
  childByLabel,
  drawnText,
  mapContext,
  strokes,
  stubTextMeasurement,
  viewport,
} from "./fixture";

stubTextMeasurement();

function drawn(heights: Array<number | undefined>, scale = 1): HeightsLayer {
  const nodes = heights.map((height, id) =>
    systemNode({ id, x: id * 10, ...(height === undefined ? {} : { height }) }),
  );
  const layer = new HeightsLayer();
  layer.rebuild(mapContext(nodes, { kind: "save" }));
  viewport(layer, scale);
  return layer;
}

function rings(layer: HeightsLayer): Graphics[] {
  return childByLabel(layer.container, "rings")
    .children.flatMap((batch) => batch.children)
    .filter((ring): ring is Graphics => ring instanceof Graphics && ring.visible);
}

describe("the heights layer", () => {
  it("draws nothing for a save whose systems lie on the plane", () => {
    const layer = drawn([undefined, absoluteHeight(0), absoluteHeight(0.004)], 4);
    expect(rings(layer)).toEqual([]);
    expect(drawnText(childByLabel(layer.container, "values"))).toEqual([]);
  });

  it("rings each system off the plane, and writes its height once names show", () => {
    const far = drawn([undefined, absoluteHeight(40), absoluteHeight(-22)], 1);
    expect(rings(far).map((ring) => ring.x)).toEqual(expect.arrayContaining([10, 20]));
    expect(rings(far)).toHaveLength(2);
    expect(drawnText(childByLabel(far.container, "values"))).toEqual([]);

    const near = drawn([undefined, absoluteHeight(40), absoluteHeight(-22)], 4);
    expect(drawnText(childByLabel(near.container, "values"))).toEqual(["+40", "−22"]);
  });

  it("writes a height signed, to one decimal at most", () => {
    expect(heightText(40)).toBe("+40");
    expect(heightText(-22.04)).toBe("−22");
    expect(heightText(2.55)).toBe("+2.6");
  });

  it("is listed for a save and never for a scenario", () => {
    expect(layerIdsFor(SAVE_CAPABILITIES).has("heights")).toBe(true);
    expect(layerIdsFor(SCENARIO_CAPABILITIES).has("heights")).toBe(false);
  });
});

describe("the heights layer on a tilted map", () => {
  it("drops a line to a hexagon on the plane under each lifted system, and none when flat", () => {
    const layer = drawn([undefined, absoluteHeight(40)]);
    const plane = childByLabel(layer.container, "plane") as Graphics;
    expect(strokes(plane)).toEqual([]);

    const cam = new Camera();
    cam.setViewport(800, 600);
    cam.setTilt(30);
    layer.onViewport(cam);
    expect(strokes(plane).map((op) => op.segments.length)).toEqual([1, 1]);
    expect(rings(layer)[0].y).toBeCloseTo(liftedY(0, 40, cam.tilt));

    cam.setTilt(0);
    layer.onViewport(cam);
    expect(strokes(plane)).toEqual([]);
    expect(rings(layer)[0].y).toBe(0);
  });
});
