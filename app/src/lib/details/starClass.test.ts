import { describe, expect, it } from "vitest";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { StarClassView } from "../../generated/StarClassView";
import { planetClassView, starClassView } from "../../test/builders";
import { planet } from "./fixture";
import {
  bulkStarClassChoices,
  crisisVariantKeys,
  currentStarBodies,
  planStarClass,
  setStarClassOp,
  skippedNote,
  starBodies,
  starClassNameKeys,
  starClassRows,
  visibleStarClassRows,
  type StarClassTarget,
} from "./starClass";

const NO_CRISIS: ReadonlySet<string> = new Set();

const CLASSES = new Map(
  [
    starClassView("sc_g", "pc_g_star"),
    starClassView("sc_m", "pc_m_star"),
    starClassView("sc_black_hole", "pc_black_hole"),
    starClassView("sc_neutron_star", "pc_neutron_star"),
    starClassView("sc_binary_2", "pc_b_star", "pc_neutron_star"),
    starClassView("sc_binary_6", "pc_m_star", "pc_g_star"),
    starClassView("sc_binary_5", "pc_b_star", "pc_b_star"),
    starClassView("sc_trinary_1", "pc_g_star", "pc_m_star", "pc_k_star"),
  ].map((c) => [c.key, c]),
);

const PLANET_CLASSES = new Map<string, PlanetClassView>(
  ["pc_g_star", "pc_m_star", "pc_b_star", "pc_neutron_star", "pc_black_hole"]
    .map((key) => planetClassView(key))
    .concat([planetClassView("pc_barren", false)])
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

describe("currentStarBodies", () => {
  const planets = [
    planet({ id: 20, class: "pc_b_star" }),
    planet({ id: 21, class: "pc_neutron_star" }),
  ];

  it("gives the star bodies of details read since the last edit", () => {
    expect(
      currentStarBodies({ planets }, false, PLANET_CLASSES, CLASSES)?.map((p) => p.id),
    ).toEqual([20, 21]);
  });

  it("gives none while the details are unread or an edit has staled them", () => {
    expect(currentStarBodies(undefined, false, PLANET_CLASSES, CLASSES)).toBeNull();
    expect(currentStarBodies({ planets }, true, PLANET_CLASSES, CLASSES)).toBeNull();
  });

  it("leaves a system whose details an edit staled out of a bulk edit, as unread", () => {
    // Read as sc_binary_2, since turned into sc_binary_6: the old bodies must not be matched
    // against the new class's planet keys.
    const stale: StarClassTarget = {
      system: { id: 2, star_class: "sc_binary_6" },
      bodies: currentStarBodies({ planets }, true, PLANET_CLASSES, CLASSES),
    };
    const plan = planStarClass([stale], CLASSES.get("sc_binary_5") as StarClassView, "B", CLASSES);
    expect(plan.op).toBeNull();
    expect(plan.skipped).toEqual({ same: 0, stars: 0, unread: 1 });
  });
});

describe("starClassRows", () => {
  const names = new Map([
    ["sc_m", "Class M"],
    ["sc_black_hole", "Black Hole"],
    ["sc_neutron_star", "Neutron Star"],
    ["sc_binary_2", "Binary Stars"],
    ["sc_binary_6", "Binary Stars"],
    ["sc_trinary_1", "Trinary Stars"],
    ["sc_g", "Class G"],
    ["pc_b_star", "Class B Star"],
    ["pc_g_star", "Class G Star"],
    ["pc_m_star", "Class M Star"],
    ["pc_k_star", "Class K Star"],
    ["pc_neutron_star", "Neutron Star"],
  ]);
  const rows = (...keys: string[]) =>
    starClassRows(
      keys.map((key) => CLASSES.get(key) as StarClassView),
      (key) => names.get(key) ?? key,
      NO_CRISIS,
    );

  it("lists single stars before exotic ones, then binaries and trinaries, each by name", () => {
    const listed = rows(
      "sc_trinary_1",
      "sc_neutron_star",
      "sc_binary_6",
      "sc_m",
      "sc_black_hole",
      "sc_binary_2",
      "sc_g",
    );
    expect(listed.map((r) => [r.group, r.label])).toEqual([
      ["Stars", "Class G"],
      ["Stars", "Class M"],
      ["Exotic", "Black Hole"],
      ["Exotic", "Neutron Star"],
      ["Binaries", "Class B Star + Neutron Star"],
      ["Binaries", "Class M Star + Class G Star"],
      ["Trinaries", "Class G Star + Class M Star + Class K Star"],
    ]);
  });

  it("names a multiple star by its bodies even when its class has no localisation", () => {
    expect(rows("sc_binary_5").map((r) => r.label)).toEqual(["Class B Star + Class B Star"]);
  });

  it("groups classes a new galaxy never rolls after the others: special, then crisis variants", () => {
    const crisis = { ...starClassView("sc_crisis", "pc_m_star", "pc_g_star"), spawn_odds: 0 };
    const special = { ...starClassView("sc_rift", "pc_g_star", "pc_b_star"), spawn_odds: 0 };
    const binary = CLASSES.get("sc_binary_2") as StarClassView;
    const classes = [crisis, special, { ...binary, crisis_star_class: "sc_crisis" }];
    const listed = starClassRows(
      classes,
      (key) => names.get(key) ?? key,
      crisisVariantKeys(classes),
    );
    expect(listed.map((r) => [r.group, r.label])).toEqual([
      ["Binaries", "Class B Star + Neutron Star"],
      ["Special", "Class G Star + Class B Star"],
      ["Crisis variants", "Class M Star + Class G Star"],
    ]);
  });
});

describe("visibleStarClassRows", () => {
  const rows = starClassRows(
    [
      starClassView("sc_normal", "pc_g_star"),
      { ...starClassView("sc_internal_1", "pc_g_star"), spawn_odds: 0, localised: false },
      { ...starClassView("sc_internal_2", "pc_g_star"), spawn_odds: 0, localised: false },
      { ...starClassView("sc_named", "pc_g_star"), spawn_odds: 0 },
      { ...starClassView("sc_rolled", "pc_g_star"), localised: false },
    ],
    (key) => key,
    NO_CRISIS,
  );

  it("keeps internal classes out of the list and counts them, until revealed", () => {
    const hidden = visibleStarClassRows(rows, false);
    expect(hidden.rows.map((r) => r.view.key)).toEqual(["sc_normal", "sc_rolled", "sc_named"]);
    expect(hidden.internalCount).toBe(2);

    const revealed = visibleStarClassRows(rows, true);
    expect(revealed.rows.map((r) => [r.group, r.view.key])).toEqual([
      ["Stars", "sc_normal"],
      ["Stars", "sc_rolled"],
      ["Special", "sc_named"],
      ["Internal", "sc_internal_1"],
      ["Internal", "sc_internal_2"],
    ]);
  });
});

describe("starClassNameKeys", () => {
  it("asks for each class and each of its bodies once", () => {
    const choices = ["sc_g", "sc_binary_6"].map((key) => CLASSES.get(key) as StarClassView);
    expect(starClassNameKeys(choices)).toEqual(["sc_g", "pc_g_star", "sc_binary_6", "pc_m_star"]);
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

describe("a bulk star class edit", () => {
  const target = (key: string) => CLASSES.get(key) as StarClassView;
  const single = (id: number, star_class: string, body: string): StarClassTarget => ({
    system: { id, star_class },
    bodies: [planet({ id: id * 10, class: body })],
  });
  const TARGETS: StarClassTarget[] = [
    single(1, "sc_g", "pc_g_star"),
    single(2, "sc_m", "pc_m_star"),
    single(3, "sc_black_hole", "pc_black_hole"),
    {
      system: { id: 4, star_class: "sc_binary_2" },
      bodies: [
        planet({ id: 40, class: "pc_b_star" }),
        planet({ id: 41, class: "pc_neutron_star" }),
      ],
    },
    { system: { id: 5, star_class: "sc_g" }, bodies: null },
    { system: { id: 6, star_class: "sc_nothing" }, bodies: [] },
  ];

  it("offers the classes for every star count the selection has", () => {
    expect(bulkStarClassChoices(TARGETS, CLASSES).map((c) => c.key)).toEqual([
      "sc_g",
      "sc_m",
      "sc_black_hole",
      "sc_neutron_star",
      "sc_binary_2",
      "sc_binary_6",
      "sc_binary_5",
    ]);
    expect(bulkStarClassChoices([TARGETS[4], TARGETS[5]], CLASSES)).toEqual([]);
  });

  it("changes every system with as many stars as one batch, skipping the rest and saying why", () => {
    const plan = planStarClass(TARGETS, target("sc_black_hole"), "Black Hole", CLASSES);
    expect(plan.op).toEqual({
      type: "Batch",
      description: "Set the star class of 2 systems to Black Hole",
      ops: [
        {
          type: "SetStarClass",
          id: 1,
          class: "sc_black_hole",
          bodies: [{ planet: 10, class: "pc_black_hole" }],
        },
        {
          type: "SetStarClass",
          id: 2,
          class: "sc_black_hole",
          bodies: [{ planet: 20, class: "pc_black_hole" }],
        },
      ],
    });
    expect(plan.changed).toBe(2);
    expect(plan.skipped).toEqual({ same: 1, stars: 2, unread: 1 });
    expect(skippedNote(plan.skipped, "Black Hole")).toBe(
      "4 systems skipped: a different number of stars (2), already Black Hole (1), no details read (1)",
    );
  });

  it("sends nothing when no system would change", () => {
    const plan = planStarClass([TARGETS[2]], target("sc_black_hole"), "Black Hole", CLASSES);
    expect(plan.op).toBeNull();
    expect(skippedNote(plan.skipped, "Black Hole")).toBe("1 system skipped: already Black Hole");
  });

  it("notes a single reason on its own, and nothing when none was skipped", () => {
    const plan = planStarClass(TARGETS.slice(0, 4), target("sc_binary_6"), "Binary Stars", CLASSES);
    expect(plan.changed).toBe(1);
    expect(skippedNote(plan.skipped, "Binary Stars")).toBe(
      "3 systems skipped: a different number of stars",
    );
    expect(skippedNote({ same: 0, stars: 0, unread: 0 }, "Binary Stars")).toBeNull();
  });
});
