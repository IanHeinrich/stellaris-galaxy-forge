import { describe, expect, it } from "vitest";
import { barShows, barTakes, layerKey, type BarControl, type BarMode } from "./barMode";
import { groupsFor } from "./layerGroups";
import { GALAXY_LAYER_IDS, LAYER_IDS, isSceneLayer } from "./layerIds";

/** The layers the bar of `mode` lists, before the document's capabilities narrow them. */
const barLayers = (mode: BarMode) => LAYER_IDS.filter((id) => barShows(mode, id));
const OTHER_CONTROLS: readonly BarControl[] = ["kinds", "masters", "rail", "tools", "symmetry"];
const controls = (mode: BarMode) => OTHER_CONTROLS.filter((control) => barShows(mode, control));

describe("the bar each view shows", () => {
  it("a save's galaxy lists every layer but orbit radii, with the kinds and the tools, and no master", () => {
    expect(barLayers("save")).toEqual(GALAXY_LAYER_IDS);
    expect(controls("save")).toEqual(["kinds", "masters", "rail", "tools", "symmetry"]);
    expect(groupsFor("save").some((group) => group.master)).toBe(false);
    expect(layerKey("systems", "save")).toBe(2);
    expect(layerKey("orbitRadii", "save")).toBe(0);
  });

  it("a scenario's galaxy lists the same layers, and its masters too", () => {
    expect(barLayers("scenario")).toEqual(barLayers("save"));
    expect(controls("scenario")).toEqual(["kinds", "masters", "rail", "tools", "symmetry"]);
    expect(groupsFor("scenario").some((group) => group.master)).toBe(true);
    expect(layerKey("systems", "scenario")).toBe(2);
  });

  it("the system view lists only the scene's own layers and the rail, with key 2 on orbit radii", () => {
    expect(barLayers("system")).toEqual(LAYER_IDS.filter(isSceneLayer));
    expect(controls("system")).toEqual(["rail"]);
    expect(layerKey("orbitRadii", "system")).toBe(2);
    expect(layerKey("systems", "system")).toBe(0);
  });
});

describe("the commands each view takes", () => {
  it("undo and clearing the selection run while a system is shown", () => {
    expect(barTakes("system", "undo")).toBe(true);
    expect(barTakes("system", "clearSelection")).toBe(true);
  });

  it("nudges on every bar: the selection on the galaxy's, the inspected body on the system's", () => {
    for (const mode of ["save", "scenario", "system"] as const) {
      expect(barTakes(mode, "nudge")).toBe(true);
    }
  });
});
