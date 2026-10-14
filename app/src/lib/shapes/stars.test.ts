import { describe, expect, it } from "vitest";
import { rollStars, starWeights, type StarClassOdds } from "./stars";

const CLASSES: StarClassOdds[] = [
  { key: "sc_g", odds: 10, randomOdds: 10 },
  { key: "sc_m", odds: 20, randomOdds: 20 },
  { key: "sc_neutron", odds: 2, randomOdds: 1 },
  { key: "sc_black_hole", odds: 3, randomOdds: 0 },
];

describe("a rolled shape's star classes", () => {
  it("draws the same classes from the same seed, and keeps them as the shape grows", () => {
    const weights = starWeights({ kind: "random" }, CLASSES);
    const small = rollStars(20, 7, weights);
    expect(rollStars(20, 7, weights)).toEqual(small);
    expect(rollStars(60, 7, weights).slice(0, 20)).toEqual(small);
    expect(rollStars(20, 8, weights)).not.toEqual(small);
  });

  it("gives every point the one class chosen", () => {
    const weights = starWeights({ kind: "one", class: "sc_black_hole" }, CLASSES);
    expect(new Set(rollStars(50, 3, weights))).toEqual(new Set(["sc_black_hole"]));
  });

  it("draws a mix only from its ticked classes", () => {
    const mix = { kind: "mix", classes: ["sc_neutron", "sc_black_hole"] } as const;
    const drawn = new Set(
      rollStars(200, 3, starWeights({ ...mix, classes: [...mix.classes] }, CLASSES)),
    );
    expect(drawn).toEqual(new Set(["sc_neutron", "sc_black_hole"]));
  });

  it("gives no weight to a class the install lacks, as one remembered from another install", () => {
    expect(starWeights({ kind: "one", class: "sc_gone" }, CLASSES)).toEqual([]);
    expect(starWeights({ kind: "mix", classes: ["sc_gone", "sc_m"] }, CLASSES)).toEqual([
      ["sc_m", 20],
    ]);
  });

  it("never draws at random a class only special layouts make", () => {
    const drawn = rollStars(2000, 11, starWeights({ kind: "random" }, CLASSES));
    expect(drawn).not.toContain("sc_black_hole");
    expect(new Set(drawn)).toEqual(new Set(["sc_g", "sc_m", "sc_neutron"]));
  });
});
