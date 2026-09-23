import { BitmapText, Graphics } from "pixi.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { L_CLUSTER, SCENARIO_HALF_EXTENT } from "../../lib/guides";
import { useLGateStore } from "../../store/lgateStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { L_CLUSTER_LABEL, LClusterLayer, MAP_BORDER_LABEL, MapBorderLayer } from "./GuideLayers";
import {
  childByLabel,
  mapContext,
  mapNode,
  strokes,
  stubTextMeasurement,
  viewport,
} from "./fixture";

stubTextMeasurement();

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

beforeEach(() => {
  useLGateStore.setState({ revealed: false });
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
});

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

describe("the L-Cluster reveal chip", () => {
  it("draws no chip when the document has no L-Gate outcome", () => {
    const layer = new LClusterLayer();
    layer.rebuild(mapContext(PLAIN));
    viewport(layer, 1);
    expect(childByLabel(layer.container, "lgateChip").visible).toBe(false);
  });

  it("offers to reveal the outcome, and reveals it on a click, without the click reaching the map", () => {
    const layer = new LClusterLayer();
    const lgate = { outcome: "l_drakes", opened: false } as const;
    layer.rebuild(mapContext(PLAIN, { lgate }));
    viewport(layer, 1);

    const chip = childByLabel(layer.container, "lgateChip");
    const chipText = childByLabel(layer.container, "lgateChipText") as BitmapText;
    expect(chip.visible).toBe(true);
    expect(chipText.text).toBe("Reveal outcome");

    const native = new Event("pointerdown");
    const stopImmediatePropagation = vi.spyOn(native, "stopImmediatePropagation");
    chip.emit("pointerdown", {
      stopImmediatePropagation: () => {},
      nativeEvent: native,
    } as never);
    expect(stopImmediatePropagation).toHaveBeenCalled();
    expect(useLGateStore.getState().revealed).toBe(true);
  });

  it("shows the outcome tooltip while hidden, never once revealed", () => {
    const layer = new LClusterLayer();
    const lgate = { outcome: "l_drakes", opened: false } as const;
    layer.rebuild(mapContext(PLAIN, { lgate }));
    viewport(layer, 1);
    const chip = childByLabel(layer.container, "lgateChip");

    chip.emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip).toMatchObject({
      title: L_CLUSTER_LABEL,
      lines: ["Reveal which outcome the L-Cluster rolled on day one"],
    });
    chip.emit("pointerout", {} as never);
    expect(useMapChromeStore.getState().tooltip).toBeNull();

    layer.setLGateRevealed(true);
    chip.emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip).toBeNull();
  });

  it("carries the outcome in the label and reads Hide, once revealed", () => {
    useLGateStore.setState({ revealed: true });
    const layer = new LClusterLayer();
    const lgate = { outcome: "l_drakes", opened: true } as const;
    layer.rebuild(mapContext(PLAIN, { lgate }));
    viewport(layer, 1);

    expect(label(layer).text).toBe(`${L_CLUSTER_LABEL} · L-Drakes, opened`);
    expect((childByLabel(layer.container, "lgateChipText") as BitmapText).text).toBe("Hide");

    childByLabel(layer.container, "lgateChip").emit("pointerdown", {
      stopImmediatePropagation: () => {},
    } as never);
    expect(useLGateStore.getState().revealed).toBe(false);
  });
});
