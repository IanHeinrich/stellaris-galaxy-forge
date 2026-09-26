import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/textures", () => ({ getTextures: () => Promise.resolve([]) }));

import { Texture, type Renderer } from "pixi.js";
import { useDetailsStore } from "../../store/detailsStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { byId, name, placedNode, systemDetails } from "../../test/builders";
import { EARTH, SUN, SYSTEM, saveBody, stubTextMeasurement } from "./fixture";
import { pickBody } from "./picking";
import { SystemScene } from "./SystemScene";

stubTextMeasurement();

/** The id an edit gives `SYSTEM` when it renumbers the systems. */
const RENUMBERED = 4;
const OTHER = 6;

const NAMED_EARTH = {
  ...EARTH,
  name: name("NAME_Earth"),
  name_key: "NAME_Earth",
};

type Listener = (e: Partial<PointerEvent>) => void;

/** A canvas that keeps its listeners, so a test can move and press on it. */
function recordingCanvas(): {
  canvas: HTMLCanvasElement;
  fire: (type: string, x: number, y: number) => void;
} {
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
  const fire = (type: string, x: number, y: number) =>
    listeners.get(type)?.({
      offsetX: x,
      offsetY: y,
      button: type === "pointermove" ? -1 : 0,
      pointerId: 1,
      timeStamp: (time += 50),
    });
  return { canvas, fire };
}

const renderer = { generateTexture: () => new Texture() } as unknown as Renderer;

let scene: SystemScene | null = null;

/** The scene entered on `SYSTEM`, sized as the host sizes it, after its first frame. */
function entered(canvas = recordingCanvas().canvas): SystemScene {
  useGalaxyStore.setState({
    systems: byId(placedNode(SYSTEM, 0, 0), placedNode(RENUMBERED, 0, 0), placedNode(OTHER, 0, 0)),
  });
  scene = new SystemScene(renderer, canvas);
  scene.show(SYSTEM, 1);
  scene.cam.setViewport(800, 600);
  scene.activate();
  scene.tick();
  return scene;
}

/** The scene's camera close on the planet at (90, 0), where its disc and plate are easy to hit. */
function zoomedOnEarth(shown: SystemScene): { x: number; y: number } {
  shown.cam.scale = 4;
  shown.cam.x = 90;
  shown.cam.y = 0;
  shown.cam.rev++;
  shown.tick();
  return shown.cam.worldToScreen(90, 0);
}

function detailsLand(...ids: number[]): void {
  const records = ids.map((id) => {
    const details = systemDetails({ id, inner_radius: 400, planets: [SUN, NAMED_EARTH] });
    return [id, details] as const;
  });
  useDetailsStore.setState({ details: new Map(records) });
}

function camera(shown: SystemScene): { x: number; y: number; scale: number } {
  return { x: shown.cam.x, y: shown.cam.y, scale: shown.cam.scale };
}

afterEach(() => {
  scene?.dispose();
  scene = null;
  useDetailsStore.getState().clear();
  useGameDataStore.setState(useGameDataStore.getInitialState());
  useMapChromeStore.setState(useMapChromeStore.getInitialState());
});

describe("the system scene's fit", () => {
  /** Entered while the system's record is not in, then the rail hiding. */
  function enteredDuringWarmUp(): SystemScene {
    const shown = entered();
    shown.cam.setViewport(740, 600);
    shown.tick();
    return shown;
  }

  it("fits again to the system's own radius when its record lands after a resize", () => {
    const shown = enteredDuringWarmUp();
    const standIn = shown.cam.scale;
    detailsLand(SYSTEM);
    shown.tick();
    expect(shown.cam.scale).toBeLessThan(standIn / 2);
  });

  it("leaves the camera where the user zoomed it when the record lands", () => {
    const shown = enteredDuringWarmUp();
    shown.cam.zoomAt({ x: 100, y: 100 }, 1.5);
    const zoomed = camera(shown);
    detailsLand(SYSTEM);
    shown.tick();
    expect(camera(shown)).toEqual(zoomed);
  });

  it("leaves the camera where the user zoomed it when an edit renumbers the system", () => {
    detailsLand(SYSTEM, RENUMBERED);
    const shown = entered();
    shown.cam.zoomAt({ x: 100, y: 100 }, 1.5);
    const zoomed = camera(shown);
    shown.show(RENUMBERED, 1);
    shown.tick();
    expect(camera(shown)).toEqual(zoomed);
  });

  it("fits again when another system is entered", () => {
    detailsLand(SYSTEM, OTHER);
    const shown = entered();
    const fitted = camera(shown);
    shown.cam.zoomAt({ x: 100, y: 100 }, 1.5);
    shown.show(OTHER, 2);
    shown.tick();
    expect(camera(shown)).toEqual(fitted);
  });
});

describe("the system scene's lanes", () => {
  it("drop the highlighted lane when an edit renumbers the system and its neighbours", () => {
    detailsLand(SYSTEM, RENUMBERED);
    const shown = entered();
    useGalaxyStore.setState({
      systems: byId(
        placedNode(SYSTEM, 0, 0, [12, 13]),
        placedNode(12, 100, 0),
        placedNode(13, 0, 100),
      ),
    });
    shown.selectLane(12);
    const before = useMapChromeStore.getState().sceneHint;

    useGalaxyStore.setState({
      systems: byId(
        placedNode(RENUMBERED, 0, 0, [11, 12]),
        placedNode(11, 100, 0),
        placedNode(12, 0, 100),
      ),
    });
    shown.show(RENUMBERED, 1);

    expect(before).not.toBeNull();
    expect(useMapChromeStore.getState().sceneHint).toBeNull();
  });
});

describe("the system scene's name plates", () => {
  it("open their body's page on a click away from the body", () => {
    detailsLand(SYSTEM);
    const { canvas, fire } = recordingCanvas();
    const shown = entered(canvas);
    const earth = zoomedOnEarth(shown);

    const offBody = (dy: number) => {
      const world = shown.cam.screenToWorld(earth.x, earth.y + dy);
      return pickBody(shown.context().bodies, shown.cam, world) === null;
    };
    const dy = Array.from({ length: 120 }, (_, i) => i + 1).find(
      (d) => offBody(d) && shown.plateAt(earth.x, earth.y + d) === EARTH.id,
    );
    if (dy === undefined) throw new Error("no plate under the planet, clear of its disc");

    fire("pointerdown", earth.x, earth.y + dy);
    fire("pointerup", earth.x, earth.y + dy);
    const { stack } = useInspectorStore.getState();
    expect(stack[stack.length - 1].ref).toEqual({ kind: "planet", id: EARTH.id });
  });
});

describe("the system scene's tooltip", () => {
  it("shows a body's name as it lands while the pointer rests on the body", () => {
    detailsLand(SYSTEM);
    const { canvas, fire } = recordingCanvas();
    const shown = entered(canvas);
    const earth = zoomedOnEarth(shown);
    fire("pointermove", earth.x, earth.y);
    const before = useMapChromeStore.getState().tooltip?.title;

    useGameDataStore.setState({ status: "ready", names: new Map([["NAME_Earth{}", "Gaia"]]) });

    expect(before).not.toBe("Gaia");
    expect(useMapChromeStore.getState().tooltip?.title).toBe("Gaia");
  });

  it("names an unnamed body by what the initializer draws for it", () => {
    const drawn = {
      ...saveBody(2, "random", [90, 0], 90, 1),
      name: name(""),
      name_key: "",
      drawn: true,
    };
    const details = systemDetails({ id: SYSTEM, inner_radius: 400, planets: [SUN, drawn] });
    useDetailsStore.setState({ details: new Map([[SYSTEM, details]]) });
    const { canvas, fire } = recordingCanvas();
    const at = zoomedOnEarth(entered(canvas));
    fire("pointermove", at.x, at.y);

    expect(useMapChromeStore.getState().tooltip?.title).toBe("Random planet, any class");
  });
});
