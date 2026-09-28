import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import type { Op } from "../generated/Op";
import type { PlanetMoveTargets } from "../generated/PlanetMoveTargets";
import type { PlanetMoveWarning } from "../generated/PlanetMoveWarning";
import { mockedIpc } from "../test/ipc";
import { run, type CommandEffects } from "./commands";
import { openFixtureSave, openFixtureScenario } from "./editorFixture";
import { useEditorStore } from "./editorStore";
import { editResult } from "./fixture";
import { bodyEntryOf, useInspectorStore } from "./inspectorStore";
import { useLayoutStore } from "./layoutStore";
import { cutAvailability, pasteCheckOf, usePlanetMoveStore } from "./planetMoveStore";
import { useSceneStore } from "./sceneStore";

const SOL = 0;
const CENTAURI = 1;
const BARNARD = 2;
const EARTH = 10;
const MARS = 11;
const LUNA = 12;
const JUPITER = 13;

const COLONY: PlanetMoveWarning = { planet: MARS, kind: "colony", owner: 0, new_owner: 1 };

const moves = () => usePlanetMoveStore.getState();
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function targets(planets: number[], over: Partial<PlanetMoveTargets> = {}): PlanetMoveTargets {
  return {
    planets,
    refused: [],
    systems: [
      { system: CENTAURI, warnings: [] },
      { system: BARNARD, warnings: [COLONY] },
    ],
    ...over,
  };
}

const MOVE: Op = {
  type: "Batch",
  description: "Moved 2 planets to Alpha Centauri",
  ops: [
    { type: "MoveSavePlanet", planet: EARTH, to: CENTAURI },
    { type: "MoveSavePlanet", planet: MARS, to: CENTAURI },
  ],
};

/** Earth and Mars of Sol selected, with the targets for them in. */
async function selectTwo(): Promise<void> {
  moves().selectBody(SOL, EARTH);
  moves().toggleBody(SOL, MARS);
  await settle();
}

beforeEach(async () => {
  await openFixtureSave();
  mockedIpc.planetMoveTargets.mockImplementation(async (planets) => targets(planets));
  mockedIpc.planetMoveOp.mockResolvedValue(MOVE);
  mockedIpc.applyOp.mockResolvedValue(editResult());
});

describe("body selection", () => {
  it("toggles bodies of one system in the order they were picked", () => {
    moves().selectBody(SOL, EARTH);
    moves().toggleBody(SOL, MARS);
    moves().toggleBody(SOL, LUNA);
    expect(moves().selection).toEqual({ system: SOL, ids: [EARTH, MARS, LUNA] });
    moves().toggleBody(SOL, MARS);
    expect(moves().selection).toEqual({ system: SOL, ids: [EARTH, LUNA] });
    moves().toggleBody(CENTAURI, JUPITER);
    expect(moves().selection).toEqual({ system: CENTAURI, ids: [JUPITER] });
    moves().toggleBody(CENTAURI, JUPITER);
    expect(moves().selection).toBeNull();
  });

  it("is cleared by entering another system and kept on entering its own", () => {
    useSceneStore.getState().enterSystem(SOL);
    moves().selectBody(SOL, EARTH);
    useSceneStore.getState().exitScene();
    useSceneStore.getState().enterSystem(SOL);
    expect(moves().selection).toEqual({ system: SOL, ids: [EARTH] });
    useSceneStore.getState().enterSystem(CENTAURI);
    expect(moves().selection).toBeNull();
  });

  it("starts again with each toggle on a scenario, whose planets cannot move", async () => {
    await openFixtureScenario();
    moves().selectBody(SOL, EARTH);
    moves().toggleBody(SOL, MARS);
    expect(moves().selection).toEqual({ system: SOL, ids: [MARS] });
    expect(cutAvailability(moves())).toEqual({ kind: "none" });
    expect(mockedIpc.planetMoveTargets).not.toHaveBeenCalled();
  });
});

describe("cut and paste", () => {
  it("cuts the planets the core normalises, from the selection's system", async () => {
    mockedIpc.planetMoveTargets.mockResolvedValue(targets([EARTH]));
    moves().selectBody(SOL, EARTH);
    moves().toggleBody(SOL, LUNA);
    expect(cutAvailability(moves())).toEqual({ kind: "pending" });
    expect(moves().cutSelection()).toBe(false);
    await settle();
    expect(cutAvailability(moves())).toEqual({ kind: "ready", planets: [EARTH] });
    expect(moves().cutSelection()).toBe(true);
    expect(moves().cut).toMatchObject({ planets: [EARTH], from: SOL });
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("replaces a cut with the next one", async () => {
    await selectTwo();
    moves().cutSelection();
    moves().selectBody(SOL, JUPITER);
    await settle();
    expect(moves().cutSelection()).toBe(true);
    expect(moves().cut?.planets).toEqual([JUPITER]);
  });

  it("will not cut a set the core refuses, and says why", async () => {
    mockedIpc.planetMoveTargets.mockResolvedValue(
      targets([EARTH, MARS], {
        refused: [
          { planet: EARTH, reason: "Sol is a star: only planets and moons can move" },
          { planet: MARS, reason: "Mars is occupied" },
        ],
        systems: [],
      }),
    );
    await selectTwo();
    expect(cutAvailability(moves())).toEqual({
      kind: "refused",
      reason: "Sol is a star: only planets and moons can move (and 1 more)",
    });
    expect(moves().cutSelection()).toBe(false);
    expect(moves().cut).toBeNull();
  });

  it("pastes on the galaxy map in one edit, selecting the moved planets and their new system", async () => {
    await selectTwo();
    moves().cutSelection();
    expect(await moves().paste(CENTAURI)).toBe(true);
    expect(mockedIpc.planetMoveOp).toHaveBeenCalledWith([EARTH, MARS], CENTAURI, null);
    expect(mockedIpc.applyOp).toHaveBeenCalledOnce();
    expect(mockedIpc.applyOp).toHaveBeenCalledWith(MOVE);
    expect(moves().cut).toBeNull();
    expect(moves().selection).toEqual({ system: CENTAURI, ids: [EARTH, MARS] });
    expect(useEditorStore.getState().selection).toEqual([CENTAURI]);
    expect(useSceneStore.getState().scene).toEqual({ kind: "galaxy" });
  });

  it("pastes a lone planet at the clicked orbit in the system view, and stays there", async () => {
    useSceneStore.getState().enterSystem(SOL);
    moves().selectBody(SOL, EARTH);
    await settle();
    moves().cutSelection();
    useSceneStore.getState().enterSystem(CENTAURI);
    expect(moves().cut?.planets).toEqual([EARTH]);
    const at = { radius: 108, angle: 20 };
    expect(await moves().paste(CENTAURI, at)).toBe(true);
    expect(mockedIpc.planetMoveOp).toHaveBeenCalledWith([EARTH], CENTAURI, at);
    expect(useSceneStore.getState().scene).toEqual({ kind: "system", id: CENTAURI });
    expect(moves().selection).toEqual({ system: CENTAURI, ids: [EARTH] });
  });

  it("keeps the cut when the edit is refused", async () => {
    await selectTwo();
    moves().cutSelection();
    mockedIpc.applyOp.mockRejectedValue({ kind: "refused", message: "no" });
    expect(await moves().paste(CENTAURI)).toBe(false);
    expect(moves().cut?.planets).toEqual([EARTH, MARS]);
  });
});

describe("paste checks", () => {
  it("reads a listed system's warnings from the cut, and asks the core about any other", async () => {
    await selectTwo();
    moves().cutSelection();
    const { cut, checks } = moves();
    expect(pasteCheckOf(cut, checks, BARNARD)).toEqual({ refusal: null, warnings: [COLONY] });
    expect(pasteCheckOf(cut, checks, SOL)).toBeNull();

    const same = { refusal: "These planets are already in Sol", warnings: [] };
    mockedIpc.planetMoveCheck.mockResolvedValue(same);
    expect(await moves().checkPaste(SOL)).toEqual(same);
    expect(await moves().checkPaste(SOL)).toEqual(same);
    expect(mockedIpc.planetMoveCheck).toHaveBeenCalledOnce();
    expect(mockedIpc.planetMoveCheck).toHaveBeenCalledWith([EARTH, MARS], SOL, null);
  });

  it("asks the core about a placement, since the targets know nothing of orbits", async () => {
    await selectTwo();
    moves().cutSelection();
    const at = { radius: 108, angle: 20 };
    mockedIpc.planetMoveCheck.mockResolvedValue({ refusal: null, warnings: [] });
    expect(pasteCheckOf(moves().cut, moves().checks, CENTAURI, at)).toBeNull();
    await moves().checkPaste(CENTAURI, at);
    expect(mockedIpc.planetMoveCheck).toHaveBeenCalledWith([EARTH, MARS], CENTAURI, at);
    expect(pasteCheckOf(moves().cut, moves().checks, CENTAURI, at)).toEqual({
      refusal: null,
      warnings: [],
    });
  });
});

describe("after an edit", () => {
  it("reads the cut's targets again and forgets cached checks", async () => {
    await selectTwo();
    moves().cutSelection();
    mockedIpc.planetMoveCheck.mockResolvedValue({ refusal: "x", warnings: [] });
    await moves().checkPaste(SOL);
    mockedIpc.planetMoveTargets.mockClear();
    await useEditorStore.getState().applyOp({ type: "MoveSystem", id: 3, x: 1, y: 1 });
    await settle();
    expect(mockedIpc.planetMoveTargets).toHaveBeenCalledWith([EARTH, MARS]);
    expect(moves().checks.size).toBe(0);
    expect(moves().cut?.planets).toEqual([EARTH, MARS]);
  });

  it("drops a cut whose planets have left its system", async () => {
    await selectTwo();
    moves().cutSelection();
    mockedIpc.planetMoveTargets.mockResolvedValue(
      targets([EARTH, MARS], { systems: [{ system: SOL, warnings: [] }] }),
    );
    await useEditorStore.getState().applyOp({ type: "MoveSystem", id: 3, x: 1, y: 1 });
    await settle();
    expect(moves().cut).toBeNull();
  });
});

describe("Esc", () => {
  const effects: CommandEffects = { focusSearch: vi.fn(), browseInitializers: vi.fn() };
  const esc = () => run("clearSelection", false, effects);

  it("cancels the cut, then clears the bodies, then leaves the system", async () => {
    useLayoutStore.setState({ tab: "inspector", collapsed: false });
    useSceneStore.getState().enterSystem(SOL);
    await selectTwo();
    moves().cutSelection();
    moves().selectBody(SOL, EARTH);
    useInspectorStore.getState().openFromMap(bodyEntryOf(true, SOL, EARTH, "Earth"));

    esc();
    expect(moves().cut).toBeNull();
    expect(moves().selection).toEqual({ system: SOL, ids: [EARTH] });
    expect(useInspectorStore.getState().stack).toHaveLength(2);

    esc();
    expect(moves().selection).toBeNull();
    expect(useInspectorStore.getState().stack).toHaveLength(1);
    expect(useSceneStore.getState().scene).toEqual({ kind: "system", id: SOL });

    esc();
    expect(useSceneStore.getState().scene).toEqual({ kind: "galaxy" });
  });

  it("cancels a cut on the galaxy map, and leaves the hidden body selection to the galaxy", async () => {
    await selectTwo();
    moves().cutSelection();
    esc();
    expect(moves().cut).toBeNull();
    esc();
    expect(moves().selection).toEqual({ system: SOL, ids: [EARTH, MARS] });
  });
});
