import { describe, expect, it } from "vitest";
import type { PlanetMoveWarning } from "../generated/PlanetMoveWarning";
import { lanesTo } from "../test/builders";
import {
  alreadyThere,
  andMore,
  cutHint,
  cutCountLabel,
  cutLabel,
  jumpsFrom,
  jumpsText,
  movingLabel,
  nearestFirst,
  pasteLabel,
  placementAt,
  refusalLine,
  selectedHint,
  selectionLine,
  warningLine,
  warningLines,
  warningText,
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
const colony: PlanetMoveWarning = { planet: 1, kind: "colony", owner: 7, new_owner: 9 };
const station: PlanetMoveWarning = { planet: 2, kind: "station", owner: 7, new_owner: 9 };
const research: PlanetMoveWarning = { planet: 3, kind: "station", owner: 7, new_owner: 9 };

describe("labels", () => {
  it("names the cut by its count", () => {
    expect(cutLabel(3)).toBe("Cut 3 planets");
    expect(cutLabel(1)).toBe("Cut 1 planet");
  });

  it("says what is moving and from where", () => {
    expect(movingLabel(THREE, "Meissa")).toBe("Moving 3 planets from Meissa");
    expect(movingLabel([MEISSA_II], "Meissa")).toBe("Moving Meissa II from Meissa");
    expect(movingLabel([URAY_IIIA], "Uray")).toBe("Moving Uray IIIa from Uray as a planet");
  });

  it("gives a lone planet's orbit and angle, and a group none", () => {
    expect(pasteLabel(THREE)).toBe("Paste 3 planets here");
    expect(pasteLabel(THREE, AT)).toBe("Paste 3 planets here");
    expect(pasteLabel([MEISSA_II], AT)).toBe("Paste Meissa II here (orbit 108 · 20°)");
    expect(pasteLabel([URAY_IIIA], AT)).toBe("Paste Uray IIIa here as a planet (orbit 108 · 20°)");
    expect(pasteLabel([MEISSA_II])).toBe("Paste Meissa II here");
  });

  it("says a paste into the planets' own system has nowhere to go", () => {
    expect(alreadyThere(THREE, "Meissa")).toBe("These planets are already in Meissa");
    expect(alreadyThere([MEISSA_II], "Meissa")).toBe("Meissa II is already in Meissa");
  });

  it("says in the status bar what is selected and what is cut", () => {
    expect(selectedHint(3, "Esc")).toBe(
      "3 planets selected · Ctrl or Shift-click to add planets · Esc clears",
    );
    expect(cutCountLabel(3)).toBe("3 planets cut");
  });

  it("places a clicked point on a whole orbit and angle", () => {
    expect(placementAt(0, 108.4)).toEqual({ radius: 108, angle: 90 });
    expect(placementAt(10, -0.0001)).toEqual({ radius: 10, angle: 0 });
  });
});

describe("warnings and refusals", () => {
  it("words a colony and a station passing to another empire", () => {
    expect(warningText(colony, NAMES)).toBe(
      "Kortol's Station will pass to Hissman Consciousness about a month after you load",
    );
    expect(warningText(station, NAMES)).toBe(
      "Meissa II's station will pass to Hissman Consciousness",
    );
  });

  it("shows the first warning with the count, and lists them all", () => {
    const all = [colony, station, research];
    expect(warningLine(all, NAMES)).toBe(
      "Kortol's Station will pass to Hissman Consciousness about a month after you load (and 2 more)",
    );
    expect(warningLines(all, NAMES)).toHaveLength(3);
    expect(warningLine([], NAMES)).toBeNull();
  });

  it("names the first refusal and counts the rest", () => {
    expect(refusalLine([])).toBeNull();
    expect(
      refusalLine([
        { planet: 1, reason: "Meissa III has an arc furnace" },
        { planet: 2, reason: "Kortol's Station is occupied" },
      ]),
    ).toBe("Meissa III has an arc furnace (and 1 more)");
    expect(andMore("One", 1)).toBe("One");
  });
});

describe("the selection summary", () => {
  it("counts the planets, the moons that come along and the planet a lone moon leaves", () => {
    expect(selectionLine(3, 2, [])).toBe("3 planets · 2 moons come along");
    expect(selectionLine(1, 1, [])).toBe("1 planet · 1 moon comes along");
    expect(selectionLine(2, 0, [{ moon: "Uray IIIa", planet: "Uray III" }])).toBe(
      "2 planets · Uray IIIa leaves Uray III",
    );
    expect(cutHint(false)).toBe("Also in the right-click menu on the map.");
    expect(cutHint(true)).toBe("Cut. Right-click a system to paste them there.");
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
