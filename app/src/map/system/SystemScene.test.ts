import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/ipc");
vi.mock("../../api/gamedata", () => import("../../test/textures"));
vi.mock("../../store/systemGeometry", async (original) => ({
  ...(await original<typeof import("../../store/systemGeometry")>()),
  applyGeometry: vi.fn(() => Promise.resolve(true)),
}));

import { Texture, type Renderer } from "pixi.js";
import { useDetailsStore } from "../../store/detailsStore";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useInspectorStore } from "../../store/inspectorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useSceneStore } from "../../store/sceneStore";
import { applyGeometry } from "../../store/systemGeometry";
import { byId, name, placedNode, saveBody, systemDetails } from "../../test/builders";
import { recordingCanvas, stubWindowKeys } from "../../test/canvas";
import { EARTH, SUN, SYSTEM, stubTextMeasurement } from "./drawFixture";
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

let press: ReturnType<typeof stubWindowKeys>;

beforeEach(() => {
  press = stubWindowKeys();
});

const renderer = { generateTexture: () => new Texture() } as unknown as Renderer;

let scene: SystemScene | null = null;

/** The scene entered on `SYSTEM`, sized as the host sizes it, after its first frame. */
function entered(canvas = recordingCanvas()): SystemScene {
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
  vi.unstubAllGlobals();
  vi.mocked(applyGeometry).mockClear();
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

  it("centres on a body asked for before its system's record lands", () => {
    const shown = entered();
    shown.show(OTHER, 2);
    useSceneStore.getState().focusBody(NAMED_EARTH.id);
    shown.tick();
    detailsLand(OTHER);
    shown.tick();
    expect(shown.cam.worldToScreen(90, 0)).toEqual({ x: 400, y: 300 });
  });

  it("drops a body asked for when another system is entered", () => {
    const shown = entered();
    shown.focusBody(NAMED_EARTH.id);
    shown.show(OTHER, 2);
    detailsLand(OTHER);
    shown.tick();
    expect(camera(shown)).toMatchObject({ x: 0, y: 0 });
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

  function wormholeLands(y: number): void {
    const wormhole = { id: 30, bypass: 31, kind: "wormhole", partner: OTHER, x: 0, y };
    const details = systemDetails({
      id: SYSTEM,
      inner_radius: 400,
      planets: [SUN, NAMED_EARTH],
      wormholes: [wormhole],
    });
    useDetailsStore.setState({ details: new Map([[SYSTEM, details]]) });
  }

  function inView(shown: SystemScene, y: number): boolean {
    const at = shown.cam.worldToScreen(0, y);
    return at.y >= 0 && at.y <= shown.cam.height;
  }

  it("reaches a wormhole past the inner radius on entering, unless Bypasses is off", () => {
    detailsLand(SYSTEM);
    const plain = entered().cam.scale;
    scene?.dispose();
    wormholeLands(459.5);
    const shown = entered();
    expect(inView(shown, 459.5 + 40)).toBe(true);
    expect(shown.cam.scale).toBeLessThan(plain);
    scene?.dispose();
    const { sceneLayers } = useMapChromeStore.getState();
    useMapChromeStore.setState({ sceneLayers: { ...sceneLayers, bypasses: false } });
    expect(entered().cam.scale).toBe(plain);
  });

  it("leaves the camera where it is when a wormhole moves further out", () => {
    wormholeLands(459.5);
    const shown = entered();
    const fitted = camera(shown);
    wormholeLands(600);
    shown.tick();
    expect(shown.context().wormholes[0].y).toBe(600);
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
    const canvas = recordingCanvas();
    const { fire } = canvas;
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
    expect(stack[stack.length - 1].ref).toEqual({ kind: "body", system: SYSTEM, id: EARTH.id });
  });
});

describe("the system scene's tooltip", () => {
  it("shows a body's name as it lands while the pointer rests on the body", () => {
    detailsLand(SYSTEM);
    const canvas = recordingCanvas();
    const { fire } = canvas;
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
      ...saveBody(2, "random", [90, 0], 90, 16, SUN),
      name: name(""),
      name_key: "",
      drawn: true,
    };
    const details = systemDetails({ id: SYSTEM, inner_radius: 400, planets: [SUN, drawn] });
    useDetailsStore.setState({ details: new Map([[SYSTEM, details]]) });
    const canvas = recordingCanvas();
    const { fire } = canvas;
    const at = zoomedOnEarth(entered(canvas));
    fire("pointermove", at.x, at.y);

    expect(useMapChromeStore.getState().tooltip?.title).toBe("Random planet, any class");
  });
});

describe("a body dragged in the system scene", () => {
  /** Earth's angle about the centre as the scene draws it. */
  const earthAngle = (shown: SystemScene) =>
    shown.context().bodyById.get(EARTH.id)?.placement.angle ?? NaN;

  /** Presses Earth where it is drawn and drags it round its orbit to `angle` degrees. */
  function dragEarthTo(
    shown: SystemScene,
    fire: (t: string, x: number, y: number) => void,
    angle: number,
  ) {
    const from = shown.cam.worldToScreen(90, 0);
    const a = (angle * Math.PI) / 180;
    const to = shown.cam.worldToScreen(90 * Math.cos(a), 90 * Math.sin(a));
    fire("pointerdown", from.x, from.y);
    fire("pointermove", from.x, from.y + 6);
    fire("pointermove", to.x, to.y);
    return to;
  }

  it("shows the preview once a frame applies it", () => {
    detailsLand(SYSTEM);
    const canvas = recordingCanvas();
    const { fire } = canvas;
    const shown = entered(canvas);
    zoomedOnEarth(shown);
    dragEarthTo(shown, fire, 10);
    expect(earthAngle(shown)).toBe(0);
    shown.tick();
    expect(earthAngle(shown)).toBe(10);
    expect(useMapChromeStore.getState().tooltip?.title).toBe("orbit 90 · 10°");
  });

  it("holds the preview after a release through the edit's stale mark, until fresh details land", async () => {
    detailsLand(SYSTEM);
    const canvas = recordingCanvas();
    const { fire } = canvas;
    const shown = entered(canvas);
    zoomedOnEarth(shown);
    const to = dragEarthTo(shown, fire, 10);
    fire("pointerup", to.x, to.y);
    await Promise.resolve();
    expect(applyGeometry).toHaveBeenCalledWith({
      kind: "move",
      system: SYSTEM,
      body: EARTH.id,
      radius: 90,
      angle: 10,
    });
    useDetailsStore.getState().invalidate([SYSTEM]);
    shown.tick();
    expect(earthAngle(shown)).toBe(10);
    detailsLand(SYSTEM);
    shown.tick();
    expect(earthAngle(shown)).toBe(0);
  });

  it("drops the preview when the edit is refused", async () => {
    vi.mocked(applyGeometry).mockResolvedValueOnce(false);
    detailsLand(SYSTEM);
    const canvas = recordingCanvas();
    const { fire } = canvas;
    const shown = entered(canvas);
    zoomedOnEarth(shown);
    const to = dragEarthTo(shown, fire, 10);
    fire("pointerup", to.x, to.y);
    shown.tick();
    expect(earthAngle(shown)).toBe(10);
    await Promise.resolve();
    await Promise.resolve();
    shown.tick();
    expect(earthAngle(shown)).toBe(0);
  });

  it("cancels a drag whose system's details change under it, and sends nothing", () => {
    detailsLand(SYSTEM);
    const canvas = recordingCanvas();
    const { fire } = canvas;
    const shown = entered(canvas);
    zoomedOnEarth(shown);
    const to = dragEarthTo(shown, fire, 10);
    shown.tick();
    expect(earthAngle(shown)).toBe(10);
    detailsLand(SYSTEM);
    fire("pointermove", to.x + 5, to.y + 5);
    fire("pointerup", to.x + 5, to.y + 5);
    shown.tick();
    expect(earthAngle(shown)).toBe(0);
    expect(applyGeometry).not.toHaveBeenCalled();
  });

  it("puts the body back on Esc, keeping the key from the app, and sends nothing", () => {
    detailsLand(SYSTEM);
    const canvas = recordingCanvas();
    const { fire } = canvas;
    const shown = entered(canvas);
    zoomedOnEarth(shown);
    const to = dragEarthTo(shown, fire, 10);
    shown.tick();
    expect(earthAngle(shown)).toBe(10);
    const kept = press("keydown", "Escape");
    fire("pointerup", to.x, to.y);
    shown.tick();
    expect(kept()).toBe(true);
    expect(earthAngle(shown)).toBe(0);
    expect(applyGeometry).not.toHaveBeenCalled();
    expect(useMapChromeStore.getState().sceneHint).toBeNull();
  });

  it("drops a drag when the window loses focus, or a move comes with no button held", () => {
    detailsLand(SYSTEM);
    const canvas = recordingCanvas();
    const { fire } = canvas;
    const shown = entered(canvas);
    zoomedOnEarth(shown);
    dragEarthTo(shown, fire, 10);
    shown.tick();
    expect(earthAngle(shown)).toBe(10);
    press("blur", "");
    shown.tick();
    expect(earthAngle(shown)).toBe(0);

    const to = dragEarthTo(shown, fire, 20);
    shown.tick();
    expect(earthAngle(shown)).toBe(20);
    fire("pointermove", to.x + 5, to.y, { buttons: 0 });
    fire("pointerup", to.x + 5, to.y);
    shown.tick();
    expect(earthAngle(shown)).toBe(0);
    expect(applyGeometry).not.toHaveBeenCalled();
  });

  it("pans on a drag while a released edit is still held, sending nothing more", () => {
    detailsLand(SYSTEM);
    const canvas = recordingCanvas();
    const { fire } = canvas;
    const shown = entered(canvas);
    zoomedOnEarth(shown);
    const to = dragEarthTo(shown, fire, 10);
    fire("pointerup", to.x, to.y);
    shown.tick();
    const before = camera(shown);
    fire("pointerdown", to.x, to.y);
    fire("pointermove", to.x + 20, to.y);
    fire("pointermove", to.x + 40, to.y);
    fire("pointerup", to.x + 40, to.y);
    shown.tick();
    expect(camera(shown).x).not.toBe(before.x);
    expect(earthAngle(shown)).toBe(10);
    expect(applyGeometry).toHaveBeenCalledTimes(1);
  });

  it("drops a held edit's preview when the system's details fail to come back", () => {
    detailsLand(SYSTEM);
    const canvas = recordingCanvas();
    const { fire } = canvas;
    const shown = entered(canvas);
    zoomedOnEarth(shown);
    const to = dragEarthTo(shown, fire, 10);
    fire("pointerup", to.x, to.y);
    useDetailsStore.getState().invalidate([SYSTEM]);
    shown.tick();
    expect(earthAngle(shown)).toBe(10);
    const state = useDetailsStore.getState();
    useDetailsStore.setState({
      failed: new Map([[SYSTEM, "no answer"]]),
      version: state.version + 1,
    });
    shown.tick();
    expect(earthAngle(shown)).toBe(0);
  });

  it("measures the pointer again under the camera as it stands when Shift changes", () => {
    detailsLand(SYSTEM);
    const canvas = recordingCanvas();
    const { fire } = canvas;
    const shown = entered(canvas);
    zoomedOnEarth(shown);
    dragEarthTo(shown, fire, 10);
    shown.tick();
    const was = { x: 90 * Math.cos(Math.PI / 18), y: 90 * Math.sin(Math.PI / 18) };
    const now = { x: 90 * Math.cos((50 * Math.PI) / 180), y: 90 * Math.sin((50 * Math.PI) / 180) };
    shown.cam.x += now.x - was.x;
    shown.cam.y += now.y - was.y;
    shown.cam.rev++;
    press("keydown", "Shift");
    shown.tick();
    expect(earthAngle(shown)).toBe(45);
  });

  it("leaves the camera where it is while a preview reaches past the system", () => {
    detailsLand(SYSTEM);
    const canvas = recordingCanvas();
    const { fire } = canvas;
    const shown = entered(canvas);
    const fitted = camera(shown);
    const from = shown.cam.worldToScreen(90, 0);
    const far = shown.cam.worldToScreen(700, 0);
    fire("pointerdown", from.x, from.y);
    fire("pointermove", from.x - 6, from.y);
    fire("pointermove", far.x, far.y);
    shown.tick();
    expect(shown.context().layout.fitRadius).toBeGreaterThan(700);
    useGameDataStore.setState({ status: "ready", names: new Map([["NAME_Earth{}", "Gaia"]]) });
    shown.tick();
    expect(camera(shown)).toEqual(fitted);
  });
});
