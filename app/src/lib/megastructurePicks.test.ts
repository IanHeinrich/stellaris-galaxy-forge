import { describe, expect, it } from "vitest";
import type { MegastructureTypeView } from "../generated/MegastructureTypeView";
import { megastructureSummary, megastructureTypeView } from "../test/builders";
import {
  BODY_HAS_MEGASTRUCTURE,
  defaultStage,
  entryStages,
  matchingEntries,
  megastructureEntries,
  megastructurePlace,
  megastructureRefusal,
  RELAY_RADIUS_FACTOR,
  type MegastructureEntry,
  type MegastructureSpot,
} from "./megastructurePicks";

const onStar = { place: "body", star_only: true } as const;
const onAny = { place: "body", star_only: false } as const;
const outside = { place: "free", outside_gravity_well: true } as const;
const inside = { place: "free", outside_gravity_well: false } as const;
const GIGA = "Gigastructural Engineering";

/** One mod chain of Dyson Sphere stages around a star of `star` class, keyed as Giga keys them. */
function gigaSphere(star: string): MegastructureTypeView[] {
  return [0, 1, 5].map((stage, i, stages) =>
    megastructureTypeView(`dyson_sphere_${stage}_${star}_star`, {
      upgrade_from: i === 0 ? [] : [`dyson_sphere_${stages[i - 1]}_${star}_star`],
      placement: onStar,
      source: GIGA,
      base_game: false,
    }),
  );
}

/** The install's types, in file order, keyed as the game data store keeps them. */
const TYPES: ReadonlyMap<string, MegastructureTypeView> = new Map(
  [
    megastructureTypeView("think_tank_1", { upgrade_from: ["think_tank_0"], placement: onAny }),
    megastructureTypeView("think_tank_0", { placement: onAny }),
    megastructureTypeView("think_tank_3", { upgrade_from: ["think_tank_1"], placement: onAny }),
    megastructureTypeView("dyson_sphere_0", { placement: onStar }),
    megastructureTypeView("dyson_sphere_5", {
      upgrade_from: ["dyson_sphere_0"],
      placement: onStar,
    }),
    megastructureTypeView("dyson_sphere_ruined", {
      placement: onStar,
      variant_of: "dyson_sphere_0",
    }),
    megastructureTypeView("dyson_sphere_restored", {
      upgrade_from: ["dyson_sphere_ruined"],
      placement: onStar,
      variant_of: "dyson_sphere_0",
    }),
    ...gigaSphere("o"),
    ...gigaSphere("m_giant"),
    megastructureTypeView("gateway_0", { placement: outside, source: GIGA }),
    megastructureTypeView("gateway_final", {
      upgrade_from: ["gateway_0"],
      placement: outside,
      bypass_type: "gateway",
      source: GIGA,
    }),
    megastructureTypeView("gateway_derelict", {
      placement: outside,
      bypass_type: "gateway",
      variant_of: "gateway_0",
    }),
    megastructureTypeView("hyper_relay", { placement: outside, bypass_type: "relay_bypass" }),
    megastructureTypeView("shroud_seal", { placement: inside }),
    megastructureTypeView("mod_beacon", {
      placement: onStar,
      source: "Zeta Structures",
      base_game: false,
    }),
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
  ["think_tank_3", "Science Nexus"],
  ["dyson_sphere_0", "Dyson Sphere Site"],
  ["dyson_sphere_5", "Dyson Sphere"],
  ["dyson_sphere_ruined", "Ruined Dyson Sphere"],
  ["dyson_sphere_restored", "Restored Dyson Sphere"],
  ["dyson_sphere_0_o_star", "Dyson Sphere"],
  ["dyson_sphere_5_o_star", "Dyson Sphere"],
  ["dyson_sphere_0_m_giant_star", "Dyson Sphere"],
  ["dyson_sphere_5_m_giant_star", "Dyson Sphere"],
  ["gateway_0", "Gateway Site"],
  ["gateway_final", "Gateway"],
  ["gateway_derelict", "Derelict Gateway"],
  ["hyper_relay", "Hyper Relay"],
  ["shroud_seal", "Shroud Seal"],
  ["mod_beacon", "Dyson Sphere"],
]);

const entries = (
  spot: MegastructureSpot,
  refusalOf?: (t: MegastructureTypeView) => string | null,
) => megastructureEntries(TYPES, NAMES, spot, refusalOf);
const planet: MegastructureSpot = { kind: "body", body: 12, star: false };
const star: MegastructureSpot = { kind: "body", body: 1, star: true };
const space: MegastructureSpot = { kind: "space", x: 30, y: 40 };

const shape = (list: readonly MegastructureEntry[]) =>
  list.map((entry) => ({
    label: entry.label,
    section: entry.section,
    rows: entry.chains.map((chain) => [chain.label, chain.stages.map((s) => s.key)]),
  }));

describe("the megastructures the Add megastructure dialog lists", () => {
  it("names each by its finished stage, base game first, mods after by name, with ruins under their megastructure", () => {
    expect(shape(entries(star))).toEqual([
      {
        label: "Dyson Sphere",
        section: null,
        rows: [
          [
            null,
            ["dyson_sphere_0", "dyson_sphere_5", "dyson_sphere_ruined", "dyson_sphere_restored"],
          ],
        ],
      },
      {
        label: "Science Nexus",
        section: null,
        rows: [[null, ["think_tank_0", "think_tank_1", "think_tank_3"]]],
      },
      {
        label: "Dyson Sphere",
        section: GIGA,
        rows: [
          [
            "M-class giant star",
            [
              "dyson_sphere_0_m_giant_star",
              "dyson_sphere_1_m_giant_star",
              "dyson_sphere_5_m_giant_star",
            ],
          ],
          [
            "O-class star",
            ["dyson_sphere_0_o_star", "dyson_sphere_1_o_star", "dyson_sphere_5_o_star"],
          ],
        ],
      },
      { label: "Dyson Sphere", section: "Zeta Structures", rows: [[null, ["mod_beacon"]]] },
    ]);
  });

  it("offers star-only types on a star alone, any body's on a planet or star, free types in space alone, and never an unsupported one", () => {
    expect(entries(planet).map((e) => e.label)).toEqual(["Science Nexus"]);
    expect(entryStages(entries(planet)[0]).map((s) => s.key)).toEqual([
      "think_tank_0",
      "think_tank_1",
      "think_tank_3",
    ]);
    const offered = [planet, star, space].flatMap((spot) =>
      entries(spot).flatMap((e) => entryStages(e).map((s) => s.key)),
    );
    expect(offered).not.toContain("lgate_base");
    expect(offered).not.toContain("ring_world_1");
  });

  it("keeps a base game gateway in the base game's section though a mod's file won, with its derelict variant", () => {
    expect(shape(entries(space))).toEqual([
      {
        label: "Gateway",
        section: null,
        rows: [[null, ["gateway_0", "gateway_final", "gateway_derelict"]]],
      },
      { label: "Hyper Relay", section: null, rows: [[null, ["hyper_relay"]]] },
      { label: "Shroud Seal", section: null, rows: [[null, ["shroud_seal"]]] },
    ]);
  });

  it("filters the megastructures by their own and their stages' names and keys, ignoring case", () => {
    const listed = entries(star);
    expect(matchingEntries(listed, " RUINED ").map((e) => e.section)).toEqual([null]);
    expect(matchingEntries(listed, "o_star").map((e) => e.section)).toEqual([GIGA]);
    expect(matchingEntries(listed, "")).toHaveLength(4);
    expect(matchingEntries(listed, "gateway")).toEqual([]);
  });

  it("opens on the type added last where it goes, else the usual one for the spot", () => {
    expect(defaultStage(entries(star), star, "dyson_sphere_5_o_star")).toBe(
      "dyson_sphere_5_o_star",
    );
    expect(defaultStage(entries(star), star, "hyper_relay")).toBe("dyson_sphere_5");
    expect(defaultStage(entries(planet), planet, null)).toBe("think_tank_3");
    expect(defaultStage(entries(space), space, null)).toBe("hyper_relay");
    const noRelay = new Map([...TYPES].filter(([key]) => key !== "hyper_relay"));
    const list = megastructureEntries(noRelay, NAMES, space);
    expect(defaultStage(list, space, null)).toBe("gateway_final");
    expect(defaultStage([], space, null)).toBeNull();
  });
});

describe("why the save would refuse a megastructure that fits the spot", () => {
  it("greys out a second relay or gateway in a system and a body that has one already", () => {
    const relay = megastructureSummary({ kind: "hyper_relay", planet: null });
    const refusal = (spot: MegastructureSpot, kind: string, rows = [relay]) =>
      megastructureRefusal(TYPES.get(kind)!, spot, rows, TYPES);
    expect(refusal(space, "hyper_relay")).toBe("The system already has a hyper relay.");
    expect(refusal(space, "gateway_final")).toBeNull();
    expect(refusal(space, "shroud_seal")).toBeNull();
    const nexus = megastructureSummary({ kind: "think_tank_3", planet: 12 });
    expect(refusal(planet, "think_tank_0", [nexus])).toBe(BODY_HAS_MEGASTRUCTURE);
    const listed = entries(space, (type) => refusal(space, type.key));
    expect(entryStages(listed[1])).toEqual([
      {
        key: "hyper_relay",
        label: "Hyper Relay",
        refused: "The system already has a hyper relay.",
      },
    ]);
  });
});

describe("where a new megastructure stands", () => {
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
});
