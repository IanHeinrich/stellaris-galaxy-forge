import { DrawnPositions } from "../drawnPositions";
import { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES } from "../../lib/capabilities";
import { NO_PRECURSOR, NO_PRECURSORS, type PrecursorRegions } from "../../lib/precursors";
import { NO_PRECURSOR_COLOR, precursorColor } from "../../lib/visual/precursorColors";
import { PrecursorsLayer } from "./PrecursorsLayer";
import { layerIdsFor } from "./registry";
import { mapContext, mapNode, strokes, viewport } from "./fixture";

const NODES = [mapNode(0, 0, "Vultaum only"), mapNode(1, 10, "Both"), mapNode(2, 20, "Neither")];

/** Vultaum round systems 0 and 1, Zroni round 1, and system 2 in no region. */
const REGIONS: PrecursorRegions = {
  legend: [
    { key: "precursor_1", name: "Vultaum", index: 0, count: 2 },
    { key: "precursor_zroni_1", name: "Zroni", index: 6, count: 1 },
  ],
  bySystem: new Map([
    [0, ["precursor_1"]],
    [1, ["precursor_1", "precursor_zroni_1"]],
  ]),
  none: 1,
};

function drawn(regions: PrecursorRegions, hidden: string[] = []): PrecursorsLayer {
  const layer = new PrecursorsLayer(new DrawnPositions());
  layer.rebuild(mapContext(NODES, { precursors: regions, hiddenPrecursors: new Set(hidden) }));
  viewport(layer, 1);
  return layer;
}

/** What each shown ring round the system at `x` strokes: its colour, and arc or whole ring. */
function ringsAt(layer: PrecursorsLayer, x: number): { color?: number; shape: string }[] {
  const rings = layer.container.children.flatMap((batch) => batch.children);
  return rings
    .filter((ring): ring is Graphics => ring instanceof Graphics && ring.visible && ring.x === x)
    .map((ring) => {
      const [stroke] = strokes(ring);
      return { color: stroke.color, shape: stroke.steps.includes("arc") ? "arc" : "ring" };
    });
}

describe("the precursors layer", () => {
  it("rings a system in its precursor's colour and one in none in grey", () => {
    const layer = drawn(REGIONS);

    expect(ringsAt(layer, 0)).toEqual([{ color: precursorColor(0), shape: "ring" }]);
    expect(ringsAt(layer, 20)).toEqual([{ color: NO_PRECURSOR_COLOR, shape: "ring" }]);
  });

  it("splits the ring of a system in two regions into one arc per shown precursor", () => {
    const split = ringsAt(drawn(REGIONS), 10);
    expect(split).toHaveLength(2);
    expect(split).toEqual(
      expect.arrayContaining([
        { color: precursorColor(0), shape: "arc" },
        { color: precursorColor(6), shape: "arc" },
      ]),
    );

    const layer = drawn(REGIONS, ["precursor_zroni_1", NO_PRECURSOR]);
    expect(ringsAt(layer, 10)).toEqual([{ color: precursorColor(0), shape: "ring" }]);
    expect(ringsAt(layer, 20)).toEqual([]);
  });

  it("follows the hidden precursors as the context changes", () => {
    const layer = drawn(REGIONS);
    layer.rebuild(
      mapContext(NODES, { precursors: REGIONS, hiddenPrecursors: new Set(["precursor_1"]) }),
    );

    expect(ringsAt(layer, 0)).toEqual([]);
    expect(ringsAt(layer, 10)).toEqual([{ color: precursorColor(6), shape: "ring" }]);
  });

  it("draws nothing until the install's precursors are known", () => {
    const layer = drawn(NO_PRECURSORS);
    for (const x of [0, 10, 20]) expect(ringsAt(layer, x)).toEqual([]);
  });

  it("is listed for a save once the install is read, and never for a scenario", () => {
    expect(layerIdsFor(SAVE_CAPABILITIES, true).has("precursors")).toBe(true);
    expect(layerIdsFor(SAVE_CAPABILITIES, false).has("precursors")).toBe(false);
    expect(layerIdsFor(SCENARIO_CAPABILITIES, true).has("precursors")).toBe(false);
  });
});
