import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { NewSystem } from "../generated/NewSystem";
import type { Op } from "../generated/Op";
import { BrushStroke, type BrushSettings } from "../lib/brush/brushStroke";
import type { Pair } from "../lib/geometry/pairs";
import { stampsAlong } from "../lib/brush/stroke";
import type { Symmetry } from "../lib/geometry/symmetry";
import { segmentsCross } from "../lib/geometry/segments";
import type { Pt } from "../lib/geometry/pt";
import { editor, openFixtureSave, openFixtureScenario, sessionError } from "./editorFixture";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { SCENARIO_RESULT, SYSTEMS, editResult, node, placedNode } from "./fixture";
import { openPlaced, sent, sym } from "./symmetryFixture";
import { spreadBrush, useToolStore } from "./toolStore";
import { mockedIpc } from "../test/ipc";
import { flush } from "../test/flush";
import type { EditResult } from "../generated/EditResult";
import { BRUSH_SETTINGS } from "../test/brush";
import { DEFAULT_SYSTEM_HEIGHT, SPAWN_BUFFER } from "../generated/constants";

const ERASE: BrushSettings = {
  ...BRUSH_SETTINGS,
  tool: "erase",
  size: 6,
  spacing: 25,
  laneMode: "off",
};

beforeEach(async () => {
  await openFixtureScenario();
  mockedIpc.applyOp.mockResolvedValue(editResult());
});

describe("a paint stroke", () => {
  it("sends its systems under the next free ids and its lanes, to an existing system too, as one edit", async () => {
    const points = [
      { x: 200, y: 200 },
      { x: 212.5, y: 200 },
    ];
    await editor().paintStroke(points, [
      [-2, -1],
      [-1, 3],
    ]);
    const added = (id: number, p: { x: number; y: number }) => ({
      system: id,
      x: p.x,
      y: p.y,
      name: null,
      initializer: null,
      spawn_weight: null,
      spawn_script: null,
    });
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Painted 2 systems and 2 lanes",
      ops: [
        { type: "AddSystems", systems: [added(6, points[0]), added(7, points[1])] },
        {
          type: "AddLanePairs",
          lanes: [
            { a: 7, b: 6, bridge: false },
            { a: 6, b: 3, bridge: false },
          ],
        },
      ],
    });
  });

  it("names one system and no lanes in the singular", async () => {
    await editor().paintStroke([{ x: 200, y: 200 }], []);
    expect(mockedIpc.applyOp.mock.calls[0][0]).toMatchObject({
      type: "Batch",
      description: "Painted 1 system",
    });
  });
});

describe("an erase stroke", () => {
  it("removes the systems it swept as one edit", async () => {
    await editor().eraseStroke([0]);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "Batch",
      description: "Erased 1 system",
      ops: [{ type: "RemoveSystems", systems: [0] }],
    });

    await editor().eraseStroke([0, 1]);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "Batch",
      description: "Erased 2 systems",
      ops: [{ type: "RemoveSystems", systems: [0, 1] }],
    });
  });

  it("a refused stroke reports why and leaves the galaxy as it was", async () => {
    mockedIpc.applyOp.mockRejectedValueOnce({ kind: "op", message: "no such system" });
    expect(await editor().eraseStroke([0])).toBe(false);
    expect(sessionError()).toBe("no such system");
    expect(useGalaxyStore.getState().systems.has(0)).toBe(true);
  });
});

describe("a connect stroke", () => {
  it("adds the lanes it found as one edit, on a save too", async () => {
    await editor().connectStroke([
      [0, 2],
      [2, 3],
    ]);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Connected 2 lanes",
      ops: [
        {
          type: "AddLanePairs",
          lanes: [
            { a: 0, b: 2, bridge: false },
            { a: 2, b: 3, bridge: false },
          ],
        },
      ],
    });

    await openFixtureSave();
    mockedIpc.applyOp.mockResolvedValue(editResult());
    expect(await editor().connectStroke([[2, 3]])).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Connected 1 lane",
      ops: [{ type: "AddLanePairs", lanes: [{ a: 2, b: 3, bridge: false }] }],
    });
  });
});

describe("a cut stroke", () => {
  it("cuts the lanes it passes over as one edit, on a save too", async () => {
    await openFixtureSave();
    mockedIpc.applyOp.mockResolvedValue(editResult());
    await editor().cutLanes([[0, 1]]);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Cut 1 lane",
      ops: [{ type: "RemoveLanePairs", lanes: [[0, 1]] }],
    });
  });
});

/** A stroke through `path` over the galaxy the store holds. */
function stroke(settings: Partial<BrushSettings>, path: Pt[]) {
  const { systems, grid } = useGalaxyStore.getState();
  const s = new BrushStroke({ ...ERASE, ...settings }, systems, grid!, 1, { systems, grid: grid! });
  let prev: Pt | null = null;
  for (const next of path) {
    s.add(stampsAlong(prev, next, s.r));
    prev = next;
  }
  return s.result();
}

/** What the last paint edit sent: its systems, and its lanes as ordered pairs of real ids. */
function sentPaint(): { description: string; systems: NewSystem[]; lanes: Pair[] } {
  const calls = mockedIpc.applyOp.mock.calls;
  const op = calls[calls.length - 1][0] as Extract<Op, { type: "Batch" }>;
  const [add, link] = op.ops;
  if (add.type !== "AddSystems") throw new Error(add.type);
  const lanes =
    link?.type === "AddLanePairs"
      ? link.lanes.map(({ a, b, bridge }): Pair => {
          expect(bridge).toBe(false);
          return a < b ? [a, b] : [b, a];
        })
      : [];
  return { description: op.description, systems: add.systems, lanes };
}

/**
 * That the painted systems are exact images, copy k of base system i at index k * count + i,
 * and that the lanes are distinct, cross each other nowhere and map onto lanes under `turn`,
 * which takes an existing system to the one `existing` names. `close` allows float noise in the images.
 */
function expectSymmetric(
  sent: ReturnType<typeof sentPaint>,
  copies: number,
  turn: (p: Pt) => Pt,
  existing: ReadonlyMap<number, number> = new Map(),
  close = false,
): void {
  const { systems, lanes } = sent;
  const count = systems.length / copies;
  expect(Number.isInteger(count) && count > 0).toBe(true);
  const first = systems[0].system;
  systems.forEach((s, i) => expect(s.system).toBe(first + i));
  for (let i = 0; i < systems.length; i++) {
    const next = systems[(i + count) % systems.length];
    const want = turn(systems[i]);
    if (close) {
      expect(next.x).toBeCloseTo(want.x, 9);
      expect(next.y).toBeCloseTo(want.y, 9);
    } else {
      expect({ x: next.x, y: next.y }).toEqual(want);
    }
  }
  const turned = (id: number) =>
    id >= first ? first + ((id - first + count) % systems.length) : (existing.get(id) ?? id);
  const keys = new Set(lanes.map(([a, b]) => `${a},${b}`));
  expect(keys.size).toBe(lanes.length);
  for (const [a, b] of lanes) {
    const [c, d] = [turned(a), turned(b)].sort((x, y) => x - y);
    expect(keys.has(`${c},${d}`)).toBe(true);
  }
  const all = useGalaxyStore.getState().systems;
  const at = (id: number): Pt => (id >= first ? systems[id - first] : all.get(id)!);
  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      const [a, b] = lanes[i];
      const [c, d] = lanes[j];
      expect(segmentsCross(at(a), at(b), at(c), at(d))).toBe(false);
    }
  }
}

const MIRROR_X: Symmetry = { kind: "mirror", axis: "x" };
const QUARTER: Symmetry = { kind: "rotate", n: 4 };
const mirrorX = (p: Pt): Pt => ({ x: p.x, y: -p.y });
const quarterTurn = (p: Pt): Pt => ({ x: -p.y, y: p.x });
const PAINT: Partial<BrushSettings> = { tool: "paint", size: 60, spacing: 20, laneMode: "new" };

describe("a symmetric paint stroke", () => {
  it("sends every system at its exact mirror image, with the lanes mirrored too", async () => {
    const painted = stroke({ ...PAINT, symmetry: MIRROR_X }, [
      { x: 150, y: 120 },
      { x: 260, y: 140 },
    ]);
    if (painted.kind !== "paint") throw new Error(painted.kind);
    await editor().paintStroke(painted.points, painted.pairs);
    const sent = sentPaint();
    expect(sent.lanes.length).toBeGreaterThan(0);
    expect(sent.description).toBe(
      `Painted ${sent.systems.length} systems and ${sent.lanes.length} lanes`,
    );
    expectSymmetric(sent, 2, mirrorX);
  });

  it("keeps clear of the mirror axis and links the two halves across it", async () => {
    const painted = stroke({ ...PAINT, symmetry: MIRROR_X }, [
      { x: 200, y: -40 },
      { x: 200, y: 40 },
    ]);
    if (painted.kind !== "paint") throw new Error(painted.kind);
    await editor().paintStroke(painted.points, painted.pairs);
    const sent = sentPaint();
    expectSymmetric(sent, 2, mirrorX);
    for (const s of sent.systems) expect(Math.abs(2 * s.y)).toBeGreaterThanOrEqual(20);
    const half = sent.systems.length / 2;
    const first = sent.systems[0].system;
    const copyOf = (id: number) => Math.floor((id - first) / half);
    expect(sent.lanes.some(([a, b]) => copyOf(a) !== copyOf(b))).toBe(true);
  });

  it("sends four exact quarter turns of every system and lane", async () => {
    const painted = stroke({ ...PAINT, symmetry: QUARTER }, [
      { x: 150, y: 50 },
      { x: 250, y: 90 },
    ]);
    if (painted.kind !== "paint") throw new Error(painted.kind);
    await editor().paintStroke(painted.points, painted.pairs);
    const sent = sentPaint();
    expect(sent.lanes.length).toBeGreaterThan(0);
    expectSymmetric(sent, 4, quarterTurn);
  });

  it("links to the systems nearby only where every copy has one at the image", async () => {
    // 20 and 21 mirror each other; nothing mirrors 22.
    useGalaxyStore.getState().applyDelta({
      systems: [placedNode(20, 200, 100), placedNode(21, 200, -100), placedNode(22, 300, 100)],
    });
    const painted = stroke({ ...PAINT, laneMode: "nearby", symmetry: MIRROR_X }, [
      { x: 170, y: 120 },
      { x: 330, y: 120 },
    ]);
    if (painted.kind !== "paint") throw new Error(painted.kind);
    await editor().paintStroke(painted.points, painted.pairs);
    const sent = sentPaint();
    expectSymmetric(
      sent,
      2,
      mirrorX,
      new Map([
        [20, 21],
        [21, 20],
      ]),
    );
    const ends = new Set(sent.lanes.flat());
    expect(ends.has(20)).toBe(true);
    expect(ends.has(21)).toBe(true);
    expect(ends.has(22)).toBe(false);
  });

  it("links to the systems an earlier three-fold stroke left, whose saved images are rounded", async () => {
    const third = (p: Pt): Pt => {
      const [c, t] = [Math.cos((2 * Math.PI) / 3), Math.sin((2 * Math.PI) / 3)];
      return { x: c * p.x - t * p.y, y: t * p.x + c * p.y };
    };
    const THREE: Symmetry = { kind: "rotate", n: 3 };
    const before = stroke({ ...PAINT, symmetry: THREE }, [
      { x: 150, y: 0 },
      { x: 250, y: 0 },
    ]);
    if (before.kind !== "paint") throw new Error(before.kind);
    // As the file writes them back: five decimals.
    const rounded = (v: number) => Math.round(v * 1e5) / 1e5;
    const id = (p: number) => (p < 0 ? 99 - p : p);
    const pairs = before.pairs.map(([a, b]) => [id(a), id(b)]);
    useGalaxyStore.getState().applyDelta({
      systems: before.points.map((p, i) => {
        const me = 100 + i;
        const to = pairs.flatMap(([a, b]) => (a === me ? [b] : b === me ? [a] : []));
        return placedNode(me, rounded(p.x), rounded(p.y), to);
      }),
    });
    const total = before.points.length;
    const turnedEarlier = new Map(
      before.points.map((_, i) => [100 + i, 100 + ((i + total / 3) % total)]),
    );

    const painted = stroke({ ...PAINT, laneMode: "nearby", symmetry: THREE }, [
      { x: 150, y: 50 },
      { x: 250, y: 50 },
    ]);
    if (painted.kind !== "paint") throw new Error(painted.kind);
    await editor().paintStroke(painted.points, painted.pairs);
    const sent = sentPaint();
    expectSymmetric(sent, 3, third, turnedEarlier, true);
    expect(sent.lanes.some(([a]) => turnedEarlier.has(a))).toBe(true);
  });
});

describe("joining islands", () => {
  it("links the isolated Deneb to its nearest neighbour as one edit", async () => {
    expect(await editor().joinIslands()).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Joined 2 islands",
      ops: [{ type: "AddLanePairs", lanes: [{ a: 0, b: 5, bridge: false }] }],
    });
    expect(sessionError()).toBeNull();
  });

  it("works on a save", async () => {
    await openFixtureSave();
    mockedIpc.applyOp.mockResolvedValue(editResult());
    expect(await editor().joinIslands()).toBe(true);
    expect(mockedIpc.applyOp.mock.calls[0][0]).toMatchObject({ description: "Joined 2 islands" });
  });

  it("says as a notice, not an error, how many islands a join leaves walled off", async () => {
    // A lone system amid a pinwheel of three lanes, each lane's ends hidden behind another.
    const blade = (id: number, [ax, ay]: number[], [bx, by]: number[]) => [
      placedNode(id, ax, ay, [id + 1]),
      placedNode(id + 1, bx, by, [id]),
    ];
    const systems = [
      placedNode(0, 0, 0),
      ...blade(1, [-3, -26], [32, 42]),
      ...blade(3, [24.017, 10.402], [-52.373, 6.713]),
      ...blade(5, [-21.017, 15.598], [20.373, -48.713]),
    ];
    useGalaxyStore.getState().load({ ...SCENARIO_RESULT.galaxy, systems });

    expect(await editor().joinIslands()).toBe(true);
    expect(useFileSessionStore.getState().notice).toMatch(/^\d islands remain: /);
    expect(sessionError()).toBeNull();
  });

  it("sends nothing when the galaxy is already one piece", async () => {
    useGalaxyStore.getState().applyDelta({
      systems: [
        {
          ...SYSTEMS[0],
          lanes: [...SYSTEMS[0].lanes, { to: 5, length: 56, bridge: false, stale: false }],
        },
        { ...SYSTEMS[5], lanes: [{ to: 0, length: 56, bridge: false, stale: false }] },
      ],
    });
    expect(await editor().joinIslands()).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});

describe("a height stroke", () => {
  it("sends every system it moved, written absolute, as one edit", async () => {
    await openFixtureSave();
    mockedIpc.applyOp.mockResolvedValue(editResult());
    const result = stroke({ tool: "height", size: 24, height: { ...ERASE.height, raise: 10 } }, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ]);
    if (result.kind !== "height") throw new Error(result.kind);
    await editor().sculptHeights(result.over);

    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "SetSystemHeights",
      heights: [
        { system: 0, height: DEFAULT_SYSTEM_HEIGHT + 10 },
        { system: 1, height: DEFAULT_SYSTEM_HEIGHT + 10 },
      ],
    });
  });
});

describe("a spread stroke", () => {
  const QUARTER: Symmetry = { kind: "rotate", n: 4 };
  /** System 20 of the placed fixture with two more beside it, and their quarter turns. */
  const beside = (k: number): Pt[] => {
    let pts = [
      { x: 302, y: 101 },
      { x: 315, y: 100 },
    ];
    for (let i = 0; i < k; i++) pts = pts.map(({ x, y }) => ({ x: -y, y: x }));
    return pts;
  };

  beforeEach(async () => {
    await openPlaced();
    const clump = [0, 1, 2, 3].flatMap((k) =>
      beside(k).map((p, i) => node(30 + 10 * k + i, "", p.x, p.y, "sc_g", [], { initializer: "" })),
    );
    useGalaxyStore.getState().applyDelta({ systems: clump });
  });

  /** A stroke held still at (305, 100) for `passes` frames, as the open document and options stand. */
  function spread(passes = 30) {
    const { systems, grid } = useGalaxyStore.getState();
    const settings = { ...ERASE, tool: "spread", size: 40, spread: spreadBrush(false) } as const;
    const s = new BrushStroke(
      { ...settings, symmetry: useToolStore.getState().symmetry },
      systems,
      grid!,
      1,
      {
        systems,
        grid: grid!,
      },
    );
    for (let i = 0; i < passes; i++) s.add([{ x: 305, y: 100 }]);
    const result = s.result();
    if (result.kind !== "move") throw new Error(result.kind);
    return result;
  }

  it("sends every system it moved as one MoveSystems, which one undo takes back", async () => {
    const before = useGalaxyStore.getState().systems;
    const result = spread();
    expect(result.moves.length).toBeGreaterThan(0);
    await editor().spreadStroke(result.over, result.gather);

    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: `Spread ${result.moves.length} systems`,
      ops: [{ type: "MoveSystems", moves: result.moves }],
    });

    const moved = result.moves.map((m) => ({ ...before.get(m.system)!, x: m.x, y: m.y }));
    useGalaxyStore.getState().applyDelta({ systems: moved });
    mockedIpc.undo.mockResolvedValueOnce(
      editResult({
        delta: { systems: result.moves.map((m) => before.get(m.system)!) },
        history: { undo: [], redo: [] },
      }),
    );
    await editor().undo();
    for (const m of result.moves) {
      const s = useGalaxyStore.getState().systems.get(m.system)!;
      expect({ x: s.x, y: s.y }).toEqual({
        x: before.get(m.system)!.x,
        y: before.get(m.system)!.y,
      });
    }
  });

  it("on a save, keeps the spawn buffer between systems and the galaxy's radius as its edge", async () => {
    await openFixtureSave();
    const radius = useGalaxyStore.getState().galaxy!.galaxy_radius;
    expect(radius).toBeGreaterThan(0);
    expect(spreadBrush(false)).toMatchObject({
      gap: SPAWN_BUFFER,
      edge: { shape: "circle", radius },
    });
    expect(SPAWN_BUFFER).toBe(10);
  });

  it("works its moves out from where a stroke sent before it left the systems", async () => {
    let land: (result: EditResult) => void = () => undefined;
    mockedIpc.applyOp.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const first = spread();
    // Laid over the same galaxy, as a stroke begun before the first lands is.
    const second = spread();
    const sending = [
      editor().spreadStroke(first.over, false),
      editor().spreadStroke(second.over, false),
    ];
    await flush();
    const before = useGalaxyStore.getState().systems;
    const moved = first.moves.map((m) => ({ ...before.get(m.system)!, x: m.x, y: m.y }));
    land(editResult({ delta: { systems: moved } }));
    await Promise.all(sending);

    const { systems, grid } = useGalaxyStore.getState();
    for (const m of first.moves) expect(systems.get(m.system)).toMatchObject({ x: m.x, y: m.y });
    const op = sent() as Extract<Op, { type: "Batch" }>;
    const moves = op.ops[0].type === "MoveSystems" ? op.ops[0].moves : [];
    expect(moves).toEqual(second.over(systems, grid!));
    expect(moves).not.toEqual(second.moves);
  });

  it("moves each system's images by the same turn of its move under symmetry", async () => {
    sym(QUARTER);
    const before = useGalaxyStore.getState().systems;
    const result = spread();
    await editor().spreadStroke(result.over, result.gather);
    const op = sent() as Extract<Op, { type: "Batch" }>;
    const moves = op.ops[0].type === "MoveSystems" ? op.ops[0].moves : [];
    const shift = (id: number) => {
      const m = moves.find((move) => move.system === id);
      const s = before.get(id)!;
      return m ? { x: m.x - s.x, y: m.y - s.y } : { x: 0, y: 0 };
    };
    expect(moves.map((m) => m.system)).toEqual(expect.arrayContaining([20, 21, 22, 23]));
    for (const [id, image] of [
      [20, 21],
      [30, 40],
      [31, 41],
    ]) {
      const d = shift(id);
      expect(shift(image).x).toBeCloseTo(-d.y, 9);
      expect(shift(image).y).toBeCloseTo(d.x, 9);
    }
  });
});

describe("an empty stroke", () => {
  it.each([
    ["paint", () => editor().paintStroke([], [])],
    ["erase", () => editor().eraseStroke([])],
    ["cut", () => editor().cutLanes([])],
    ["connect", () => editor().connectStroke([])],
    ["spread", () => editor().spreadStroke(() => [], false)],
    [
      "height",
      async () => {
        await openFixtureSave();
        return editor().sculptHeights(() => new Map());
      },
    ],
  ])("of the %s brush sends nothing", async (_brush, stroke) => {
    expect(await stroke()).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});
