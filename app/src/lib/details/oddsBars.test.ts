import { describe, expect, it } from "vitest";
import { readableTint } from "../visual/color";
import { NEUTRAL_RAMP } from "../visual/resourceColors";
import { starGlyph } from "../visual/starGlyphs";
import { oddsRows, starListName } from "./oddsBars";

describe("odds bars", () => {
  it("drop a star class name's leading English Class, and leave other names as they are", () => {
    expect(starListName("Class G Star")).toBe("G Star");
    expect(starListName("class M Red Giant")).toBe("M Red Giant");
    expect(starListName("Black Hole")).toBe("Black Hole");
    expect(starListName("Classic Star")).toBe("Classic Star");
    expect(starListName("Étoile de classe G")).toBe("Étoile de classe G");
  });

  it("scale each row to the likeliest, and fall back to a neutral tone for a colour too dark or unknown", () => {
    const rows = oddsRows(
      [
        { key: "sc_g", share: 0.6 },
        { key: "sc_black_hole", share: 0.3 },
        { key: "sc_weird", share: 0.1 },
      ],
      (key) => readableTint(starGlyph(key).tint),
    );
    expect(rows.map((r) => [r.key, r.width.toFixed(3), r.color])).toEqual([
      ["sc_g", "1.000", "#ffe066"],
      ["sc_black_hole", "0.500", NEUTRAL_RAMP[1]],
      ["sc_weird", "0.167", "#9aa3ad"],
    ]);
  });
});
