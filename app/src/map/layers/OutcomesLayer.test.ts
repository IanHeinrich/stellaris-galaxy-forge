import { DrawnPositions } from "../drawnPositions";
import { Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { SCENARIO_CAPABILITIES, SAVE_CAPABILITIES } from "../../lib/capabilities";
import type { Outcome } from "../../lib/prepareCopy";
import { OUTCOME_COLORS } from "../../lib/visual/outcomeColors";
import { OutcomesLayer } from "./OutcomesLayer";
import { layerIdsFor, layersFor } from "./registry";
import { mapContext, mapNode, strokes, viewport } from "./fixture";

const NODES = [mapNode(0, 0, "Kept"), mapNode(1, 10, "Zone"), mapNode(2, 20, "Seat")];

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
    .flatMap((batch) => batch.children)
    .filter((ring): ring is Graphics => ring instanceof Graphics && ring.visible && ring.x === x)
    .map((ring) => strokes(ring)[0].color);
}

describe("the outcomes layer", () => {
  it("rings each new starting position and zone in its colour, and nothing else", () => {
    const layer = drawn(
      new Map<number, Outcome>([
        [1, "zone"],
        [2, "seat"],
      ]),
    );
    expect(ringsAt(layer, 0)).toEqual([]);
    expect(ringsAt(layer, 10)).toEqual([OUTCOME_COLORS.zone]);
    expect(ringsAt(layer, 20)).toEqual([OUTCOME_COLORS.seat]);

    layer.setOutcome(new Map());
    for (const x of [0, 10, 20]) expect(ringsAt(layer, x)).toEqual([]);
  });

  it("draws on a scenario only, and is never offered in the menus", () => {
    expect(layersFor(SCENARIO_CAPABILITIES).map((entry) => entry.id)).toContain("outcomes");
    expect(layersFor(SAVE_CAPABILITIES).map((entry) => entry.id)).not.toContain("outcomes");
    expect([...layerIdsFor(SCENARIO_CAPABILITIES, true)]).not.toContain("outcomes");
  });
});
