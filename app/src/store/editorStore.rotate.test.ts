import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { editor, openFixtureSave } from "./editorFixture";
import { useToolStore } from "./toolStore";
import { SYSTEMS, editResult } from "./fixture";
import { mockedIpc } from "../test/ipc";
import type { Op } from "../generated/Op";
import type { Pt } from "../lib/geometry/pt";

beforeEach(async () => {
  await openFixtureSave();
  mockedIpc.applyOp.mockResolvedValue(editResult());
});

const sent = () => mockedIpc.applyOp.mock.calls.map(([op]) => op);

describe("rotating the selection", () => {
  it("sends one RotateSystems about the pivot it was given, symmetry or not", async () => {
    useToolStore.setState({ symmetry: { kind: "mirror", axis: "x" } });
    await editor().setSelection([0, 3], "replace");
    editor().setRotatePivot({ x: 10, y: 0 });

    expect(await editor().rotateSelection(90)).toBe(true);
    expect(sent()).toEqual([
      { type: "RotateSystems", systems: [0, 3], pivot: [10, 0], degrees: 90, nebulae: true },
    ]);
    expect(editor().rotatePivot).toEqual({ x: 10, y: 0 });
  });

  it("turns about the centroid with no pivot given, which a turn leaves where it is", async () => {
    await editor().setSelection([0, 2], "replace");
    expect(editor().rotatePivot).toBeNull();

    await editor().rotateSelection(90);
    await editor().rotateSelection(30);
    expect(sent()).toEqual([
      { type: "RotateSystems", systems: [0, 2], pivot: [10, 5], degrees: 90, nebulae: true },
      { type: "RotateSystems", systems: [0, 2], pivot: [10, 5], degrees: 30, nebulae: true },
    ]);
    expect(editor().rotatePivot).toBeNull();
  });

  it("turns about the centroid where a nudge took the group", async () => {
    const moved = (s: Pt) => ({ x: s.x + 50, y: s.y });
    const trio = [SYSTEMS[0], SYSTEMS[2], SYSTEMS[4]];
    await editor().setSelection([0, 2, 4], "replace");
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: trio.map((s) => ({ ...s, ...moved(s) })) } }),
    );

    await editor().nudgeSelection(50, 0);
    await editor().rotateSelection(30);

    expect(sent()[1]).toEqual({
      type: "RotateSystems",
      systems: [0, 2, 4],
      pivot: [expect.closeTo(60, 4), expect.closeTo(-20 / 3, 4)],
      degrees: 30,
      nebulae: true,
    });
  });

  it("asks for the nebulae in the selection's hull unless rotateNebulae is off", async () => {
    await editor().setSelection([0, 3, 4], "replace");

    await editor().rotateSelection(90);
    editor().setRotateNebulae(false);
    await editor().rotateSelection(90);

    expect(sent().map((op) => (op as Extract<Op, { type: "RotateSystems" }>).nebulae)).toEqual([
      true,
      false,
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
