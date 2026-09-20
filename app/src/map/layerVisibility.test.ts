import { describe, expect, it } from "vitest";
import { DEFAULT_LAYERS } from "../lib/visual/layerIds";
import { layerShown } from "./layerVisibility";

describe("layerShown", () => {
  it("hides the bypasses layer on a scenario when both toggles are off", () => {
    const layers = { ...DEFAULT_LAYERS, bypasses: false, day_one_bypasses: false };
    expect(layerShown("bypasses", layers, "scenario")).toBe(false);
  });

  it("shows the bypasses layer on a scenario with only the initializers' toggle on", () => {
    const layers = { ...DEFAULT_LAYERS, bypasses: true, day_one_bypasses: false };
    expect(layerShown("bypasses", layers, "scenario")).toBe(true);
  });

  it("shows the bypasses layer on a scenario with only the day-one toggle on", () => {
    const layers = { ...DEFAULT_LAYERS, bypasses: false, day_one_bypasses: true };
    expect(layerShown("bypasses", layers, "scenario")).toBe(true);
  });

  it("on a save, only the bypasses layer's own flag counts", () => {
    const layers = { ...DEFAULT_LAYERS, bypasses: false, day_one_bypasses: true };
    expect(layerShown("bypasses", layers, "save")).toBe(false);
    expect(layerShown("bypasses", { ...layers, bypasses: true }, "save")).toBe(true);
    expect(layerShown("bypasses", layers, null)).toBe(false);
  });

  it("leaves every other layer to follow its own flag", () => {
    expect(layerShown("lanes", { ...DEFAULT_LAYERS, lanes: false }, "scenario")).toBe(false);
    expect(layerShown("lanes", { ...DEFAULT_LAYERS, lanes: true }, "scenario")).toBe(true);
  });
});
