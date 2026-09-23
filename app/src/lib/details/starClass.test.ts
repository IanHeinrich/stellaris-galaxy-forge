import { describe, expect, it } from "vitest";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { StarClassView } from "../../generated/StarClassView";
import { planet } from "./fixture";
import { setStarClassOp, starBodies, starClassChoices, starClassRows } from "./starClass";

function view(key: string, ...planet_keys: string[]): StarClassView {
  return { key, texture_key: `star_class:${key}`, icon_scale: 1, planet_keys };
}

const CLASSES = new Map(
  [
    view("sc_g", "pc_g_star"),
    view("sc_m", "pc_m_star"),
    view("sc_black_hole", "pc_black_hole"),
    view("sc_neutron_star", "pc_neutron_star"),
    view("sc_binary_2", "pc_b_star", "pc_neutron_star"),
    view("sc_binary_6", "pc_m_star", "pc_g_star"),
    view("sc_binary_5", "pc_b_star", "pc_b_star"),
    view("sc_trinary_1", "pc_g_star", "pc_m_star", "pc_k_star"),
  ].map((c) => [c.key, c]),
);

const PLANET_CLASSES = new Map<string, PlanetClassView>(
  ["pc_g_star", "pc_m_star", "pc_b_star", "pc_neutron_star", "pc_black_hole"]
    .map((key) => ({ key, icon_sprite: null, habitable: false, star: true }))
    .concat([{ key: "pc_barren", icon_sprite: null, habitable: false, star: false }])
    .map((c) => [c.key, c]),
);

describe("starBodies", () => {
  it("keeps the planets whose class is a star", () => {
    const planets = [
      planet({ id: 10, class: "pc_b_star" }),
      planet({ id: 11, class: "pc_barren" }),
      planet({ id: 12, class: "pc_neutron_star" }),
    ];
    expect(starBodies(planets, PLANET_CLASSES, CLASSES).map((p) => p.id)).toEqual([10, 12]);
  });
});

describe("starClassChoices", () => {
  it("offers only the classes with as many bodies, leaving out the current one", () => {
    expect(starClassChoices("sc_g", 1, CLASSES).map((c) => c.key)).toEqual([
      "sc_m",
      "sc_black_hole",
      "sc_neutron_star",
    ]);
    expect(starClassChoices("sc_binary_2", 2, CLASSES).map((c) => c.key)).toEqual([
      "sc_binary_6",
      "sc_binary_5",
    ]);
    expect(starClassChoices("sc_g", 0, CLASSES)).toEqual([]);
  });
});

describe("starClassRows", () => {
  it("lists the stars before the exotic classes, each by name", () => {
    const names = new Map([
      ["sc_m", "Class M"],
      ["sc_black_hole", "Black Hole"],
      ["sc_neutron_star", "Neutron Star"],
      ["sc_binary_2", "X-ray Binary"],
      ["sc_g", "Class G"],
    ]);
    const rows = starClassRows(
      ["sc_neutron_star", "sc_m", "sc_black_hole", "sc_binary_2", "sc_g"].map(
        (key) => CLASSES.get(key) as StarClassView,
      ),
      (key) => names.get(key) ?? key,
    );
    expect(rows.map((r) => [r.group, r.label])).toEqual([
      ["Stars", "Class G"],
      ["Stars", "Class M"],
      ["Stars", "X-ray Binary"],
      ["Exotic", "Black Hole"],
      ["Exotic", "Neutron Star"],
    ]);
  });
});

describe("setStarClassOp", () => {
  const target = (key: string) => CLASSES.get(key) as StarClassView;

  it("turns a single star into the target's one body", () => {
    const op = setStarClassOp(
      { id: 1, star_class: "sc_g" },
      target("sc_black_hole"),
      [planet({ id: 10, class: "pc_g_star" })],
      CLASSES,
    );
    expect(op).toEqual({
      type: "SetStarClass",
      id: 1,
      class: "sc_black_hole",
      bodies: [{ planet: 10, class: "pc_black_hole" }],
    });
  });

  it("maps a binary's bodies by their class when they are stored in another order", () => {
    const bodies = [
      planet({ id: 20, class: "pc_neutron_star" }),
      planet({ id: 21, class: "pc_b_star" }),
    ];
    const op = setStarClassOp(
      { id: 2, star_class: "sc_binary_2" },
      target("sc_binary_6"),
      bodies,
      CLASSES,
    );
    expect(op).toMatchObject({
      bodies: [
        { planet: 20, class: "pc_g_star" },
        { planet: 21, class: "pc_m_star" },
      ],
    });
  });

  it("gives two bodies of one class a position each", () => {
    const bodies = [planet({ id: 30, class: "pc_b_star" }), planet({ id: 31, class: "pc_b_star" })];
    const op = setStarClassOp(
      { id: 3, star_class: "sc_binary_5" },
      target("sc_binary_6"),
      bodies,
      CLASSES,
    );
    expect(op).toMatchObject({
      bodies: [
        { planet: 30, class: "pc_m_star" },
        { planet: 31, class: "pc_g_star" },
      ],
    });
  });

  it("falls back to list order for a class the install does not know", () => {
    const bodies = [planet({ id: 40, class: "pc_x_star" }), planet({ id: 41, class: "pc_y_star" })];
    const op = setStarClassOp(
      { id: 4, star_class: "sc_modded" },
      target("sc_binary_2"),
      bodies,
      CLASSES,
    );
    expect(op).toMatchObject({
      bodies: [
        { planet: 40, class: "pc_b_star" },
        { planet: 41, class: "pc_neutron_star" },
      ],
    });
  });

  it("fills a body that matches no position with the one left over", () => {
    const bodies = [
      planet({ id: 50, class: "pc_other_star" }),
      planet({ id: 51, class: "pc_b_star" }),
    ];
    const op = setStarClassOp(
      { id: 5, star_class: "sc_binary_2" },
      target("sc_binary_6"),
      bodies,
      CLASSES,
    );
    expect(op).toMatchObject({
      bodies: [
        { planet: 50, class: "pc_g_star" },
        { planet: 51, class: "pc_m_star" },
      ],
    });
  });
});
