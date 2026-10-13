import { describe, expect, it } from "vitest";
import { planetSummary } from "../../test/builders";
import {
  copiesValue,
  innerRadiusValue,
  planetsSummaryValue,
  ringValue,
  rowLabel,
} from "./scenarioValues";

const FACTS = { names: new Map<string, string>(), planetClasses: new Map() };

describe("scenario values", () => {
  it("rolls a range whose bounds differ and states one whose bounds meet", () => {
    expect(copiesValue({ min: 2, max: 4 })).toEqual({ state: "rolled", text: "2 to 4" });
    expect(copiesValue({ min: 3, max: 3 })).toEqual({ state: "fixed", text: "×3" });
    expect(innerRadiusValue({ min: 40.123, max: 40.123 }, 5)).toEqual({
      state: "unknown",
      text: "40.12",
    });
  });

  it("says nothing beside the Planets title for a count the file states", () => {
    const planets = { min: 4, max: 4 };
    expect(planetsSummaryValue({ planets, moons: null, asteroids: null })).toBeNull();
    expect(planetsSummaryValue({ planets: null, moons: null, asteroids: null })?.state).toBe(
      "unknown",
    );
  });

  it("reads a ring from the block first, else from the summary", () => {
    expect(ringValue({ state: "rolled", chance: null }, true).state).toBe("rolled");
    expect(ringValue(undefined, null).state).toBe("rolled");
    expect(ringValue(undefined, false)).toEqual({ state: "fixed", text: "No" });
  });

  it("heads a row with the name the game gives, rolled where its numeral can change", () => {
    const planet = planetSummary({ id: 7 });
    const given = { text: "Sol II", all: ["Sol II", "Sol III"], rolled: true };
    const label = rowLabel(planet, given, null, undefined, FACTS);
    expect(label.title).toEqual({ state: "rolled", text: "Sol II to III" });
    expect(label.described).toBe(false);
  });
});
