import { describe, expect, it } from "vitest";
import { placedNode } from "../../test/builders";
import { componentCount } from "../geometry/joinIslands";
import type { Pt } from "../geometry/pt";
import { provisionalId, provisionalIndex } from "../placement/lanes";
import { arrangeSpacing } from "./arrange";
import { toLocal } from "./frame";
import { GALAXY_FORMS } from "./galaxies";
import STATS from "./galaxyStats.json";
import { fillSpacing, laidCount, shapePlacement } from "./placement";
import {
  components,
  crossings,
  EMPTY,
  groundOf,
  OFF,
  pending as pendingOf,
  ROLLED,
  STATEMENTS,
} from "./placement.fixture";
import { SHAPE_SPECS } from "./specs";
import type { GalaxyForm, GalaxyShape, PendingShape, ShapePreview, SpacedFill } from "./types";

/**
 * What a galaxy the game generated looks like, from day-one saves of Stellaris 4.5.2 (medium,
 * and large for six arms), each system's distance and angle taken in galaxy radii: the share of
 * systems in each tenth of the radius outward, the radii a twentieth of them sit inside and
 * outside, and the arms' count, winding in radians per radius, strength (the debiased size of
 * the arm count's harmonic once the arms are unwound) and the share of lanes whose middle lies
 * in the quarter of a turn between arms.
 */
interface GalaxyStats {
  systems: number;
  radial: number[];
  core: number;
  rim: number;
  arms?: { count: number; wind: number; amplitude: number; gapLanes: number };
  side?: { wind: number; amplitude: number };
}

const SAVES = STATS as Record<GalaxyForm, GalaxyStats>;

const RADIUS = 450;
const SEED = 11;

function galaxy(form: GalaxyForm, over: Partial<GalaxyShape> = {}): GalaxyShape {
  return { ...SHAPE_SPECS.galaxy.initial, form, radius: RADIUS, ...over };
}

/** A scattered fill `spacing` apart, as a galaxy takes. */
function scattered(spacing: number): SpacedFill {
  return { kind: "scattered", spacing, edge: false };
}

/** A galaxy pending with a scattered fill `spacing` apart, its lanes among its new systems. */
function pending(
  shape: GalaxyShape,
  spacing = 1,
  over: Partial<PendingShape> & { fill?: SpacedFill } = {},
): PendingShape & { fill: SpacedFill } {
  const fill = over.fill ?? scattered(spacing);
  const lanes = { follow: false, mode: "new" } as const;
  return { ...pendingOf(shape, { lanes, seed: SEED, ...over }), fill };
}

/** A galaxy of `form` placed with as many systems as the save had at most, at the spacing that lays them. */
function laidLikeTheSave(form: GalaxyForm): ShapePreview {
  const rules = { ...STATEMENTS, cap: SAVES[form].systems };
  const spacing = fillSpacing(galaxy(form), scattered(1), OFF, rules);
  return shapePlacement(pending(galaxy(form), spacing), groundOf([], OFF, rules));
}

/** Each point's distance from the centre and angle round it, in radii and radians. */
function polar(points: readonly Pt[]): Array<{ r: number; t: number }> {
  return points.map((p) => ({ r: Math.hypot(p.x, p.y) / RADIUS, t: Math.atan2(p.y, p.x) }));
}

function radial(at: ReadonlyArray<{ r: number }>): number[] {
  const bins = new Array<number>(10).fill(0);
  for (const { r } of at) bins[Math.min(9, Math.floor(r * 10))]++;
  return bins.map((n) => n / at.length);
}

function percentile(values: number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

/** The `m`th harmonic of the angles once arms winding `wind` radians per radius are unwound. */
function harmonic(at: ReadonlyArray<{ r: number; t: number }>, m: number, wind: number) {
  let re = 0;
  let im = 0;
  for (const { r, t } of at) {
    re += Math.cos(m * (t - wind * r));
    im += Math.sin(m * (t - wind * r));
  }
  return { re: re / at.length, im: im / at.length };
}

/** The harmonic's size less what a random spread of as many points gives it. */
function amplitude(at: ReadonlyArray<{ r: number; t: number }>, m: number, wind: number) {
  const { re, im } = harmonic(at, m, wind);
  return Math.sqrt(Math.max(0, re * re + im * im - 1 / at.length));
}

/** The winding, to a twentieth of a radian per radius, that makes `m` arms strongest. */
function windingOf(at: ReadonlyArray<{ r: number; t: number }>, m: number): number {
  let best = 0;
  let most = -1;
  for (let k = -300; k <= 300; k++) {
    const a = amplitude(at, m, k / 20);
    if (a > most) [best, most] = [k / 20, a];
  }
  return best;
}

/** The share of `preview`'s lanes whose middle lies in the quarter of a turn between arms. */
function gapLanes(preview: ShapePreview, m: number, wind: number): number {
  const at = polar(preview.points);
  const { re, im } = harmonic(at, m, wind);
  const phase = Math.atan2(im, re);
  const between = preview.pairs.filter(([a, b]) => {
    const p = preview.points[provisionalIndex(a)];
    const q = preview.points[provisionalIndex(b)];
    const [mid] = polar([{ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }]);
    const d = m * (mid.t - wind * mid.r) - phase;
    return Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) > 0.75 * Math.PI;
  });
  return between.length / preview.pairs.length;
}

// Each figure of the save is itself drawn from about 600 systems, as ours is. The share of
// systems in a tenth of the radius then varies by about 0.016 either way in each, so a gap of
// 0.06 is over two and a half of those for the two together, with room for the fit's own miss.
// An arm harmonic varies by about 0.04 in each, so 0.1 is the same margin. A winding is held to
// one radian per radius, a twentieth of a turn across the galaxy's width for two arms.
const RADIAL_GAP = 0.06;
const CORE_GAP = 0.05;
const AMPLITUDE_GAP = 0.1;
const WIND_GAP = 1;
const GAP_LANES_OVER = 0.05;

describe("a galaxy's density map, against galaxies the game generated", () => {
  it.each(GALAXY_FORMS)("lays %s as the game does", (form) => {
    const save = SAVES[form];
    const preview = laidLikeTheSave(form);
    const at = polar(preview.points);
    expect(Math.abs(at.length - save.systems)).toBeLessThan(save.systems * 0.15);
    expect(at.every(({ r }) => r <= 1)).toBe(true);
    expect(components(preview)).toBe(1);
    radial(at).forEach((share, i) =>
      expect(Math.abs(share - save.radial[i])).toBeLessThan(RADIAL_GAP),
    );
    const r = at.map((p) => p.r);
    expect(Math.abs(percentile(r, 0.05) - save.core)).toBeLessThan(CORE_GAP);
    expect(Math.abs(percentile(r, 0.95) - save.rim)).toBeLessThan(CORE_GAP);
    const { arms, side } = save;
    if (arms) {
      expect(Math.abs(windingOf(at, arms.count) - arms.wind)).toBeLessThanOrEqual(WIND_GAP);
      expect(Math.abs(amplitude(at, arms.count, arms.wind) - arms.amplitude)).toBeLessThan(
        AMPLITUDE_GAP,
      );
      expect(gapLanes(preview, arms.count, arms.wind)).toBeLessThan(arms.gapLanes + GAP_LANES_OVER);
    } else {
      for (const m of [1, 2, 3, 4, 6]) expect(amplitude(at, m, 0)).toBeLessThan(AMPLITUDE_GAP);
    }
    if (side) {
      expect(Math.abs(windingOf(at, 1) - side.wind)).toBeLessThanOrEqual(WIND_GAP);
      expect(Math.abs(amplitude(at, 1, side.wind) - side.amplitude)).toBeLessThan(AMPLITUDE_GAP);
    }
  });
});

describe("a galaxy's fill", () => {
  it("lays the cap's worth at the closest spacing that fills it, and the preview places that many", () => {
    const rules = { ...STATEMENTS, cap: 300 };
    const lanes = { follow: false, mode: "off" } as const;
    for (const form of GALAXY_FORMS) {
      const shape = galaxy(form);
      const spacing = fillSpacing(shape, scattered(1), OFF, rules);
      const preview = shapePlacement(pending(shape, spacing, { lanes }), groundOf([], OFF, rules));
      expect(preview.capped).toBe(false);
      expect(preview.points.length).toBeGreaterThan(0.8 * rules.cap);
      expect(preview.points.length).toBe(laidCount(pending(shape), OFF, rules, spacing));
    }
  });

  it("lays no row round its rim, and keeps its points as it moves and turns", () => {
    const shape = galaxy("spiral_2", { radius: 200 });
    const lined = { kind: "scattered", spacing: 15, edge: true } as const;
    const here = shapePlacement(pending(shape, 15, { fill: lined }), EMPTY);
    const turned = { ...shape, centre: { x: 40, y: -25 }, rotation: 90 };
    const there = shapePlacement(pending(turned, 15, { fill: lined }), EMPTY);
    expect(here.points.every((p) => Math.hypot(p.x, p.y) < 0.95 * 200)).toBe(true);
    expect(there.points).toHaveLength(here.points.length);
    const own = (s: GalaxyShape) => (p: Pt) =>
      toLocal({ origin: s.centre, rotation: s.rotation }, p);
    there.points.map(own(turned)).forEach((p, i) => {
      const q = own(shape)(here.points[i]);
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(0.01);
    });
  });

  it("joins its pieces into one network, through the galaxy's own where New and nearby links them to it", () => {
    // A ring of existing systems through the shape's arms, each laned to the next: one network
    // whose lanes cut the new systems inside it from those outside.
    const ring = Array.from({ length: 24 }, (_, i) => {
      const t = (i * Math.PI) / 12;
      return placedNode(i + 1, 90 * Math.cos(t), 90 * Math.sin(t), [((i + 1) % 24) + 1]);
    });
    const existing = ring.flatMap((s) => s.lanes.map((l): [number, number] => [s.id, l.to]));
    const shape = galaxy("bar", { radius: 150 });
    for (const mode of ["new", "nearby"] as const) {
      const lanes = { follow: false, mode };
      const preview = shapePlacement(pending(shape, 10, { lanes }), groundOf(ring));
      expect(crossings(preview, ring)).toBe(0);
      if (mode === "new") continue;
      const points = [
        ...preview.points.map((p, i) => ({ id: provisionalId(i), ...p })),
        ...ring.map(({ id, x, y }) => ({ id, x, y })),
      ];
      expect(componentCount(points, [...preview.pairs, ...existing])).toBe(1);
    }
    const off = shapePlacement(
      pending(shape, 10, { lanes: { follow: false, mode: "off" } }),
      EMPTY,
    );
    expect(off.pairs).toEqual([]);
  });

  it("can be the shape a selection is arranged into, as many points as systems", () => {
    const shown = pending(galaxy("bar", { radius: 250 }), 10, {
      purpose: { kind: "arrange", ids: [], lanes: "keep", alsoOuter: false },
    });
    for (const n of [12, 75]) {
      const spacing = arrangeSpacing(shown, ROLLED, n);
      expect(spacing).not.toBeNull();
      expect(laidCount(shown, OFF, { ...ROLLED, cap: n }, spacing!)).toBe(n);
    }
  });
});
