import { describe, expect, it } from "vitest";
import {
  countryNode,
  megastructureFits,
  megastructureSummary,
  megastructureSwap,
  megastructureTypeView,
  starbaseSummary,
  systemDetails,
} from "../test/builders";
import { MEGASTRUCTURE_ICON_KEY } from "./details/icons";
import { megastructureEntries } from "./megastructurePicks";
import {
  constructionLines,
  hasModel,
  megastructureDescriptionKeys,
  megastructurePreview,
  megastructureThumbKeys,
  ownerCulture,
} from "./megastructurePreview";

const TYPES = new Map(
  [
    megastructureTypeView("mega_shipyard_0"),
    megastructureTypeView("mega_shipyard_1", { upgrade_from: ["mega_shipyard_0"] }),
    megastructureTypeView("mega_shipyard_restored", {
      variant_of: "mega_shipyard_0",
      upgrade_from: ["mega_shipyard_1"],
      produces: [
        ["alloys", 20],
        ["energy", -5],
      ],
    }),
    megastructureTypeView("orbital_ring_tier_1", { entity: null }),
  ].map((t) => [t.key, t]),
);

const shipyard = (names: ReadonlyMap<string, string>) => {
  const [entry] = megastructureEntries(TYPES, names, megastructureFits(TYPES.keys()));
  return entry;
};

describe("the picture a megastructure's tile shows", () => {
  it("draws the model in the owner's culture, bare without one, with the map icon behind it", () => {
    const yard = TYPES.get("mega_shipyard_1");
    expect(megastructureThumbKeys(yard, "mammalian_01")).toEqual([
      "model:mammalian_01:mega_shipyard_1_entity",
      MEGASTRUCTURE_ICON_KEY,
    ]);
    expect(megastructureThumbKeys(yard, null)).toEqual([
      "model:none:mega_shipyard_1_entity",
      MEGASTRUCTURE_ICON_KEY,
    ]);
  });

  it("shows the map icon for a type with no model", () => {
    expect(megastructureThumbKeys(TYPES.get("orbital_ring_tier_1"), "mammalian_01")).toEqual([
      MEGASTRUCTURE_ICON_KEY,
    ]);
    expect(hasModel(TYPES.get("orbital_ring_tier_1"))).toBe(false);
    expect(hasModel(TYPES.get("mega_shipyard_1"))).toBe(true);
  });

  it("finds the owner's culture on a station or megastructure the owner has", () => {
    const systems = [
      systemDetails({ id: 1, starbase: starbaseSummary({ owner: 3, culture: null }) }),
      systemDetails({
        id: 2,
        megastructures: [
          megastructureSummary({ kind: "think_tank_3", owner: 4, culture: "avian_01" }),
        ],
        other_starbases: [starbaseSummary({ owner: 3, culture: "humanoid_01" })],
      }),
    ];
    expect(ownerCulture(3, systems)).toBe("humanoid_01");
    expect(ownerCulture(4, systems)).toBe("avian_01");
    expect(ownerCulture(9, systems)).toBeNull();
    expect(ownerCulture(null, systems)).toBeNull();
  });

  it("takes the culture the owner's country names before any it owns", () => {
    const systems = [
      systemDetails({ id: 1, starbase: starbaseSummary({ owner: 3, culture: "humanoid_01" }) }),
    ];
    const countries = new Map([
      [3, countryNode({ id: 3, graphical_culture: "plantoid_01" })],
      [4, countryNode({ id: 4 })],
    ]);
    expect(ownerCulture(3, systems, countries)).toBe("plantoid_01");
    expect(ownerCulture(4, systems, countries)).toBeNull();
  });
});

describe("the preview of the selected type", () => {
  it("reads the stage's description with the game's markup kept, its stage and what it produces", () => {
    const names = new Map([
      ["mega_shipyard_restored", "Mega Shipyard"],
      ["mega_shipyard_restored_DESC", ""],
      ["mega_shipyard_0_MEGASTRUCTURE_DETAILS", "A massive §YStarbase§! with £alloys£ 20 berths."],
    ]);
    const entry = shipyard(names);
    const chain = entry.chains[1];
    expect(chain.kind).toBe("ruins");
    const stage = chain.stages[0];
    expect(megastructureDescriptionKeys(stage.key, entry)).toEqual([
      "mega_shipyard_restored_DESC",
      "mega_shipyard_restored_MEGASTRUCTURE_DETAILS",
      "mega_shipyard_0_MEGASTRUCTURE_DETAILS",
    ]);

    const preview = megastructurePreview(stage, chain, entry, TYPES.get(stage.key), names);
    expect(preview).toMatchObject({
      key: "mega_shipyard_restored",
      variant: "mega_shipyard_restored",
      label: "Mega Shipyard (Restored)",
      stage: null,
      add: "Add Mega Shipyard (Restored)",
      model: true,
      refused: null,
      description: "A massive §YStarbase§! with £alloys£ 20 berths.",
    });
    expect(preview.produces.map((row) => [row.resource, row.amount])).toEqual([
      ["energy", -5],
      ["alloys", 20],
    ]);
  });

  it("prefers the stage's own description from the game texts, and has none when the game gives none", () => {
    const names = new Map([
      ["mega_shipyard_1", "Mega Shipyard"],
      ["mega_shipyard_0_MEGASTRUCTURE_DETAILS", "A massive Starbase."],
    ]);
    const texts = new Map([["mega_shipyard_1_DESC", "The §Ginitial§! framework."]]);
    const entry = shipyard(names);
    const chain = entry.chains[0];
    const text = (key: string) => texts.get(key) ?? "";
    expect(
      megastructurePreview(chain.stages[1], chain, entry, undefined, names, new Map(), text)
        .description,
    ).toBe("The §Ginitial§! framework.");
    const bare = megastructurePreview(
      chain.stages[1],
      chain,
      entry,
      undefined,
      names,
      new Map(),
      () => "",
    );
    expect(bare).toMatchObject({
      description: null,
      stage: "Stage 2 of 2: Finished",
      produces: [],
      effects: [],
      writes: [],
    });
  });

  it("names the variant Add writes, with its description first, its empire effects and what it also writes", () => {
    const types = new Map(
      [
        megastructureTypeView("dyson_swarm_0", { placement: { place: "body", star_only: true } }),
        megastructureTypeView("dyson_swarm_3", {
          upgrade_from: ["dyson_swarm_0"],
          placement: { place: "body", star_only: true },
          swaps: [megastructureSwap("dyson_swarm_3_b_star", { classes: ["pc_b_star"] })],
        }),
        megastructureTypeView("dyson_swarm_3_b_star", {
          upgrade_from: ["dyson_swarm_3"],
          placement: { place: "body", star_only: true },
          country_effects: [
            { key: "country_energy_produces_mult", value: 0.1, text: "+10% Energy Credits" },
          ],
          construction_summary: [
            {
              on: "body",
              kind: "modifier",
              key: "dyson_swarm_3_mod",
              name: "Dyson Swarm",
              permanent: true,
              conditional: false,
            },
          ],
        }),
      ].map((t) => [t.key, t]),
    );
    const names = new Map([
      ["dyson_swarm_0", "Dyson Swarm Site"],
      ["dyson_swarm_3", "Dyson Swarm"],
      ["dyson_swarm_3_b_star", "Blue Dyson Swarm"],
    ]);
    const fits = megastructureFits(["dyson_swarm_0", "dyson_swarm_3"], {
      dyson_swarm_3: { variant: "dyson_swarm_3_b_star" },
    });
    const [entry] = megastructureEntries(types, names, fits);
    expect(entry.label).toBe("Dyson Swarm");
    const chain = entry.chains[0];
    const stage = chain.stages[1];
    const preview = megastructurePreview(stage, chain, entry, types.get(stage.variant), names);
    expect(preview).toMatchObject({
      key: "dyson_swarm_3",
      variant: "dyson_swarm_3_b_star",
      label: "Blue Dyson Swarm",
      stage: "Stage 2 of 2: Finished",
      add: "Add Dyson Swarm, stage 2 of 2",
      effects: ["+10% Energy Credits"],
      writes: ["A Dyson Swarm modifier on the planet or star it orbits"],
    });
    expect(preview.descriptionKeys.slice(0, 3)).toEqual([
      "dyson_swarm_3_b_star_DESC",
      "dyson_swarm_3_b_star_MEGASTRUCTURE_DETAILS",
      "dyson_swarm_3_DESC",
    ]);
  });
});

describe("what adding a megastructure also writes", () => {
  it("joins a modifier and deposit of one name in one place, and says where and when each lands", () => {
    const line = (over: Partial<Parameters<typeof constructionLines>[0][number]>) => ({
      on: "planets" as const,
      kind: "modifier" as const,
      key: "k",
      name: "Arc Furnace",
      permanent: true,
      conditional: false,
      ...over,
    });
    expect(
      constructionLines([
        line({ kind: "deposit", key: "d_arc_furnace_4" }),
        line({ key: "orbital_arc_furnace_4_mod" }),
      ]),
    ).toEqual(["An Arc Furnace modifier and deposit on every planet in the system"]);
    expect(
      constructionLines([
        line({ kind: "deposit", conditional: true }),
        line({ on: "system", name: "Burning Brightly", permanent: false }),
        line({ on: "system", name: "Stellar Haze", conditional: true }),
        line({ on: "owner", name: "Grand Archive", conditional: true }),
        line({ on: "body", name: "Shielded", conditional: true }),
      ]),
    ).toEqual([
      "An Arc Furnace deposit on some planets in the system",
      "A Burning Brightly modifier on the system, for a limited time",
      "A Stellar Haze modifier on the system, when it has an owner",
      "A Grand Archive modifier for the empire that owns it",
      "A Shielded modifier on the planet or star it orbits, in some cases",
    ]);
  });
});
