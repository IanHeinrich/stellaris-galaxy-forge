import { describe, expect, it } from "vitest";
import { megastructureFits, megastructureTypeView } from "../test/builders";
import {
  hostMoonsChoice,
  hostMoonsOf,
  hostMoonsSent,
  keepMoonsText,
  removeMoonsText,
} from "./hostMoonsAdd";

const shipyard = megastructureTypeView("giga_equatorial_shipyard_3", { removes_host_moons: true });
const nexus = megastructureTypeView("think_tank_3");
const three = { kind: "removable", count: 3 } as const;
const refused = { kind: "refused", reason: "a moon holds a colony" } as const;

describe("the moons choice of the Add megastructure dialog", () => {
  it("counts the moons it removes, and names one moon as one", () => {
    expect(removeMoonsText(3)).toBe("Remove its 3 moons, as the game does");
    expect(removeMoonsText(1)).toBe("Remove its moon, as the game does");
    expect(removeMoonsText(null)).toBe("Remove its moons, as the game does");
    expect(keepMoonsText(3)).toBe("Keep its moons");
    expect(keepMoonsText(1)).toBe("Keep its moon");
  });

  it("is offered only for a type that removes the moons of a body that has some", () => {
    expect(hostMoonsChoice(shipyard, three)).toEqual(three);
    expect(hostMoonsChoice(shipyard, refused)).toEqual(refused);
    expect(hostMoonsChoice(shipyard, { kind: "kept" })).toBeNull();
    expect(hostMoonsChoice(nexus, three)).toBeNull();
    expect(hostMoonsChoice(undefined, three)).toBeNull();
  });

  it("removes the moons unless kept for that type or refused", () => {
    const kind = shipyard.key;
    expect(hostMoonsSent(three, null, kind)).toBe("remove");
    expect(hostMoonsSent(three, kind, kind)).toBe("keep");
    expect(hostMoonsSent(three, "think_tank_3", kind)).toBe("remove");
    expect(hostMoonsSent(refused, null, kind)).toBe("keep");
  });

  it("reads the moons of the type a stage writes from the fits", () => {
    const fits = megastructureFits(["giga_equatorial_shipyard_3"], {
      giga_equatorial_shipyard_3: { variant: "giga_shipyard_variant", host_moons: three },
    });
    expect(hostMoonsOf(fits, "giga_shipyard_variant")).toEqual(three);
    expect(hostMoonsOf(fits, "giga_equatorial_shipyard_3")).toEqual({ kind: "kept" });
    expect(hostMoonsOf(null, "giga_shipyard_variant")).toEqual({ kind: "kept" });
  });
});
