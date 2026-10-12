import { describe, expect, it } from "vitest";
import { megastructureSummary, megastructureTypeView } from "../../test/builders";
import {
  MEGASTRUCTURE_FIXED,
  MEGASTRUCTURE_REFUSALS,
  megastructureMove,
  moveMegastructureOp,
  targetRefusal,
} from "./megastructureMoves";

const gateway = megastructureTypeView("gateway_final", {
  bypass_type: "gateway",
  placement: { place: "free", outside_gravity_well: true },
});
const seal = megastructureTypeView("shroud_seal", {
  placement: { place: "free", outside_gravity_well: false },
});
const nexus = megastructureTypeView("think_tank_3");
const sphere = megastructureTypeView("dyson_sphere_5", {
  placement: { place: "body", star_only: true },
});

describe("how a megastructure moves", () => {
  it("moves a gateway or the Shroud Seal to any point", () => {
    const row = megastructureSummary({ kind: "gateway_final", at: [0, 210] });
    expect(megastructureMove(row, gateway)).toEqual({ place: "free" });
    expect(megastructureMove(row, seal)).toEqual({ place: "free" });
  });

  it("moves a structure tied to a body onto another body, a star-only type only onto a star", () => {
    const tied = megastructureSummary({ kind: "think_tank_3", planet: 5 });
    expect(megastructureMove(tied, nexus)).toEqual({ place: "body", on: 5, starOnly: false });
    const onStar = megastructureSummary({ kind: "dyson_sphere_5", planet: 1 });
    expect(megastructureMove(onStar, sphere)).toEqual({
      place: "body",
      on: 1,
      starOnly: true,
    });
  });

  it("moves a tied row by its own shape without game data", () => {
    const tied = megastructureSummary({ kind: "think_tank_3", planet: 5 });
    expect(megastructureMove(tied, undefined)).toEqual({
      place: "body",
      on: 5,
      starOnly: false,
    });
    const free = megastructureSummary({ kind: "gateway_ruined", at: [10, 0] });
    expect(megastructureMove(free, undefined)).toEqual({ place: "free" });
  });

  it("keeps the L-Gate, a ring world section, a starbase's structure and one at the centre", () => {
    const fixed = (why: string) => ({ place: "fixed", why });
    const lgate = megastructureSummary({ kind: "lgate_base", at: [21, 21] });
    expect(megastructureMove(lgate, undefined)).toEqual(fixed(MEGASTRUCTURE_FIXED.bypass));
    const lgateType = megastructureTypeView("lgate_base", { bypass_type: "lgate" });
    expect(megastructureMove(lgate, lgateType)).toEqual(fixed(MEGASTRUCTURE_FIXED.bypass));
    const ring = megastructureSummary({ kind: "ring_world_ruined", at: [45, 0] });
    expect(megastructureMove(ring, undefined)).toEqual(fixed(MEGASTRUCTURE_FIXED.ringWorld));
    const citadel = megastructureTypeView("deep_space_citadel_0", {
      placement: { place: "unsupported", why: { kind: "becomes_starbase" } },
    });
    const station = megastructureSummary({ kind: "deep_space_citadel_0", planet: 4 });
    expect(megastructureMove(station, citadel)).toEqual(fixed(MEGASTRUCTURE_FIXED.starbase));
    const ruin = megastructureSummary({ kind: "dyson_sphere_5", at: [0, 0] });
    expect(megastructureMove(ruin, sphere)).toEqual(fixed(MEGASTRUCTURE_FIXED.centre));
  });
});

describe("which bodies take a dragged megastructure", () => {
  const rows = [
    megastructureSummary({ id: 41, kind: "think_tank_3", planet: 5 }),
    megastructureSummary({ id: 43, kind: "orbital_ring_ruined", planet: 2 }),
  ];
  const tied = { place: "body", on: 5, starOnly: false } as const;
  const starOnly = { ...tied, starOnly: true } as const;
  const body = (id: number, star = false) => ({ id, star, name: `P${id}` });

  it("takes a free planet or star", () => {
    expect(targetRefusal(tied, 41, "Science Nexus", body(7), rows)).toBeNull();
    expect(targetRefusal(tied, 41, "Science Nexus", body(1, true), rows)).toBeNull();
  });

  it("refuses a body that has a megastructure", () => {
    expect(targetRefusal(tied, 41, "Science Nexus", body(2), rows)).toBe(
      MEGASTRUCTURE_REFUSALS.taken("P2"),
    );
  });

  it("refuses a planet for a type built only around a star", () => {
    expect(targetRefusal(starOnly, 41, "Dyson Sphere", body(7), rows)).toBe(
      MEGASTRUCTURE_REFUSALS.starOnly("Dyson Sphere"),
    );
    expect(targetRefusal(starOnly, 41, "Dyson Sphere", body(1, true), rows)).toBeNull();
  });
});

describe("the op a move makes", () => {
  it("names the place, and makes nothing where the row stands already", () => {
    const free = megastructureSummary({ id: 40, kind: "gateway_final", at: [0, 210] });
    const to = { place: "free", x: 50, y: 60 } as const;
    expect(moveMegastructureOp(free, to)).toEqual({
      type: "MoveMegastructure",
      megastructure: 40,
      at: to,
    });
    expect(moveMegastructureOp(free, { place: "free", x: 0, y: 210.000001 })).toBeNull();
    const tied = megastructureSummary({ id: 41, kind: "think_tank_3", planet: 5 });
    expect(moveMegastructureOp(tied, { place: "body", body: 5 })).toBeNull();
  });
});
