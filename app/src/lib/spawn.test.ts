import { describe, expect, it } from "vitest";
import { node } from "../store/fixture";
import { isSpawnPoint } from "./spawn";

/** A system with an initializer, so a weight can stand beside it. */
const weighable = (id: number) => node(id, `NAME_${id}`, id, 0, "sc_g");

describe("isSpawnPoint", () => {
  it("counts a zero base with a modifier that adds weight, as a mod writes an empire's start", () => {
    const base = { ...weighable(1), spawn_weight: 0, spawn_modifiers: [] };
    expect(isSpawnPoint(base)).toBe(false);
    const added = {
      ...base,
      spawn_modifiers: [
        { factor: null, add: 10000, trigger: "has_country_flag = x", reservation: null },
      ],
    };
    expect(isSpawnPoint(added)).toBe(true);
    const scaled = {
      ...base,
      spawn_modifiers: [{ factor: 2, add: null, trigger: "is_ai = yes", reservation: null }],
    };
    expect(isSpawnPoint(scaled)).toBe(false);
  });

  it("counts a base the generator draws on, and no weight at all as none", () => {
    expect(isSpawnPoint({ ...weighable(1), spawn_weight: 10 })).toBe(true);
    expect(isSpawnPoint(weighable(1))).toBe(false);
  });
});
