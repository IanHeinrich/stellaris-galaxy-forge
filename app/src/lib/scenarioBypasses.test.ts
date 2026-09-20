import { describe, expect, it } from "vitest";
import type { ScenarioBypass } from "../generated/ScenarioBypass";
import type { ScenarioBypasses } from "../generated/ScenarioBypasses";
import { bypassLinks, randomBypassLine } from "./scenarioBypasses";

function bypassesOf(bypasses: ScenarioBypass[]): ScenarioBypasses {
  return {
    bypasses,
    open_endpoints: 0,
    random_wormhole_pairs: 0,
    random_gateways: 0,
    with_game_data: true,
  };
}

describe("bypassLinks", () => {
  it("pairs a wormhole once, lower id first, when both ends share a source", () => {
    const bypasses = bypassesOf([
      {
        system: 2,
        kind: { type: "wormhole" },
        partner: 1,
        source: { type: "initializer", key: "a" },
        assumed: false,
      },
      {
        system: 1,
        kind: { type: "wormhole" },
        partner: 2,
        source: { type: "initializer", key: "b" },
        assumed: false,
      },
    ]);

    expect(bypassLinks(bypasses, true, true)).toEqual([{ type: "wormhole", a: 1, b: 2 }]);
  });

  it("draws a cross-source pair only when both toggles are on", () => {
    const bypasses = bypassesOf([
      {
        system: 1,
        kind: { type: "wormhole" },
        partner: 2,
        source: { type: "initializer", key: "a" },
        assumed: false,
      },
      {
        system: 2,
        kind: { type: "wormhole" },
        partner: 1,
        source: { type: "day_one", event: "fixture.1" },
        assumed: false,
      },
    ]);

    expect(bypassLinks(bypasses, true, true)).toEqual([{ type: "wormhole", a: 1, b: 2 }]);
  });

  it("draws the shown end of a cross-source pair alone when the other end's toggle is off", () => {
    const bypasses = bypassesOf([
      {
        system: 1,
        kind: { type: "wormhole" },
        partner: 2,
        source: { type: "initializer", key: "a" },
        assumed: false,
      },
      {
        system: 2,
        kind: { type: "wormhole" },
        partner: 1,
        source: { type: "day_one", event: "fixture.1" },
        assumed: false,
      },
    ]);

    expect(bypassLinks(bypasses, true, false)).toEqual([
      { type: "other", system: 1, kind: "wormhole" },
    ]);
    expect(bypassLinks(bypasses, false, true)).toEqual([
      { type: "other", system: 2, kind: "wormhole" },
    ]);
  });

  it("shows only the endpoint whose toggle is on when one system carries both sources", () => {
    const bypasses = bypassesOf([
      {
        system: 1,
        kind: { type: "gateway", ruined: false },
        partner: null,
        source: { type: "initializer", key: "a" },
        assumed: false,
      },
      {
        system: 1,
        kind: { type: "wormhole" },
        partner: 2,
        source: { type: "day_one", event: "fixture.1" },
        assumed: false,
      },
      {
        system: 2,
        kind: { type: "wormhole" },
        partner: 1,
        source: { type: "day_one", event: "fixture.1" },
        assumed: false,
      },
    ]);

    expect(bypassLinks(bypasses, true, false)).toEqual([
      { type: "gateway", system: 1, active: true },
    ]);
    expect(bypassLinks(bypasses, false, true)).toEqual([{ type: "wormhole", a: 1, b: 2 }]);
  });
});

describe("randomBypassLine", () => {
  it("names the random pairs and gateways, then the mouths whose far end is unknown", () => {
    const base = { bypasses: [], with_game_data: true };
    expect(randomBypassLine(null)).toBeNull();
    expect(
      randomBypassLine({
        ...base,
        random_wormhole_pairs: 0,
        random_gateways: 0,
        open_endpoints: 0,
      }),
    ).toBeNull();
    expect(
      randomBypassLine({
        ...base,
        random_wormhole_pairs: 2,
        random_gateways: 1,
        open_endpoints: 0,
      }),
    ).toBe("2 wormhole pairs and 1 gateway placed at random on day one");
    expect(
      randomBypassLine({
        ...base,
        random_wormhole_pairs: 0,
        random_gateways: 0,
        open_endpoints: 1,
      }),
    ).toBe("1 wormhole mouth whose far end the game picks");
  });
});
