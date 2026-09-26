import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/textures", () => ({ getTextures: () => Promise.resolve([]) }));

import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemNode } from "../../generated/SystemNode";
import { DETAILS_MIN_SCALE } from "../../lib/details/layout";
import { DetailsLayer } from "./DetailsLayer";
import { mapContext, stubTextMeasurement, mapNode, viewport } from "./fixture";

stubTextMeasurement();

const SOL = mapNode(0, 0, "Sol");
const ALPHA = mapNode(1, 20, "Alpha");
/** Far enough out that it is only in view once the camera has panned to it. */
const DISTANT = mapNode(2, 400, "Distant");
const NODES = [SOL, ALPHA, DISTANT];
const IN_VIEW = 2;

const CLOSE = DETAILS_MIN_SCALE;

function details(s: SystemNode): SystemDetails {
  return {
    id: s.id,
    resources: [],
    planets: [],
    starbase: null,
    fleets: { fleet_count: 0, military_count: 0, ship_count: 0, military_power: 0 },
    fleets_present: [],
    megastructures: [],
    sites: [],
    with_game_data: false,
    belts: [],
    inner_radius: null,
  };
}

const DETAILS = new Map(NODES.map((s) => [s.id, details(s)]));

describe("the details layer's rows", () => {
  it("lays a row out again for a zoom, a details change or a row coming into view, never a pan", () => {
    let laidOut = 0;
    const ctx = mapContext(NODES, {
      details: DETAILS,
      detailsVersion: 1,
      nodeName: (name) => {
        laidOut++;
        return name.key;
      },
    });
    const layer = new DetailsLayer();
    layer.rebuild(ctx);
    viewport(layer, CLOSE);
    expect(laidOut).toBe(IN_VIEW);

    laidOut = 0;
    viewport(layer, CLOSE, { x: 5, y: 0 });
    expect(laidOut).toBe(0);

    viewport(layer, CLOSE + 1, { x: 5, y: 0 });
    expect(laidOut).toBe(IN_VIEW);

    laidOut = 0;
    layer.rebuild({ ...ctx, detailsVersion: 2 });
    viewport(layer, CLOSE + 1, { x: 5, y: 0 });
    expect(laidOut).toBe(IN_VIEW);

    laidOut = 0;
    viewport(layer, CLOSE + 1, { x: DISTANT.x, y: 0 });
    expect(laidOut).toBe(1);
  });

  it("lays a row out again for a delta that renamed its system, at the same zoom", () => {
    let laidOut = 0;
    const ctx = mapContext(NODES, {
      details: DETAILS,
      detailsVersion: 1,
      nodeName: (name) => {
        laidOut++;
        return name.key;
      },
    });
    const layer = new DetailsLayer();
    layer.rebuild(ctx);
    viewport(layer, CLOSE);

    laidOut = 0;
    const renamed = { ...SOL, name: { key: "Helios", literal: true, variables: [] } };
    layer.applyDelta({ systems: [renamed] });
    viewport(layer, CLOSE);

    expect(laidOut).toBe(IN_VIEW);
  });
});
