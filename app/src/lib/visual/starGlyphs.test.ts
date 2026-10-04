import { describe, expect, it } from "vitest";
import type { StarClassView } from "../../generated/StarClassView";
import { drawnStarClass, starTextureKey } from "./starGlyphs";

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

describe("drawnStarClass", () => {
  it("keeps the class the system is given", () => {
    expect(drawnStarClass({ star_class: "sc_black_hole" })).toBe("sc_black_hole");
  });

  it("draws a system given none, whose star the game picks, as a yellow star", () => {
    expect(drawnStarClass({ star_class: "" })).toBe("sc_g");
  });
});
