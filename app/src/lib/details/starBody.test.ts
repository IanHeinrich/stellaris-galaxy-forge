import { describe, expect, it } from "vitest";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import { planetClassView, starClassView } from "../../test/builders";
import { details, planet } from "./fixture";
import {
  findPlanet,
  isStarBody,
  setPlanetSizeOp,
  setStarTypeOp,
  singleStarClasses,
  starMismatch,
  starTypeChoices,
  starTypeRows,
} from "./starBody";

const CLASSES = new Map(
  [
    starClassView("sc_g", "pc_g_star"),
    starClassView("sc_black_hole", "pc_black_hole"),
    starClassView("sc_binary_2", "pc_b_star", "pc_neutron_star"),
  ].map((c) => [c.key, c]),
);

const PLANET_CLASSES = new Map<string, PlanetClassView>(
  ["pc_g_star", "pc_b_star", "pc_neutron_star", "pc_black_hole"]
    .map((key) => planetClassView(key))
    .concat([planetClassView("pc_barren", false)])
    .map((c) => [c.key, c]),
);

describe("findPlanet", () => {
  it("finds a planet and its system in whichever system's details list it", () => {
    const read = new Map([
      [1, details({ id: 1, planets: [planet({ id: 10 })] })],
      [2, details({ id: 2, planets: [planet({ id: 20 }), planet({ id: 21, size: 8 })] })],
    ]);
    const found = findPlanet(read, 21);
    expect(found?.system).toBe(2);
    expect(found?.planet.size).toBe(8);
    expect(findPlanet(read, 99)).toBeNull();
  });
});

describe("isStarBody", () => {
  it("asks the game data, and the key alone while none is loaded", () => {
    expect(isStarBody("pc_g_star", PLANET_CLASSES, CLASSES)).toBe(true);
    expect(isStarBody("pc_barren", PLANET_CLASSES, CLASSES)).toBe(false);
    expect(isStarBody("pc_k_star", new Map(), new Map())).toBe(true);
    expect(isStarBody("pc_pulsar", new Map(), new Map())).toBe(true);
    expect(isStarBody("pc_barren", new Map(), new Map())).toBe(false);
    expect(isStarBody("star", new Map(), new Map())).toBe(true);
  });
});

describe("the star type picker", () => {
  it("offers every star planet class but the current one", () => {
    expect(starTypeChoices("pc_g_star", PLANET_CLASSES)).toEqual([
      "pc_b_star",
      "pc_neutron_star",
      "pc_black_hole",
    ]);
  });

  it("lists ordinary stars before exotic bodies, each by name", () => {
    const names = new Map([
      ["pc_b_star", "Class B Star"],
      ["pc_g_star", "Class G Star"],
      ["pc_neutron_star", "Neutron Star"],
      ["pc_black_hole", "Black Hole"],
    ]);
    const rows = starTypeRows(
      ["pc_neutron_star", "pc_g_star", "pc_black_hole", "pc_b_star"],
      (key) => names.get(key) ?? key,
    );
    expect(rows.map((r) => [r.group, r.label])).toEqual([
      ["Stars", "Class B Star"],
      ["Stars", "Class G Star"],
      ["Exotic", "Black Hole"],
      ["Exotic", "Neutron Star"],
    ]);
  });

  it("finds the single star class of a body, preferring one a new galaxy rolls", () => {
    const scripted = { ...starClassView("sc_g_scripted", "pc_g_star"), spawn_odds: 0 };
    const classes = new Map(
      [scripted, ...CLASSES.values(), starClassView("sc_g_again", "pc_g_star")].map((c) => [
        c.key,
        c,
      ]),
    );
    const singles = singleStarClasses(classes);
    expect(singles.get("pc_g_star")?.key).toBe("sc_g");
    expect(singles.get("pc_black_hole")?.key).toBe("sc_black_hole");
    expect(singles.has("pc_b_star")).toBe(false);
  });
});

describe("setStarTypeOp", () => {
  const binary = { id: 4, star_class: "sc_binary_2" };
  const pair = [
    { id: 41, class: "pc_b_star" },
    { id: 42, class: "pc_neutron_star" },
  ];

  it("changes the one body and keeps the class when no class has the stars it leaves", () => {
    expect(setStarTypeOp(binary, pair, 41, "pc_g_star", CLASSES)).toEqual({
      type: "SetStarClass",
      id: 4,
      class: "sc_binary_2",
      bodies: [{ planet: 41, class: "pc_g_star" }],
    });
  });

  it("moves the system to the class whose stars the bodies now are", () => {
    const single = { id: 7, star_class: "sc_g" };
    expect(
      setStarTypeOp(single, [{ id: 70, class: "pc_g_star" }], 70, "pc_black_hole", CLASSES),
    ).toMatchObject({ class: "sc_black_hole", bodies: [{ planet: 70, class: "pc_black_hole" }] });

    const mixed = [
      { id: 41, class: "pc_g_star" },
      { id: 42, class: "pc_neutron_star" },
    ];
    expect(setStarTypeOp(binary, mixed, 41, "pc_b_star", CLASSES)).toMatchObject({
      class: "sc_binary_2",
    });
  });

  it("prefers a class a new galaxy rolls over a variant with the same stars", () => {
    const variant = { ...starClassView("sc_crisis_hole", "pc_black_hole"), spawn_odds: 0 };
    const classes = new Map([[variant.key, variant], ...CLASSES]);
    const single = { id: 7, star_class: "sc_g" };
    const op = setStarTypeOp(
      single,
      [{ id: 70, class: "pc_g_star" }],
      70,
      "pc_black_hole",
      classes,
    );
    expect(op).toMatchObject({ class: "sc_black_hole" });
  });
});

describe("setPlanetSizeOp", () => {
  it("sets a whole size of at least 1", () => {
    expect(setPlanetSizeOp(10, 20, 35)).toEqual({ type: "SetPlanetSize", id: 10, size: 35 });
    expect(setPlanetSizeOp(10, 20, 1)).toEqual({ type: "SetPlanetSize", id: 10, size: 1 });
  });

  it("sends nothing for a size the core refuses or a fraction", () => {
    expect(setPlanetSizeOp(10, 20, 20)).toBeNull();
    expect(setPlanetSizeOp(10, 20, 0)).toBeNull();
    expect(setPlanetSizeOp(10, 20, -3)).toBeNull();
    expect(setPlanetSizeOp(10, 20, 2.5)).toBeNull();
  });
});

describe("starMismatch", () => {
  const binary = CLASSES.get("sc_binary_2");

  it("is nothing when the bodies are the class's in any order", () => {
    expect(starMismatch(["pc_neutron_star", "pc_b_star"], binary)).toBeNull();
    expect(starMismatch(["pc_g_star"], CLASSES.get("sc_g"))).toBeNull();
  });

  it("gives the bodies' classes when they differ", () => {
    expect(starMismatch(["pc_g_star", "pc_b_star"], binary)).toEqual(["pc_g_star", "pc_b_star"]);
    expect(starMismatch(["pc_b_star", "pc_b_star"], binary)).toEqual(["pc_b_star", "pc_b_star"]);
    expect(starMismatch(["pc_b_star"], binary)).toEqual(["pc_b_star"]);
  });

  it("says nothing for an unknown class or a system with no star bodies", () => {
    expect(starMismatch(["pc_g_star"], undefined)).toBeNull();
    expect(starMismatch([], binary)).toBeNull();
  });
});
