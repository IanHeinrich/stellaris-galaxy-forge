import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { GEOMETRY_REASONS } from "../lib/details/orbitEdits";
import { useDetailsStore } from "./detailsStore";
import { openFixtureSave, openFixtureScenario } from "./editorFixture";
import { editResult, orbitClasses, orbitSystem } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { bodyEntryOf, useInspectorStore } from "./inspectorStore";
import { useMapChromeStore } from "./mapChromeStore";
import { useSceneStore } from "./sceneStore";
import { applyGeometry, nudgeBody, systemGeometry } from "./systemGeometry";
import { mockedIpc } from "../test/ipc";

/** Sol of the fixture galaxy, read as the save system with moons and belts. */
const SOL = 0;
const STAR = 1;
const LONE = 5;

/** Sol's details as the store holds them, and the classes that read them. */
function readSol(): void {
  useDetailsStore.setState({ details: new Map([[SOL, orbitSystem({ id: SOL })]]) });
  useGameDataStore.setState({ planetClasses: orbitClasses() });
}

/** Sol on screen, with the inspector showing body `id`'s page. */
function inspect(id: number): void {
  useSceneStore.getState().enterSystem(SOL);
  useInspectorStore.getState().openFromMap(bodyEntryOf(true, SOL, id, "Body"));
}

beforeEach(async () => {
  await openFixtureSave();
  readSol();
  mockedIpc.applyOp.mockResolvedValue(editResult());
});

describe("applyGeometry", () => {
  it("sends the one op a move makes", async () => {
    const applied = await applyGeometry({
      kind: "move",
      system: SOL,
      body: LONE,
      radius: 110,
      angle: 90,
    });
    expect(applied).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenCalledOnce();
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "MoveSaveBody",
      system: SOL,
      body: LONE,
      radius: 110,
      angle: 90,
    });
  });

  it("sends nothing on a scenario", async () => {
    await openFixtureScenario();
    readSol();
    expect(systemGeometry(SOL).editing.bodies.size).toBe(0);
    const intent = { kind: "move", system: SOL, body: LONE, radius: 110, angle: 90 } as const;
    expect(await applyGeometry(intent)).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("says why a refused intent is refused in the status bar, and sends nothing", async () => {
    const intent = { kind: "move", system: SOL, body: STAR, radius: 10, angle: 0 } as const;
    expect(await applyGeometry(intent)).toBe(false);
    expect(useMapChromeStore.getState().sceneHint).toBe(GEOMETRY_REASONS.star);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});

describe("systemGeometry", () => {
  it("reads the layout the scene draws, and the same editing while nothing changes", () => {
    const first = systemGeometry(SOL);
    const again = systemGeometry(SOL);
    expect(again.layout).toBe(first.layout);
    expect(again.editing).toBe(first.editing);
    expect(first.editing.bodies.get(LONE)?.move).toBe(true);
  });
});

describe("nudgeBody", () => {
  it("turns and steps out the body the inspector shows, landing on whole values", async () => {
    inspect(LONE);
    expect(await nudgeBody({ turn: 1, out: 0 })).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "MoveSaveBody",
      system: SOL,
      body: LONE,
      radius: 100,
      angle: 121,
    });
    await nudgeBody({ turn: 0, out: -10 });
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith(
      expect.objectContaining({ radius: 90, angle: expect.closeTo(120, 9) }),
    );
  });

  it("does nothing with no body page on top, or for a body that cannot move", async () => {
    useSceneStore.getState().enterSystem(SOL);
    expect(await nudgeBody({ turn: 1, out: 0 })).toBe(false);
    inspect(STAR);
    expect(await nudgeBody({ turn: 1, out: 0 })).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("does nothing while the galaxy is shown", async () => {
    useInspectorStore.getState().openFromMap(bodyEntryOf(true, SOL, LONE, "Body"));
    expect(await nudgeBody({ turn: 1, out: 0 })).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});
