import { describe, expect, it } from "vitest";
import { barShows, barTakes, layerKey, type BarControl, type BarMode } from "./barMode";
import { groupsFor } from "./layerGroups";
import { GALAXY_LAYER_IDS, LAYER_IDS, isSceneLayer } from "./layerIds";

/** The layers the bar of `mode` lists, before the document's capabilities narrow them. */
const barLayers = (mode: BarMode) => LAYER_IDS.filter((id) => barShows(mode, id));
const OTHER_CONTROLS: readonly BarControl[] = ["kinds", "masters", "tools"];
const controls = (mode: BarMode) => OTHER_CONTROLS.filter((control) => barShows(mode, control));

describe("the bar each view shows", () => {
  it("a save's galaxy lists every layer but orbit radii, with the kinds and the tools, and no master", () => {
    expect(barLayers("save")).toEqual(GALAXY_LAYER_IDS);
    expect(controls("save")).toEqual(["kinds", "masters", "tools"]);
    expect(groupsFor("save").some((group) => group.master)).toBe(false);
    expect(layerKey("systems", "save")).toBe(2);
    expect(layerKey("orbitRadii", "save")).toBe(0);
  });

  it("a scenario's galaxy lists the same layers, and its masters too", () => {
    expect(barLayers("scenario")).toEqual(barLayers("save"));
    expect(controls("scenario")).toEqual(["kinds", "masters", "tools"]);
    expect(groupsFor("scenario").some((group) => group.master)).toBe(true);
    expect(layerKey("systems", "scenario")).toBe(2);
  });

  it("the system view lists only the scene's own layers, with key 2 on orbit radii", () => {
    expect(barLayers("system")).toEqual(LAYER_IDS.filter(isSceneLayer));
    expect(controls("system")).toEqual([]);
    expect(layerKey("orbitRadii", "system")).toBe(2);
    expect(layerKey("systems", "system")).toBe(0);
  });
});

describe("the commands each view takes", () => {
  it("the galaxy's edits wait while a system is shown, and the rest run everywhere", () => {
    for (const command of [
      "deleteSelection",
      "selectAll",
      "browseInitializers",
      "nudge",
    ] as const) {
      expect(barTakes("save", command)).toBe(true);
      expect(barTakes("scenario", command)).toBe(true);
      expect(barTakes("system", command)).toBe(false);
    }
    expect(barTakes("system", "undo")).toBe(true);
    expect(barTakes("system", "clearSelection")).toBe(true);
  });
});
