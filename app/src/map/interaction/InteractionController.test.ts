import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_RESULT } from "../../store/fixture";
import { systemNode } from "../../test/builders";

vi.mock("../../api/ipc");
vi.mock("../../api/events");

import type { Graphics } from "pixi.js";
import { ACCENT_COLOR, REFUSED_COLOR } from "../../lib/visual/style";
import { run, type CommandEffects } from "../../store/commands";
import { useEditorStore } from "../../store/editorStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useToolStore } from "../../store/toolStore";
import { lanesTo } from "../../test/builders";
import { Camera } from "../Camera";
import { HighlightsLayer } from "../layers/HighlightsLayer";
import { strokes } from "../layers/fixture";
import type { DragState, MapLayer } from "../layers/MapLayer";
import { InteractionController } from "./InteractionController";

type Listener = (e: PointerEvent) => void;

type Surface = HTMLCanvasElement & {
  fire(type: string, x: number, y: number, button?: number): void;
};

/** A canvas that records its listeners, so a test can press, drag and release on it. */
function canvas(): Surface {
  const listeners = new Map<string, Listener>();
  return {
    style: {},
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    setPointerCapture: () => undefined,
    hasPointerCapture: () => false,
    releasePointerCapture: () => undefined,
    fire(type: string, x: number, y: number, button?: number) {
      listeners.get(type)?.({
        offsetX: x,
        offsetY: y,
        button: button ?? (type === "pointermove" ? -1 : 0),
        pointerId: 1,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      } as PointerEvent);
    },
  } as unknown as Surface;
}

let controller: InteractionController | null = null;
/** The window's key listeners, by event type, as the controller registered them. */
const keyListeners = new Map<string, (e: KeyboardEvent) => void>();

/** A key going down or up on the window; the returned spy says whether the press was kept from the app. */
function key(type: "keydown" | "keyup", name: string): () => boolean {
  const stop = vi.fn();
  keyListeners.get(type)?.({ key: name, target: null, stopImmediatePropagation: stop } as never);
  return () => stop.mock.calls.length > 0;
}

beforeEach(() => {
  keyListeners.clear();
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: (e: KeyboardEvent) => void) => keyListeners.set(type, fn),
    removeEventListener: (type: string) => keyListeners.delete(type),
  });
  vi.stubGlobal("HTMLElement", class {});
  // A frame runs at once, and hands back no handle, so every move draws straight away.
  vi.stubGlobal("requestAnimationFrame", (draw: FrameRequestCallback) => {
    draw(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useToolStore.setState({ ...useToolStore.getInitialState() });
});

afterEach(() => {
  controller?.dispose();
  controller = null;
  vi.unstubAllGlobals();
});

describe("a box select", () => {
  it("selects what it encloses in the document's order, not where each system lies", () => {
    const systems = [
      systemNode({ id: 5, x: 300 }),
      systemNode({ id: 1, x: -300 }),
      systemNode({ id: 3 }),
    ];
    useGalaxyStore.getState().load({ ...OPEN_RESULT.galaxy, systems });
    const cam = new Camera();
    cam.setViewport(800, 600);
    const surface = canvas();
    controller = new InteractionController(surface, cam, new HighlightsLayer());

    surface.fire("pointerdown", 1, 1);
    surface.fire("pointermove", 799, 599);
    surface.fire("pointerup", 799, 599);

    expect(useEditorStore.getState().selection).toEqual([5, 1, 3]);
  });
});

describe("the symmetry guides", () => {
  it("show in every tool while symmetry is on, and keep a held stroke's own until it ends", () => {
    useGalaxyStore.getState().load({ ...OPEN_RESULT.galaxy, systems: [systemNode({ id: 1 })] });
    useToolStore.setState({ tool: "select", symmetry: { kind: "mirror", axis: "x" } });
    const cam = new Camera();
    cam.setViewport(800, 600);
    const surface = canvas();
    const highlights = new HighlightsLayer();
    const guide = highlights.guide.graphics;
    const segments = () => strokes(guide).flatMap((op) => op.segments).length;
    controller = new InteractionController(surface, cam, highlights);
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
    const systems = [systemNode({ id: 1, x: 100, y: 50 }), systemNode({ id: 2, x: 100, y: -50 })];
    useGalaxyStore.getState().load({ ...OPEN_RESULT.galaxy, systems });
    useToolStore.setState({ tool: "select", symmetry: { kind: "mirror", axis: "x" } });
    const cam = new Camera();
    cam.setViewport(800, 600);
    const surface = canvas();
    const drags: Array<DragState | null> = [];
    const layer = { setDragState: (d: DragState | null) => drags.push(d) } as unknown as MapLayer;
    controller = new InteractionController(surface, cam, new HighlightsLayer(), [layer]);

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

/** Two systems 100 apart across the origin with a lane between, and a controller over them. */
function laned(tool: "select" | "cut") {
  const systems = [
    systemNode({ id: 1, x: -50, lanes: lanesTo(2) }),
    systemNode({ id: 2, x: 50, lanes: lanesTo(1) }),
  ];
  useGalaxyStore.getState().load({ ...OPEN_RESULT.galaxy, systems });
  useToolStore.setState({ tool, size: 40, symmetry: { kind: "off" } });
  const cam = new Camera();
  cam.setViewport(800, 600);
  const surface = canvas();
  const highlights = new HighlightsLayer();
  controller = new InteractionController(surface, cam, highlights);
  const brush = (label: string) => highlights.brush.container.getChildByLabel(label) as Graphics;
  const mid = cam.worldToScreen(0, 0);
  const star = cam.worldToScreen(-50, 0);
  return { surface, brush, mid, star };
}

/** An edit that settles only when the test says so. */
function pending() {
  let settle: (applied: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((resolve) => (settle = resolve));
  return { promise, settle };
}

const effects: CommandEffects = {
  focusSearch: () => undefined,
  browseInitializers: () => undefined,
};

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
    await vi.waitFor(() => expect(strokes(brush("brushMarks"))).toHaveLength(0));
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
    run("clearSelection", false, effects);
    expect(useToolStore.getState().tool).toBe("select");
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

describe("a prevented pair's dash", () => {
  it("opens its own menu on a right-click and is passed over by hover and a left click", () => {
    const systems = [
      systemNode({ id: 1, x: -50, prevented: [2] }),
      systemNode({ id: 2, x: 50, prevented: [1] }),
    ];
    useGalaxyStore.getState().load({ ...OPEN_RESULT.galaxy, systems });
    const cam = new Camera();
    cam.setViewport(800, 600);
    const surface = canvas();
    controller = new InteractionController(surface, cam, new HighlightsLayer());
    const mid = cam.worldToScreen(0, 0);

    surface.fire("pointerdown", mid.x, mid.y, 2);
    surface.fire("pointerup", mid.x, mid.y, 2);
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
