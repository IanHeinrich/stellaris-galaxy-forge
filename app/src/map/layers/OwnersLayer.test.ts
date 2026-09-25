import { BitmapText, type Container, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { CountryNode } from "../../generated/CountryNode";
import type { MapColor } from "../../generated/MapColor";
import type { SystemNode } from "../../generated/SystemNode";
import { countryRegions, regionLabelAnchor } from "../../lib/geometry/territory";
import { SAVE_CAPABILITIES } from "../../lib/capabilities";
import { MARAUDER_COLORS, ownerColors } from "../../lib/visual/ownerColors";
import { EMPHASIS_COLOR } from "../../lib/visual/specialStyle";
import { countryNode } from "../../test/builders";
import { VANILLA_BORDER, type RenderContext } from "../RenderContext";
import { CLAN_GLYPH, OwnersLayer } from "./OwnersLayer";
import { layerIdsFor, layersFor } from "./registry";
import {
  childByLabel,
  drawOps,
  mapContext,
  stubTextMeasurement,
  mapNode,
  strokes,
} from "./fixture";

stubTextMeasurement();

/** An empire whose view names no map colours, so the map paints it from its palette slot. */
const COUNTRY: CountryNode = countryNode({
  id: 1,
  name: { key: "Country", literal: true, variables: [] },
  name_key: "Country",
  country_type: "custom_empire",
  capital_system: null,
  system_count: 1,
  painted_border: undefined,
  painted_fill: undefined,
});

const OWNED = { ...mapNode(1, 0, "S1"), owner: COUNTRY.id };
const COUNTRIES = new Map([[COUNTRY.id, COUNTRY]]);
const PARAMS = {
  radius: VANILLA_BORDER.system_radius,
  laneHalfWidth: VANILLA_BORDER.hyperlane_thickness / 2,
};

const PALETTE = new Map<string, MapColor>(
  [
    ["grey", "#808080"],
    ["dark_blue", "#000080"],
    ["intense_red", "#ff0000"],
    ["light_pink", "#ffc0cb"],
  ].map(([name, map]) => [name, { name, map, flag: map, ship: map }]),
);

/** The colours the one country's territory is filled and outlined in. */
function paintOf(layer: OwnersLayer): { fill: number | undefined; edge: number | undefined } {
  const territories = childByLabel(layer.container, "territories");
  const [fill] = childByLabel(territories, "fills").children as Graphics[];
  const [edge] = childByLabel(territories, "edges").children as Graphics[];
  return {
    fill: drawOps(fill).find((op) => op.action === "fill")?.color,
    edge: strokes(edge)[0]?.color,
  };
}

/** The one shown badge's label. */
function labelOf(layer: OwnersLayer): BitmapText {
  const badges = childByLabel(layer.container, "badges").children as Container[];
  const badge = badges.find((b) => b.visible);
  const label = badge?.children.find((c): c is BitmapText => c instanceof BitmapText && c.visible);
  if (!label) throw new Error("no label drawn");
  return label;
}

/** The fill colour of every territory the layer paints, in the order it holds them. */
function fillColors(layer: OwnersLayer): number[] {
  return childByLabel(childByLabel(layer.container, "territories"), "fills")
    .children.filter((c): c is Graphics => c instanceof Graphics && c.visible)
    .map((g) => drawOps(g).find((op) => op.action === "fill")?.color ?? -1);
}

/** The shown badges, each as the texts its visible children draw. */
function badgesShown(layer: OwnersLayer): string[][] {
  return (childByLabel(layer.container, "badges").children as Container[])
    .filter((c) => c.visible)
    .map((badge) =>
      badge.children
        .filter((c): c is BitmapText => c instanceof BitmapText && c.visible)
        .map((c) => c.text),
    );
}

/** The fill of the clan's territory, by its colour; undefined once there is none shown. */
function clanFill(layer: OwnersLayer): Graphics | undefined {
  return childByLabel(childByLabel(layer.container, "territories"), "fills")
    .children.filter((c): c is Graphics => c instanceof Graphics && c.visible)
    .find((g) => drawOps(g).find((op) => op.action === "fill")?.color === MARAUDER_COLORS.fill);
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

/** Whether the first polygon the fill lays down reaches round (`x`, `y`), by ray crossing. */
function covers(fill: Graphics, x: number, y: number): boolean {
  const polygon = outlineOf(fill);
  let inside = false;
  for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [polygon[i], polygon[i + 1], polygon[j], polygon[j + 1]];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** A scenario system at (`x`, `y`) with lanes to `to`. */
function scenarioNode(id: number, x: number, y: number, ...to: number[]): SystemNode {
  return {
    ...mapNode(id, x, `S${id}`),
    y,
    lanes: to.map((other) => ({ to: other, length: 10, bridge: false, stale: false })),
  };
}

const SCRIPTED: CountryNode = { ...COUNTRY, id: 7, name_key: "Scripted" };
/** The palette fill for the scripted empire, second in the countries map with no map colours. */
const SCRIPTED_FILL = ownerColors(SCRIPTED, 0, new Map()).fill;
/** A scripted empire over two linked systems, the second claimed by a day-one event. */
const SEAT = { ...scenarioNode(10, 300, 0, 11), owner: SCRIPTED.id };
const CLAIMED = { ...scenarioNode(11, 330, 0, 10), owner: SCRIPTED.id };
/** Clan 1: a home with a base 20 north and one 25 east. */
const HOME = { ...scenarioNode(1, 0, 0, 2, 3), marauder: { home: 1 } };
const BASE_N = { ...scenarioNode(2, 0, -20, 1), marauder: { base: 1 } };
const BASE_E = { ...scenarioNode(3, 25, 0, 1), marauder: { base: 1 } };
const SCENARIO = [HOME, BASE_N, BASE_E, SEAT, CLAIMED];

function scenarioContext(
  hiddenOwners: Iterable<number>,
  nodes: readonly SystemNode[] = SCENARIO,
): RenderContext {
  return mapContext(nodes, {
    countries: new Map([[SCRIPTED.id, SCRIPTED]]),
    countryName: () => "Scripted",
    border: VANILLA_BORDER,
    hiddenOwners: new Set(hiddenOwners),
  });
}

describe("an owner's label", () => {
  it("re-fits its scale to the width cap when a names update lengthens the text", () => {
    const layer = new OwnersLayer();
    let text = "S";
    const over = { countries: COUNTRIES, hiddenOwners: new Set<number>() };
    layer.rebuild(
      mapContext([OWNED], { ...over, countryName: () => text, names: new Map([["a", "1"]]) }),
    );
    expect(labelOf(layer).text).toBe("S");

    const region = countryRegions([OWNED], PARAMS, new Set([COUNTRY.id])).get(COUNTRY.id);
    const anchor = region && regionLabelAnchor(region);
    if (!anchor) throw new Error("no region drawn");

    text = "S".repeat(100);
    layer.rebuild(
      mapContext([OWNED], { ...over, countryName: () => text, names: new Map([["a", "2"]]) }),
    );

    const label = labelOf(layer);
    expect(label.text).toBe(text);
    expect(label.width).toBeLessThanOrEqual(anchor.width * 0.9 + 0.5);
  });
});

describe("a scenario's territories", () => {
  it("paints one for the scripted empire and one for the clan, in black with a skull badge", () => {
    const layer = new OwnersLayer();
    layer.rebuild(scenarioContext([CLAIMED.id]));
    const colors = fillColors(layer);
    expect(colors).toHaveLength(2);
    expect(colors.filter((c) => c === MARAUDER_COLORS.fill)).toHaveLength(1);
    expect(MARAUDER_COLORS.fill).toBe(0x000000);
    const badges = badgesShown(layer);
    expect(badges).toHaveLength(2);
    expect(badges).toContainEqual([CLAN_GLYPH, "Marauder clan 1"]);
    expect(badges).toContainEqual(["Scripted"]);
    const texts = childByLabel(layer.container, "badges")
      .children.flatMap((b) => (b as Container).children)
      .filter((c): c is BitmapText => c instanceof BitmapText && c.visible);
    const tintOf = (text: string) => texts.find((c) => c.text === text)?.tint;
    expect(tintOf(CLAN_GLYPH)).toBe(MARAUDER_COLORS.outline);
    expect(tintOf("Marauder clan 1")).toBe(MARAUDER_COLORS.outline);
    expect(tintOf("Scripted")).toBe(0xffffff);
  });

  it("is the one layer for the clans: the marauders toggle is menu-only and steers it", () => {
    const capabilities = { ...SAVE_CAPABILITIES, create_systems: true };
    expect(layersFor(capabilities).map((entry) => entry.id)).not.toContain("marauders");
    expect(layerIdsFor(capabilities).has("marauders")).toBe(true);
    expect(layerIdsFor(SAVE_CAPABILITIES).has("marauders")).toBe(false);
  });

  it("hides the clan with the marauders layer and the empire with its own, each on its own", () => {
    const layer = new OwnersLayer();
    layer.rebuild(scenarioContext([CLAIMED.id]));
    layer.setClansShown(false);
    expect(fillColors(layer)).toEqual([SCRIPTED_FILL]);
    layer.setVisible(false);
    expect(fillColors(layer)).toEqual([]);
    layer.setClansShown(true);
    expect(fillColors(layer)).toEqual([MARAUDER_COLORS.fill]);
    layer.setVisible(true);
    expect(fillColors(layer)).toHaveLength(2);
  });

  it("grows the clan with a delta that lanes a base to its home, without a full recompute", () => {
    const loose = { ...BASE_E, lanes: [] };
    const homeAlone = { ...HOME, lanes: HOME.lanes.filter((l) => l.to !== BASE_E.id) };
    const layer = new OwnersLayer();
    layer.rebuild(scenarioContext([], [homeAlone, BASE_N, loose, SEAT, CLAIMED]));
    expect(covers(clanFill(layer)!, BASE_E.x, BASE_E.y)).toBe(false);

    layer.rebuild(scenarioContext([]));
    layer.applyDelta({ systems: [HOME, BASE_E] });
    expect(covers(clanFill(layer)!, BASE_E.x, BASE_E.y)).toBe(true);
  });

  it("emphasises the clan's border while marauders are shown as points of interest", () => {
    const layer = new OwnersLayer();
    layer.rebuild(scenarioContext([]));
    layer.setShownKinds(new Set(["marauder"]));
    const emphases = childByLabel(layer.container, "emphases").children.filter(
      (c): c is Graphics => c instanceof Graphics && drawOps(c).length > 0,
    );
    expect(emphases).toHaveLength(1);
    expect(drawOps(emphases[0]).every((op) => op.color === EMPHASIS_COLOR)).toBe(true);
  });
});

describe("an owner's territory", () => {
  it("is painted in the border and fill the view says the map paints", () => {
    const flagged = { ...COUNTRY, painted_border: "grey", painted_fill: "dark_blue" };
    const chosen = { ...COUNTRY, painted_border: "intense_red", painted_fill: "light_pink" };
    const paint = (country: CountryNode): ReturnType<typeof paintOf> => {
      const layer = new OwnersLayer();
      const countries = new Map([[country.id, country]]);
      layer.rebuild(mapContext([OWNED], { countries, mapColors: PALETTE }));
      return paintOf(layer);
    };
    expect(paint(flagged)).toEqual({ edge: 0x808080, fill: 0x000080 });
    expect(paint(chosen)).toEqual({ edge: 0xff0000, fill: 0xffc0cb });
  });
});
