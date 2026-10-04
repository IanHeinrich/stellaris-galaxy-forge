import { describe, expect, it } from "vitest";
import type { MapColor } from "../../generated/MapColor";
import { countryNode } from "../../test/builders";
import { ownerColors } from "./ownerColors";

/** Swatches as the 4.5 install's `flags/colors.txt` writes them, flag and map rgb apart. */
const SWATCHES: MapColor[] = [
  { name: "black", flag: "#1b1b1b", map: "#1b1b1b", ship: "#f3f3f3" },
  { name: "red_orange", flag: "#d74a41", map: "#e04040", ship: "#ff3924" },
  { name: "orange", flag: "#d76423", map: "#ed7619", ship: "#ff8518" },
  { name: "turquoise", flag: "#3d9993", map: "#3d9993", ship: "#00fffd" },
  { name: "dark_brown", flag: "#3a2617", map: "#6b4428", ship: "#ffe488" },
  { name: "burgundy", flag: "#591227", map: "#591227", ship: "#e82882" },
  { name: "purple", flag: "#64369e", map: "#6d1896", ship: "#c751fc" },
  { name: "intense_red", flag: "#f1250f", map: "#f1250f", ship: "#ff3924" },
  { name: "light_pink", flag: "#d03195", map: "#de40a3", ship: "#e82882" },
];
const PALETTE = new Map(SWATCHES.map((s) => [s.name, s]));

function painted(colors: string[]) {
  return ownerColors(
    countryNode({ colors, painted_border: colors[0], painted_fill: colors[1] }),
    0,
    PALETTE,
  );
}

describe("ownerColors", () => {
  it("fills with the secondary or tertiary colour whose map rgb is further from the border's", () => {
    expect(painted(["black", "red_orange", "orange", "black", "black", "red_orange"])).toEqual({
      outline: 0x1b1b1b,
      fill: 0xed7619,
    });
    expect(painted(["turquoise", "dark_brown", "black", "turquoise"]).fill).toBe(0x1b1b1b);
    expect(painted(["burgundy", "purple", "black", "burgundy"]).fill).toBe(0x6d1896);
  });

  it("fills with the only other colour when the tertiary is missing", () => {
    expect(painted(["red_orange", "black"]).fill).toBe(0x1b1b1b);
  });

  it("fills with the chosen map colour under independent map colours", () => {
    const country = countryNode({
      colors: ["burgundy", "purple", "black", "burgundy", "intense_red", "light_pink"],
      border_color: "intense_red",
      fill_color: "light_pink",
      use_map_color: true,
      painted_border: "intense_red",
      painted_fill: "light_pink",
    });
    expect(ownerColors(country, 0, PALETTE)).toEqual({ outline: 0xf1250f, fill: 0xde40a3 });
  });
});
