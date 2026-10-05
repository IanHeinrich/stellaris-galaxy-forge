/** The canvas, galaxy and hooks an interaction controller test runs over. */
import { afterEach, beforeEach, vi } from "vitest";
import type { Graphics } from "pixi.js";
import type { Nebula } from "../../generated/Nebula";
import type { SystemNode } from "../../generated/SystemNode";
import type { CommandEffects } from "../../store/commands";
import { useEditorStore } from "../../store/editorStore";
import { OPEN_RESULT } from "../../store/fixture";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useToolStore } from "../../store/toolStore";
import { lanesTo, systemNode } from "../../test/builders";
import { recordingCanvas, stubWindowKeys } from "../../test/canvas";
import { Camera } from "../Camera";
import { DrawnPositions } from "../drawnPositions";
import { HighlightsLayer } from "../layers/HighlightsLayer";
import type { MapLayer } from "../layers/MapLayer";
import { InteractionController } from "./InteractionController";

let controller: InteractionController | null = null;
let keys: ReturnType<typeof stubWindowKeys>;

/** The controller the last `mapOver` built. */
export function current(): InteractionController {
  if (!controller) throw new Error("no controller: call mapOver first");
  return controller;
}

/** Sends a key event to the window the controller listens on. */
export const key: ReturnType<typeof stubWindowKeys> = (type, name) => keys(type, name);

/** Fresh stores, frames that run at once and window keys before each test; the controller disposed after. */
export function installControllerHooks(): void {
  beforeEach(() => {
    keys = stubWindowKeys();
    // A frame runs at once, and hands back no handle, so every move draws straight away.
    vi.stubGlobal("requestAnimationFrame", (draw: FrameRequestCallback) => {
      draw(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    useEditorStore.setState({ ...useEditorStore.getInitialState() });
    useToolStore.setState({ ...useToolStore.getInitialState() });
    useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
  });

  afterEach(() => {
    controller?.dispose();
    controller = null;
    vi.unstubAllGlobals();
  });
}

export /** A galaxy of `systems` and `nebulae` on an 800 by 600 canvas, and a controller over it. */
function mapOver(systems: SystemNode[], layers: MapLayer[] = [], nebulae: Nebula[] = []) {
  useGalaxyStore.getState().load({ ...OPEN_RESULT.galaxy, systems, nebulae });
  const cam = new Camera();
  cam.setViewport(800, 600);
  const surface = recordingCanvas();
  const positions = new DrawnPositions(cam);
  const highlights = new HighlightsLayer(positions);
  controller = new InteractionController(surface, cam, highlights, layers, positions);
  return { cam, surface, highlights, positions };
}

export /** Two systems 100 apart across the origin with a lane between, and a controller over them. */
function laned(tool: "select" | "cut") {
  useToolStore.setState({ tool, size: 40, symmetry: { kind: "off" } });
  const { cam, surface, highlights } = mapOver([
    systemNode({ id: 1, x: -50, lanes: lanesTo(2) }),
    systemNode({ id: 2, x: 50, lanes: lanesTo(1) }),
  ]);
  const brush = (label: string) => highlights.brush.container.getChildByLabel(label) as Graphics;
  const mid = cam.worldToScreen(0, 0);
  const star = cam.worldToScreen(-50, 0);
  return { surface, highlights, brush, mid, star };
}

/** An edit that settles only when the test says so. */
export function pending() {
  let settle: (applied: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((resolve) => (settle = resolve));
  return { promise, settle };
}

export const effects: CommandEffects = {
  focusSearch: () => undefined,
  browseInitializers: () => undefined,
};
