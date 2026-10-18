import { describe, expect, it } from "vitest";
import type { StarClassView } from "../../generated/StarClassView";
import { starClassView } from "../../test/builders";
import { drawnStarClass, starGlyph, starTextureKey } from "./starGlyphs";

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

describe("starGlyph", () => {
  const classes = new Map(
    [
      starClassView("sc_pair", "pc_m_star", "pc_g_star"),
      starClassView("sc_binary_odd", "pc_b_star"),
      starClassView("sc_trinary_1", "pc_g_star", "pc_m_star", "pc_k_star"),
      { ...starClassView("sc_shell", "pc_g_star", "pc_m_star"), alternatives: true },
      starClassView("sc_g", "pc_g_star"),
    ].map((c) => [c.key, c]),
  );
  const multi = starGlyph("sc_trinary_1", classes);

  it("draws a class of several stars by the count the install gives it, whatever its key", () => {
    expect(starGlyph("sc_pair", classes)).toBe(multi);
    expect(starGlyph("sc_binary_odd", classes)).not.toBe(multi);
    expect(starGlyph("sc_shell", classes)).not.toBe(multi);
    expect(starGlyph("sc_g", classes)).toBe(starGlyph("sc_g", new Map()));
  });

  it("keeps a binary the install does not list from taking the B star's colour", () => {
    expect(starGlyph("sc_binary_3", new Map())).toBe(multi);
    expect(starGlyph("sc_b", new Map())).not.toBe(multi);
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
