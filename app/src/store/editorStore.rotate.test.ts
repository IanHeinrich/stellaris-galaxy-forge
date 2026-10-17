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

  it("turns about the selection's bounds centre with no pivot given", async () => {
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

  it("pins the centre it turned about, so a second turn goes about the same point", async () => {
    const turned = [SYSTEMS[0], SYSTEMS[2], SYSTEMS[4]].map((s) => ({
      ...s,
      ...rotateAbout(s, { x: 10, y: -10 }, 30),
    }));
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ delta: { systems: turned } }));
    await editor().setSelection([0, 2, 4], "replace");

    await editor().rotateSelection(30);
    expect(editor().rotatePivot).toEqual({ x: 10, y: -10 });
    await editor().rotateSelection(30);

    const second = sent()[1] as Extract<Op, { type: "Batch" }>;
    expect(second.ops[0]).toEqual({
      type: "MoveSystems",
      moves: [SYSTEMS[0], SYSTEMS[2], SYSTEMS[4]].map((s) => {
        const at = rotateAbout(s, { x: 10, y: -10 }, 60);
        return { system: s.id, x: expect.closeTo(at.x, 4), y: expect.closeTo(at.y, 4) };
      }),
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
