import { describe, expect, it } from "vitest";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import { planetClassView } from "../../test/builders";
import {
  CLASS_FIXED,
  CLASSES_NEED_GAME_DATA,
  COLONY_CLASS_FIXED,
  classFieldReason,
  classRows,
  setPlanetClassOp,
} from "./planetClass";

const CLASSES = new Map<string, PlanetClassView>(
  [
    planetClassView("pc_continental", false, null, { change: "any", models: 4 }),
    planetClassView("pc_ocean", false, null, { change: "any", models: 3 }),
    planetClassView("pc_barren", false, null, { habitable: false, models: 3 }),
    planetClassView("pc_city", false, null, { models: 1, moonless: true }),
    planetClassView("pc_habitat", false, null, { change: "never" }),
    planetClassView("pc_g_star"),
  ].map((c) => [c.key, c]),
);

const label = (key: string) => key.replace("pc_", "");

describe("the classes a planet may take", () => {
  it("offers an uncolonised planet every class that changes, habitable first", () => {
    expect(classRows("pc_barren", false, false, CLASSES, label)).toEqual([
      { key: "pc_city", label: "city", group: "Habitable" },
      { key: "pc_continental", label: "continental", group: "Habitable" },
      { key: "pc_ocean", label: "ocean", group: "Habitable" },
    ]);
  });

  it("leaves a moon out the classes that cannot be moons", () => {
    expect(classRows("pc_barren", false, true, CLASSES, label).map((r) => r.key)).toEqual([
      "pc_continental",
      "pc_ocean",
    ]);
  });

  it("offers a colony only the classes open to colonies", () => {
    expect(classRows("pc_continental", true, false, CLASSES, label).map((r) => r.key)).toEqual([
      "pc_ocean",
    ]);
  });

  it("offers nothing where the planet keeps its class, and says why", () => {
    expect(classRows("pc_habitat", false, false, CLASSES, label)).toEqual([]);
    expect(classFieldReason("pc_habitat", false, CLASSES)).toBe(CLASS_FIXED);
    expect(classFieldReason("pc_city", true, CLASSES)).toBe(COLONY_CLASS_FIXED);
    expect(classFieldReason("pc_barren", false, new Map())).toBe(CLASSES_NEED_GAME_DATA);
    expect(classFieldReason("pc_barren", false, CLASSES)).toBeNull();
  });

  it("sends both classes' rules, and nothing for the class it has", () => {
    expect(setPlanetClassOp(585, "pc_barren", "pc_ocean", CLASSES)).toEqual({
      type: "SetPlanetClass",
      planet: 585,
      from: { class: "pc_barren", change: "uncolonised", models: 3 },
      to: { class: "pc_ocean", change: "any", models: 3 },
    });
    expect(setPlanetClassOp(585, "pc_barren", "pc_barren", CLASSES)).toBeNull();
    expect(setPlanetClassOp(585, "pc_barren", "pc_unknown", CLASSES)).toBeNull();
  });
});
