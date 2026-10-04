import { describe, expect, it } from "vitest";
import { lanesTo } from "../test/builders";
import {
  andMore,
  cutCountLabel,
  cutLabel,
  jumpsFrom,
  jumpsText,
  movingLabel,
  nearestFirst,
  pasteLabel,
  placementAt,
  refusalLine,
  selectionLine,
  warningLine,
} from "./planetMove";

const MEISSA_II = { name: "Meissa II", moon: false };
const KORTOL = { name: "Kortol's Station", moon: false };
const MEISSA_IV = { name: "Meissa IV", moon: false };
const URAY_IIIA = { name: "Uray IIIa", moon: true };
const THREE = [MEISSA_II, KORTOL, MEISSA_IV];
const AT = { radius: 108, angle: 20 };

const NAMES = {
  planet: (id: number) => ({ 1: "Kortol's Station", 2: "Meissa II", 3: "Meissa IV" })[id] ?? "?",
  country: () => "Hissman Consciousness",
};

describe("labels", () => {
  it("names the cut by its count", () => {
    expect(cutLabel([MEISSA_II])).toBe("Cut Meissa II");
    expect(cutLabel([URAY_IIIA])).toBe("Cut Uray IIIa");
  });

  it("says how many are moving and from where", () => {
    expect(movingLabel(THREE, "Meissa")).toBe("Moving 3 planets from Meissa");
  });

  it("gives a lone planet's orbit and angle, and a group none", () => {
    expect(pasteLabel(THREE)).toBe("Paste 3 planets here");
    expect(pasteLabel(THREE, AT)).toBe("Paste 3 planets here");
    expect(pasteLabel([MEISSA_II], AT)).toBe("Paste Meissa II here (orbit 108 · 20°)");
    expect(pasteLabel([URAY_IIIA], AT)).toBe("Paste Uray IIIa here as a planet (orbit 108 · 20°)");
    expect(pasteLabel([MEISSA_II])).toBe("Paste Meissa II here");
  });

  it("says in the status bar how many planets are cut", () => {
    expect(cutCountLabel(3)).toBe("3 planets cut");
  });

  it("places a clicked point on a whole orbit and angle", () => {
    expect(placementAt(0, 108.4)).toEqual({ radius: 108, angle: 90 });
    expect(placementAt(10, -0.0001)).toEqual({ radius: 10, angle: 0 });
  });
});

describe("warnings and refusals", () => {
  it("has no line for no warnings or no refusals, and no count for a lone one", () => {
    expect(warningLine([], NAMES)).toBeNull();
    expect(refusalLine([])).toBeNull();
    expect(andMore("One", 1)).toBe("One");
  });
});

describe("the selection summary", () => {
  it("counts the planets, the moons that come along and the planet a lone moon leaves", () => {
    expect(selectionLine(1, 1, [])).toBe("1 planet · 1 moon comes along");
    expect(selectionLine(2, 0, [{ moon: "Uray IIIa", planet: "Uray III" }])).toBe(
      "2 planets · Uray IIIa leaves Uray III",
    );
  });
});

describe("the nearest systems", () => {
  // A chain 0-1-2 with a branch 1-3, and 4 that no lane reaches.
  const systems = new Map([
    [0, { lanes: lanesTo(1) }],
    [1, { lanes: lanesTo(0, 2, 3) }],
    [2, { lanes: lanesTo(1) }],
    [3, { lanes: lanesTo(1) }],
    [4, { lanes: lanesTo() }],
  ]);

  it("counts the jumps to every system the lanes reach", () => {
    expect([...jumpsFrom(systems, 0)]).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 2],
    ]);
    expect(jumpsText(1)).toBe("1 jump");
    expect(jumpsText(2)).toBe("2 jumps");
  });

  it("puts the fewest jumps first, then the nearer, and a system no lane reaches last", () => {
    const distance = (id: number) => ({ 1: 5, 2: 30, 3: 20, 4: 1 })[id] ?? 0;
    expect(nearestFirst([4, 2, 3, 1], jumpsFrom(systems, 0), distance)).toEqual([1, 3, 2, 4]);
  });
});
