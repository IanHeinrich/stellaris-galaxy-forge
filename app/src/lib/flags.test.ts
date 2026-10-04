import { describe, expect, it } from "vitest";
import type { FlagParts } from "../generated/FlagParts";
import { countryNode } from "../store/fixture";
import { empireFlag, flagMods, paletteLines, sameFlag } from "./flags";

const PARTS: FlagParts = {
  emblems: [{ name: "extra_shapes", files: [{ file: "star.dds", source: "More Flags" }] }],
  backgrounds: [
    { file: "flag_bg_plain.dds", source: "More Flags" },
    { file: "flag_bg_stripes.dds", source: "Other Flags" },
  ],
};

const FLAGGED = {
  ...countryNode(),
  colors: ["red", "blue"],
  flag_icon: { category: "extra_shapes", file: "star.dds" },
  flag_background: { category: "backgrounds", file: "flag_bg_plain.dds" },
};

describe("flag helpers the empire page does not reach", () => {
  it("asks for game data while the palette is empty", () => {
    expect(paletteLines(new Map(), null)).toEqual([
      "Load game data to pick from the game's palette.",
    ]);
  });

  it("reads no flag from a country with fewer than two colours", () => {
    expect(empireFlag(FLAGGED)).not.toBeNull();
    expect(empireFlag({ ...FLAGGED, colors: ["red"] })).toBeNull();
  });

  it("differs from another flag in any one part", () => {
    const flag = empireFlag(FLAGGED)!;
    expect(sameFlag(flag, { ...flag })).toBe(true);
    for (const change of [
      { icon_category: "pointy" },
      { icon_file: "other.dds" },
      { background: "other.dds" },
      { primary: "blue" },
      { secondary: "red" },
    ]) {
      expect(sameFlag(flag, { ...flag, ...change })).toBe(false);
    }
  });

  it("names a mod once when the emblem and the background share it", () => {
    expect(flagMods(empireFlag(FLAGGED)!, PARTS)).toEqual(["More Flags"]);
    const striped = {
      ...FLAGGED,
      flag_background: { category: "backgrounds", file: "flag_bg_stripes.dds" },
    };
    expect(flagMods(empireFlag(striped)!, PARTS)).toEqual(["More Flags", "Other Flags"]);
  });
});
