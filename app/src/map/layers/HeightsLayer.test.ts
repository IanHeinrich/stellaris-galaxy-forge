import { Graphics } from "pixi.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { absoluteHeight, heightTint } from "../../lib/height";
import { DETAIL_SCALE } from "../../lib/visual/labels";
import { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES } from "../../lib/capabilities";
import { systemNode } from "../../test/builders";
import { HeightsLayer, heightText } from "./HeightsLayer";
import { RingBatch } from "./highlights/RingBatch";
import { layerIdsFor } from "./registry";
import { Camera } from "../Camera";
import { DrawnPositions } from "../drawnPositions";
import {
  childByLabel,
  drawnText,
  mapContext,
  strokes,
  stubTextMeasurement,
  viewport,
} from "./fixture";

stubTextMeasurement();

function drawn(
  heights: Array<number | undefined>,
  scale = 1,
  positions = new DrawnPositions(),
): HeightsLayer {
  const nodes = heights.map((height, id) =>
    systemNode({ id, x: id * 10, ...(height === undefined ? {} : { height }) }),
  );
  const layer = new HeightsLayer(positions);
  positions.onChange((change) => layer.onDrawn(change));
  layer.rebuild(mapContext(nodes, { kind: "save" }));
  viewport(layer, scale);
  return layer;
}

function rings(layer: HeightsLayer): Graphics[] {
  return childByLabel(layer.container, "rings")
    .children.flatMap((batch) => batch.children)
    .filter((ring): ring is Graphics => ring instanceof Graphics && ring.visible);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the heights layer", () => {
  it("draws nothing for a save whose systems lie on the plane", () => {
    const layer = drawn([undefined, absoluteHeight(0), absoluteHeight(0.004)], DETAIL_SCALE);
    expect(rings(layer)).toEqual([]);
    expect(drawnText(childByLabel(layer.container, "values"))).toEqual([]);
  });

  it("rings each system off the plane, and writes its height once names show", () => {
    const far = drawn([undefined, absoluteHeight(40), absoluteHeight(-22)], 1);
    expect(rings(far).map((ring) => ring.x)).toEqual(expect.arrayContaining([10, 20]));
    expect(rings(far)).toHaveLength(2);
    expect(drawnText(childByLabel(far.container, "values"))).toEqual([]);

    const near = drawn([undefined, absoluteHeight(40), absoluteHeight(-22)], DETAIL_SCALE);
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
    const cam = new Camera();
    cam.setViewport(800, 600);
    const positions = new DrawnPositions(cam);
    const layer = drawn([undefined, absoluteHeight(40)], 1, positions);
    const plane = () =>
      childByLabel(layer.container, "plane").children.flatMap((g) => strokes(g as Graphics));
    expect(plane()).toEqual([]);

    positions.setTilt(30);
    layer.onViewport(cam);
    expect(plane().map((op) => op.segments.length)).toEqual([1, 1]);
    expect(rings(layer)[0].y).toBeCloseTo(-40 * 0.5 * Math.tan(Math.PI / 6));

    positions.setTilt(0);
    layer.onViewport(cam);
    expect(plane()).toEqual([]);
    expect(rings(layer)[0].y).toBe(0);
  });
});

describe("the heights layer under a height preview", () => {
  it("rings and writes a previewed system at the previewed height, and its own again after", () => {
    const positions = new DrawnPositions();
    const layer = drawn([undefined, absoluteHeight(40)], DETAIL_SCALE, positions);
    const preview = childByLabel(layer.container, "previewRings");

    positions.setPreview(new Map([[0, -15]]));
    expect(preview.children).toHaveLength(1);
    expect(strokes(preview.children[0] as Graphics)[0].color).toBe(heightTint(-15));
    expect(drawnText(childByLabel(layer.container, "values")).sort()).toEqual(["+40", "−15"]);

    positions.setPreview(new Map([[1, 0]]));
    expect(preview.children).toHaveLength(0);
    expect(rings(layer)).toHaveLength(0);
    expect(drawnText(childByLabel(layer.container, "values"))).toEqual([]);

    positions.setPreview(new Map());
    expect(rings(layer)).toHaveLength(1);
    expect(drawnText(childByLabel(layer.container, "values"))).toEqual(["+40"]);
  });

  it("redraws only the systems whose previewed height changed", () => {
    const cam = new Camera();
    cam.setViewport(800, 600);
    const positions = new DrawnPositions(cam);
    const layer = drawn(
      [undefined, absoluteHeight(40), absoluteHeight(-22), absoluteHeight(80), undefined],
      4,
      positions,
    );
    positions.setTilt(30);
    layer.onViewport(cam);
    const place = vi.spyOn(RingBatch.prototype, "place");
    const planes = (childByLabel(layer.container, "plane").children as Graphics[]).map((g) =>
      vi.spyOn(g, "clear"),
    );

    positions.setPreview(
      new Map([
        [0, 5],
        [4, 6],
      ]),
    );
    expect(place).not.toHaveBeenCalled();
    for (const clear of planes) expect(clear).not.toHaveBeenCalled();
    const marks = childByLabel(layer.container, "previewRings").children as Graphics[];
    const kept = vi.spyOn(marks[0], "clear");

    positions.setPreview(
      new Map([
        [0, 5],
        [4, 7],
      ]),
    );
    expect(kept).not.toHaveBeenCalled();

    positions.setPreview(
      new Map([
        [0, 5],
        [4, 7],
        [1, 30],
      ]),
    );
    expect(place).toHaveBeenCalledTimes(1);
    expect(planes.filter((clear) => clear.mock.calls.length > 0)).toHaveLength(1);
    expect(rings(layer)).toHaveLength(2);
  });

  it("writes a height just off the plane to two decimals, never as 0", () => {
    expect(heightText(0.02)).toBe("+0.02");
    expect(heightText(-0.04)).toBe("−0.04");
  });
});
