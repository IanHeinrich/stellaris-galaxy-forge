import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/textures", () => ({ getTextures: () => Promise.resolve([]) }));

import { Texture, type Renderer } from "pixi.js";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import { useDetailsStore } from "../../store/detailsStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { byId, placedNode, planetSummary, systemDetails } from "../../test/builders";
import { stubTextMeasurement } from "./fixture";
import { pickBody } from "./picking";
import { SystemScene } from "./SystemScene";

stubTextMeasurement();

const SYSTEM = 5;

function body(id: number, planetClass: string, at: [number, number], orbit: number): PlanetSummary {
  const size = { min: 16, max: 16 };
  const layout = { orbit: { min: orbit, max: orbit }, angle: null, at, size };
  return planetSummary({ id, class: planetClass, parent: id === 1 ? null : 1, orbit, layout });
}

const SUN = body(1, "pc_g_star", [0, 0], 0);
const EARTH = body(2, "pc_continental", [90, 0], 90);

type Listener = (e: Partial<PointerEvent>) => void;

/** A canvas that keeps its listeners, so a test can press on it. */
function recordingCanvas(): { canvas: HTMLCanvasElement; press: (x: number, y: number) => void } {
  const listeners = new Map<string, Listener>();
  const canvas = {
    style: {},
    addEventListener: (type: string, listener: Listener) => void listeners.set(type, listener),
    removeEventListener: (type: string) => void listeners.delete(type),
    setPointerCapture: () => undefined,
    hasPointerCapture: () => false,
    releasePointerCapture: () => undefined,
  } as unknown as HTMLCanvasElement;
  let time = 1000;
  const press = (x: number, y: number) => {
    const event = (kind: string) =>
      listeners.get(kind)?.({
        offsetX: x,
        offsetY: y,
        button: 0,
        pointerId: 1,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        timeStamp: (time += 50),
      });
    event("pointerdown");
    event("pointerup");
  };
  return { canvas, press };
}

const renderer = { generateTexture: () => new Texture() } as unknown as Renderer;
let scene: SystemScene | null = null;

afterEach(() => {
  scene?.dispose();
  scene = null;
  useDetailsStore.getState().clear();
});

describe("the system scene's name plates", () => {
  it("open their body's page on a click away from the body", () => {
    useGalaxyStore.setState({ systems: byId(placedNode(SYSTEM, 0, 0)) });
    const details = systemDetails({ id: SYSTEM, inner_radius: 400, planets: [SUN, EARTH] });
    useDetailsStore.setState({ details: new Map([[SYSTEM, details]]) });
    const { canvas, press } = recordingCanvas();
    scene = new SystemScene(renderer, canvas);
    scene.show(SYSTEM);
    scene.cam.setViewport(800, 600);
    scene.activate();
    scene.tick();
    const shown = scene;
    shown.cam.scale = 4;
    shown.cam.x = 90;
    shown.cam.y = 0;
    shown.cam.rev++;
    shown.tick();

    const earth = shown.cam.worldToScreen(90, 0);
    const offBody = (dy: number) => {
      const world = shown.cam.screenToWorld(earth.x, earth.y + dy);
      return pickBody(shown.context().bodies, shown.cam, world) === null;
    };
    const dy = Array.from({ length: 120 }, (_, i) => i + 1).find(
      (d) => offBody(d) && shown.plateAt(earth.x, earth.y + d) === EARTH.id,
    );
    if (dy === undefined) throw new Error("no plate under the planet, clear of its disc");

    press(earth.x, earth.y + dy);
    const { stack } = useInspectorStore.getState();
    expect(stack[stack.length - 1].ref).toEqual({ kind: "planet", id: EARTH.id });
  });
});
