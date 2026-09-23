import { describe, expect, it } from "vitest";
import type { PlanetClassView } from "../../generated/PlanetClassView";
import type { StarClassView } from "../../generated/StarClassView";
import { singleStarClasses } from "../details/starBody";
import {
  MAX_SIZE_FACTOR,
  MIN_SIZE_FACTOR,
  REFERENCE_STAR_SIZE,
  clusterOffsets,
  starCluster,
  starSizeFactor,
} from "./starCluster";

function star(key: string, planetKeys: string[], iconScale = 1): StarClassView {
  return {
    key,
    texture_key: `star_class:${key}`,
    icon_scale: iconScale,
    planet_keys: planetKeys,
    crisis_star_class: null,
    spawn_odds: 1,
    localised: true,
  };
}

function planet(key: string, isStar: boolean): PlanetClassView {
  return { key, icon_sprite: null, habitable: !isStar, star: isStar };
}

const STAR_CLASSES = new Map(
  [
    star("sc_b", ["pc_b_star"]),
    star("sc_k", ["pc_k_star"]),
    star("sc_black_hole", ["pc_black_hole"], 2),
    star("sc_trinary_1", ["pc_b_star", "pc_k_star", "pc_t_star"]),
  ].map((c) => [c.key, c]),
);
const PLANET_CLASSES = new Map(
  [
    planet("pc_b_star", true),
    planet("pc_k_star", true),
    planet("pc_t_star", true),
    planet("pc_black_hole", true),
    planet("pc_barren", false),
  ].map((c) => [c.key, c]),
);
const SINGLES = singleStarClasses(STAR_CLASSES);
const TRINARY_ART = { key: "star_class:sc_trinary_1", scale: 1 };

describe("starSizeFactor", () => {
  it("scales a star by its size against a G star's", () => {
    expect(starSizeFactor(REFERENCE_STAR_SIZE)).toBe(1);
    expect(starSizeFactor(30)).toBeCloseTo(30 / REFERENCE_STAR_SIZE);
  });

  it("holds a tiny star and a huge one to the clamps", () => {
    expect(starSizeFactor(5)).toBe(MIN_SIZE_FACTOR);
    expect(starSizeFactor(90)).toBe(MAX_SIZE_FACTOR);
  });

  it("draws a star of unknown size at the base", () => {
    expect(starSizeFactor(null)).toBe(1);
    expect(starSizeFactor(0)).toBe(1);
  });
});

describe("clusterOffsets", () => {
  it("puts two stars on a diagonal, upper left then lower right", () => {
    const [a, b] = clusterOffsets(2);
    expect(a.dx).toBeLessThan(0);
    expect(a.dy).toBeLessThan(0);
    expect(b.dx).toBeCloseTo(-a.dx);
    expect(b.dy).toBeCloseTo(-a.dy);
  });

  it("puts three stars on a triangle from the top", () => {
    const [top, right, left] = clusterOffsets(3);
    expect(top.dx).toBeCloseTo(0);
    expect(top.dy).toBeLessThan(0);
    expect(right.dx).toBeGreaterThan(0);
    expect(left.dx).toBeCloseTo(-right.dx);
    expect(right.dy).toBeCloseTo(left.dy);
  });

  it("keeps every star of up to five within one footprint", () => {
    for (let n = 2; n <= 5; n++) {
      for (const p of clusterOffsets(n)) {
        expect(Math.hypot(p.dx, p.dy) + p.diameter / 2).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
  });
});

describe("starCluster", () => {
  it("draws each star of a trinary with its own class's art, sized by its body", () => {
    const cluster = starCluster(
      [
        { class: "pc_b_star", size: 40 },
        { class: "pc_barren", size: 12 },
        { class: "pc_k_star", size: REFERENCE_STAR_SIZE },
        { class: "pc_black_hole", size: 5 },
      ],
      PLANET_CLASSES,
      STAR_CLASSES,
      SINGLES,
      TRINARY_ART,
    );
    expect(cluster?.map((s) => s.texture)).toEqual([
      { key: "star_class:sc_b", scale: 1 },
      { key: "star_class:sc_k", scale: 1 },
      { key: "star_class:sc_black_hole", scale: 2 },
    ]);
    const base = clusterOffsets(3)[0].diameter;
    expect(cluster?.map((s) => s.diameter)).toEqual([
      base * MAX_SIZE_FACTOR,
      base,
      base * MIN_SIZE_FACTOR,
    ]);
  });

  it("falls back to the system class's art for a star no single class makes", () => {
    const cluster = starCluster(
      [
        { class: "pc_b_star", size: null },
        { class: "pc_t_star", size: null },
      ],
      PLANET_CLASSES,
      STAR_CLASSES,
      SINGLES,
      TRINARY_ART,
    );
    expect(cluster?.map((s) => s.texture.key)).toEqual(["star_class:sc_b", TRINARY_ART.key]);
  });

  it("leaves a single star, a scenario system and a star with no art to the class glyph", () => {
    const args = [PLANET_CLASSES, STAR_CLASSES, SINGLES] as const;
    const one = [
      { class: "pc_k_star", size: 20 },
      { class: "pc_barren", size: 10 },
    ];
    expect(starCluster(one, ...args, TRINARY_ART)).toBeNull();
    expect(starCluster(undefined, ...args, TRINARY_ART)).toBeNull();
    const two = [
      { class: "pc_b_star", size: 30 },
      { class: "pc_t_star", size: 10 },
    ];
    expect(starCluster(two, ...args, null)).toBeNull();
  });

  it("tells stars from planets by key while no game data is loaded", () => {
    const cluster = starCluster(
      [
        { class: "pc_b_star", size: 30 },
        { class: "pc_barren", size: 10 },
        { class: "pc_k_star", size: 20 },
      ],
      new Map(),
      new Map(),
      new Map(),
      TRINARY_ART,
    );
    expect(cluster).toHaveLength(2);
  });
});
