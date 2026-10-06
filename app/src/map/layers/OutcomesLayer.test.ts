import { DrawnPositions } from "../drawnPositions";
import { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { SCENARIO_CAPABILITIES, SAVE_CAPABILITIES } from "../../lib/capabilities";
import { FE_ZONE_DEFAULT_DISTANCE, FE_ZONE_RADIUS, newFeZone } from "../../lib/feZone";
import type { Outcome } from "../../lib/prepareCopy";
import { OUTCOME_COLORS } from "../../lib/visual/outcomeColors";
import { OutcomesLayer } from "./OutcomesLayer";
import { layerIdsFor, layersFor } from "./registry";
import { childByLabel, mapContext, mapNode, strokes, viewport } from "./fixture";

const ZONE_ANCHOR = { ...mapNode(1, 10, "Zone"), fe_zone: newFeZone("e") };
const NODES = [mapNode(0, 0, "Kept"), ZONE_ANCHOR, mapNode(2, 20, "Seat")];

function drawn(outcomes: Map<number, Outcome>): OutcomesLayer {
  const layer = new OutcomesLayer(new DrawnPositions());
  layer.rebuild(mapContext(NODES));
  viewport(layer, 1);
  layer.setOutcome(outcomes);
  return layer;
}

/** The colour of each shown ring round the system at `x`. */
function ringsAt(layer: OutcomesLayer, x: number): (number | undefined)[] {
  return layer.container.children
    .filter((child) => child.label !== "outcome.zones")
    .flatMap((batch) => batch.children)
    .filter((ring): ring is Graphics => ring instanceof Graphics && ring.visible && ring.x === x)
    .map((ring) => strokes(ring)[0].color);
}

/** Each zone mark as `[x, y, radius]` with its colour. */
function zoneMarks(layer: OutcomesLayer): (number | undefined)[][] {
  const g = childByLabel(layer.container, "outcome.zones") as Graphics;
  return strokes(g).flatMap((op) => op.segments.map((circle) => [...circle, op.color]));
}

describe("the outcomes layer", () => {
  it("rings each new starting position, and each new zone round its own ring, and nothing else", () => {
    const layer = drawn(
      new Map<number, Outcome>([
        [1, "zone"],
        [2, "seat"],
      ]),
    );
    expect(ringsAt(layer, 0)).toEqual([]);
    expect(ringsAt(layer, 10)).toEqual([]);
    expect(ringsAt(layer, 20)).toEqual([OUTCOME_COLORS.seat]);
    const [mark] = zoneMarks(layer);
    expect(mark.slice(0, 2)).toEqual([10 - FE_ZONE_DEFAULT_DISTANCE, 0]);
    expect(mark[2]).toBeGreaterThan(FE_ZONE_RADIUS);
    expect(mark[3]).toBe(OUTCOME_COLORS.zone);

    layer.setOutcome(new Map());
    for (const x of [0, 10, 20]) expect(ringsAt(layer, x)).toEqual([]);
    expect(zoneMarks(layer)).toEqual([]);
  });

  it("draws on a scenario only, and is never offered in the menus", () => {
    expect(layersFor(SCENARIO_CAPABILITIES).map((entry) => entry.id)).toContain("outcomes");
    expect(layersFor(SAVE_CAPABILITIES).map((entry) => entry.id)).not.toContain("outcomes");
    expect([...layerIdsFor(SCENARIO_CAPABILITIES, true)]).not.toContain("outcomes");
  });
});
