import { describe, expect, it } from "vitest";
import { kindCapabilities } from "../lib/documentKinds";
import { SAVE_CAPABILITIES, SCENARIO_CAPABILITIES } from "../lib/capabilities";
import { DEFAULT_LAYERS } from "../lib/visual/layerIds";
import { layerShown } from "./layerVisibility";

describe("layerShown", () => {
  it("hides the bypasses layer on a scenario when both toggles are off", () => {
    const layers = { ...DEFAULT_LAYERS, bypasses: false, day_one_bypasses: false };
    expect(layerShown("bypasses", layers, SCENARIO_CAPABILITIES)).toBe(false);
  });

  it("shows the bypasses layer on a scenario with only the initializers' toggle on", () => {
    const layers = { ...DEFAULT_LAYERS, bypasses: true, day_one_bypasses: false };
    expect(layerShown("bypasses", layers, SCENARIO_CAPABILITIES)).toBe(true);
  });

  it("shows the bypasses layer on a scenario with only the day-one toggle on", () => {
    const layers = { ...DEFAULT_LAYERS, bypasses: false, day_one_bypasses: true };
    expect(layerShown("bypasses", layers, SCENARIO_CAPABILITIES)).toBe(true);
  });

  it("on a save, only the bypasses layer's own flag counts", () => {
    const layers = { ...DEFAULT_LAYERS, bypasses: false, day_one_bypasses: true };
    expect(layerShown("bypasses", layers, SAVE_CAPABILITIES)).toBe(false);
    expect(layerShown("bypasses", { ...layers, bypasses: true }, SAVE_CAPABILITIES)).toBe(true);
    expect(layerShown("bypasses", layers, kindCapabilities(null))).toBe(false);
  });

  it("leaves every other layer to follow its own flag", () => {
    expect(layerShown("lanes", { ...DEFAULT_LAYERS, lanes: false }, SCENARIO_CAPABILITIES)).toBe(
      false,
    );
    expect(layerShown("lanes", { ...DEFAULT_LAYERS, lanes: true }, SCENARIO_CAPABILITIES)).toBe(
      true,
    );
  });
});
