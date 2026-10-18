import { describe, expect, it } from "vitest";
import type { LayoutDiagram } from "../generated/LayoutDiagram";
import { arrangement, planetClassView, starClassView, starType } from "../test/builders";
import { singleStarClasses } from "./details/starBody";
import {
  diagramReach,
  fitDiagram,
  fitSlots,
  placeLabels,
  shortStarNames,
  gameStarSets,
  randomStarsCard,
  slotsFor,
  specialStars,
  starArtKeys,
  type DiagramFit,
} from "./multiStar";

const ARRANGEMENTS = [
  arrangement("binary_1", 2, "Close pair", 0.6),
  arrangement("binary_2", 2, "Distant companion", 0.4, { shape: "distant_companion" }),
  arrangement("trinary_1", 3, "Close trio", 1),
];

describe("a random binary or trinary's card", () => {
  it("counts the game's sets and gives each shape's share, the later shapes in lower case", () => {
    expect(randomStarsCard(2, ARRANGEMENTS, 10)).toEqual([
      { label: "Stars", text: "Any of the game's 10 pairs" },
      { label: "Shape", text: "Close pair 6 in 10, distant companion 4 in 10" },
      { label: "Planets", text: "3–11" },
    ]);
    expect(randomStarsCard(3, ARRANGEMENTS, 4)).toEqual([
      { label: "Stars", text: "Any of the game's 4 trios" },
      { label: "Shape", text: "Close trio 10 in 10" },
      { label: "Planets", text: "3–11" },
    ]);
  });

  it("leaves out a line it has nothing for", () => {
    expect(randomStarsCard(2, [], 0)).toEqual([]);
  });
});

describe("the game's own sets of stars", () => {
  it("are the classes of as many stars a galaxy draws, no crisis variant or placeholder", () => {
    const pair = starClassView("sc_pair", "pc_b_star", "pc_neutron_star");
    const crisis = starClassView("sc_pair_crisis", "pc_b_star", "pc_pulsar");
    const scripted = { ...starClassView("sc_scripted", "pc_g_star", "pc_g_star"), spawn_odds: 0 };
    const placeholder = {
      ...starClassView("sc_held", "pc_m_star", "pc_k_star"),
      placeholder: true,
    };
    const trio = starClassView("sc_trio", "pc_g_star", "pc_m_star", "pc_k_star");
    const all = [pair, crisis, scripted, placeholder, trio, starClassView("sc_g", "pc_g_star")];
    const sets = (count: number) =>
      gameStarSets(all, count, new Set(["sc_pair_crisis"])).map((c) => c.key);
    expect(sets(2)).toEqual(["sc_pair"]);
    expect(sets(3)).toEqual(["sc_trio"]);
  });
});

describe("star slots", () => {
  it("keep the first stars when there are fewer slots, and fill new slots with the pad", () => {
    expect(slotsFor(["a", "b", "c"], 2, "z")).toEqual(["a", "b"]);
    expect(slotsFor(["a", "b"], 3, "z")).toEqual(["a", "b", "z"]);
    expect(slotsFor(["a"], 2)).toEqual(["a", "a"]);
    expect(slotsFor([], 2)).toEqual([]);
  });
});

describe("fitting stars to an arrangement", () => {
  const types = ["pc_a_star", "pc_m_star"].map((key) => starType(key));

  it("pads with the first star kept, so a single star becomes a pair of itself", () => {
    expect(fitSlots(["pc_m_star"], 2, types)).toEqual(["pc_m_star", "pc_m_star"]);
  });

  it("leaves out a star the install no longer offers, and pads with the first type when none is left", () => {
    expect(fitSlots(["pc_mod_star", "pc_m_star"], 2, types)).toEqual(["pc_m_star", "pc_m_star"]);
    expect(fitSlots(["pc_mod_star"], 2, types)).toEqual(["pc_a_star", "pc_a_star"]);
    expect(fitSlots(["pc_mod_star"], 2, null)).toEqual(["pc_mod_star", "pc_mod_star"]);
  });
});

describe("a stars-only diagram", () => {
  const star = (x: number, y: number, distant = false) => ({
    x,
    y,
    orbit: Math.hypot(x, y),
    distant,
  });
  /** The game's four arrangements, at their ranges' middles. */
  const FOUR: Record<string, LayoutDiagram> = {
    closePair: { stars: [star(-25, 0), star(25, 0)] },
    distantCompanion: { stars: [star(0, 0), star(120, 0, true)] },
    closeTrio: { stars: [star(0, -30), star(26, 15), star(-26, 15)] },
    twoDistantCompanions: { stars: [star(0, 0), star(100, 0, true), star(-140, 40, true)] },
  };
  const REACH = Math.max(...Object.values(FOUR).map(diagramReach));
  /** How far out from the system's centre the furthest star is drawn. */
  const spread = (fit: DiagramFit) =>
    Math.max(...fit.stars.map((p) => Math.hypot(p.x - fit.centre.x, p.y - fit.centre.y)));
  const artBoxes = (fit: DiagramFit) =>
    fit.stars.map((p) => ({
      left: p.x - fit.starSize / 2,
      right: p.x + fit.starSize / 2,
      top: p.y - fit.starSize / 2,
      bottom: p.y + fit.starSize / 2,
    }));

  for (const [name, diagram] of Object.entries(FOUR)) {
    for (const [size, maxStar] of [
      [200, 32],
      [64, 14],
    ]) {
      it(`fits ${name} in a box of ${size}, every star inside it and clear of the others`, () => {
        const fit = fitDiagram(diagram, { size, maxStar, minStar: 6, below: 12, reach: REACH });
        const boxes = artBoxes(fit);
        for (const box of boxes) {
          expect(box.left).toBeGreaterThanOrEqual(0);
          expect(box.top).toBeGreaterThanOrEqual(0);
          expect(box.right).toBeLessThanOrEqual(size);
          expect(box.bottom).toBeLessThanOrEqual(size);
        }
        boxes.forEach((a, i) =>
          boxes.forEach((b, j) => {
            if (j <= i) return;
            const apart =
              a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
            expect(apart).toBe(true);
          }),
        );
        const numbers = placeLabels(
          fit,
          diagram.stars.map((_, i) => `${i + 1}`),
        );
        expect(numbers).not.toBeNull();
      });
    }
  }

  it("keeps a close group close and spreads a distant one at one system scale", () => {
    const fit = (diagram: LayoutDiagram) =>
      fitDiagram(diagram, { size: 200, maxStar: 32, minStar: 6, below: 12, reach: REACH });
    const close = Math.max(spread(fit(FOUR.closePair)), spread(fit(FOUR.closeTrio)));
    const distant = Math.min(
      spread(fit(FOUR.distantCompanion)),
      spread(fit(FOUR.twoDistantCompanions)),
    );
    expect(close).toBeLessThan(distant / 1.5);
    // Close stars still keep their art apart: at least 1.3 art sizes between centres.
    const trio = fit(FOUR.closeTrio);
    expect(
      Math.hypot(trio.stars[0].x - trio.stars[1].x, trio.stars[0].y - trio.stars[1].y),
    ).toBeGreaterThanOrEqual(1.3 * trio.starSize - 1e-9);
  });

  it("draws a distant companion's path round the system's centre", () => {
    const fit = fitDiagram(FOUR.distantCompanion, { size: 100, maxStar: 20, minStar: 6 });
    expect(fit.stars[0].path).toBeNull();
    expect(fit.stars[1].path).toBeCloseTo(fit.stars[1].x - fit.centre.x);
    expect([fit.stars[0].x, fit.stars[0].y]).toEqual([fit.centre.x, fit.centre.y]);
  });

  it("leaves out labels that would still touch", () => {
    const fit = fitDiagram(FOUR.closePair, { size: 64, maxStar: 14, minStar: 6 });
    expect(placeLabels(fit, ["1", "2"])).not.toBeNull();
    expect(placeLabels(fit, ["Class F Star", "Class T Brown Dwarf"])).toBeNull();
  });
});

describe("a star's art", () => {
  const classes = new Map(
    [
      starClassView("sc_black_hole", "pc_black_hole"),
      starClassView("sc_pair", "pc_b_star", "pc_neutron_star"),
    ].map((c) => [c.key, c]),
  );

  it("is the texture of the class that is that star alone, then its own sprite", () => {
    const planets = new Map([
      ["pc_black_hole", planetClassView("pc_black_hole", true, null, { icon_sprite: "GFX_bh" })],
    ]);
    expect(starArtKeys("pc_black_hole", singleStarClasses(classes), planets)).toEqual([
      "star_class:sc_black_hole",
      "sprite:GFX_bh",
    ]);
    expect(starArtKeys("pc_b_star", singleStarClasses(classes), planets)).toEqual([]);
  });

  it("of a special layout's stars is its class's stars when it has as many", () => {
    expect(specialStars(classes.get("sc_pair"), 2)).toEqual(["pc_b_star", "pc_neutron_star"]);
    expect(specialStars(classes.get("sc_black_hole"), 3)).toEqual([
      "pc_black_hole",
      "pc_black_hole",
      "pc_black_hole",
    ]);
    expect(specialStars(undefined, 2)).toEqual([]);
  });
});

describe("short star names", () => {
  const USUAL: [string, string][] = [
    ["pc_a_star", "Class A Star"],
    ["pc_b_star", "Class B Star"],
    ["pc_f_star", "Class F Star"],
    ["pc_g_star", "Class G Star"],
    ["pc_k_star", "Class K Star"],
    ["pc_m_star", "Class M Star"],
    ["pc_m_giant_star", "Class M Red Giant"],
    ["pc_t_star", "Class T Brown Dwarf"],
    ["pc_black_hole", "Black Hole"],
    ["pc_neutron_star", "Neutron Star"],
    ["pc_pulsar", "Pulsar"],
  ];
  const types = [
    ...USUAL.map(([key, name]) => ({ key, name, usual: true, effects: false })),
    { key: "pc_protostar", name: "Protostar", usual: false, effects: false },
  ];

  it("drop the words at least half the usual names share", () => {
    const short = shortStarNames(types);
    expect(USUAL.map(([key]) => short(key))).toEqual([
      "A",
      "B",
      "F",
      "G",
      "K",
      "M",
      "M Red Giant",
      "T Brown Dwarf",
      "Black Hole",
      "Neutron",
      "Pulsar",
    ]);
    expect(short("pc_protostar")).toBe("Protostar");
    expect(short("pc_unknown")).toBe("pc_unknown");
  });

  it("drop only a shared leading word in leading mode", () => {
    const short = shortStarNames(types, true);
    expect(USUAL.map(([key]) => short(key))).toEqual([
      "A Star",
      "B Star",
      "F Star",
      "G Star",
      "K Star",
      "M Star",
      "M Red Giant",
      "T Brown Dwarf",
      "Black Hole",
      "Neutron Star",
      "Pulsar",
    ]);
    expect(short("pc_protostar")).toBe("Protostar");
    expect(short("pc_unknown")).toBe("pc_unknown");
  });

  it("keep a name those words make up entirely", () => {
    const short = shortStarNames([
      { key: "a", name: "Star", usual: true, effects: false },
      { key: "b", name: "Class B Star", usual: true, effects: false },
      { key: "c", name: "Class C Star", usual: true, effects: false },
    ]);
    expect(short("a")).toBe("Star");
    expect(short("b")).toBe("B");
  });
});
