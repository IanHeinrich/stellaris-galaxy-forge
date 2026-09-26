import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/textures", () => ({ getTextures: () => Promise.resolve([]) }));

import { Texture, type Renderer } from "pixi.js";
import { useDetailsStore } from "../../store/detailsStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { byId, placedNode, systemDetails } from "../../test/builders";
import { SystemScene } from "./SystemScene";

const SYSTEM = 5;

const renderer = { generateTexture: () => new Texture() } as unknown as Renderer;
const canvas = {
  style: {},
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
} as unknown as HTMLCanvasElement;

let scene: SystemScene | null = null;

/** The scene entered on a system whose record is not in, sized as the host sizes it, then the rail hiding. */
function enteredDuringWarmUp(): SystemScene {
  useGalaxyStore.setState({ systems: byId(placedNode(SYSTEM, 0, 0)) });
  scene = new SystemScene(renderer, canvas);
  scene.show(SYSTEM);
  scene.cam.setViewport(800, 600);
  scene.activate();
  scene.tick();
  scene.cam.setViewport(740, 600);
  scene.tick();
  return scene;
}

function detailsLand(): void {
  const details = systemDetails({ id: SYSTEM, inner_radius: 400 });
  useDetailsStore.setState({ details: new Map([[SYSTEM, details]]) });
}

afterEach(() => {
  scene?.dispose();
  scene = null;
  useDetailsStore.getState().clear();
});

describe("the system scene's fit", () => {
  it("fits again to the system's own radius when its record lands after a resize", () => {
    const shown = enteredDuringWarmUp();
    const standIn = shown.cam.scale;
    detailsLand();
    shown.tick();
    expect(shown.cam.scale).toBeLessThan(standIn / 2);
  });

  it("leaves the camera where the user zoomed it when the record lands", () => {
    const shown = enteredDuringWarmUp();
    shown.cam.zoomAt({ x: 100, y: 100 }, 1.5);
    const zoomed = { x: shown.cam.x, y: shown.cam.y, scale: shown.cam.scale };
    detailsLand();
    shown.tick();
    expect({ x: shown.cam.x, y: shown.cam.y, scale: shown.cam.scale }).toEqual(zoomed);
  });
});
