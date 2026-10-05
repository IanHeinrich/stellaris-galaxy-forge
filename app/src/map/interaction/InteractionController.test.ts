import { describe, expect, it, vi } from "vitest";
import { name, systemNode } from "../../test/builders";
import { until } from "../../test/wait";

vi.mock("../../api/ipc");
vi.mock("../../api/events");

import type { Nebula } from "../../generated/Nebula";
import { DEFAULT_LAYERS } from "../../lib/visual/layerIds";
import { ACCENT_COLOR, REFUSED_COLOR } from "../../lib/visual/style";
import { run } from "../../store/commands";
import { useEditorStore } from "../../store/editorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useToolStore } from "../../store/toolStore";
import { strokes } from "../layers/fixture";
import type { DragState, MapLayer } from "../layers/MapLayer";
import {
  current,
  effects,
  installControllerHooks,
  key,
  laned,
  mapOver,
  pending,
} from "./controllerHarness";

installControllerHooks();

describe("a box select", () => {
  it("selects what it encloses in the document's order, not where each system lies", () => {
    const { surface } = mapOver([
      systemNode({ id: 5, x: 300 }),
      systemNode({ id: 1, x: -300 }),
      systemNode({ id: 3 }),
    ]);

    surface.fire("pointerdown", 1, 1);
    surface.fire("pointermove", 799, 599);
    surface.fire("pointerup", 799, 599);

    expect(useEditorStore.getState().selection).toEqual([5, 1, 3]);
  });
});

describe("the symmetry guides", () => {
  it("show in every tool while symmetry is on, and keep a held stroke's own until it ends", () => {
    useToolStore.setState({ tool: "select", symmetry: { kind: "mirror", axis: "x" } });
    const { surface, highlights } = mapOver([systemNode({ id: 1 })]);
    const segments = () => strokes(highlights.guide.graphics).flatMap((op) => op.segments).length;
    expect(segments()).toBe(1);

    useToolStore.setState({ tool: "cut" });
    expect(segments()).toBe(1);

    surface.fire("pointerdown", 400, 300);
    useToolStore.getState().setSymmetry({ kind: "rotate", n: 4 });
    expect(segments()).toBe(1);
    surface.fire("pointerup", 400, 300);
    expect(segments()).toBe(4);

    useToolStore.setState({ tool: "select" });
    expect(segments()).toBe(4);
    useToolStore.getState().toggleSymmetry();
    expect(segments()).toBe(0);
  });
});

describe("a drag under symmetry", () => {
  it("previews each counterpart moving by the image of the drag", () => {
    useToolStore.setState({ tool: "select", symmetry: { kind: "mirror", axis: "x" } });
    const drags: Array<DragState | null> = [];
    const layer = { setDragState: (d: DragState | null) => drags.push(d) } as unknown as MapLayer;
    const { cam, surface } = mapOver(
      [systemNode({ id: 1, x: 100, y: 50 }), systemNode({ id: 2, x: 100, y: -50 })],
      [layer],
    );

    const from = cam.worldToScreen(100, 50);
    const to = cam.worldToScreen(110, 60);
    surface.fire("pointerdown", from.x, from.y);
    surface.fire("pointermove", to.x, to.y);

    const ghosts = drags[drags.length - 1]?.ghosts.map(({ id, x, y }) => ({ id, x, y }));
    expect(ghosts).toHaveLength(2);
    expect(ghosts![0]).toEqual({ id: 1, x: expect.closeTo(110), y: expect.closeTo(60) });
    expect(ghosts![1]).toEqual({ id: 2, x: expect.closeTo(110), y: expect.closeTo(-60) });
  });
});

describe("a brush stroke", () => {
  it("keeps its preview until the edit it sent settles", async () => {
    const edit = pending();
    const cutLanes = vi.fn(() => edit.promise);
    useEditorStore.setState({ cutLanes });
    const { surface, brush, mid } = laned("cut");

    surface.fire("pointerdown", mid.x, mid.y);
    surface.fire("pointerup", mid.x, mid.y);
    expect(cutLanes).toHaveBeenCalledWith([[1, 2]]);
    expect(strokes(brush("brushMarks"))).toHaveLength(1);

    edit.settle(true);
    await until(() => expect(strokes(brush("brushMarks"))).toHaveLength(0));
  });

  it("is dropped by the first Esc, and the second returns to Select", () => {
    const cutLanes = vi.fn(async () => true);
    useEditorStore.setState({ cutLanes });
    const { surface, brush, mid } = laned("cut");

    surface.fire("pointerdown", mid.x, mid.y);
    expect(strokes(brush("brushMarks"))).toHaveLength(1);
    const kept = key("keydown", "Escape");
    expect(kept()).toBe(true);
    expect(strokes(brush("brushMarks"))).toHaveLength(0);
    surface.fire("pointerup", mid.x, mid.y);
    expect(cutLanes).not.toHaveBeenCalled();
    expect(useToolStore.getState().tool).toBe("cut");

    expect(key("keydown", "Escape")()).toBe(false);
  });

  it("is dropped with the brush it belongs to when the tool changes", () => {
    const cutLanes = vi.fn(async () => true);
    useEditorStore.setState({ cutLanes });
    const { surface, brush, mid } = laned("cut");

    surface.fire("pointerdown", mid.x, mid.y);
    expect(strokes(brush("brushMarks"))).toHaveLength(1);
    useToolStore.setState({ tool: "select" });
    expect(strokes(brush("brushMarks"))).toHaveLength(0);
    surface.fire("pointerup", mid.x, mid.y);
    expect(cutLanes).not.toHaveBeenCalled();
    expect(strokes(brush("brushCircle"))).toHaveLength(0);
  });
});

describe("a held stroke's preview", () => {
  it("is drawn at most once per frame, however many moves the frame takes", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (draw: FrameRequestCallback) => frames.push(draw));
    const { surface, highlights, mid } = laned("cut");
    const drawn = vi.spyOn(highlights.brush, "setPreview");

    surface.fire("pointerdown", mid.x, mid.y);
    for (const dx of [2, 4, 6]) surface.fire("pointermove", mid.x + dx, mid.y);
    expect(frames).toHaveLength(1);
    expect(drawn).not.toHaveBeenCalled();

    frames.shift()!(0);
    expect(drawn).toHaveBeenCalledTimes(1);
    surface.fire("pointermove", mid.x + 8, mid.y);
    expect(frames).toHaveLength(1);
  });
});

describe("the brush circle", () => {
  it("turns to the inverse brush as Alt goes down, and back as it comes up", () => {
    const { surface, brush, mid } = laned("cut");
    const colour = () => strokes(brush("brushCircle"))[0]?.color;

    surface.fire("pointermove", mid.x, mid.y);
    expect(colour()).toBe(REFUSED_COLOR);
    key("keydown", "Alt");
    expect(colour()).toBe(ACCENT_COLOR);
    key("keyup", "Alt");
    expect(colour()).toBe(REFUSED_COLOR);
  });
});

describe("a press on a star in a nebula's ring band", () => {
  it("selects the system, where the ring alone selects the nebula", async () => {
    const cloud: Nebula = { name: name("Cloud"), x: 0, y: 0, radius: 40, systems: [] };
    useMapChromeStore.setState({ layers: { ...DEFAULT_LAYERS, nebulae: true } });
    const { cam, surface } = mapOver([systemNode({ id: 1, x: 40 })], [], [cloud]);
    const ring = cam.worldToScreen(0, 40);
    const star = cam.worldToScreen(40, 0);

    surface.fire("pointerdown", ring.x, ring.y);
    surface.fire("pointerup", ring.x, ring.y);
    expect(useEditorStore.getState().selectedNebula).toBe(0);

    surface.fire("pointerdown", star.x, star.y);
    surface.fire("pointerup", star.x, star.y);

    await until(() => expect(useEditorStore.getState().selection).toEqual([1]));
    expect(useEditorStore.getState().selectedNebula).toBeNull();
  });
});

describe("a prevented pair's dash", () => {
  it("opens its own menu on a right-click and is passed over by hover and a left click", () => {
    const { cam, surface } = mapOver([
      systemNode({ id: 1, x: -50, prevented: [2] }),
      systemNode({ id: 2, x: 50, prevented: [1] }),
    ]);
    const mid = cam.worldToScreen(0, 0);

    surface.fire("pointerdown", mid.x, mid.y, { button: 2 });
    surface.fire("pointerup", mid.x, mid.y, { button: 2 });
    expect(useMapChromeStore.getState().contextMenu?.target).toEqual({
      kind: "prevented",
      a: 1,
      b: 2,
    });

    surface.fire("pointermove", mid.x, mid.y);
    expect(useMapChromeStore.getState().gesture).toBeNull();
    surface.fire("pointerdown", mid.x, mid.y);
    surface.fire("pointerup", mid.x, mid.y);
    expect(useEditorStore.getState().selectedLane).toBeNull();
    expect(useMapChromeStore.getState().contextMenu).toBeNull();
  });
});

describe("switching tools by key", () => {
  it("lets go of the system the pointer was resting on", () => {
    const { surface, star } = laned("select");
    surface.fire("pointermove", star.x, star.y);
    expect(useEditorStore.getState().hover).toBe(1);

    run("cutTool", false, effects);
    expect(useEditorStore.getState().hover).toBeNull();
  });
});

describe("a deactivated controller", () => {
  it("leaves the selection and hover as they were when a system is pressed", () => {
    const { surface, star } = laned("select");
    current().deactivate();

    surface.fire("pointermove", star.x, star.y);
    surface.fire("pointerdown", star.x, star.y);
    surface.fire("pointerup", star.x, star.y);
    expect(useEditorStore.getState().selection).toEqual([]);
    expect(useEditorStore.getState().hover).toBeNull();
  });

  it("takes the brush circle away and replays nothing when Alt goes down", () => {
    const { surface, brush, mid } = laned("cut");
    const colour = () => strokes(brush("brushCircle"))[0]?.color;
    surface.fire("pointermove", mid.x, mid.y);
    expect(colour()).toBe(REFUSED_COLOR);
    current().deactivate();
    expect(colour()).toBeUndefined();

    key("keydown", "Alt");
    expect(colour()).toBeUndefined();
  });

  it("selects a pressed system again once activated", () => {
    const { surface, star } = laned("select");
    current().deactivate();
    current().activate();

    surface.fire("pointerdown", star.x, star.y);
    surface.fire("pointerup", star.x, star.y);
    expect(useEditorStore.getState().selection).toEqual([1]);
  });
});
