import { describe, expect, it } from "vitest";
import type { CountryNode } from "../../generated/CountryNode";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import { STAR_BASE_PX } from "../visual/starSize";
import { COUNTRY, details, planet } from "./fixture";
import { empireFlagKey } from "./fleets";
import {
  NAME_ROW,
  NO_MARKS,
  bodyMarks,
  colonyOwner,
  marked,
  nameEmblem,
  nameRowY,
  plateBottom,
  plateBox,
  plateKey,
  sameMarks,
  visiblePlanets,
} from "./layout";

describe("colonyOwner", () => {
  it("is the first owner that is not a pre-FTL civilisation", () => {
    const d = details({
      planets: [
        planet({ id: 1, owner: 9, pre_ftl: true }),
        planet({ id: 2, owner: null }),
        planet({ id: 3, owner: 4, colonised: true }),
        planet({ id: 4, owner: 5, colonised: true }),
      ],
    });
    expect(colonyOwner(d)).toBe(4);
  });

  it("is null when only pre-FTL or unowned planets are present", () => {
    expect(colonyOwner(details({ planets: [planet({ owner: 9, pre_ftl: true })] }))).toBeNull();
    expect(colonyOwner(details({}))).toBeNull();
  });
});

describe("visiblePlanets", () => {
  it("shows free habitable planets, guessing from the class without game data", () => {
    const d = details({
      planets: [
        planet({ id: 1, class: "pc_gas_giant", habitable: true }),
        planet({ id: 2, class: "pc_continental", habitable: false }),
        planet({ id: 3, class: "pc_continental", habitable: null }),
        planet({ id: 4, class: "pc_gas_giant", habitable: null }),
        planet({ id: 5, class: "pc_barren", habitable: false, colonised: true }),
      ],
    });
    expect(visiblePlanets(d).map((p) => p.id)).toEqual([1, 3]);
  });
});

describe("plateKey", () => {
  it("is the capital plate when the owner's capital is here, the plain one otherwise, none uncolonised", () => {
    expect(plateKey(details({ planets: [planet({ colonised: true, owner: 2 })] }))).toBe(
      "sprite:GFX_map_icon_bg",
    );
    expect(
      plateKey(details({ planets: [planet({ colonised: true, owner: 2, capital: true })] })),
    ).toBe("sprite:GFX_map_icon_bg_capital");
    expect(plateKey(details({ planets: [planet({ pre_ftl: true, owner: 2 })] }))).toBeNull();
  });

  it("is null for a marauder-held system with nothing colonised, so no plate sits behind its emblem", () => {
    expect(plateKey(details({}))).toBeNull();
  });
});

describe("bodyMarks", () => {
  const countries = new Map([[COUNTRY.id, COUNTRY]]);
  const empty = details({});
  const names = new Map<string, string>();
  const marksOf = (p: ReturnType<typeof planet>, d = empty, n = names) =>
    bodyMarks(p, countries, d, n);
  const kinds = (p: ReturnType<typeof planet>, d = empty) =>
    marksOf(p, d).slots.map((slot) => slot.kind);

  it("gives a colony its owner's emblem, the capital's plate and rim on the capital", () => {
    const colony = planet({ colonised: true, owner: COUNTRY.id });
    expect(marksOf(colony).emblem).toEqual({
      owner: COUNTRY.id,
      flag: empireFlagKey(COUNTRY),
      plate: "sprite:GFX_map_icon_bg",
      capital: false,
    });
    expect(marksOf({ ...colony, capital: true }).emblem).toMatchObject({
      plate: "sprite:GFX_map_icon_bg_capital",
      capital: true,
    });
  });

  it("gives a pre-FTL world its icon and no emblem, and an unsettled planet nothing", () => {
    const preFtl = planet({ colonised: true, owner: COUNTRY.id, pre_ftl: true });
    expect(marksOf(preFtl).emblem).toBeNull();
    expect(kinds(preFtl)).toEqual(["preFtl"]);
    expect(marked(marksOf(planet({})))).toBe(false);
  });

  it("keeps a colony's plate when its owner has no flag", () => {
    const colony = planet({ colonised: true, owner: 99 });
    expect(marksOf(colony).emblem).toMatchObject({
      plate: "sprite:GFX_map_icon_bg",
      flag: null,
    });
  });

  it("gives a body the megastructures orbiting it, bypasses left out, its dig sites and its anomaly's name", () => {
    const body = planet({ id: 7, anomaly: "AIANOM_RESEARCHDEPO_CAT" });
    const structure = (id: number, kind: string, on: number | null): MegastructureSummary => ({
      id,
      kind,
      owner: null,
      planet: on,
    });
    const d = details({
      megastructures: [
        structure(1, "dyson_sphere_2", 7),
        structure(2, "gateway_final", 7),
        structure(3, "ring_world_ruined", 8),
        structure(4, "matter_decompressor", null),
      ],
      sites: [
        { id: 10, kind: "site_tiyanki_graveyard", planet: 7 },
        { id: 11, kind: "site_zroni_ruins", planet: 8 },
      ],
    });
    const named = new Map([["AIANOM_RESEARCHDEPO_CAT", "Research Depot"]]);
    const marks = marksOf(body, d, named);
    expect(marks.slots.map((slot) => [slot.kind, slot.icon.label, slot.count])).toEqual([
      ["megastructures", "Dyson Sphere (stage 2)", 1],
      ["sites", "Tiyanki Graveyard", 1],
      ["anomaly", "Research Depot", 1],
    ]);
    expect(marks.emblem).toBeNull();
    expect(marksOf(body, d).icons.anomaly).toBe("Aianom Researchdepo");
    expect(marked(marksOf({ ...body, id: 9, anomaly: undefined }, d))).toBe(false);
  });

  it("reads the same for equal icons in fresh arrays, and apart for a changed anomaly or site", () => {
    const body = planet({ id: 7, anomaly: "time_loop_world" });
    const d = () => details({ sites: [{ id: 10, kind: "site_zroni_ruins", planet: 7 }] });
    expect(sameMarks(marksOf(body, d()), marksOf(body, d()))).toBe(true);
    const renamed = new Map([["time_loop_world", "Time Loop"]]);
    expect(sameMarks(marksOf(body, d()), marksOf(body, d(), renamed))).toBe(false);
    expect(sameMarks(marksOf(body, d()), marksOf(body))).toBe(false);
    expect(sameMarks(NO_MARKS, marksOf(planet({})))).toBe(true);
  });
});

describe("nameRowY", () => {
  it("follows the star's on-screen diameter, clamped at both ends", () => {
    expect(nameRowY(1)).toBeCloseTo(STAR_BASE_PX / 4 + 4);
    expect(nameRowY(0.1)).toBe(5);
    expect(nameRowY(1000)).toBe(18);
  });
});

describe("plateBox", () => {
  it("puts the plate a few pixels past the name each side", () => {
    const box = plateBox(20, 20);
    expect(box.x).toBe(-23);
    expect(box.x + box.width).toBe(23);
    expect(box.y).toBe(18);
    expect(box.height).toBe(NAME_ROW.height + 7);
    expect(plateBottom(20)).toBe(box.y + box.height);
  });
});

describe("nameEmblem", () => {
  it("is the coloniser's, else a marauder clan's holding the system with no plate, else nobody's", () => {
    const countries = new Map<number, CountryNode>([
      [5, { ...COUNTRY, id: 5, country_type: "dormant_marauders" }],
      [6, { ...COUNTRY, id: 6, country_type: "default" }],
    ]);
    const owner = (planets: ReturnType<typeof planet>[], holder: number | null) =>
      nameEmblem(planets, countries, holder)?.owner ?? null;
    expect(owner([planet({ owner: 6 })], 5)).toBe(6);
    expect(owner([], 5)).toBe(5);
    expect(nameEmblem([], countries, 5)?.plate).toBeNull();
    expect(owner([], 6)).toBeNull();
    expect(owner([], null)).toBeNull();
  });

  it("rings the flag and picks the capital's plate only where the owner's capital is among the planets", () => {
    const countries = new Map([[COUNTRY.id, COUNTRY]]);
    const colony = planet({ id: 1, owner: COUNTRY.id, colonised: true });
    const foreignCapital = planet({ id: 2, owner: 9, colonised: true, capital: true });
    expect(nameEmblem([colony, foreignCapital], countries)).toMatchObject({
      capital: false,
      plate: "sprite:GFX_map_icon_bg",
    });
    expect(nameEmblem([{ ...colony, capital: true }], countries)).toMatchObject({
      capital: true,
      plate: "sprite:GFX_map_icon_bg_capital",
    });
  });
});
