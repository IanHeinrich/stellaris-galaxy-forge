import { BitmapText, type Container, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { CountryNode } from "../../generated/CountryNode";
import type { SystemNode } from "../../generated/SystemNode";
import { countryRegions, regionLabelAnchor } from "../../lib/geometry/territory";
import { MARAUDER_COLOR } from "../../lib/visual/ownerColors";
import { EMPHASIS_COLOR } from "../../lib/visual/specialStyle";
import { VANILLA_BORDER, type RenderContext } from "../RenderContext";
import { OwnersLayer } from "./OwnersLayer";
import { childByLabel, drawOps, mapContext, stubTextMeasurement, mapNode } from "./fixture";

stubTextMeasurement();

const COUNTRY: CountryNode = {
  id: 1,
  name: { key: "Country", literal: true, variables: [] },
  name_key: "Country",
  country_type: "custom_empire",
  capital_system: null,
  system_count: 1,
  colors: [],
  flag_icon: null,
  flag_background: null,
};

const OWNED = { ...mapNode(1, 0, "S1"), owner: COUNTRY.id };
const COUNTRIES = new Map([[COUNTRY.id, COUNTRY]]);
const PARAMS = {
  radius: VANILLA_BORDER.system_radius,
  laneHalfWidth: VANILLA_BORDER.hyperlane_thickness / 2,
};

/** The one shown badge's label. */
function labelOf(layer: OwnersLayer): BitmapText {
  const badges = childByLabel(layer.container, "badges").children as Container[];
  const badge = badges.find((b) => b.visible);
  const label = badge?.children.find((c): c is BitmapText => c instanceof BitmapText);
  if (!label) throw new Error("no label drawn");
  return label;
}

/** The fill colour of every territory the layer paints, in the order it holds them. */
function fillColors(layer: OwnersLayer): number[] {
  return childByLabel(childByLabel(layer.container, "territories"), "fills")
    .children.filter((c): c is Graphics => c instanceof Graphics && c.visible)
    .map((g) => drawOps(g).find((op) => op.action === "fill")?.color ?? -1);
}

function badgesShown(layer: OwnersLayer): number {
  return childByLabel(layer.container, "badges").children.filter((c) => c.visible).length;
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
/** A scripted empire over two linked systems, the second claimed by a day-one event. */
const SEAT = { ...scenarioNode(10, 300, 0, 11), owner: SCRIPTED.id };
const CLAIMED = { ...scenarioNode(11, 330, 0, 10), owner: SCRIPTED.id };
/** Clan 1: a home with a base 20 north and one 25 east. */
const HOME = { ...scenarioNode(1, 0, 0, 2, 3), marauder: { home: 1 } };
const BASE_N = { ...scenarioNode(2, 0, -20, 1), marauder: { base: 1 } };
const BASE_E = { ...scenarioNode(3, 25, 0, 1), marauder: { base: 1 } };
const SCENARIO = [HOME, BASE_N, BASE_E, SEAT, CLAIMED];

function scenarioContext(hiddenOwners: Iterable<number>): RenderContext {
  return mapContext(SCENARIO, {
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
  it("paints one for the scripted empire and one for the clan, the clan without a badge", () => {
    const layer = new OwnersLayer();
    layer.rebuild(scenarioContext([CLAIMED.id]));
    const colors = fillColors(layer);
    expect(colors).toHaveLength(2);
    expect(colors.filter((c) => c === MARAUDER_COLOR)).toHaveLength(1);
    expect(badgesShown(layer)).toBe(1);
    expect(labelOf(layer).text).toBe("Scripted");
  });

  it("drops the clan while the marauders eye is off, and brings it back", () => {
    const layer = new OwnersLayer();
    layer.rebuild(scenarioContext([CLAIMED.id]));
    layer.rebuild(scenarioContext([CLAIMED.id, HOME.id, BASE_N.id, BASE_E.id]));
    expect(fillColors(layer)).toHaveLength(1);
    expect(fillColors(layer)).not.toContain(MARAUDER_COLOR);

    layer.rebuild(scenarioContext([CLAIMED.id]));
    expect(fillColors(layer)).toHaveLength(2);
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
