import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPEN_RESULT } from "../../store/fixture";
import { systemNode } from "../../test/builders";

vi.mock("../../api/ipc");
vi.mock("../../api/events");

import { useEditorStore } from "../../store/editorStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { Camera } from "../Camera";
import { HighlightsLayer } from "../layers/HighlightsLayer";
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
