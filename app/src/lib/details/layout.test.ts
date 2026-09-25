import { describe, expect, it } from "vitest";
import type { CountryNode } from "../../generated/CountryNode";
import { STAR_BASE_PX } from "../visual/starSize";
import { COUNTRY, details, planet } from "./fixture";
import {
  NAME_ROW,
  colonyOwner,
  emblemOwner,
  nameRowY,
  plateBottom,
  plateBox,
  plateKey,
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
