import { afterEach, describe, expect, it, vi } from "vitest";

/** The texture fetch, which answers with nothing, or once a test asks, that no key can render. */
const fetch = vi.hoisted(() => ({ fails: false }));

vi.mock("../../api/textures", () => ({
  getTextures: (keys: string[]) =>
    Promise.resolve(
      fetch.fails
        ? keys.map((key) => ({ key, width: 0, height: 0, png_base64: null, error: "none" }))
        : [],
    ),
}));

import { BitmapText, type Container } from "pixi.js";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemNode } from "../../generated/SystemNode";
import { DETAILS_MIN_SCALE } from "../../lib/details/layout";
import { clearTextures } from "../../lib/visual/textures";
import { planetSummary } from "../../test/builders";
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
    wormholes: [],
  };
}

const DETAILS = new Map(NODES.map((s) => [s.id, details(s)]));

afterEach(() => {
  fetch.fails = false;
  clearTextures();
  vi.restoreAllMocks();
});

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

  it("draws a system's megastructure, dig site and pre-FTL icons right of its name, and never an anomaly", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetch.fails = true;
    const natives = planetSummary({
      id: 7,
      colonised: true,
      owner: 10,
      pre_ftl: true,
      anomaly: "AIANOM_RESEARCHDEPO_CAT",
    });
    const sol: SystemDetails = {
      ...details(SOL),
      planets: [natives],
      megastructures: [{ id: 50, kind: "dyson_sphere_2", owner: null, planet: 7 }],
      sites: [{ id: 60, kind: "site_tiyanki_graveyard", planet: 7 }],
    };
    const layer = new DetailsLayer();
    layer.rebuild(mapContext(NODES, { details: new Map([[SOL.id, sol]]), detailsVersion: 1 }));
    viewport(layer, CLOSE);
    const texts = (c: Container): BitmapText[] => [
      ...(c instanceof BitmapText && c.visible ? [c] : []),
      ...c.children.flatMap(texts),
    ];
    const glyphs = () =>
      texts(layer.container)
        .filter((t) => t.text !== "Sol")
        .sort((a, b) => a.x - b.x)
        .map((t) => t.text);
    await vi.waitFor(() => {
      viewport(layer, CLOSE);
      expect(glyphs()).toEqual(["◈", "⚱", "☗"]);
    });
    layer.destroy();
  });
});
