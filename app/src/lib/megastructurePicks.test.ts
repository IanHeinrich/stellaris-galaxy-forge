import { describe, expect, it } from "vitest";
import type { MegastructureTypeView } from "../generated/MegastructureTypeView";
import { megastructureTypeView } from "../test/builders";
import {
  defaultOwner,
  megastructurePicks,
  megastructurePlace,
  RELAY_RADIUS_FACTOR,
  type MegastructureSpot,
} from "./megastructurePicks";

const onStar = { place: "body", star_only: true } as const;
const onAny = { place: "body", star_only: false } as const;
const outside = { place: "free", outside_gravity_well: true } as const;
const inside = { place: "free", outside_gravity_well: false } as const;

/** The install's types, in file order, keyed as the game data store keeps them. */
const TYPES: ReadonlyMap<string, MegastructureTypeView> = new Map(
  [
    megastructureTypeView("think_tank_1", { upgrade_from: ["think_tank_0"], placement: onAny }),
    megastructureTypeView("think_tank_0", { placement: onAny }),
    megastructureTypeView("think_tank_2", { upgrade_from: ["think_tank_1"], placement: onAny }),
    megastructureTypeView("dyson_sphere_0", { placement: onStar }),
    megastructureTypeView("dyson_sphere_1", {
      upgrade_from: ["dyson_sphere_0"],
      placement: onStar,
    }),
    megastructureTypeView("dyson_sphere_ruined", { placement: onAny }),
    megastructureTypeView("hyper_relay", { placement: outside }),
    megastructureTypeView("shroud_seal", { placement: inside }),
    megastructureTypeView("lgate_base", {
      placement: { place: "unsupported", why: { kind: "bypass", bypass: "lgate" } },
    }),
    megastructureTypeView("ring_world_1", {
      placement: { place: "unsupported", why: { kind: "ring_world" } },
    }),
  ].map((t) => [t.key, t]),
);

const NAMES = new Map([
  ["think_tank_0", "Science Nexus Site"],
  ["think_tank_2", "Science Nexus"],
  ["dyson_sphere_0", "Dyson Sphere Site"],
]);

const picks = (spot: MegastructureSpot) => megastructurePicks(TYPES, NAMES, spot);
const planet: MegastructureSpot = { kind: "body", body: 12, star: false };
const star: MegastructureSpot = { kind: "body", body: 1, star: true };
const space: MegastructureSpot = { kind: "space", x: 30, y: 40 };

describe("the types the Add megastructure dialog offers", () => {
  it("groups a body's types by upgrade family, named by the first stage, each in chain order", () => {
    expect(picks(star)).toEqual([
      {
        key: "dyson_sphere_ruined",
        label: "Dyson Sphere (ruined)",
        family: "Dyson Sphere (ruined)",
        state: "ruined",
      },
      {
        key: "dyson_sphere_0",
        label: "Dyson Sphere Site",
        family: "Dyson Sphere Site",
        state: "under construction",
      },
      {
        key: "dyson_sphere_1",
        label: "Dyson Sphere (stage 1)",
        family: "Dyson Sphere Site",
        state: "stage 1",
      },
      {
        key: "think_tank_0",
        label: "Science Nexus Site",
        family: "Science Nexus Site",
        state: "under construction",
      },
      {
        key: "think_tank_1",
        label: "Think Tank (stage 1)",
        family: "Science Nexus Site",
        state: "stage 1",
      },
      {
        key: "think_tank_2",
        label: "Science Nexus",
        family: "Science Nexus Site",
        state: "stage 2",
      },
    ]);
  });

  it("offers star-only types on a star alone, free types in space alone, and never an unsupported one", () => {
    expect(picks(planet).map((p) => p.key)).toEqual([
      "dyson_sphere_ruined",
      "think_tank_0",
      "think_tank_1",
      "think_tank_2",
    ]);
    expect(picks(space).map((p) => p.key)).toEqual(["hyper_relay", "shroud_seal"]);
    const offered = [planet, star, space].flatMap((spot) => picks(spot).map((p) => p.key));
    expect(offered).not.toContain("lgate_base");
    expect(offered).not.toContain("ring_world_1");
  });
});

describe("where a new megastructure stands and who owns it", () => {
  it("ties a body's row to the body, stands a relay just outside the inner radius in the direction pressed, and a shroud seal where pressed", () => {
    expect(megastructurePlace(planet, TYPES.get("think_tank_0"), 150)).toEqual({
      place: "body",
      body: 12,
    });
    const relay = megastructurePlace(space, TYPES.get("hyper_relay"), 150);
    expect(relay.place).toBe("free");
    if (relay.place !== "free") return;
    expect(Math.hypot(relay.x, relay.y)).toBeCloseTo(RELAY_RADIUS_FACTOR * 150);
    expect(Math.atan2(relay.y, relay.x)).toBeCloseTo(Math.atan2(40, 30));
    expect(megastructurePlace(space, TYPES.get("shroud_seal"), 150)).toEqual({
      place: "free",
      x: 30,
      y: 40,
    });
  });

  it("gives a working structure to the system's owner and a ruin to no one", () => {
    expect(defaultOwner("think_tank_2", 4)).toBe(4);
    for (const ruin of [
      "dyson_sphere_ruined",
      "orbital_ring_permanently_ruined",
      "gateway_destroyed",
      "gateway_derelict",
    ]) {
      expect(defaultOwner(ruin, 4)).toBeNull();
    }
  });
});
