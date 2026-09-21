import { BitmapText, Graphics } from "pixi.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { MarauderRole } from "../../generated/MarauderRole";
import type { SystemNode } from "../../generated/SystemNode";
import { ALL_CAPABILITIES } from "../../lib/capabilities";
import { GHOST_ALPHA } from "../../lib/visual/style";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { childByLabel, drawnText, mapContext, mapNode, viewport } from "./fixture";
import { HOME_TAG, MarauderLayer } from "./MarauderLayer";
import { layersFor } from "./registry";

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

function tagged(
  nodes: readonly SystemNode[],
  kind: "scenario" | "save" = "scenario",
): MarauderLayer {
  const layer = new MarauderLayer();
  layer.rebuild(mapContext(nodes, { kind }));
  viewport(layer, 1);
  return layer;
}

beforeEach(() => {
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
});

describe("the marauder layer", () => {
  it("is registered once for a document whose systems can be written, above the systems", () => {
    const ids = layersFor({ ...ALL_CAPABILITIES, create_systems: true }).map((entry) => entry.id);
    expect(ids.filter((id) => id === "marauders")).toHaveLength(1);
    expect(ids.indexOf("marauders")).toBeGreaterThan(ids.indexOf("systems"));
    expect(layersFor(ALL_CAPABILITIES).map((entry) => entry.id)).not.toContain("marauders");
  });

  it("tags the clan home with the glyph, and neither a base nor a plain system", () => {
    const layer = tagged([...CLAN, PLAIN]);
    expect(chips(layer).map((c) => [c.x, c.y])).toEqual([[0, 0]]);
    expect(drawnText(childByLabel(layer.container, "tags"))).toEqual([HOME_TAG]);
  });

  it("draws nothing for a save", () => {
    expect(chips(tagged(CLAN, "save"))).toEqual([]);
  });

  it("moves the tag with a drag, dimmed", () => {
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
