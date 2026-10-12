import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { GEOMETRY_REASONS } from "../lib/details/orbitIntent";
import { DETAILS_DEBOUNCE_MS } from "./batching";
import { documentCapabilities } from "../lib/capabilities";
import { useDetailsStore } from "./detailsStore";
import { useFileSessionStore } from "./fileSessionStore";
import { openFixtureSave, openFixtureScenario } from "./editorFixture";
import { polar } from "../lib/details/orbits";
import type { MegastructurePlace } from "../generated/MegastructurePlace";
import { megastructureSummary, saveBody } from "../test/builders";
import { editResult, orbitClasses, orbitSystem } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { bodyEntry, useInspectorStore } from "./inspectorStore";
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
  useInspectorStore.getState().openFromMap(bodyEntry(SOL, id, "Body"));
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

  it("names the system in the description of a belt move by its name and id", async () => {
    await applyGeometry({ kind: "setBeltRadius", system: SOL, index: 0, radius: 130 });
    expect(mockedIpc.applyOp).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "Moved the belt at radius 120 in Sol #0 to 130, with 1 asteroid",
      }),
    );
  });

  it("sends nothing on a scenario", async () => {
    await openFixtureScenario();
    readSol();
    expect(systemGeometry(SOL).editing.bodies.size).toBe(0);
    const intent = { kind: "move", system: SOL, body: LONE, radius: 110, angle: 90 } as const;
    expect(await applyGeometry(intent)).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("says why a refused intent is refused where the caller asks, in the status bar by default", async () => {
    const said: string[] = [];
    const intent = { kind: "move", system: SOL, body: STAR, radius: 10, angle: 0 } as const;
    expect(await applyGeometry(intent, (reason) => said.push(reason))).toBe(false);
    expect(said).toEqual([GEOMETRY_REASONS.star]);
    expect(useMapChromeStore.getState().sceneHint).toBeNull();

    expect(await applyGeometry(intent)).toBe(false);
    expect(useMapChromeStore.getState().sceneHint).toBe(GEOMETRY_REASONS.star);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });
});

describe("a megastructure's move", () => {
  /** Sol with a gateway at a point of its own and a Science Nexus around planet 5. */
  function withStructures(): void {
    const megastructures = [
      megastructureSummary({ id: 40, kind: "gateway_final", at: [0, 250] }),
      megastructureSummary({ id: 41, kind: "think_tank_3", planet: LONE, at: null }),
    ];
    useDetailsStore.setState({
      details: new Map([[SOL, orbitSystem({ id: SOL, megastructures })]]),
    });
  }
  const moved = (megastructure: number, at: MegastructurePlace) =>
    ({ kind: "moveMegastructure", system: SOL, megastructure, at }) as const;

  it("sends the op that moves a structure to a point or onto another body", async () => {
    withStructures();
    expect(systemGeometry(SOL).editing.megastructures).toBe(true);
    expect(await applyGeometry(moved(40, { place: "free", x: 10, y: 220 }))).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "MoveMegastructure",
      megastructure: 40,
      at: { place: "free", x: 10, y: 220 },
    });
    expect(await applyGeometry(moved(41, { place: "body", body: 2 }))).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenLastCalledWith({
      type: "MoveMegastructure",
      megastructure: 41,
      at: { place: "body", body: 2 },
    });
  });

  it("sends nothing where it stands already, and refuses a row or body not in the system", async () => {
    withStructures();
    expect(await applyGeometry(moved(41, { place: "body", body: LONE }))).toBe(false);
    const said: string[] = [];
    const say = (reason: string) => said.push(reason);
    expect(await applyGeometry(moved(99, { place: "body", body: 2 }), say)).toBe(false);
    expect(await applyGeometry(moved(41, { place: "body", body: 99 }), say)).toBe(false);
    expect(said).toEqual([GEOMETRY_REASONS.megastructureElsewhere, GEOMETRY_REASONS.elsewhere]);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("moves nothing in a save before Stellaris 4.0, which the core refuses", async () => {
    withStructures();
    const session = useFileSessionStore.getState();
    useFileSessionStore.setState({
      capabilities: { ...documentCapabilities(session), geometry: false },
    });
    expect(systemGeometry(SOL).editing.megastructures).toBe(false);
    expect(await applyGeometry(moved(40, { place: "free", x: 10, y: 220 }))).toBe(false);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("moves nothing on a scenario", async () => {
    await openFixtureScenario();
    withStructures();
    expect(systemGeometry(SOL).editing.megastructures).toBe(false);
    expect(await applyGeometry(moved(40, { place: "free", x: 10, y: 220 }))).toBe(false);
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
    useInspectorStore.getState().openFromMap(bodyEntry(SOL, LONE, "Body"));
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

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds each edit on the details the one before it left", async () => {
    answerWith({ belts: [{ kind: "rocky_asteroid_belt", inner_radius: 120 }] });
    const remove = { kind: "removeBelt", system: SOL, index: 1 } as const;
    const edits = Promise.all([applyGeometry(remove), applyGeometry(remove)]);
    await vi.advanceTimersByTimeAsync(DETAILS_DEBOUNCE_MS);
    const [first, second] = await edits;
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
    const nudges = Promise.all([nudgeBody({ turn: 1, out: 0 }), nudgeBody({ turn: 1, out: 0 })]);
    await vi.advanceTimersByTimeAsync(DETAILS_DEBOUNCE_MS);
    await vi.advanceTimersByTimeAsync(DETAILS_DEBOUNCE_MS);
    await nudges;
    expect(mockedIpc.applyOp.mock.calls.map(([op]) => (op as { angle: number }).angle)).toEqual([
      121, 122,
    ]);
  });
});
