import { BitmapText, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { MarauderRole } from "../../generated/MarauderRole";
import type { SystemNode } from "../../generated/SystemNode";
import { ALL_CAPABILITIES } from "../../lib/capabilities";
import { GHOST_ALPHA } from "../../lib/visual/style";
import { childByLabel, drawOps, drawnText, mapContext, mapNode, viewport } from "./fixture";
import {
  BASE_DISTANCES,
  baseGhosts,
  CLAN_COLORS,
  HOME_TAG,
  MarauderLayer,
  MarauderTerritoryLayer,
  TERRITORY_RADIUS,
  territoryRadius,
} from "./MarauderLayer";
import { layersFor } from "./registry";
import { TERRITORY_EDGE_PX, TERRITORY_FILL_ALPHA } from "./territoryStyle";

/** A system at `x` in `role`, linked by lane to `to`. */
function marauder(id: number, x: number, role: MarauderRole | null, ...to: number[]): SystemNode {
  return {
    ...mapNode(id, x, `S${id}`),
    marauder: role,
    lanes: to.map((other) => ({ to: other, length: 10, bridge: false, stale: false })),
  };
}

const HOME = marauder(0, 0, { home: 1 });
const PLAIN = marauder(1, 200, null);

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

function ghosts(layer: MarauderLayer): Graphics[] {
  return childByLabel(layer.container, "baseGhosts")
    .children.filter((c): c is Graphics => c instanceof Graphics && c.visible)
    .sort((a, b) => a.x - b.x);
}

function discs(layer: MarauderTerritoryLayer): Graphics[] {
  return layer.container.children
    .filter((c): c is Graphics => c instanceof Graphics && c.visible)
    .sort((a, b) => a.x - b.x);
}

/** The radius the disc was drawn with, read from its circle step. */
function discRadius(disc: Graphics): number {
  const fill = drawOps(disc).find((op) => op.action === "fill")!;
  return fill.segments[0][2];
}

function drawn(nodes: readonly SystemNode[], paintLayer = true): MarauderLayer {
  const layer = new MarauderLayer();
  layer.rebuild(mapContext(nodes, { paintLayer }));
  viewport(layer, 1);
  return layer;
}

function painted(nodes: readonly SystemNode[], paintLayer = true): MarauderTerritoryLayer {
  const layer = new MarauderTerritoryLayer();
  layer.rebuild(mapContext(nodes, { paintLayer }));
  viewport(layer, 1);
  return layer;
}

describe("the marauder layers", () => {
  it("are registered for a document whose systems can be written, and not for a save", () => {
    const scenario = layersFor({ ...ALL_CAPABILITIES, create_systems: true });
    const ids = scenario.map((entry) => entry.id);
    expect(ids.filter((id) => id === "marauders")).toHaveLength(2);
    expect(ids.indexOf("marauders")).toBeLessThan(ids.indexOf("lanes"));
    expect(ids.lastIndexOf("marauders")).toBeGreaterThan(ids.indexOf("systems"));
    expect(layersFor(ALL_CAPABILITIES).map((entry) => entry.id)).not.toContain("marauders");
  });

  it("tags each clan home with the glyph and leaves the rest bare", () => {
    const layer = drawn([HOME, PLAIN, marauder(2, 40, { base: 1 })]);
    expect(chips(layer).map((c) => c.x)).toEqual([HOME.x]);
    expect(drawnText(childByLabel(layer.container, "tags"))).toEqual([HOME_TAG]);
  });

  it("draw nothing for a save, or for a scenario not written for the mod", () => {
    expect(chips(drawn([HOME], false))).toEqual([]);
    expect(discs(painted([HOME], false))).toEqual([]);
    const layer = new MarauderLayer();
    layer.rebuild(mapContext([HOME], { kind: "save", paintLayer: true }));
    expect(chips(layer)).toEqual([]);
    const territory = new MarauderTerritoryLayer();
    territory.rebuild(mapContext([HOME], { kind: "save", paintLayer: true }));
    expect(discs(territory)).toEqual([]);
  });

  it("previews two bases at 20 and 25 from a home with none linked, each on a dashed lane", () => {
    const layer = drawn([HOME, PLAIN]);
    const [g] = ghosts(layer);
    expect(ghosts(layer)).toHaveLength(1);
    expect([g.x, g.y]).toEqual([HOME.x, 0]);
    const bases = baseGhosts(HOME.id);
    expect(bases.map((b) => Math.hypot(b.x, b.y))).toEqual(
      BASE_DISTANCES.map((d) => expect.closeTo(d, 6)),
    );
    const ops = drawOps(g);
    const lanes = ops.find((op) => op.action === "stroke")!;
    expect(lanes.segments.length).toBeGreaterThan(BASE_DISTANCES.length * 4);
    expect(ops.filter((op) => op.action === "fill" && op.steps.includes("circle"))).toHaveLength(
      BASE_DISTANCES.length,
    );
  });

  it("seeds the ghosts by the home's id, so the same home always previews the same bases", () => {
    expect(baseGhosts(7)).toEqual(baseGhosts(7));
    expect(baseGhosts(7)).not.toEqual(baseGhosts(8));
  });

  it("drops the ghosts once a base of the clan is linked to the home, and not for another clan's", () => {
    const home = marauder(0, 0, { home: 1 }, 2, 3);
    const otherClan = marauder(3, 60, { base: 2 }, 0);
    const layer = drawn([home, otherClan, marauder(2, 40, null, 0)]);
    expect(ghosts(layer)).toHaveLength(1);

    const linked = marauder(2, 40, { base: 1 }, 0);
    layer.rebuild(mapContext([home, otherClan, linked], { paintLayer: true }));
    layer.applyDelta({ systems: [linked] });
    expect(ghosts(layer)).toHaveLength(0);
    expect(chips(layer)).toHaveLength(1);
  });

  it("follows a delta that makes a system a home, moves it, and takes the clan away", () => {
    const layer = drawn([HOME, PLAIN]);
    const second = marauder(1, 200, { home: 2 });
    layer.rebuild(mapContext([HOME, second], { paintLayer: true }));
    layer.applyDelta({ systems: [second] });
    expect(chips(layer).map((c) => c.x)).toEqual([0, 200]);

    const moved = marauder(0, 60, { home: 1 });
    layer.rebuild(mapContext([moved, second], { paintLayer: true }));
    layer.applyDelta({ systems: [moved] });
    expect(chips(layer).map((c) => c.x)).toEqual([60, 200]);
    expect(ghosts(layer).map((g) => g.x)).toEqual([60, 200]);

    const plain = marauder(0, 60, null);
    layer.rebuild(mapContext([plain, second], { paintLayer: true }));
    layer.applyDelta({ systems: [plain] });
    expect(chips(layer).map((c) => c.x)).toEqual([200]);
    expect(labels(layer)).toHaveLength(1);
  });

  it("moves the tag and the ghosts with a drag, dimmed, and puts them back after", () => {
    const layer = drawn([HOME]);
    const ghost = { id: 0, x: 30, y: 10 };
    layer.setDragState({ ghosts: [ghost], byId: new Map([[0, ghost]]) });
    expect([chips(layer)[0].x, chips(layer)[0].y]).toEqual([30, 10]);
    expect(chips(layer)[0].alpha).toBe(GHOST_ALPHA);
    expect(ghosts(layer)[0].x).toBe(30);

    layer.setDragState(null);
    expect([chips(layer)[0].x, chips(layer)[0].y]).toEqual([0, 0]);
    expect(chips(layer)[0].alpha).toBe(1);
  });

  it("keeps the glyph on the chip through a zoom, both scaling from the star", () => {
    const layer = drawn([HOME]);
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

  it("paints a disc of radius 35 about each home in its clan's colour, the way owners are painted", () => {
    const layer = painted([HOME, marauder(2, 200, { home: 3 }), PLAIN]);
    const [first, third] = discs(layer);
    expect(discs(layer).map((d) => d.x)).toEqual([0, 200]);
    expect(discRadius(first)).toBe(TERRITORY_RADIUS);
    const ops = drawOps(first);
    expect(ops.find((op) => op.action === "fill")).toMatchObject({
      color: CLAN_COLORS[0],
      alpha: TERRITORY_FILL_ALPHA,
    });
    expect(ops.find((op) => op.action === "stroke")?.color).toBe(CLAN_COLORS[0]);
    expect(drawOps(third).find((op) => op.action === "fill")?.color).toBe(CLAN_COLORS[2]);
    expect(TERRITORY_EDGE_PX).toBe(6);
  });

  it("grows the disc to cover the bases linked to the home, by 8 past the farthest", () => {
    const home = marauder(0, 0, { home: 1 }, 2, 3);
    const near = marauder(2, 20, { base: 1 }, 0);
    const far = { ...marauder(3, 0, { base: 1 }, 0), y: 40 };
    const systems = new Map([home, near, far].map((s) => [s.id, s]));
    expect(territoryRadius(home, home, systems)).toBe(48);
    expect(territoryRadius(home, home, new Map([[0, home]]))).toBe(TERRITORY_RADIUS);

    const layer = painted([home, near, far]);
    expect(discRadius(discs(layer)[0])).toBe(48);
  });

  it("follows a home's drag with its disc, dimmed", () => {
    const layer = painted([HOME]);
    const ghost = { id: 0, x: 30, y: 10 };
    layer.setDragState({ ghosts: [ghost], byId: new Map([[0, ghost]]) });
    expect([discs(layer)[0].x, discs(layer)[0].alpha]).toEqual([30, GHOST_ALPHA]);
    layer.setDragState(null);
    expect([discs(layer)[0].x, discs(layer)[0].alpha]).toEqual([0, 1]);
  });
});
