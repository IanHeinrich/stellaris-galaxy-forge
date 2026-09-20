import { describe, expect, it } from "vitest";
import type { KindCount } from "../generated/KindCount";
import { kindLabel, kindOrder, kindTitle, KIND_ORDER } from "./special";

/** The counts a document answers with: one per kind, in `sgf-gamedata`'s `KIND_ORDER`. */
const COUNTS: KindCount[] = [
  { kind: "leviathan", count: 3, primary_count: 3 },
  { kind: "enclave", count: 2, primary_count: 2 },
  { kind: "marauder", count: 1, primary_count: 1 },
  { kind: "fallen_empire", count: 1, primary_count: 0 },
  { kind: "landmark", count: 4, primary_count: 4 },
  { kind: "unique", count: 9, primary_count: 7 },
];

describe("the order of the special kinds", () => {
  it("is the one the backend sends its counts in", () => {
    expect(kindOrder(COUNTS)).toEqual(KIND_ORDER);
  });

  it("stands in for a document that has answered with none", () => {
    expect(kindOrder([])).toEqual(KIND_ORDER);
  });

  it("names every kind the backend counts", () => {
    expect(KIND_ORDER.map(kindLabel)).toEqual([
      "Leviathan",
      "Enclave",
      "Marauder",
      "Fallen empire",
      "Landmark",
      "Unique",
    ]);
    expect(kindTitle("marauder")).toBe(
      "Marauder: A marauder clan lives here, raiding its neighbours and hiring out as mercenaries.",
    );
  });
});
