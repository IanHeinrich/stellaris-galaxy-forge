import { describe, expect, it } from "vitest";
import { ambientObjectView } from "../test/builders";
import {
  ambientObjectEntries,
  ambientObjectGroup,
  matchingAmbientObjects,
  OTHER_OBJECTS,
  PLACED_IN_SYSTEMS,
} from "./ambientObjectAdd";

const views = new Map(
  [
    ambientObjectView("storm_object", { name: "Ion Storm", portrait: null }),
    ambientObjectView("derelict_ship_object", {
      name: "Derelict Ship",
      placed_by: ["scavenger_system"],
    }),
    ambientObjectView("abandoned_ship_object", {
      name: "Abandoned Ship",
      placed_by: ["basic_init_01", "basic_init_02"],
    }),
    ambientObjectView("asteroid_field_object", { name: "Asteroid Field" }),
  ].map((v) => [v.key, v]),
);

describe("the Add ambient object browser's list", () => {
  it("lists what an initializer places first, then every other object, each group by name", () => {
    const entries = ambientObjectEntries(views);
    expect(entries.map((v) => [ambientObjectGroup(v), v.name])).toEqual([
      [PLACED_IN_SYSTEMS, "Abandoned Ship"],
      [PLACED_IN_SYSTEMS, "Derelict Ship"],
      [OTHER_OBJECTS, "Asteroid Field"],
      [OTHER_OBJECTS, "Ion Storm"],
    ]);
  });

  it("searches names and keys, whatever their case", () => {
    const entries = ambientObjectEntries(views);
    const found = (query: string) => matchingAmbientObjects(entries, query).map((v) => v.key);
    expect(found("SHIP")).toEqual(["abandoned_ship_object", "derelict_ship_object"]);
    expect(found("storm_obj")).toEqual(["storm_object"]);
    expect(found("  ")).toHaveLength(4);
    expect(found("gateway")).toEqual([]);
  });
});
