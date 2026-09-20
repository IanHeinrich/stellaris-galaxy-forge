import { BitmapText, type Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { CountryNode } from "../../generated/CountryNode";
import { countryRegions, regionLabelAnchor } from "../../lib/geometry/territory";
import { VANILLA_BORDER } from "../RenderContext";
import { OwnersLayer } from "./OwnersLayer";
import { childByLabel, mapContext, stubTextMeasurement, mapNode } from "./fixture";

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

/** The one country's badge label the layer has drawn. */
function labelOf(layer: OwnersLayer): BitmapText {
  const [badge] = childByLabel(layer.container, "badges").children as Container[];
  const label = badge?.children.find((c): c is BitmapText => c instanceof BitmapText);
  if (!label) throw new Error("no label drawn");
  return label;
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
