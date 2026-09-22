import type { Graphics } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_RESULT } from "../../store/fixture";
import { systemNode } from "../../test/builders";

vi.mock("../../api/ipc");
vi.mock("../../api/events");

import { useEditorStore } from "../../store/editorStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useToolStore } from "../../store/toolStore";
import { Camera } from "../Camera";
import { HighlightsLayer } from "../layers/HighlightsLayer";
import { childByLabel, strokes } from "../layers/fixture";
import type { DragState, MapLayer } from "../layers/MapLayer";
import { InteractionController } from "./InteractionController";

type Listener = (e: PointerEvent) => void;

/** A canvas that records its listeners, so a test can press, drag and release on it. */
function canvas(): HTMLCanvasElement & { fire(type: string, x: number, y: number): void } {
  const listeners = new Map<string, Listener>();
  return {
    style: {},
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    setPointerCapture: () => undefined,
    hasPointerCapture: () => false,
    releasePointerCapture: () => undefined,
    fire(type: string, x: number, y: number) {
      listeners.get(type)?.({
        offsetX: x,
        offsetY: y,
        button: type === "pointermove" ? -1 : 0,
        pointerId: 1,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
      } as PointerEvent);
    },
  } as unknown as HTMLCanvasElement & { fire(type: string, x: number, y: number): void };
}

let controller: InteractionController | null = null;

beforeEach(() => {
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
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
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    useGalaxyStore.getState().load({ ...OPEN_RESULT.galaxy, systems: [systemNode({ id: 1 })] });
    useToolStore.setState({ tool: "select", symmetry: { kind: "mirror", axis: "x" } });
    const cam = new Camera();
    cam.setViewport(800, 600);
    const surface = canvas();
    const highlights = new HighlightsLayer();
    const guide = childByLabel(highlights.container, "symmetryGuide") as Graphics;
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
