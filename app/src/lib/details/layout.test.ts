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
  emblemOwner,
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

  it("gives a colony the plate and its owner's flag, the capital's plate and rim on the capital", () => {
    const colony = planet({ colonised: true, owner: COUNTRY.id });
    expect(marksOf(colony)).toEqual({
      ...NO_MARKS,
      plate: "sprite:GFX_map_icon_bg",
      flag: empireFlagKey(COUNTRY),
    });
    expect(marksOf({ ...colony, capital: true })).toMatchObject({
      plate: "sprite:GFX_map_icon_bg_capital",
      capital: true,
    });
  });

  it("gives a pre-FTL world the icon alone, and an unsettled planet nothing", () => {
    const preFtl = planet({ colonised: true, owner: COUNTRY.id, pre_ftl: true });
    expect(marksOf(preFtl)).toEqual({ ...NO_MARKS, preFtl: true });
    expect(marksOf(planet({ owner: COUNTRY.id }))).toEqual(NO_MARKS);
  });

  it("keeps a colony's plate when its owner has no flag", () => {
    const colony = planet({ colonised: true, owner: 99 });
    expect(marksOf(colony)).toMatchObject({
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
    expect(marks.megastructures.map((m) => m.id)).toEqual([1]);
    expect(marks.sites.map((s) => s.id)).toEqual([10]);
    expect(marks.anomaly).toBe("Research Depot");
    expect(marks.plate).toBeNull();
    expect(marksOf(body, d).anomaly).toBe("Aianom Researchdepo");
    expect(marksOf({ ...body, id: 9, anomaly: undefined }, d)).toBe(NO_MARKS);
  });

  it("reads the same for equal icons in fresh arrays, and apart for a changed anomaly or site", () => {
    const body = planet({ id: 7, anomaly: "time_loop_world" });
    const d = () => details({ sites: [{ id: 10, kind: "site_zroni_ruins", planet: 7 }] });
    expect(sameMarks(marksOf(body, d()), marksOf(body, d()))).toBe(true);
    const renamed = new Map([["time_loop_world", "Time Loop"]]);
    expect(sameMarks(marksOf(body, d()), marksOf(body, d(), renamed))).toBe(false);
    expect(sameMarks(marksOf(body, d()), marksOf(body))).toBe(false);
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

describe("emblemOwner", () => {
  it("is the coloniser, else a marauder clan holding the system, else nobody", () => {
    const countries = new Map<number, CountryNode>([
      [5, { ...COUNTRY, id: 5, country_type: "dormant_marauders" }],
      [6, { ...COUNTRY, id: 6, country_type: "default" }],
    ]);
    expect(emblemOwner(details({ planets: [planet({ owner: 6 })] }), 5, countries)).toBe(6);
    expect(emblemOwner(details({}), 5, countries)).toBe(5);
    expect(emblemOwner(details({}), 6, countries)).toBeNull();
    expect(emblemOwner(details({}), null, countries)).toBeNull();
  });

  it("is the marauder clan even with no colonised planet in the system", () => {
    const countries = new Map<number, CountryNode>([
      [5, { ...COUNTRY, id: 5, country_type: "dormant_marauders" }],
    ]);
    expect(emblemOwner(details({ planets: [] }), 5, countries)).toBe(5);
  });
});
