import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { editor, openFixtureSave } from "./editorFixture";
import { useGalaxyStore } from "./galaxyStore";
import { useToolStore } from "./toolStore";
import { OPEN_RESULT, SYSTEMS, editResult, name } from "./fixture";
import { mockedIpc } from "../test/ipc";
import { rotateAbout } from "../lib/geometry/rotate";
import type { Op } from "../generated/Op";
import type { Pt } from "../lib/geometry/pt";

beforeEach(async () => {
  await openFixtureSave();
  mockedIpc.applyOp.mockResolvedValue(editResult());
});

const sent = () => mockedIpc.applyOp.mock.calls.map(([op]) => op);

describe("rotating the selection", () => {
  it("turns the selection about the pivot it was given in one Batch, symmetry or not", async () => {
    useToolStore.setState({ symmetry: { kind: "mirror", axis: "x" } });
    await editor().setSelection([0, 3], "replace");
    editor().setRotatePivot({ x: 10, y: 0 });

    expect(await editor().rotateSelection(90)).toBe(true);
    expect(sent()).toEqual([
      {
        type: "Batch",
        description: "Rotated 2 systems by 90°",
        ops: [
          {
            type: "MoveSystems",
            moves: [
              { system: 0, x: 10, y: 10 },
              { system: 3, x: 10, y: -20 },
            ],
          },
        ],
      },
    ]);
    expect(editor().rotatePivot).toEqual({ x: 10, y: 0 });
  });

  it("turns two systems about their midpoint with no pivot given", async () => {
    await editor().setSelection([0, 2], "replace");
    expect(editor().rotatePivot).toBeNull();

    await editor().rotateSelection(90);
    expect(sent()[0]).toMatchObject({
      ops: [
        {
          type: "MoveSystems",
          moves: [
            { system: 0, x: 5, y: 15 },
            { system: 2, x: 15, y: -5 },
          ],
        },
      ],
    });
  });

  describe("with no pivot placed", () => {
    const TRIO = [SYSTEMS[0], SYSTEMS[2], SYSTEMS[4]];
    const at = (p: Pt) => ({ x: expect.closeTo(p.x, 4), y: expect.closeTo(p.y, 4) });
    /** The trio's moves in the `index`th op sent. */
    const movesOf = (index: number) => (sent()[index] as Extract<Op, { type: "Batch" }>).ops[0];
    /** An edit that leaves the trio where `place` puts each. */
    const landing = (place: (s: Pt) => Pt) =>
      editResult({ delta: { systems: TRIO.map((s) => ({ ...s, ...place(s) })) } });

    beforeEach(() => editor().setSelection([0, 2, 4], "replace"));

    it("turns about the centroid, which a turn leaves where it is", async () => {
      const centroid = { x: 10, y: -20 / 3 };
      mockedIpc.applyOp.mockResolvedValueOnce(landing((s) => rotateAbout(s, centroid, 30)));

      await editor().rotateSelection(30);
      await editor().rotateSelection(30);

      expect(editor().rotatePivot).toBeNull();
      expect(movesOf(1)).toEqual({
        type: "MoveSystems",
        moves: TRIO.map((s) => ({ system: s.id, ...at(rotateAbout(s, centroid, 60)) })),
      });
    });

    it("turns about the centroid where a nudge took the group", async () => {
      const moved = (s: Pt) => ({ x: s.x + 50, y: s.y });
      mockedIpc.applyOp.mockResolvedValueOnce(landing(moved));

      await editor().nudgeSelection(50, 0);
      await editor().rotateSelection(30);

      expect(movesOf(1)).toEqual({
        type: "MoveSystems",
        moves: TRIO.map((s) => ({
          system: s.id,
          ...at(rotateAbout(moved(s), { x: 60, y: -20 / 3 }, 30)),
        })),
      });
    });
  });

  it("carries a nebula centred inside the selection's hull only with rotateNebulae on", async () => {
    const cloud = (x: number, y: number) => ({
      name: name("NAME_Cloud"),
      x,
      y,
      radius: 5,
      systems: [],
    });
    useGalaxyStore
      .getState()
      .load({ ...OPEN_RESULT.galaxy, nebulae: [cloud(100, 100), cloud(10, -5)] });
    await editor().setSelection([0, 3, 4], "replace");
    editor().setRotatePivot({ x: 10, y: -10 });
    const moves = {
      type: "MoveSystems",
      moves: [
        { system: 0, x: 20, y: 0 },
        { system: 3, x: 20, y: -30 },
        { system: 4, x: -10, y: -10 },
      ],
    };

    await editor().rotateSelection(90);
    editor().setRotateNebulae(true);
    await editor().rotateSelection(90);

    expect(sent()).toEqual([
      { type: "Batch", description: "Rotated 3 systems by 90°", ops: [moves] },
      {
        type: "Batch",
        description: "Rotated 3 systems and 1 nebula by 90°",
        ops: [moves, { type: "MoveNebula", index: 1, x: 15, y: -10 }],
      },
    ]);
  });

  it("drops the pivot when the selection changes, and keeps it when the same systems are picked again", async () => {
    await editor().setSelection([0, 3], "replace");
    editor().setRotatePivot({ x: 5, y: 5 });
    await editor().setSelection([3, 0], "replace");
    expect(editor().rotatePivot).toEqual({ x: 5, y: 5 });

    await editor().setSelection([2], "add");
    expect(editor().rotatePivot).toBeNull();
  });

  it("sends nothing for one selected system or a whole number of turns", async () => {
    await editor().select(2);
    expect(await editor().rotateSelection(90)).toBe(false);

    await editor().setSelection([0, 3], "replace");
    expect(await editor().rotateSelection(0)).toBe(false);
    expect(await editor().rotateSelection(360)).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});
