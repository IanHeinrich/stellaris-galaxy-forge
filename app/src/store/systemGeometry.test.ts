import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { GEOMETRY_REASONS } from "../lib/details/orbitEdits";
import { useDetailsStore } from "./detailsStore";
import { openFixtureSave, openFixtureScenario } from "./editorFixture";
import { polar } from "../lib/details/orbits";
import { saveBody } from "../test/builders";
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
      type: "MoveBody",
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
      type: "MoveBody",
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

describe("quick edits in a row", () => {
  /** Sol as the save writes it once an edit lands: `over` in place of the fixture's. */
  function answerWith(over: Parameters<typeof orbitSystem>[0]): void {
    mockedIpc.applyOp.mockResolvedValue(editResult({ details_stale: [SOL] }));
    mockedIpc.getSystemDetails.mockResolvedValue([orbitSystem({ id: SOL, ...over })]);
  }

  it("builds each edit on the details the one before it left", async () => {
    answerWith({ belts: [{ kind: "rocky_asteroid_belt", inner_radius: 120 }] });
    const remove = { kind: "removeBelt", system: SOL, index: 1 } as const;
    const [first, second] = await Promise.all([applyGeometry(remove), applyGeometry(remove)]);
    expect([first, second]).toEqual([true, false]);
    expect(mockedIpc.applyOp).toHaveBeenCalledOnce();
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "RemoveBelt",
      system: SOL,
      index: 1,
    });
  });

  it("nudges twice from where each press left the body", async () => {
    inspect(LONE);
    const turned = polar(0, 0, 100, 121);
    const planets = orbitSystem().planets.map((p) =>
      p.id === LONE ? saveBody(LONE, "pc_arid", [turned.x, turned.y], 100, 12) : p,
    );
    answerWith({ planets });
    await Promise.all([nudgeBody({ turn: 1, out: 0 }), nudgeBody({ turn: 1, out: 0 })]);
    expect(mockedIpc.applyOp.mock.calls.map(([op]) => (op as { angle: number }).angle)).toEqual([
      121, 122,
    ]);
  });

  it("says a refusal where the caller asks, and in the status bar by default", async () => {
    const said: string[] = [];
    const intent = { kind: "move", system: SOL, body: STAR, radius: 10, angle: 0 } as const;
    expect(await applyGeometry(intent, (reason) => said.push(reason))).toBe(false);
    expect(said).toEqual([GEOMETRY_REASONS.star]);
    expect(useMapChromeStore.getState().sceneHint).toBeNull();
  });
});
