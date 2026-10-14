import { describe, expect, it } from "vitest";
import type { SystemMove } from "../../generated/SystemMove";
import type { SystemNode } from "../../generated/SystemNode";
import { BRUSH_SETTINGS, drag } from "../../test/brush";
import { countryNode, lanesTo, systemNode } from "../../test/builders";
import { sampleGalaxy } from "../../test/sampleGalaxy";
import { segmentsCross } from "../geometry/segments";
import type { Pt } from "../geometry/pt";
import { seeded } from "../random";
import { SpatialGrid } from "../spatialGrid";
import { BrushStroke, type BrushSettings } from "./brushStroke";
import { homeSystems } from "./special";
import type { SpreadBrush } from "./spread";

const STEP = 20;
const SIDE = 11;

/** A lattice 20 apart about the centre, each system laned to the next along and down, jittered by up to 4. */
function lattice(): SystemNode[] {
  const rand = seeded(3);
  const id = (i: number, j: number) => i * SIDE + j + 1;
  const half = (SIDE - 1) / 2;
  const out: SystemNode[] = [];
  for (let i = 0; i < SIDE; i++) {
    for (let j = 0; j < SIDE; j++) {
      const to = [
        ...(i + 1 < SIDE ? [id(i + 1, j)] : []),
        ...(j + 1 < SIDE ? [id(i, j + 1)] : []),
        ...(i > 0 ? [id(i - 1, j)] : []),
        ...(j > 0 ? [id(i, j - 1)] : []),
      ];
      out.push(
        systemNode({
          id: id(i, j),
          x: (i - half) * STEP + (rand() - 0.5) * 8,
          y: (j - half) * STEP + (rand() - 0.5) * 8,
          lanes: lanesTo(...to),
        }),
      );
    }
  }
  return out;
}

/** Six systems within 3 of the centre, on top of the lattice's middle. */
const CLUMP = [
  [3, 0],
  [-2, 2],
  [-2, -2],
  [1, 2.5],
  [0.5, -2.5],
  [2, -1],
].map(([x, y], i) => systemNode({ id: 200 + i, x, y }));
const CLUMP_IDS = CLUMP.map((s) => s.id);

const CENTRE: Pt = { x: 0, y: 0 };
const SIZE = 80;

function settings(spread: Partial<SpreadBrush> = {}, over: Partial<BrushSettings> = {}) {
  return {
    ...BRUSH_SETTINGS,
    tool: "spread",
    size: SIZE,
    ...over,
    spread: { ...BRUSH_SETTINGS.spread, ...spread },
  } satisfies BrushSettings;
}

/** `passes` stamps at each point of `path`, as holding still there would lay them, then `hold` more at its end. */
function sculpt(systems: SystemNode[], brush: BrushSettings, path: Pt[], passes = 60, hold = 0) {
  const galaxy = new Map(systems.map((s) => [s.id, s]));
  const grid = new SpatialGrid();
  grid.build(systems);
  const stroke = new BrushStroke(brush, galaxy, grid, 1, { systems: galaxy, grid });
  for (const stamps of drag(path, brush.size / 2)) {
    for (const stamp of stamps) stroke.add([stamp]);
    for (let i = 1; i < passes; i++) stroke.add([stamps[stamps.length - 1]]);
  }
  for (let i = 0; i < hold; i++) stroke.add([path[path.length - 1]]);
  const result = stroke.result();
  if (result.kind !== "move") throw new Error(result.kind);
  return { galaxy, moves: result.moves, after: placed(systems, result.moves) };
}

/** Where every system stands once `moves` are made. */
function placed(systems: SystemNode[], moves: readonly SystemMove[]): Map<number, Pt> {
  const at = new Map(systems.map((s): [number, Pt] => [s.id, { x: s.x, y: s.y }]));
  for (const m of moves) at.set(m.system, { x: m.x, y: m.y });
  return at;
}

function nearestSpread(ids: readonly number[], at: ReadonlyMap<number, Pt>): number {
  return Math.min(
    ...ids.map((a) =>
      Math.min(...ids.filter((b) => b !== a).map((b) => dist(at.get(a)!, at.get(b)!))),
    ),
  );
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function crossings(systems: SystemNode[], at: ReadonlyMap<number, Pt>): number {
  const lanes = systems.flatMap((s) =>
    s.lanes.filter((l) => l.to > s.id).map((l): [number, number] => [s.id, l.to]),
  );
  let count = 0;
  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      const [a, b] = lanes[i];
      const [c, d] = lanes[j];
      if (segmentsCross(at.get(a)!, at.get(b)!, at.get(c)!, at.get(d)!)) count++;
    }
  }
  return count;
}

function closestPair(at: ReadonlyMap<number, Pt>): number {
  const all = [...at.values()];
  let least = Infinity;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) least = Math.min(least, dist(all[i], all[j]));
  }
  return least;
}

describe("a spread stroke", () => {
  it("spreads a clump out", () => {
    const systems = [...lattice(), ...CLUMP];
    const before = placed(systems, []);
    const { after } = sculpt(systems, settings(), [CENTRE]);
    expect(nearestSpread(CLUMP_IDS, after)).toBeGreaterThan(3 * nearestSpread(CLUMP_IDS, before));
  });

  it("gathers the systems under it towards its centre with Alt", () => {
    const systems = lattice();
    const under = systems.filter((s) => dist(s, CENTRE) <= SIZE / 2);
    const mean = (at: ReadonlyMap<number, Pt>) =>
      under.reduce((sum, s) => sum + dist(at.get(s.id)!, CENTRE), 0) / under.length;
    const { after } = sculpt(systems, settings({ gather: true }), [CENTRE]);
    expect(mean(after)).toBeLessThan(0.9 * mean(placed(systems, [])));
  });

  it("moves no system outside the brush", () => {
    const systems = [...lattice(), ...CLUMP];
    for (const gather of [false, true]) {
      const { galaxy, moves } = sculpt(systems, settings({ gather }), [CENTRE]);
      expect(moves.length).toBeGreaterThan(0);
      for (const m of moves)
        expect(dist(galaxy.get(m.system)!, CENTRE)).toBeLessThanOrEqual(SIZE / 2);
    }
  });

  it("never makes two lanes cross", () => {
    const systems = lattice();
    const path = [
      { x: -80, y: -60 },
      { x: 0, y: 10 },
      { x: 70, y: 60 },
    ];
    expect(crossings(systems, placed(systems, []))).toBe(0);
    for (const gather of [false, true]) {
      const brush = settings({ gather, strength: 1 });
      const { moves, after } = sculpt(systems, brush, path, 200);
      expect(moves.length).toBeGreaterThan(0);
      expect(crossings(systems, after)).toBe(0);
    }
  });

  it("pushes no system past the map's edge", () => {
    const systems = lattice().filter((s) => Math.hypot(s.x, s.y) <= 95);
    const edge = { shape: "circle", radius: 100 } as const;
    const { moves, after } = sculpt(
      systems,
      settings({ edge, strength: 1 }),
      [{ x: 90, y: 0 }],
      200,
    );
    expect(moves.length).toBeGreaterThan(0);
    for (const p of after.values()) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(100);
  });

  it("brings no two systems closer than the gap", () => {
    const systems = lattice();
    expect(closestPair(placed(systems, []))).toBeGreaterThan(10);
    const brush = settings({ gather: true, strength: 1, gap: 10 });
    const { moves, after } = sculpt(systems, brush, [CENTRE], 300);
    expect(moves.length).toBeGreaterThan(0);
    expect(closestPair(after)).toBeGreaterThanOrEqual(10);
  });

  it("leaves special and home systems where they are unless told to move them", () => {
    const wormhole = { ...CLUMP[0], wormhole_pair: 1 };
    const [, home, guardian, plain] = CLUMP;
    // A save names an initializer for every system, so a plain one moves whatever it names.
    const named = { ...plain, initializer: "basic_init_06" };
    const systems = [...lattice(), wormhole, home, guardian, named, ...CLUMP.slice(4)];
    // The homes and the special systems game data finds, as the store passes them.
    const kept = new Set([home.id, guardian.id]);
    const still = [wormhole.id, home.id, guardian.id];
    const moved = sculpt(systems, settings({ kept }), [CENTRE]).moves.map((m) => m.system);
    for (const id of still) expect(moved).not.toContain(id);
    expect(moved).toContain(named.id);
    const all = sculpt(systems, settings({ kept, specials: true }), [CENTRE]).moves;
    expect(all.map((m) => m.system)).toEqual(expect.arrayContaining(still));
  });

  it("moves each system's images with it under symmetry", () => {
    const quarter = { kind: "rotate", n: 4 } as const;
    const turned = (s: SystemNode, k: number): SystemNode => {
      let { x, y } = s;
      for (let i = 0; i < k; i++) [x, y] = [-y, x];
      return { ...s, id: s.id + 1000 * k, x, y };
    };
    const three = [
      systemNode({ id: 1, x: 200, y: 50 }),
      systemNode({ id: 2, x: 202, y: 51 }),
      systemNode({ id: 3, x: 215, y: 50 }),
    ];
    const systems = [0, 1, 2, 3].flatMap((k) => three.map((s) => turned(s, k)));
    const { galaxy, moves } = sculpt(systems, settings({}, { symmetry: quarter }), [
      { x: 205, y: 50 },
    ]);
    const shift = (id: number) => {
      const m = moves.find((move) => move.system === id);
      const s = galaxy.get(id)!;
      return m ? { x: m.x - s.x, y: m.y - s.y } : { x: 0, y: 0 };
    };
    expect(moves.length).toBeGreaterThanOrEqual(8);
    for (const s of three) {
      const d = shift(s.id);
      const e = shift(s.id + 1000);
      expect(e.x).toBeCloseTo(-d.y, 9);
      expect(e.y).toBeCloseTo(d.x, 9);
    }
  });

  it("spreads a lone clump out to fill the brush", () => {
    const rand = seeded(5);
    const clump = Array.from({ length: 10 }, (_, i) =>
      systemNode({ id: i + 1, x: (i % 4) * 3 + rand(), y: Math.floor(i / 4) * 3 + rand() }),
    );
    const ids = clump.map((s) => s.id);
    const before = nearestSpread(ids, placed(clump, []));
    const { after } = sculpt(clump, settings(), [{ x: 4, y: 3 }]);
    expect(nearestSpread(ids, after)).toBeGreaterThan(3 * before);
  });

  it("keeps a system on the mirror's axis on it, and one at the centre of a rotation still", () => {
    const mirror = { kind: "mirror", axis: "x" } as const;
    const onAxis = [
      systemNode({ id: 1, x: 100, y: 0 }),
      systemNode({ id: 2, x: 103, y: 3 }),
      systemNode({ id: 3, x: 103, y: -3 }),
      systemNode({ id: 4, x: 96, y: 2 }),
      systemNode({ id: 5, x: 96, y: -2 }),
    ];
    for (const gather of [false, true]) {
      const brush = settings({ gather }, { symmetry: mirror });
      const { after } = sculpt(onAxis, brush, [{ x: 102, y: 10 }]);
      expect(after.get(1)!.y).toBe(0);
      expect(after.get(2)!.y).toBeCloseTo(-after.get(3)!.y, 9);
    }

    const quarter = { kind: "rotate", n: 4 } as const;
    const atCentre = [
      systemNode({ id: 1, x: 0, y: 0 }),
      ...[
        [3, 1],
        [-1, 3],
        [-3, -1],
        [1, -3],
      ].map(([x, y], i) => systemNode({ id: i + 2, x, y })),
    ];
    for (const gather of [false, true]) {
      const brush = settings({ gather }, { symmetry: quarter });
      const { moves } = sculpt(atCentre, brush, [{ x: 5, y: 5 }]);
      expect(moves.length).toBeGreaterThan(0);
      expect(moves.map((m) => m.system)).not.toContain(1);
    }
  });

  it("parts two systems standing on the same point", () => {
    const systems = [
      systemNode({ id: 1, x: 0, y: 0 }),
      systemNode({ id: 2, x: 0, y: 0 }),
      systemNode({ id: 3, x: 15, y: 0 }),
    ];
    const { moves, after } = sculpt(systems, settings(), [CENTRE]);
    for (const m of moves) expect(Number.isFinite(m.x) && Number.isFinite(m.y)).toBe(true);
    expect(dist(after.get(1)!, after.get(2)!)).toBeGreaterThan(5);
  });
});

describe("home systems", () => {
  it("are each country's capital and each system marked as a home", () => {
    const systems = [systemNode({ id: 1 }), systemNode({ id: 2, home_system: true })];
    const countries = [countryNode({ capital_system: 7 }), countryNode({ capital_system: null })];
    expect([...homeSystems(systems, countries)].sort()).toEqual([2, 7]);
  });
});

describe("a spread stroke over the sample save's galaxy", () => {
  const systems = sampleGalaxy();
  const grid = new SpatialGrid();
  grid.build(systems);
  /** The system with the most others within 25 of it: a crowded group of laned systems. */
  const crowded = systems
    .map((s) => {
      let n = 0;
      grid.forEachWithin(s.x, s.y, 25, () => n++);
      return { s, n };
    })
    .reduce((a, b) => (b.n > a.n ? b : a)).s;
  const edge = { shape: "circle", radius: 1000 } as const;

  it("evens out a crowded group, as a drag across it and five seconds held still would", () => {
    const brush = settings({ gap: 10, edge }, { size: 36 });
    const start = { x: crowded.x - 30, y: crowded.y };
    const path = Array.from({ length: 31 }, (_, i) => ({ x: start.x + i, y: start.y }));
    const { moves, after } = sculpt(systems, brush, path, 1, 300);
    const before = placed(systems, []);
    const under = systems.filter((s) => dist(s, crowded) <= 18).map((s) => s.id);

    expect(moves.length).toBeGreaterThan(2);
    const farthest = Math.max(...moves.map((m) => dist(m, before.get(m.system)!)));
    expect(farthest).toBeGreaterThan(3);
    const nearest = (at: ReadonlyMap<number, Pt>) =>
      Math.min(...under.map((id) => nearestOf(id, at)));
    expect(nearest(after)).toBeGreaterThan(nearest(before));

    expect(crossingPairs(systems, after)).toEqual(crossingPairs(systems, before));
    for (const m of moves) {
      expect(nearestOf(m.system, after)).toBeGreaterThanOrEqual(
        Math.min(10, nearestOf(m.system, before)),
      );
    }
  });
});

/** The distance from system `id` to the nearest other, where `at` puts them all. */
function nearestOf(id: number, at: ReadonlyMap<number, Pt>): number {
  const p = at.get(id)!;
  let least = Infinity;
  for (const [other, q] of at) if (other !== id) least = Math.min(least, dist(p, q));
  return least;
}

/** Every pair of lanes that cross, where `at` puts the systems, as sorted keys. */
function crossingPairs(systems: SystemNode[], at: ReadonlyMap<number, Pt>): string[] {
  const lanes = systems.flatMap((s) =>
    s.lanes.filter((l) => l.to > s.id).map((l): [number, number] => [s.id, l.to]),
  );
  const out: string[] = [];
  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      const [a, b] = lanes[i];
      const [c, d] = lanes[j];
      if (segmentsCross(at.get(a)!, at.get(b)!, at.get(c)!, at.get(d)!)) {
        out.push(`${a}-${b}x${c}-${d}`);
      }
    }
  }
  return out.sort();
}
