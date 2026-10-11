import { describe, expect, it } from "vitest";
import {
  countryNode,
  megastructureSummary,
  megastructureTypeView,
  starbaseSummary,
  systemDetails,
} from "../test/builders";
import { MEGASTRUCTURE_ICON_KEY } from "./details/icons";
import { megastructureEntries } from "./megastructurePicks";
import {
  descriptionText,
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
      upgrade_from: ["mega_shipyard_1"],
      produces: [
        ["alloys", 20],
        ["energy", -5],
      ],
    }),
    megastructureTypeView("orbital_ring_tier_1", { entity: null }),
  ].map((t) => [t.key, t]),
);

const planet = { kind: "body", body: 12, star: false } as const;
const shipyard = (names: ReadonlyMap<string, string>) => {
  const [entry] = megastructureEntries(TYPES, names, planet);
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
  it("reads the stage's description, cleaned of the game's markup, its stage and what it produces", () => {
    const names = new Map([
      ["mega_shipyard_restored", "Mega Shipyard"],
      ["mega_shipyard_restored_DESC", ""],
      [
        "mega_shipyard_0_MEGASTRUCTURE_DETAILS",
        "A massive §YStarbase§! with £alloys£  20 berths.\nBuilt $UNKNOWN_REF$ once.",
      ],
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
      label: "Mega Shipyard (Restored)",
      stage: null,
      model: true,
      refused: null,
      description: "A massive Starbase with 20 berths.\nBuilt once.",
    });
    expect(preview.produces.map((row) => [row.resource, row.amount])).toEqual([
      ["energy", -5],
      ["alloys", 20],
    ]);
  });

  it("prefers the stage's own description, and has none when the game gives none", () => {
    const names = new Map([
      ["mega_shipyard_1_DESC", "The initial framework."],
      ["mega_shipyard_0_MEGASTRUCTURE_DETAILS", "A massive Starbase."],
    ]);
    const entry = shipyard(names);
    const chain = entry.chains[0];
    expect(megastructurePreview(chain.stages[1], chain, entry, undefined, names).description).toBe(
      "The initial framework.",
    );
    expect(megastructurePreview(chain.stages[1], chain, entry, undefined, new Map())).toMatchObject(
      {
        description: null,
        stage: "Stage 2 of 2",
        produces: [],
      },
    );
    expect(descriptionText("§R§!")).toBeNull();
  });
});
