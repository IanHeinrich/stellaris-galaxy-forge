import { describe, expect, it, vi } from "vitest";
import { editResult } from "../../store/fixture";
import { systemNode } from "../../test/builders";
import { until } from "../../test/wait";

vi.mock("../../api/ipc");
vi.mock("../../api/events");

import type { Graphics } from "pixi.js";
import { useEditorStore } from "../../store/editorStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useHeightPreviewStore } from "../../store/heightPreviewStore";
import { useToolStore } from "../../store/toolStore";
import { lanesTo } from "../../test/builders";
import { strokes } from "../layers/fixture";
import type { DragState, MapLayer } from "../layers/MapLayer";
import { absoluteHeight } from "../../lib/height";
import type { HeightsOver } from "../../lib/brush/heightBrush";
import { mockedIpc } from "../../test/ipc";
import { installControllerHooks, mapOver } from "./controllerHarness";

installControllerHooks();

describe("the tilted map", () => {
  /** A system 100 above the plane at x 40, a flat one at x -40, and the map leant 30°. */
  function leaning() {
    const drags: Array<DragState | null> = [];
    const layer = { setDragState: (d: DragState | null) => drags.push(d) } as unknown as MapLayer;
    const map = mapOver(
      [systemNode({ id: 1, x: 40, height: absoluteHeight(100) }), systemNode({ id: 2, x: -40 })],
      [layer],
    );
    map.positions.setTilt(30);
    const lifted = useGalaxyStore.getState().systems.get(1)!;
    const drawn = map.cam.worldToScreen(40, map.positions.y(lifted));
    const plane = map.cam.worldToScreen(40, 0);
    return { ...map, drags, drawn, plane, lifted };
  }

  /** Two systems 120 apart, both 200 above the plane, with a lane between, and the map leant 30°. */
  function liftedLane(tool: "select" | "connect" | "cut", lanes = true) {
    useToolStore.setState({ tool, size: 10, symmetry: { kind: "off" } });
    const height = absoluteHeight(200);
    const map = mapOver([
      systemNode({ id: 1, x: -60, height, lanes: lanes ? lanesTo(2) : [] }),
      systemNode({ id: 2, x: 60, height, lanes: lanes ? lanesTo(1) : [] }),
    ]);
    map.positions.setTilt(30);
    const y = map.positions.y(useGalaxyStore.getState().systems.get(1)!);
    const screen = (x: number) => map.cam.worldToScreen(x, y);
    return { ...map, y, screen };
  }

  it("selects a lifted system where its star is drawn, not where it stands on the plane", async () => {
    const { surface, drawn, plane } = leaning();
    expect(plane.y - drawn.y).toBeGreaterThan(20);

    surface.fire("pointermove", drawn.x, drawn.y);
    expect(useEditorStore.getState().hover).toBe(1);
    surface.fire("pointerdown", drawn.x, drawn.y);
    surface.fire("pointerup", drawn.x, drawn.y);
    await until(() => expect(useEditorStore.getState().selection).toEqual([1]));

    surface.fire("pointerdown", plane.x, plane.y);
    surface.fire("pointerup", plane.x, plane.y);
    await until(() => expect(useEditorStore.getState().selection).toEqual([]));
  });

  it("follows a previewed height when picking", () => {
    const { cam, positions, surface, drawn, lifted } = leaning();
    positions.setPreview(new Map([[1, 200]]));
    const raised = cam.worldToScreen(40, positions.y(lifted));

    surface.fire("pointermove", drawn.x, drawn.y);
    expect(useEditorStore.getState().hover).toBeNull();
    surface.fire("pointermove", raised.x, raised.y);
    expect(useEditorStore.getState().hover).toBe(1);
  });

  it("moves a dragged lifted system by the pointer's travel on the plane, its ghost where it draws", () => {
    const applyOp = vi.fn(async () => true);
    useEditorStore.setState({ applyOp });
    const { cam, surface, drags, drawn: from, positions, lifted } = leaning();
    const lift = positions.y(lifted);
    const to = cam.worldToScreen(60, lift + 10);

    surface.fire("pointerdown", from.x, from.y);
    surface.fire("pointermove", to.x, to.y);
    const ghost = drags[drags.length - 1]?.ghosts[0];
    expect(ghost).toEqual({ id: 1, x: expect.closeTo(60), y: expect.closeTo(lift + 10) });
    surface.fire("pointerup", to.x, to.y);

    expect(applyOp).toHaveBeenCalledTimes(1);
    expect(applyOp.mock.calls[0]).toEqual([
      { type: "MoveSystem", system: 1, x: expect.closeTo(60), y: expect.closeTo(10) },
    ]);
  });

  it("selects a lifted lane clicked where it is drawn, not where it lies on the plane", () => {
    const { cam, surface, screen } = liftedLane("select");
    const plane = cam.worldToScreen(-25, 0);
    surface.fire("pointerdown", plane.x, plane.y);
    surface.fire("pointerup", plane.x, plane.y);
    expect(useEditorStore.getState().selectedLane).toBeNull();

    const on = screen(-25);
    surface.fire("pointerdown", on.x, on.y);
    surface.fire("pointerup", on.x, on.y);
    expect(useEditorStore.getState().selectedLane).toEqual({ a: 1, b: 2 });
  });

  it("connects two lifted systems with a Connect stroke from one drawn star to the other", () => {
    const connectStroke = vi.fn(async () => true);
    useEditorStore.setState({ connectStroke });
    const { surface, screen } = liftedLane("connect", false);
    const from = screen(-60);
    const to = screen(60);

    surface.fire("pointerdown", from.x, from.y);
    surface.fire("pointermove", to.x, to.y);
    surface.fire("pointerup", to.x, to.y);

    expect(connectStroke).toHaveBeenCalledWith([[1, 2]]);
  });

  it("cuts a lifted lane with a Cut stroke across where it is drawn", () => {
    const cutLanes = vi.fn(async () => true);
    useEditorStore.setState({ cutLanes });
    const { cam, surface, screen } = liftedLane("cut");
    const plane = cam.worldToScreen(0, 0);
    surface.fire("pointerdown", plane.x, plane.y);
    surface.fire("pointerup", plane.x, plane.y);
    expect(cutLanes).toHaveBeenLastCalledWith([]);

    const on = screen(0);
    surface.fire("pointerdown", on.x, on.y);
    surface.fire("pointerup", on.x, on.y);
    expect(cutLanes).toHaveBeenLastCalledWith([[1, 2]]);
  });

  it("moves a dragged system on the plane again once it lies flat", () => {
    const { cam, positions, surface, drags } = leaning();
    positions.setTilt(0);
    const star = cam.worldToScreen(40, 0);
    const to = cam.worldToScreen(60, 20);

    surface.fire("pointerdown", star.x, star.y);
    surface.fire("pointermove", to.x, to.y);

    expect(drags[drags.length - 1]?.ghosts).toEqual([
      { id: 1, x: expect.closeTo(60), y: expect.closeTo(20) },
    ]);
  });
});

/** A promise and the way to settle it, for an answer a test holds back. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("the height brush", () => {
  /** Two flat systems 15 apart, a 100-wide Ripple brush and a stroke that settles at once. */
  function sculpting(mode: "ripple" | "raise" = "ripple") {
    useHeightPreviewStore.setState({ ...useHeightPreviewStore.getInitialState() });
    const sculptHeights = vi.fn<(over: HeightsOver) => Promise<boolean>>(async () => true);
    useEditorStore.setState({ sculptHeights });
    useToolStore.setState({ tool: "height", size: 100, heightMode: mode, raiseStrength: 10 });
    const map = mapOver([systemNode({ id: 1 }), systemNode({ id: 2, x: 15 })]);
    const brush = (label: string) =>
      map.highlights.brush.container.getChildByLabel(label) as Graphics;
    const centre = map.cam.worldToScreen(0, 0);
    return { ...map, sculptHeights, brush, centre };
  }
  const previewed = () => useHeightPreviewStore.getState().preview;
  /** The heights the `n`th sculpt sent would give the galaxy as it stands. */
  const sculpted = (sculptHeights: ReturnType<typeof sculpting>["sculptHeights"], n = 0) =>
    sculptHeights.mock.calls[n][0](useGalaxyStore.getState().systems);
  /** Where the ripple's first crest is centred, in world units. */
  const crestCentre = (rings: Graphics) =>
    strokes(rings)
      .find((op) => op.steps.includes("circle"))
      ?.segments[0].slice(0, 2);

  it("previews a ripple's rings and heights under the pointer, and drops them when it leaves", () => {
    const { surface, brush, centre } = sculpting();
    surface.fire("pointermove", centre.x, centre.y);
    expect(strokes(brush("brushRings")).length).toBeGreaterThan(0);
    expect(previewed().get(1)).toBe(40);
    expect(previewed().get(2)).toBeLessThan(0);

    surface.fire("pointerleave", centre.x, centre.y);
    expect(previewed().size).toBe(0);
    expect(strokes(brush("brushRings"))).toHaveLength(0);
  });

  it("drops a ripple click where it was clicked, as one edit", () => {
    const { surface, sculptHeights, centre } = sculpting();
    surface.fire("pointerdown", centre.x, centre.y);
    surface.fire("pointerup", centre.x, centre.y);

    expect(sculptHeights).toHaveBeenCalledTimes(1);
    expect(sculpted(sculptHeights).get(1)).toBe(40);
  });

  it("moves a held ripple with the pointer, and drops it where the button is let go", () => {
    const { cam, surface, sculptHeights, brush, centre } = sculpting();
    const second = cam.worldToScreen(15, 0);
    surface.fire("pointerdown", centre.x, centre.y);
    surface.fire("pointermove", second.x, second.y);

    expect(crestCentre(brush("brushRings"))?.[0]).toBeCloseTo(15);
    expect(previewed().get(2)).toBe(40);
    expect(previewed().get(1)).toBeLessThan(0);
    expect(sculptHeights).not.toHaveBeenCalled();

    surface.fire("pointerup", second.x, second.y);
    expect(sculptHeights).toHaveBeenCalledTimes(1);
    expect(sculpted(sculptHeights).get(2)).toBe(40);
    expect(sculpted(sculptHeights).get(1)).toBeLessThan(0);
  });

  it("strokes while the map leans, as one edit", () => {
    const { cam, positions, surface, sculptHeights } = sculpting("raise");
    positions.setTilt(30);

    const from = cam.worldToScreen(0, 0);
    const to = cam.worldToScreen(15, 0);
    surface.fire("pointerdown", from.x, from.y);
    surface.fire("pointermove", to.x, to.y);
    surface.fire("pointerup", to.x, to.y);

    expect(sculptHeights).toHaveBeenCalledTimes(1);
    const sent = sculpted(sculptHeights);
    expect([...sent.keys()]).toEqual([1, 2]);
    expect(sent.get(1)).toBe(10);
  });

  it("raises twice for two clicks sent before the first has landed", async () => {
    const { surface, centre } = sculpting("raise");
    useEditorStore.setState({ sculptHeights: useEditorStore.getInitialState().sculptHeights });
    const first = deferred<ReturnType<typeof editResult>>();
    mockedIpc.applyOp.mockReset();
    mockedIpc.applyOp.mockReturnValueOnce(first.promise).mockResolvedValueOnce(editResult());

    for (let i = 0; i < 2; i++) {
      surface.fire("pointerdown", centre.x, centre.y);
      surface.fire("pointerup", centre.x, centre.y);
    }
    await until(() => expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1));
    expect(mockedIpc.applyOp.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        heights: expect.arrayContaining([{ system: 1, height: absoluteHeight(10) }]),
      }),
    );

    const raised = useGalaxyStore.getState().systems.get(1)!;
    first.resolve(editResult({ delta: { systems: [{ ...raised, height: absoluteHeight(10) }] } }));
    await until(() => expect(mockedIpc.applyOp).toHaveBeenCalledTimes(2));
    expect(mockedIpc.applyOp.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        heights: expect.arrayContaining([{ system: 1, height: absoluteHeight(20) }]),
      }),
    );
  });

  it("keeps a stroke's preview until its own edit lands, not the one before it", async () => {
    const { cam, surface, sculptHeights, centre } = sculpting();
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    sculptHeights.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const far = cam.worldToScreen(15, 0);

    surface.fire("pointerdown", centre.x, centre.y);
    surface.fire("pointerup", centre.x, centre.y);
    surface.fire("pointerdown", far.x, far.y);
    surface.fire("pointerup", far.x, far.y);
    surface.fire("pointerleave", far.x, far.y);
    expect(previewed().get(2)).toBe(40);

    first.resolve(true);
    await first.promise;
    await Promise.resolve();
    expect(previewed().get(2)).toBe(40);

    second.resolve(true);
    await until(() => expect(previewed().size).toBe(0));
  });

  it("publishes a preview only when it changes, and nothing over empty space", () => {
    const { cam, surface, centre } = sculpting("raise");
    const published = vi.fn();
    const unsubscribe = useHeightPreviewStore.subscribe(published);

    surface.fire("pointermove", centre.x, centre.y);
    surface.fire("pointermove", centre.x, centre.y);
    expect(published).toHaveBeenCalledTimes(1);

    for (let x = 300; x < 400; x += 20) {
      const empty = cam.worldToScreen(x, 0);
      surface.fire("pointermove", empty.x, empty.y);
    }
    expect(published).toHaveBeenCalledTimes(2);
    expect(previewed().size).toBe(0);
    unsubscribe();
  });
});
