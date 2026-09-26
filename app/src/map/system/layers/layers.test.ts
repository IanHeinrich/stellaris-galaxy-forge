import { describe, expect, it, vi } from "vitest";

vi.mock("../../../api/textures", () => ({ getTextures: () => Promise.resolve([]) }));

import { Texture, type Graphics } from "pixi.js";
import type { BodyLayout } from "../../../generated/BodyLayout";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { byId, placedNode, planetSummary, systemDetails } from "../../../test/builders";
import { NO_SOURCES, systemContext, type SystemContext } from "../context";
import { drawOps, stubTextMeasurement, viewport } from "../fixture";
import { BeltsLayer, MAX_ROCKS } from "./BeltsLayer";
import { ExitsLayer } from "./ExitsLayer";
import { OrbitsLayer } from "./OrbitsLayer";

stubTextMeasurement();

const SYSTEM = 5;

function saveBody(
  id: number,
  planetClass: string,
  at: [number, number],
  orbit: number,
  parent: number | null = null,
): PlanetSummary {
  const layout: BodyLayout = {
    orbit: { min: orbit, max: orbit },
    angle: null,
    at,
    size: { min: 16, max: 16 },
  };
  return planetSummary({ id, class: planetClass, parent, moon: parent !== null, orbit, layout });
}

const SUN = saveBody(1, "pc_g_star", [0, 0], 0);
const EARTH = saveBody(2, "pc_continental", [90, 0], 90, 1);
const LUNA = saveBody(3, "pc_barren", [102, 0], 12, 2);
const MARS = saveBody(4, "pc_arid", [0, 130], 130, 1);

function context(details: Partial<SystemDetails>): SystemContext {
  const home = placedNode(SYSTEM, 0, 0, [6, 7]);
  return systemContext({
    ...NO_SOURCES,
    id: SYSTEM,
    systems: byId(
      { ...home, bypass_ids: [8] },
      placedNode(6, 100, 0, [SYSTEM]),
      placedNode(7, 0, 100, [SYSTEM]),
      placedNode(8, -100, 0),
    ),
    details: systemDetails({ id: SYSTEM, inner_radius: 160, ...details }),
  });
}

/** The radius of every arc the graphics has stroked, rounded, once each. */
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

describe("the system scene's orbits layer", () => {
  it("strokes each orbit about its parent, and the inner radius on its own", () => {
    const layer = new OrbitsLayer();
    layer.rebuild(context({ planets: [SUN, EARTH, LUNA, MARS] }));
    viewport(layer, 2);
    expect(arcRadii(layer.rings)).toEqual([12, 90, 130]);
    expect(arcRadii(layer.inner)).toEqual([160]);
  });
});

describe("the system scene's belts layer", () => {
  const rocky = (radius: number) =>
    context({ belts: [{ kind: "rocky_asteroid_belt", inner_radius: radius }] });

  it("scatters more rocks about a wider belt, in step with its circumference", () => {
    const narrow = new BeltsLayer(Texture.WHITE);
    narrow.rebuild(rocky(30));
    const wide = new BeltsLayer(Texture.WHITE);
    wide.rebuild(rocky(60));
    const few = narrow.rocks.children.length;
    const many = wide.rocks.children.length;
    expect(few).toBeGreaterThan(0);
    expect(many / few).toBeCloseTo(2, 1);
  });

  it("draws no more than its cap of rocks about a belt far out", () => {
    const layer = new BeltsLayer(Texture.WHITE);
    layer.rebuild(rocky(1000));
    expect(layer.rocks.children.length).toBe(MAX_ROCKS);
  });

  it("keeps every rock where it was across a pan, a zoom and a rebuild from the same belt", () => {
    const layer = new BeltsLayer(Texture.WHITE);
    layer.rebuild(rocky(80));
    viewport(layer, 2);
    const where = () => layer.rocks.children.map((rock) => [rock.x, rock.y]);
    const before = where();
    viewport(layer, 2, { x: 30, y: -12 });
    viewport(layer, 5, { x: 30, y: -12 });
    expect(where()).toEqual(before);
    layer.rebuild(rocky(80));
    expect(where()).toEqual(before);
  });
});

describe("the system scene's exits layer", () => {
  it("draws one arrow per hyperlane, named for the neighbour, and none for a bypass", () => {
    const layer = new ExitsLayer();
    const ctx = context({});
    layer.rebuild(ctx);
    viewport(layer, 2);
    expect(drawOps(layer.arrows).filter((op) => op.action === "fill").length).toBe(2);
    expect(ctx.exits.map((exit) => exit.neighbour).sort()).toEqual([6, 7]);
    expect(ctx.exits.map((exit) => exit.name).sort()).toEqual(["S6", "S7"]);
  });

  it("points each arrow along the galaxy bearing to its neighbour, outside the inner radius", () => {
    const ctx = context({});
    const east = ctx.exits.find((exit) => exit.neighbour === 6);
    expect(east?.dx).toBeCloseTo(1);
    expect(east?.dy).toBeCloseTo(0);
    expect(east?.radius).toBe(160);
  });
});
