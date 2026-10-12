import { describe, expect, it } from "vitest";
import { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES } from "../capabilities";
import { barShowsLayer } from "./barMode";
import { SCENE_LAYER_IDS } from "./layerIds";

/** The switches the system view's bar shows for a document with `capabilities`. */
const sceneSwitches = (capabilities: typeof SAVE_CAPABILITIES) =>
  SCENE_LAYER_IDS.filter((id) => barShowsLayer("system", id, capabilities));

describe("the system view's switches", () => {
  it("a save's system shows every switch the scene has", () => {
    expect(sceneSwitches(SAVE_CAPABILITIES)).toEqual(SCENE_LAYER_IDS);
  });

  it("a scenario's system shows Megastructures and starbases, and no Bypasses", () => {
    expect(sceneSwitches(SCENARIO_CAPABILITIES)).toEqual([
      "labels",
      "details",
      "nebulae",
      "orbitRadii",
      "megastructures",
    ]);
  });
});
