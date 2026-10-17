import { describe, expect, it, vi } from "vitest";
import { systemNode } from "../../test/builders";
import { until } from "../../test/wait";

vi.mock("../../api/ipc");
vi.mock("../../api/events");

import type { Op } from "../../generated/Op";
import { rotateAbout } from "../../lib/geometry/rotate";
import { rotationPreview } from "../../lib/rotation";
import type { OpSource } from "../../store/editorEdits";
import { useEditorStore } from "../../store/editorStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useToolStore } from "../../store/toolStore";
import type { DragState, MapLayer } from "../layers/MapLayer";
import { rotateGizmo } from "../rotateGizmo";
import { installControllerHooks, key, mapOver } from "./controllerHarness";

installControllerHooks();

/** Three systems round a centroid of (0, 20), which no system stands on. */
const SYSTEMS = [
  systemNode({ id: 1, x: -100 }),
  systemNode({ id: 2, x: 100 }),
  systemNode({ id: 3, y: 60 }),
];

/**
 * `systems` on the map with `selection` selected, the ops sent and the drags shown recorded, and
 * the gizmo of all three.
 */
function selected(selection: number[], systems = SYSTEMS) {
  const ops: Op[] = [];
  const applyOp = vi.fn(async (source: OpSource) => {
    const op = typeof source === "function" ? await source() : source;
    if (op) ops.push(op);
    return true;
  });
  const cutLanes = vi.fn(async () => true);
  useEditorStore.setState({ applyOp, cutLanes });
  const drags: Array<DragState | null> = [];
  const layer = { setDragState: (d: DragState | null) => drags.push(d) } as unknown as MapLayer;
  const { cam, surface, positions } = mapOver(systems, [layer]);
  useEditorStore.setState({ selection });
  const all = { selection: [1, 2, 3], rotatePivot: null };
  const gizmo = rotateGizmo(useGalaxyStore.getState().systems, all, cam, positions.at)!;
  const screen = (p: { x: number; y: number }) => cam.worldToScreen(p.x, p.y);
  /** Presses at the world point `from`, moves to `to` and releases there. */
  const drag = (from: { x: number; y: number }, to: { x: number; y: number }, shiftKey = false) => {
    const a = screen(from);
    const b = screen(to);
    surface.fire("pointerdown", a.x, a.y, { shiftKey });
    surface.fire("pointermove", b.x, b.y, { shiftKey });
    surface.fire("pointerup", b.x, b.y, { shiftKey });
  };
  return { ops, applyOp, drags, gizmo, cam, surface, screen, drag };
}

/** Where the selection lands turned `degrees` about its centroid. */
function landing(degrees: number) {
  return rotationPreview(useEditorStore.getState(), useGalaxyStore.getState(), degrees)!.systems;
}

describe("a drag on the rotate handle", () => {
  it("previews the turned systems as ghosts, then sends one rotation where they land", async () => {
    const { ops, applyOp, drags, gizmo, surface, screen } = selected([1, 2, 3]);
    expect(gizmo.pivot).toEqual({ x: 0, y: 20 });
    const a = screen(gizmo.handle);
    const b = screen(rotateAbout(gizmo.handle, gizmo.pivot, 30));

    surface.fire("pointerdown", a.x, a.y);
    surface.fire("pointermove", b.x, b.y);
    const shown = drags[drags.length - 1]!;
    expect(shown.turn).toBeCloseTo(30);
    const expected = landing(30);
    expect(shown.ghosts).toEqual(
      expected.map(({ system, x, y }) => ({
        id: system,
        x: expect.closeTo(x, 4),
        y: expect.closeTo(y, 4),
      })),
    );
    expect(applyOp).not.toHaveBeenCalled();

    surface.fire("pointerup", b.x, b.y);
    expect(applyOp).toHaveBeenCalledTimes(1);
    await until(() => expect(ops).toHaveLength(1));
    expect(ops).toEqual([
      {
        type: "RotateSystems",
        systems: [1, 2, 3],
        pivot: [gizmo.pivot.x, gizmo.pivot.y],
        degrees: expect.closeTo(30, 4),
        nebulae: false,
      },
    ]);
  });

  it("lands on a multiple of 15° with Shift held, and wins over the Shift marquee", async () => {
    const { ops, drag, gizmo } = selected([1, 2, 3]);

    drag(gizmo.handle, rotateAbout(gizmo.handle, gizmo.pivot, 50), true);

    expect(useEditorStore.getState().selection).toEqual([1, 2, 3]);
    await until(() => expect(ops).toHaveLength(1));
    expect(ops).toEqual([
      {
        type: "RotateSystems",
        systems: [1, 2, 3],
        pivot: [gizmo.pivot.x, gizmo.pivot.y],
        degrees: 45,
        nebulae: false,
      },
    ]);
  });
});

describe("a drag on the pivot", () => {
  it("moves the pivot and sends no edit", () => {
    const { applyOp, drag, gizmo } = selected([1, 2, 3]);

    drag(gizmo.pivot, { x: -50, y: 80 });

    expect(applyOp).not.toHaveBeenCalled();
    expect(useEditorStore.getState().rotatePivot).toEqual({
      x: expect.closeTo(-50),
      y: expect.closeTo(80),
    });
  });

  it("gives way to a selected star under it, which moves the group", async () => {
    const onPivot = [
      systemNode({ id: 1, x: -100 }),
      systemNode({ id: 2, x: 100 }),
      systemNode({ id: 3 }),
    ];
    const { ops, drag, gizmo } = selected([1, 2, 3], onPivot);
    expect(gizmo.pivot).toEqual({ x: 0, y: 0 });

    drag(gizmo.pivot, { x: 10, y: 20 });

    expect(useEditorStore.getState().rotatePivot).toBeNull();
    await until(() => expect(ops).toHaveLength(1));
    expect(ops[0]).toMatchObject({ type: "MoveSystems" });
  });

  it("puts the pivot back when Esc drops the drag", () => {
    const { gizmo, surface, screen } = selected([1, 2, 3]);
    const a = screen(gizmo.pivot);

    surface.fire("pointerdown", a.x, a.y);
    surface.fire("pointermove", a.x + 40, a.y + 40);
    expect(useEditorStore.getState().rotatePivot).not.toBeNull();
    key("keydown", "Escape");
    surface.fire("pointerup", a.x + 40, a.y + 40);

    expect(useEditorStore.getState().rotatePivot).toBeNull();
  });
});

describe("the pivot and rotate handle", () => {
  it.each([
    ["one system is selected", "select", [1]],
    ["a brush is out", "cut", [1, 2, 3]],
  ] as const)("are not there when %s", (_case, tool, selection) => {
    useToolStore.setState({ tool });
    const { ops, drags, drag, gizmo } = selected([...selection]);

    drag(gizmo.pivot, { x: -50, y: 80 });
    drag(gizmo.handle, rotateAbout(gizmo.handle, gizmo.pivot, 30));

    expect(useEditorStore.getState().rotatePivot).toBeNull();
    expect(drags.filter((d) => d?.turn != null)).toEqual([]);
    expect(ops.filter((op) => op.type === "RotateSystems")).toEqual([]);
  });
});
