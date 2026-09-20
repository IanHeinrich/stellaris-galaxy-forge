import { describe, expect, it } from "vitest";
import type { SpecialKind } from "../../generated/SpecialKind";
import { KIND_ORDER } from "../special";
import { LAYER_IDS, defaultLayers, type LayerId } from "./layerIds";
import {
  NO_GAME_DATA_KEYS_TITLE,
  NO_GAME_DATA_TITLE,
  SECTION_SOURCES,
  UNFOLDED_SECTIONS,
  groupState,
  groupsFor,
  sectionIdsOf,
  sourceOf,
  splitsBySource,
  type LayerVisibility,
  type Source,
} from "./layerGroups";

/** Layers only a save can answer for, which a scenario's groups therefore leave out. */
const SAVE_ONLY: readonly LayerId[] = ["waylines"];

describe("layer groups", () => {
  it("assigns every layer a scenario can draw to exactly one of its three groups", () => {
    const assigned = groupsFor("scenario").flatMap((group) => [...group.layers]);
    expect(new Set(assigned).size).toBe(assigned.length);
    expect([...assigned].sort()).toEqual(LAYER_IDS.filter((id) => !SAVE_ONLY.includes(id)).sort());
  });

  it("names the group each layer belongs to", () => {
    expect(sourceOf("lanes", "scenario")).toBe("scenario");
    expect(sourceOf("initializers", "scenario")).toBe("scenario");
    expect(sourceOf("special", "scenario")).toBe("initializers");
    expect(sourceOf("colonies", "scenario")).toBe("initializers");
    expect(sourceOf("owners", "scenario")).toBe("initializers");
    expect(sourceOf("claims", "scenario")).toBe("scripts");
    expect(sourceOf("bypasses", "scenario")).toBe("initializers");
    expect(sourceOf("day_one_bypasses", "scenario")).toBe("scripts");
    expect(sourceOf("day_one_bypasses", "save")).toBeNull();
  });

  it("gives a save one unframed group holding every layer, with no master", () => {
    for (const kind of ["save", null] as const) {
      const groups = groupsFor(kind);
      expect(groups).toHaveLength(1);
      expect(groups[0].master).toBe(false);
      expect([...groups[0].layers].sort()).toEqual([...LAYER_IDS].sort());
      expect(sourceOf("owners", kind)).toBeNull();
    }
  });

  it("puts a master over the two groups the install decides", () => {
    const masters = groupsFor("scenario").filter((group) => group.master);
    expect(masters.map((group) => group.source)).toEqual(["initializers", "scripts"]);
    for (const group of masters) expect(group.needsGameData).toBe(true);
  });

  it("says why each group the install decides is dead without it, in its own words", () => {
    const titleOf = (source: Source) =>
      groupsFor("scenario").find((group) => group.source === source)?.deadTitle;
    expect(titleOf("initializers")).toBe(NO_GAME_DATA_KEYS_TITLE);
    expect(titleOf("scripts")).toBe(NO_GAME_DATA_TITLE);
    expect(titleOf("initializers")).not.toBe(titleOf("scripts"));
    expect(titleOf("scenario")).toBeUndefined();
  });

  it("splits only for a scenario document", () => {
    expect(splitsBySource("scenario")).toBe(true);
    expect(splitsBySource("save")).toBe(false);
    expect(splitsBySource(null)).toBe(false);
  });

  it("sorts the inspector's sections by source", () => {
    expect(SECTION_SOURCES["system.initializer"]).toBe("initializers");
    expect(SECTION_SOURCES["system.spawn"]).toBe("scenario");
    expect(sectionIdsOf("initializers")).toContain("system.planets");
    expect(sectionIdsOf("scripts")).toEqual(["system.scripts"]);
    // The bypasses of a scenario come from both, so the section wears no chip and no master folds it.
    expect(SECTION_SOURCES["system.bypasses"]).toBeUndefined();
  });

  it("leaves the initializer section out of what its own master folds away", () => {
    expect(UNFOLDED_SECTIONS.has("system.initializer")).toBe(true);
    expect(sectionIdsOf("initializers")).not.toContain("system.initializer");
  });
});

describe("how much of a group is drawn", () => {
  /** The layers a scenario opens with, with `off` turned off and `kinds` the only ones shown. */
  function visible(off: LayerId[], kinds: SpecialKind[], on: LayerId[] = []): LayerVisibility {
    const layers = defaultLayers("scenario");
    for (const id of on) layers[id] = true;
    for (const id of off) layers[id] = false;
    return { layers, shownKinds: new Set(kinds) };
  }

  const initializers = groupsFor("scenario").find((group) => group.source === "initializers");
  const state = (off: LayerId[], kinds: SpecialKind[] = KIND_ORDER) =>
    groupState(visible(off, kinds), "scenario", "initializers");

  it("is on where every layer of the group is on, and off where none is", () => {
    expect(state([])).toBe("on");
    expect(state([...(initializers?.layers ?? [])])).toBe("off");
    // The scripts' overlays start off; the group reads on once both are shown.
    expect(groupState(visible([], KIND_ORDER), "scenario", "scripts")).toBe("off");
    expect(
      groupState(visible([], KIND_ORDER, ["claims", "day_one_bypasses"]), "scenario", "scripts"),
    ).toBe("on");
  });

  it("is mixed where some of the group is on", () => {
    expect(state(["details"])).toBe("mixed");
    expect(state(["classes", "details", "colonies", "owners", "bypasses"])).toBe("mixed");
  });

  it("counts the kinds the bar carries a button for, and no others", () => {
    expect(state([], ["leviathan", "enclave"])).toBe("on");
    expect(state([], ["leviathan", "enclave", "landmark"])).toBe("on");
    expect(state([], ["leviathan"])).toBe("mixed");
    expect(state([], ["landmark"])).toBe("mixed");
    expect(state(["details", "owners", "bypasses"], ["landmark"])).toBe("off");
  });

  it("reads a kind through the layer that carries them all", () => {
    expect(state(["special"], KIND_ORDER)).toBe("mixed");
    expect(state(["special", "details", "owners", "bypasses"], KIND_ORDER)).toBe("off");
  });

  it("counts only the layers the bar carries an icon for", () => {
    expect(state(["classes", "colonies"])).toBe("on");
    expect(state(["details", "owners", "bypasses", "special"])).toBe("off");
  });

  it("reads off for a group the open document has not got", () => {
    expect(groupState(visible([], KIND_ORDER), "save", "scripts")).toBe("off");
  });
});
