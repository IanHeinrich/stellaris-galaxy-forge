import { describe, expect, it } from "vitest";

import { planetSummary } from "../test/builders";
import { takesMoons } from "./addBody";

const plain = { star: false, asteroid: false };

describe("takesMoons", () => {
  it("takes moons on a planet of the primary or of a companion star", () => {
    const companion = planetSummary({ id: 2, role: "star", parent: 1 });
    expect(takesMoons(planetSummary({ id: 3 }), undefined, plain)).toBe(true);
    expect(takesMoons(planetSummary({ id: 4, parent: 2 }), companion, plain)).toBe(true);
  });

  it("refuses a habitat that orbits a planet without being a moon", () => {
    const planet = planetSummary({ id: 5 });
    const habitat = planetSummary({ id: 6, class: "pc_habitat", parent: 5 });
    expect(takesMoons(habitat, planet, plain)).toBe(false);
  });

  it("refuses moons, stars and asteroids", () => {
    expect(takesMoons(planetSummary({ moon: true, parent: 5 }), undefined, plain)).toBe(false);
    expect(takesMoons(planetSummary(), undefined, { star: true, asteroid: false })).toBe(false);
    expect(takesMoons(planetSummary(), undefined, { star: false, asteroid: true })).toBe(false);
  });
});
