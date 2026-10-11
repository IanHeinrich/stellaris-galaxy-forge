import { describe, expect, it } from "vitest";
import {
  megastructureSummary,
  megastructureTypeView,
  starbaseSummary,
  systemDetails,
} from "../test/builders";
import { MEGASTRUCTURE_ICON_KEY } from "./details/icons";
import { megastructureFamilies, megastructurePicks } from "./megastructurePicks";
import {
  descriptionText,
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
const families = (names: ReadonlyMap<string, string>) =>
  megastructureFamilies(megastructurePicks(TYPES, names, planet), () => null);

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
    const [family] = families(names);
    const pick = family.picks[2];
    expect(megastructureDescriptionKeys(pick)).toEqual([
      "mega_shipyard_restored_DESC",
      "mega_shipyard_restored_MEGASTRUCTURE_DETAILS",
      "mega_shipyard_0_MEGASTRUCTURE_DETAILS",
    ]);

    const preview = megastructurePreview(pick, family, TYPES.get(pick.key), names);
    expect(preview).toMatchObject({
      key: "mega_shipyard_restored",
      label: "Mega Shipyard",
      stage: "Stage 3 of 3",
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
    const [family] = families(names);
    expect(megastructurePreview(family.picks[1], family, undefined, names).description).toBe(
      "The initial framework.",
    );
    expect(megastructurePreview(family.picks[1], family, undefined, new Map())).toMatchObject({
      description: null,
      stage: "Stage 2 of 3",
      produces: [],
    });
    expect(descriptionText("§R§!")).toBeNull();
  });
});
