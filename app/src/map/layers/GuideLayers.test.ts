import { BitmapText, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { L_CLUSTER, SCENARIO_HALF_EXTENT } from "../../lib/guides";
import { L_CLUSTER_LABEL, LClusterLayer, MAP_BORDER_LABEL, MapBorderLayer } from "./GuideLayers";
import { mapContext, mapNode, strokes, viewport } from "./fixture";

const PLAIN = [mapNode(0, 0, "S0"), mapNode(1, 200, "S1")];

function shape(layer: MapBorderLayer | LClusterLayer): Graphics {
  const g = layer.container.children.find((c): c is Graphics => c instanceof Graphics);
  if (!g) throw new Error("no shape");
  return g;
}

function label(layer: MapBorderLayer | LClusterLayer): BitmapText {
  const text = layer.container.children.find((c): c is BitmapText => c instanceof BitmapText);
  if (!text) throw new Error("no label");
  return text;
}

/** The furthest any dash of the stroked path starts from the graphics' own origin. */
function reach(g: Graphics): number {
  return Math.max(
    ...strokes(g).flatMap((op) => op.segments.map((seg) => Math.hypot(seg[0], seg[1]))),
  );
}

describe("the map border guide", () => {
  it("draws the ±500 square for a scenario, labelled above its top edge", () => {
    const layer = new MapBorderLayer();
    layer.rebuild(mapContext(PLAIN, { radius: 60 }));
    viewport(layer, 2);
    expect(reach(shape(layer))).toBeCloseTo(Math.hypot(SCENARIO_HALF_EXTENT, SCENARIO_HALF_EXTENT));
    expect(label(layer).text).toBe(MAP_BORDER_LABEL);
    expect(label(layer).y).toBeLessThan(-SCENARIO_HALF_EXTENT);
    expect(layer.container.visible).toBe(true);
  });

  it("draws the galaxy radius circle for a save, and nothing while the radius is unknown", () => {
    const layer = new MapBorderLayer();
    layer.rebuild(mapContext(PLAIN, { kind: "save", radius: 60 }));
    expect(reach(shape(layer))).toBeCloseTo(60);
    expect(label(layer).y).toBeLessThan(-60);

    layer.rebuild(mapContext(PLAIN, { kind: "save", radius: 0 }));
    expect(layer.container.visible).toBe(false);
  });

  it("stays hidden when switched off, whatever it is given to draw", () => {
    const layer = new MapBorderLayer();
    layer.setVisible(false);
    layer.rebuild(mapContext(PLAIN));
    expect(layer.container.visible).toBe(false);
    layer.setVisible(true);
    expect(layer.container.visible).toBe(true);
  });
});

describe("the L-Cluster guide", () => {
  it("draws the game's fixed circle for a scenario, labelled above it", () => {
    const layer = new LClusterLayer();
    layer.rebuild(mapContext(PLAIN));
    viewport(layer, 1);
    expect(layer.circle).toEqual(L_CLUSTER);
    expect([shape(layer).x, shape(layer).y]).toEqual([L_CLUSTER.x, L_CLUSTER.y]);
    expect(reach(shape(layer))).toBeCloseTo(L_CLUSTER.radius);
    expect(label(layer).text).toBe(L_CLUSTER_LABEL);
    expect(label(layer).x).toBe(L_CLUSTER.x);
    expect(label(layer).y).toBeLessThan(L_CLUSTER.y - L_CLUSTER.radius);
  });

  it("circles a save's systems flagged or initialised as the cluster, and falls back to the fixed circle", () => {
    const layer = new LClusterLayer();
    const cluster = [
      { ...mapNode(0, 100, "L0", "lcluster_01"), y: 100 },
      { ...mapNode(1, 140, "L1"), y: 100, flags: ["lcluster1"] },
      mapNode(2, -300, "S2"),
    ];
    layer.rebuild(mapContext(cluster, { kind: "save" }));
    expect(layer.circle).toEqual({ x: 120, y: 100, radius: 35 });

    layer.rebuild(mapContext(PLAIN, { kind: "save" }));
    expect(layer.circle).toEqual(L_CLUSTER);
  });
});
