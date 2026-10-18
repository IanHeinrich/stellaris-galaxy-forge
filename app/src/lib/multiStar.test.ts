import { describe, expect, it } from "vitest";
import { arrangement, planetClassView, starClassView } from "../test/builders";
import { singleStarClasses } from "./details/starBody";
import {
  diagramPlaces,
  gameStarSets,
  randomStarsCard,
  slotsFor,
  specialStars,
  starArtKeys,
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
    ]);
    expect(randomStarsCard(3, ARRANGEMENTS, 4)).toEqual([
      { label: "Stars", text: "Any of the game's 4 trios" },
      { label: "Shape", text: "Close trio 10 in 10" },
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

describe("a stars-only diagram", () => {
  it("puts the centre star in the middle and a distant companion on its path near the edge", () => {
    const places = diagramPlaces(
      {
        stars: [
          { x: 0, y: 0, orbit: 0 },
          { x: 120, y: 0, orbit: 120 },
        ],
      },
      100,
      10,
    );
    expect(places).toEqual([
      { x: 50, y: 50, path: null },
      { x: 90, y: 50, path: 40 },
    ]);
  });

  it("keeps a close pair near the middle, with no path", () => {
    const places = diagramPlaces(
      {
        stars: [
          { x: -15, y: 0, orbit: 15 },
          { x: 15, y: 0, orbit: 15 },
        ],
      },
      100,
      10,
    );
    expect(places).toEqual([
      { x: 40, y: 50, path: null },
      { x: 60, y: 50, path: null },
    ]);
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
