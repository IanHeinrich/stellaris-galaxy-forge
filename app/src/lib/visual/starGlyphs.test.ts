import { describe, expect, it } from "vitest";
import type { StarClassView } from "../../generated/StarClassView";
import { RANDOM_STAR_CLASS, effectiveStarClass, starTextureKey } from "./starGlyphs";

const CLASSES = new Map<string, StarClassView>([
  [
    "sc_black_hole",
    {
      key: "sc_black_hole",
      texture_key: "star_class:black_hole",
      icon_scale: 2,
      planet_keys: ["pc_black_hole"],
      crisis_star_class: null,
      spawn_odds: 1,
      localised: true,
    },
  ],
]);

describe("starTextureKey", () => {
  it("resolves a known star class to its texture key and icon scale", () => {
    expect(starTextureKey("sc_black_hole", CLASSES)).toEqual({
      key: "star_class:black_hole",
      scale: 2,
    });
  });
  it("returns null for an unknown star class", () => {
    expect(starTextureKey("sc_g", CLASSES)).toBeNull();
  });
});

describe("effectiveStarClass", () => {
  it("keeps a class the document writes itself", () => {
    expect(effectiveStarClass({ star_class: "sc_m" }, "sc_b", "scenario")).toBe("sc_m");
  });

  it("takes the initializer's class when the system has none", () => {
    expect(effectiveStarClass({ star_class: "" }, "sc_black_hole", "scenario")).toBe(
      "sc_black_hole",
    );
  });

  it("takes the class the core resolved for a random list, and the stand-in for an unknown initializer", () => {
    expect(effectiveStarClass({ star_class: "" }, "sc_g", "scenario")).toBe("sc_g");
    expect(effectiveStarClass({ star_class: "" }, undefined, "scenario")).toBe(RANDOM_STAR_CLASS);
  });

  it("leaves a save's classless system classless", () => {
    expect(effectiveStarClass({ star_class: "" }, undefined, "save")).toBe("");
    expect(effectiveStarClass({ star_class: "" }, "sc_g", "save")).toBe("sc_g");
  });
});
