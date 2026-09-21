import { BitmapText, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { MarauderRole } from "../../generated/MarauderRole";
import type { SystemNode } from "../../generated/SystemNode";
import { ALL_CAPABILITIES } from "../../lib/capabilities";
import { GHOST_ALPHA } from "../../lib/visual/style";
import { VANILLA_BORDER } from "../RenderContext";
import { childByLabel, drawOps, drawnText, mapContext, mapNode, viewport } from "./fixture";
import {
  CLAN_COLORS,
  clanRegions,
  HOME_TAG,
  MarauderLayer,
  MarauderTerritoryLayer,
} from "./MarauderLayer";
import { layersFor } from "./registry";
import { TERRITORY_EDGE_PX, TERRITORY_FILL_ALPHA } from "./territoryStyle";

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

  it("paints one region over the clan's three systems, in the clan's colour and the owners' style", () => {
    const layer = painted([...CLAN, PLAIN]);
    expect(fills(layer)).toHaveLength(1);
    const fill = drawOps(fills(layer)[0]).find((op) => op.action === "fill")!;
    expect(fill).toMatchObject({ color: CLAN_COLORS[0], alpha: TERRITORY_FILL_ALPHA });
    const outline = outlineOf(fills(layer)[0]);
    for (const s of CLAN) expect(covers(outline, s.x, s.y), `covers S${s.id}`).toBe(true);
    expect(covers(outline, PLAIN.x, PLAIN.y)).toBe(false);
    const edge = drawOps(edges(layer)[0]).find((op) => op.action === "stroke")!;
    expect(edge.color).toBe(CLAN_COLORS[0]);
    expect(TERRITORY_EDGE_PX).toBe(6);
  });

  it("gives each clan its own region and colour, and leaves a base of another clan out", () => {
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
    expect(
      fills(layer)
        .map((g) => drawOps(g)[0].color)
        .sort(),
    ).toEqual([CLAN_COLORS[0], CLAN_COLORS[1]].sort());
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
