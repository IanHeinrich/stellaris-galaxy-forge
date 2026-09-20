import { describe, expect, it } from "vitest";
import { planetTint } from "./icons";

describe("planetTint", () => {
  it("colours a random habitable class like a habitable world and leaves the rest neutral", () => {
    expect(planetTint("random_colonizable")).toBe(planetTint("pc_gaia"));
    expect(planetTint("random_ruler")).toBe(planetTint("pc_gaia"));
    expect(planetTint("ideal_planet_class")).toBe(planetTint("pc_gaia"));
    expect(planetTint("random_non_colonizable")).toBe(planetTint("pc_barren"));
    expect(planetTint("random")).toBe(planetTint("pc_barren"));
  });
});
