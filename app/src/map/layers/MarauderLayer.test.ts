import { BitmapText, Graphics } from "pixi.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { MarauderRole } from "../../generated/MarauderRole";
import type { SystemNode } from "../../generated/SystemNode";
import { ALL_CAPABILITIES } from "../../lib/capabilities";
import { countryRegions, type Region } from "../../lib/geometry/territory";
import { GHOST_ALPHA } from "../../lib/visual/style";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { VANILLA_BORDER } from "../RenderContext";
import {
  childByLabel,
  drawOps,
  drawnText,
  mapContext,
  mapNode,
  strokes,
  viewport,
} from "./fixture";
import {
  clanRegions,
  HOME_TAG,
  MARAUDER_COLOR,
  MarauderLayer,
  MarauderTerritoryLayer,
} from "./MarauderLayer";
import { layersFor } from "./registry";
import {
  TERRITORY_EDGE_ALPHA,
  TERRITORY_EDGE_PX,
  TERRITORY_FILL_ALPHA,
  TERRITORY_HALO_ALPHA,
  TERRITORY_HALO_PX,
} from "./TerritoryShapes";

const PARAMS = {
  radius: VANILLA_BORDER.system_radius,
  laneHalfWidth: VANILLA_BORDER.hyperlane_thickness / 2,
};

/** A system at (`x`, `y`) in `role`, linked by lane to `to`. */
function marauder(
  id: number,
  x: number,
  y: number,
  role: MarauderRole | null,
  ...to: number[]
): SystemNode {
  return {
    ...mapNode(id, x, `S${id}`),
    y,
    marauder: role,
    initializer:
      role === null ? "" : "home" in role ? `marauder_${role.home}_1` : `marauder_${role.base}_2`,
    lanes: to.map((other) => ({ to: other, length: 10, bridge: false, stale: false })),
  };
}

/** Clan 1 complete at the origin: a home with a base 20 north and one 25 east. */
const HOME = marauder(0, 0, 0, { home: 1 }, 1, 2);
const BASE_N = marauder(1, 0, -20, { base: 1 }, 0);
const BASE_E = marauder(2, 25, 0, { base: 1 }, 0);
const PLAIN = marauder(3, 200, 0, null);
const CLAN = [HOME, BASE_N, BASE_E];

function chips(layer: MarauderLayer): Graphics[] {
  return childByLabel(layer.container, "tags")
    .children.filter((c): c is Graphics => c instanceof Graphics && c.visible)
    .sort((a, b) => a.x - b.x);
}

function labels(layer: MarauderLayer): BitmapText[] {
  return childByLabel(layer.container, "tags").children.filter(
    (c): c is BitmapText => c instanceof BitmapText && c.visible,
  );
}

function fills(layer: MarauderTerritoryLayer): Graphics[] {
  return childByLabel(layer.container, "fills").children.filter(
    (c): c is Graphics => c instanceof Graphics && c.visible,
  );
}

function edges(layer: MarauderTerritoryLayer): Graphics[] {
  return childByLabel(layer.container, "edges").children.filter(
    (c): c is Graphics => c instanceof Graphics && c.visible,
  );
}

function tagged(
  nodes: readonly SystemNode[],
  kind: "scenario" | "save" = "scenario",
): MarauderLayer {
  const layer = new MarauderLayer();
  layer.rebuild(mapContext(nodes, { kind }));
  viewport(layer, 1);
  return layer;
}

function painted(
  nodes: readonly SystemNode[],
  kind: "scenario" | "save" = "scenario",
): MarauderTerritoryLayer {
  const layer = new MarauderTerritoryLayer();
  layer.rebuild(mapContext(nodes, { kind, border: VANILLA_BORDER }));
  viewport(layer, 1);
  return layer;
}

/** The first polygon a fill lays down, as the flat `[x, y, …]` its `poly` step was given. */
function outlineOf(fill: Graphics): number[] {
  const instruction = fill.context.instructions[0] as unknown as {
    data: { path: { instructions: Array<{ action: string; data: unknown[] }> } };
  };
  const poly = instruction.data.path.instructions.find((step) => step.action === "poly");
  const points = (poly?.data[0] as Array<number | { x: number; y: number }> | undefined) ?? [];
  return points.flatMap((p) => (typeof p === "number" ? [p] : [p.x, p.y]));
}

/** Whether a polygon's outline reaches round the point: the point is inside, by ray crossing. */
function covers(polygon: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [polygon[i], polygon[i + 1], polygon[j], polygon[j + 1]];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRegion(region: Region, x: number, y: number): boolean {
  return region.some(([ring]) =>
    covers(
      ring.flatMap((p) => [p.x, p.y]),
      x,
      y,
    ),
  );
}

/** The width of each stroke a graphics has laid down, in order. */
function strokeWidths(graphics: Graphics): number[] {
  return graphics.context.instructions
    .filter((instruction) => instruction.action === "stroke")
    .map((instruction) => (instruction.data as { style: { width: number } }).style.width);
}

beforeEach(() => {
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
});

describe("the marauder layers", () => {
  it("are registered for a document whose systems can be written, below the lanes and above the systems", () => {
    const ids = layersFor({ ...ALL_CAPABILITIES, create_systems: true }).map((entry) => entry.id);
    expect(ids.filter((id) => id === "marauders")).toHaveLength(2);
    expect(ids.indexOf("marauders")).toBeLessThan(ids.indexOf("lanes"));
    expect(ids.lastIndexOf("marauders")).toBeGreaterThan(ids.indexOf("systems"));
    expect(layersFor(ALL_CAPABILITIES).map((entry) => entry.id)).not.toContain("marauders");
  });

  it("tags the clan home with the glyph, and neither a base nor a plain system", () => {
    const layer = tagged([...CLAN, PLAIN]);
    expect(chips(layer).map((c) => [c.x, c.y])).toEqual([[0, 0]]);
    expect(drawnText(childByLabel(layer.container, "tags"))).toEqual([HOME_TAG]);
  });

  it("draws nothing for a save", () => {
    expect(chips(tagged(CLAN, "save"))).toEqual([]);
    expect(fills(painted(CLAN, "save"))).toEqual([]);
  });

  it("paints one region over the clan's three systems, in the marauder colour and the owners' style", () => {
    const layer = painted([...CLAN, PLAIN]);
    expect(fills(layer)).toHaveLength(1);
    const fill = drawOps(fills(layer)[0]).find((op) => op.action === "fill")!;
    expect(fill).toMatchObject({ color: MARAUDER_COLOR, alpha: TERRITORY_FILL_ALPHA });
    const outline = outlineOf(fills(layer)[0]);
    for (const s of CLAN) expect(covers(outline, s.x, s.y), `covers S${s.id}`).toBe(true);
    expect(covers(outline, PLAIN.x, PLAIN.y)).toBe(false);
    const edge = drawOps(edges(layer)[0]).find((op) => op.action === "stroke")!;
    expect(edge.color).toBe(MARAUDER_COLOR);
    expect(TERRITORY_EDGE_PX).toBe(6);
  });

  it("strokes the edge over a halo, as the owners' edges are stroked", () => {
    const layer = painted(CLAN);
    const [halo, edge] = strokes(edges(layer)[0]);
    expect(halo).toMatchObject({ color: MARAUDER_COLOR, alpha: TERRITORY_HALO_ALPHA });
    expect(edge).toMatchObject({ color: MARAUDER_COLOR, alpha: TERRITORY_EDGE_ALPHA });
    expect(strokeWidths(edges(layer)[0])).toEqual([TERRITORY_HALO_PX, TERRITORY_EDGE_PX]);
  });

  it("takes a scripted empire's systems as the empire's, so its lane band and the clan's region meet without overlapping", () => {
    const p = { ...marauder(20, 12, -60, null, 21), owner: 7 };
    const q = { ...marauder(21, 12, 60, null, 20), owner: 7 };
    const all = [...CLAN, p, q];
    const systems = new Map(all.map((s) => [s.id, s]));
    const clan = clanRegions(systems, new Map(), mapContext([], { border: VANILLA_BORDER })).get(
      1,
    )!;
    const empire = countryRegions(all, PARAMS, new Set([7])).get(7)!;
    const together = countryRegions(all, PARAMS, new Set([7, 100]), (s) =>
      s.marauder === null ? s.owner : 100,
    );
    expect(clan).toEqual(together.get(100));
    expect(empire).toEqual(together.get(7));

    expect(inRegion(clan, 12, 0)).toBe(true);
    expect(inRegion(empire, 12, -45)).toBe(true);
    for (let y = -60; y <= 60; y += 3) {
      const claimed = Number(inRegion(clan, 12, y)) + Number(inRegion(empire, 12, y));
      expect(claimed, `at (12, ${y})`).toBeLessThanOrEqual(1);
    }
  });

  it("gives each clan its own region in the one marauder colour, and leaves a base of another clan out", () => {
    const home2 = marauder(10, 200, 0, { home: 2 }, 11);
    const base2 = marauder(11, 220, 0, { base: 2 }, 10);
    const stray = marauder(12, 300, 0, { base: 3 });
    const regions = clanRegions(
      new Map([...CLAN, home2, base2, stray].map((s) => [s.id, s])),
      new Map(),
      mapContext([], { border: VANILLA_BORDER }),
    );
    expect([...regions.keys()].sort()).toEqual([1, 2]);
    const layer = painted([...CLAN, home2, base2, stray]);
    expect(fills(layer)).toHaveLength(2);
    expect(fills(layer).map((g) => drawOps(g)[0].color)).toEqual([MARAUDER_COLOR, MARAUDER_COLOR]);
  });

  it("follows a delta that completes a clan, and drops the region when the clan goes", () => {
    const lone = marauder(0, 0, 0, { home: 1 });
    const layer = painted([lone, PLAIN]);
    expect(fills(layer)).toHaveLength(1);

    layer.rebuild(mapContext([...CLAN, PLAIN], { border: VANILLA_BORDER }));
    layer.applyDelta();
    const outline = outlineOf(fills(layer)[0]);
    expect(covers(outline, BASE_E.x, BASE_E.y)).toBe(true);

    layer.rebuild(mapContext([marauder(0, 0, 0, null), PLAIN], { border: VANILLA_BORDER }));
    layer.applyDelta();
    expect(fills(layer)).toHaveLength(0);
  });

  it("moves the tag with a drag, dimmed, and paints the region about the ghost", () => {
    const layer = tagged(CLAN);
    const ghost = { id: 0, x: 30, y: 10 };
    layer.setDragState({ ghosts: [ghost], byId: new Map([[0, ghost]]) });
    expect([chips(layer)[0].x, chips(layer)[0].y, chips(layer)[0].alpha]).toEqual([
      30,
      10,
      GHOST_ALPHA,
    ]);
    layer.setDragState(null);
    expect([chips(layer)[0].x, chips(layer)[0].alpha]).toEqual([0, 1]);

    const territory = painted(CLAN);
    const far = { id: 0, x: 300, y: 300 };
    territory.setDragState({ ghosts: [far], byId: new Map([[0, far]]) });
    expect(fills(territory)[0].alpha).toBe(GHOST_ALPHA);
    expect(covers(outlineOf(fills(territory)[0]), 300, 300)).toBe(true);
    territory.setDragState(null);
    expect(fills(territory)[0].alpha).toBe(1);
  });

  it("names the clan and its raid bases while the pointer is on the chip", () => {
    const layer = tagged([...CLAN, PLAIN]);
    const chip = chips(layer)[0];
    expect(chip.hitArea?.contains(0, 0)).toBe(false);

    chip.emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip).toMatchObject({
      title: "Marauder clan 1 home",
      lines: ["Raid bases: S1, S2"],
    });

    chip.emit("pointerout", {} as never);
    expect(useMapChromeStore.getState().tooltip).toBeNull();

    chips(tagged([HOME, BASE_N]))[0].emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip?.lines).toEqual(["Raid bases: S1, one missing"]);

    chips(tagged([HOME]))[0].emit("pointerover", { global: { x: 4, y: 6 } } as never);
    expect(useMapChromeStore.getState().tooltip?.lines).toEqual(["Raid bases: missing"]);
  });

  it("keeps the glyph on the chip through a zoom, both scaling from the star", () => {
    const layer = tagged([HOME]);
    const chip = chips(layer)[0];
    const glyph = labels(layer)[0];
    const offset = () => ({ x: glyph.x - chip.x, y: glyph.y - chip.y });
    const before = { ...offset(), scale: chip.scale.x };
    viewport(layer, 4);
    const grown = chip.scale.x / before.scale;
    expect(grown).not.toBeCloseTo(1, 5);
    expect(offset().x).toBeCloseTo(before.x * grown, 5);
    expect(offset().y).toBeCloseTo(before.y * grown, 5);
    expect(glyph.scale.x).toBe(chip.scale.x);
  });
});
