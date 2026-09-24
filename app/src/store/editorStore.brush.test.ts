import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import type { NewSystem } from "../generated/NewSystem";
import type { Op } from "../generated/Op";
import { BrushStroke, type BrushSettings } from "../lib/brush/brushStroke";
import type { Pair } from "../lib/geometry/pairs";
import { stampsAlong } from "../lib/brush/stroke";
import type { Symmetry } from "../lib/geometry/symmetry";
import { segmentsCross } from "../lib/geometry/segments";
import type { Pt } from "../lib/geometry/pt";
import { run } from "./commands";
import { editor, mocked, openFixtureSave, sessionError } from "./editorFixture";
import { canDelete, deletableSelection } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { SCENARIO_RESULT, SYSTEMS, editResult, node, placedNode } from "./fixture";

const effects = { focusSearch: vi.fn(), browseInitializers: vi.fn() };

const ERASE: BrushSettings = {
  tool: "erase",
  size: 6,
  spacing: 25,
  laneMode: "off",
  eraseTarget: "systems",
  eraseSpecials: false,
  symmetry: { kind: "off" },
  beta: 1,
};

/** An erase stroke over the galaxy the store holds, by default from Sol to Alpha Centauri. */
function erase(settings: Partial<BrushSettings> = {}, to = { x: 10, y: 0 }) {
  const { systems, grid } = useGalaxyStore.getState();
  const stroke = new BrushStroke({ ...ERASE, ...settings }, systems, grid!, 1);
  stroke.add(stampsAlong(null, { x: 0, y: 0 }, 3));
  stroke.add(stampsAlong({ x: 0, y: 0 }, to, 3));
  return stroke.result();
}

beforeEach(async () => {
  await openFixtureSave();
  mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
  await useFileSessionStore.getState().openSave(SCENARIO_RESULT.path);
  mocked.applyOp.mockResolvedValue(editResult());
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
      id,
      x: p.x,
      y: p.y,
      name: null,
      initializer: null,
      spawn_weight: null,
      spawn_script: null,
    });
    expect(mocked.applyOp).toHaveBeenCalledTimes(1);
    expect(mocked.applyOp).toHaveBeenCalledWith({
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
    expect(mocked.applyOp.mock.calls[0][0]).toMatchObject({
      type: "Batch",
      description: "Painted 1 system",
    });
  });

  it("sends nothing for an empty stroke", async () => {
    expect(await editor().paintStroke([], [])).toBe(false);
    expect(await editor().eraseStroke([])).toBe(false);
    expect(await editor().cutLanes([])).toBe(false);
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });
});

describe("an erase stroke", () => {
  it("keeps the special systems it passes over unless told to take them", async () => {
    useGalaxyStore.getState().applyDelta({ systems: [{ ...SYSTEMS[0], initializer: "" }] });

    const kept = erase();
    expect(kept).toEqual({ kind: "erase", doomed: [0], kept: [1] });
    await editor().eraseStroke(kept.kind === "erase" ? kept.doomed : []);
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "Batch",
      description: "Erased 1 system",
      ops: [{ type: "RemoveSystems", ids: [0] }],
    });

    const taken = erase({ eraseSpecials: true });
    await editor().eraseStroke(taken.kind === "erase" ? taken.doomed : []);
    expect(mocked.applyOp).toHaveBeenLastCalledWith({
      type: "Batch",
      description: "Erased 2 systems",
      ops: [{ type: "RemoveSystems", ids: [0, 1] }],
    });
  });

  it("cuts the lanes it passes over in lanes mode, as one edit", async () => {
    // Short of Alpha Centauri, whose other lanes a stamp on it would cut too.
    const cut = erase({ eraseTarget: "lanes" }, { x: 5, y: 0 });
    expect(cut).toEqual({ kind: "cut", lanes: [[0, 1]] });
    await editor().cutLanes(cut.kind === "cut" ? cut.lanes : []);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Cut 1 lane",
      ops: [{ type: "RemoveLanePairs", lanes: [[0, 1]] }],
    });
  });

  it("a refused stroke reports why and leaves the galaxy as it was", async () => {
    mocked.applyOp.mockRejectedValueOnce({ kind: "op", message: "no such system" });
    expect(await editor().eraseStroke([0])).toBe(false);
    expect(sessionError()).toBe("no such system");
    expect(useGalaxyStore.getState().systems.has(0)).toBe(true);
  });
});

/** A stroke of `tool` from `from` to `to` over the galaxy the store holds. */
function brush(
  settings: Partial<BrushSettings>,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const { systems, grid } = useGalaxyStore.getState();
  const stroke = new BrushStroke({ ...ERASE, ...settings }, systems, grid!, 1);
  stroke.add(stampsAlong(null, from, stroke.r));
  stroke.add(stampsAlong(from, to, stroke.r));
  return stroke.result();
}

const pairsOf = (result: ReturnType<typeof brush>) =>
  result.kind === "connect" ? result.pairs : [];

describe("a connect stroke", () => {
  // Sol, Alpha Centauri, Barnard and Sirius, whose chain already links Alpha Centauri to the others.
  const CHAIN = { from: { x: 0, y: 0 }, to: { x: 30, y: 0 } };

  it("meshes the systems it passes over, leaving out pairs already linked, as one edit", async () => {
    const dense = brush({ tool: "connect", size: 30, beta: 0.1 }, CHAIN.from, CHAIN.to);
    expect(dense).toEqual({
      kind: "connect",
      swept: [0, 1, 2, 3],
      pairs: [
        [0, 2],
        [2, 3],
      ],
      sparse: false,
    });
    await editor().connectStroke(pairsOf(dense));
    expect(mocked.applyOp).toHaveBeenCalledTimes(1);
    expect(mocked.applyOp).toHaveBeenCalledWith({
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

    // The Gabriel graph drops Sol–Barnard, whose circle holds Alpha Centauri.
    expect(pairsOf(brush({ tool: "connect", size: 30, beta: 1 }, CHAIN.from, CHAIN.to))).toEqual([
      [2, 3],
    ]);
  });

  it("leaves out a pair the scenario keeps apart", () => {
    useGalaxyStore.getState().applyDelta({
      systems: [
        { ...SYSTEMS[2], prevented: [3] },
        { ...SYSTEMS[3], prevented: [2] },
      ],
    });
    expect(pairsOf(brush({ tool: "connect", size: 30, beta: 0.1 }, CHAIN.from, CHAIN.to))).toEqual([
      [0, 2],
    ]);
  });

  it("adds no lane that would cross an existing one, and then sends nothing", async () => {
    // Either side of the Alpha Centauri–Vega lane, so the one lane between them would cross it.
    useGalaxyStore.getState().applyDelta({
      systems: [node(6, "NAME_West", 0, -15, "sc_g"), node(7, "NAME_East", 20, -15, "sc_g")],
    });
    const across = brush({ tool: "connect", size: 6 }, { x: 0, y: -15 }, { x: 20, y: -15 });
    expect(across).toEqual({ kind: "connect", swept: [6, 7], pairs: [], sparse: false });
    expect(await editor().connectStroke(pairsOf(across))).toBe(false);
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });

  it("works on a save", async () => {
    await openFixtureSave();
    mocked.applyOp.mockResolvedValue(editResult());
    const pairs = pairsOf(brush({ tool: "connect", size: 30, beta: 1 }, CHAIN.from, CHAIN.to));
    expect(await editor().connectStroke(pairs)).toBe(true);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Connected 1 lane",
      ops: [{ type: "AddLanePairs", lanes: [{ a: 2, b: 3, bridge: false }] }],
    });
  });
});

describe("a cut stroke", () => {
  it("cuts the lanes it passes over as one edit, on a save too", async () => {
    await openFixtureSave();
    mocked.applyOp.mockResolvedValue(editResult());
    const cut = brush({ tool: "cut", size: 6 }, { x: 0, y: 0 }, { x: 5, y: 0 });
    expect(cut).toEqual({ kind: "cut", lanes: [[0, 1]] });
    await editor().cutLanes(cut.kind === "cut" ? cut.lanes : []);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Cut 1 lane",
      ops: [{ type: "RemoveLanePairs", lanes: [[0, 1]] }],
    });
  });
});

/** Systems no eraser spares, at `at` from id `first` on, joined by `lanes`. */
function place(first: number, at: Pt[], lanes: Array<[number, number]> = []): void {
  const systems = at.map((p, i) => {
    const id = first + i;
    const to = lanes.flatMap(([a, b]): Array<[number, number]> =>
      a === id ? [[b, 40]] : b === id ? [[a, 40]] : [],
    );
    return node(id, "NAME_Placed", p.x, p.y, "sc_g", to, { initializer: "" });
  });
  useGalaxyStore.getState().applyDelta({ systems });
}

/** A stroke through `path` over the galaxy the store holds. */
function stroke(settings: Partial<BrushSettings>, path: Pt[]) {
  const { systems, grid } = useGalaxyStore.getState();
  const s = new BrushStroke({ ...ERASE, ...settings }, systems, grid!, 1);
  let prev: Pt | null = null;
  for (const next of path) {
    s.add(stampsAlong(prev, next, s.r));
    prev = next;
  }
  return s.result();
}

/** What the last paint edit sent: its systems, and its lanes as ordered pairs of real ids. */
function sentPaint(): { description: string; systems: NewSystem[]; lanes: Pair[] } {
  const calls = mocked.applyOp.mock.calls;
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
  const first = systems[0].id;
  systems.forEach((s, i) => expect(s.id).toBe(first + i));
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
    const first = sent.systems[0].id;
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
    place(20, [
      { x: 200, y: 100 },
      { x: 200, y: -100 },
      { x: 300, y: 100 },
    ]);
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
    place(
      100,
      before.points.map((p) => ({ x: rounded(p.x), y: rounded(p.y) })),
      before.pairs.map(([a, b]): [number, number] => [id(a), id(b)]),
    );
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

describe("symmetric erase, cut and connect strokes", () => {
  it("erase what every image of the stroke passes over, as one edit", async () => {
    place(10, [
      { x: 100, y: 50 },
      { x: 100, y: -50 },
    ]);
    expect(stroke({ symmetry: MIRROR_X }, [{ x: 100, y: 50 }])).toEqual({
      kind: "erase",
      doomed: [10, 11],
      kept: [],
    });

    place(12, [
      { x: -50, y: 100 },
      { x: -100, y: -50 },
      { x: 50, y: -100 },
    ]);
    const turned = stroke({ symmetry: QUARTER }, [{ x: 100, y: 50 }]);
    expect(turned).toEqual({ kind: "erase", doomed: [10, 12, 13, 14], kept: [] });
    await editor().eraseStroke(turned.kind === "erase" ? turned.doomed : []);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Erased 4 systems",
      ops: [{ type: "RemoveSystems", ids: [10, 12, 13, 14] }],
    });
  });

  it("cut the lanes every image of the stroke passes over, on a save too", async () => {
    await openFixtureSave();
    mocked.applyOp.mockResolvedValue(editResult());
    place(
      10,
      [
        { x: 60, y: 50 },
        { x: 100, y: 50 },
        { x: -60, y: 50 },
        { x: -100, y: 50 },
      ],
      [
        [10, 11],
        [12, 13],
      ],
    );
    const cut = stroke({ tool: "cut", size: 6, symmetry: { kind: "mirror", axis: "y" } }, [
      { x: 80, y: 50 },
    ]);
    const lanes: Pair[] = [
      [10, 11],
      [12, 13],
    ];
    expect(cut).toEqual({ kind: "cut", lanes });
    await editor().cutLanes(cut.kind === "cut" ? cut.lanes : []);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Cut 2 lanes",
      ops: [{ type: "RemoveLanePairs", lanes }],
    });
  });

  it("connect only lane patterns every copy repeats, so a square gets its sides and no diagonal", async () => {
    await openFixtureSave();
    mocked.applyOp.mockResolvedValue(editResult());
    place(10, [
      { x: 300, y: 0 },
      { x: 0, y: 300 },
      { x: -300, y: 0 },
      { x: 0, y: -300 },
    ]);
    const square = stroke(
      { tool: "connect", size: 10, beta: 0.1, symmetry: { kind: "rotate", n: 4 } },
      [{ x: 300, y: 0 }],
    );
    expect(square).toEqual({
      kind: "connect",
      swept: [10, 11, 12, 13],
      pairs: [
        [10, 11],
        [10, 13],
        [11, 12],
        [12, 13],
      ],
      sparse: false,
    });
  });

  it("connect the systems every image of the stroke passes over, on a save too", async () => {
    await openFixtureSave();
    mocked.applyOp.mockResolvedValue(editResult());
    place(10, [
      { x: 60, y: 50 },
      { x: 80, y: 50 },
      { x: -60, y: -50 },
      { x: -80, y: -50 },
    ]);
    const connect = stroke({ tool: "connect", size: 10, symmetry: { kind: "rotate", n: 2 } }, [
      { x: 60, y: 50 },
      { x: 80, y: 50 },
    ]);
    expect(connect).toEqual({
      kind: "connect",
      swept: [10, 11, 12, 13],
      pairs: [
        [10, 11],
        [12, 13],
      ],
      sparse: false,
    });
    await editor().connectStroke(pairsOf(connect));
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Connected 2 lanes",
      ops: [
        {
          type: "AddLanePairs",
          lanes: [
            { a: 10, b: 11, bridge: false },
            { a: 12, b: 13, bridge: false },
          ],
        },
      ],
    });
  });
});

describe("joining islands", () => {
  it("links the isolated Deneb to its nearest neighbour as one edit", async () => {
    expect(await editor().joinIslands()).toBe(true);
    expect(mocked.applyOp).toHaveBeenCalledTimes(1);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Joined 2 islands",
      ops: [{ type: "AddLanePairs", lanes: [{ a: 0, b: 5, bridge: false }] }],
    });
    expect(sessionError()).toBeNull();
  });

  it("works on a save", async () => {
    await openFixtureSave();
    mocked.applyOp.mockResolvedValue(editResult());
    expect(await editor().joinIslands()).toBe(true);
    expect(mocked.applyOp.mock.calls[0][0]).toMatchObject({ description: "Joined 2 islands" });
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
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });
});

describe("deleting a selection of systems", () => {
  it("asks, counting each lane touching them once, then removes them all as one edit", async () => {
    await editor().setSelection([0, 1, 2], "replace");
    run("deleteSelection", false, effects);
    await vi.waitFor(() => expect(mocked.applyOp).toHaveBeenCalled());
    expect(mocked.confirm).toHaveBeenCalledWith(
      "Delete 3 systems and their 4 lanes?",
      expect.objectContaining({ kind: "warning" }),
    );
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Deleted 3 systems",
      ops: [{ type: "RemoveSystems", ids: [0, 1, 2] }],
    });
  });

  it("sends nothing when the question is declined", async () => {
    mocked.confirm.mockResolvedValueOnce(false);
    await editor().setSelection([0, 5], "replace");
    await editor().deleteSelection();
    expect(mocked.confirm).toHaveBeenCalledWith("Delete 2 systems and their 1 lane?", {
      title: "Delete systems",
      kind: "warning",
    });
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });

  it("deletes a single selected system too, asking about it and its lanes", async () => {
    await editor().select(1);
    run("deleteSelection", false, effects);
    await vi.waitFor(() => expect(mocked.applyOp).toHaveBeenCalled());
    expect(mocked.confirm).toHaveBeenCalledWith(
      "Delete Alpha Centauri and its 4 lanes?",
      expect.objectContaining({ kind: "warning" }),
    );
    expect(mocked.applyOp).toHaveBeenCalledWith({ type: "RemoveSystem", id: 1 });
  });

  it("names the selection as deletable on a scenario, and nothing on a save", async () => {
    await editor().setSelection([0, 1], "replace");
    expect(deletableSelection(editor())).toEqual({ kind: "systems", ids: [0, 1] });
    expect(canDelete(editor())).toBe(true);

    await openFixtureSave();
    await editor().setSelection([0, 1], "replace");
    expect(canDelete(editor())).toBe(false);
    await editor().deleteSelection();
    expect(mocked.confirm).not.toHaveBeenCalled();
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });
});
