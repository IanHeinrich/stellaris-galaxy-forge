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
import { bodyEntry, useInspectorStore } from "./inspectorStore";
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
    { type: "MoveBodyToSystem", body: EARTH, to: CENTAURI },
    { type: "MoveBodyToSystem", body: MARS, to: CENTAURI },
  ],
};

/** Earth and Mars of Sol selected, with the targets for them in. */
async function selectTwo(): Promise<void> {
  useSceneStore.getState().selectBody(SOL, EARTH);
  useSceneStore.getState().toggleBody(SOL, MARS);
  await settle();
}

beforeEach(async () => {
  await openFixtureSave();
  mockedIpc.planetMoveTargets.mockImplementation(async (planets) => targets(planets));
  mockedIpc.planetMoveOp.mockResolvedValue(MOVE);
  mockedIpc.applyOp.mockResolvedValue(editResult());
});

/** The ref of the page on top of the inspector. */
const topPage = () => {
  const { stack } = useInspectorStore.getState();
  return stack[stack.length - 1].ref;
};

describe("body selection", () => {
  it("toggles bodies of one system in the order they were picked", () => {
    useSceneStore.getState().enterSystem(SOL);
    useSceneStore.getState().selectBody(SOL, EARTH);
    useSceneStore.getState().toggleBody(SOL, MARS);
    useSceneStore.getState().toggleBody(SOL, LUNA);
    expect(useSceneStore.getState().bodySelection).toEqual({
      system: SOL,
      ids: [EARTH, MARS, LUNA],
    });
    useSceneStore.getState().toggleBody(SOL, MARS);
    expect(useSceneStore.getState().bodySelection).toEqual({ system: SOL, ids: [EARTH, LUNA] });
  });

  it("opens the one body a toggle leaves, and goes back to the system when it leaves none", () => {
    useSceneStore.getState().enterSystem(SOL);
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: SOL }, label: "Sol" });
    expect(useSceneStore.getState().toggleBody(SOL, EARTH)).toBe(EARTH);
    expect(topPage()).toEqual({ kind: "body", system: SOL, id: EARTH });
    expect(useSceneStore.getState().toggleBody(SOL, MARS)).toBeNull();
    expect(useSceneStore.getState().bodySelection).toEqual({ system: SOL, ids: [EARTH, MARS] });
    expect(useSceneStore.getState().toggleBody(SOL, EARTH)).toBe(MARS);
    expect(topPage()).toEqual({ kind: "body", system: SOL, id: MARS });
    expect(useSceneStore.getState().bodySelection).toEqual({ system: SOL, ids: [MARS] });
    expect(useSceneStore.getState().toggleBody(SOL, MARS)).toBeNull();
    expect(useSceneStore.getState().bodySelection).toBeNull();
    expect(topPage()).toEqual({ kind: "system", id: SOL });
  });

  it("keeps a selection of one body on the page the inspector shows", () => {
    useSceneStore.getState().enterSystem(SOL);
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: SOL }, label: "Sol" });
    useInspectorStore.getState().openFromMap(bodyEntry(SOL, EARTH, "Earth"));
    expect(useSceneStore.getState().bodySelection).toEqual({ system: SOL, ids: [EARTH] });
    useInspectorStore.getState().open(bodyEntry(SOL, LUNA, "Luna"));
    expect(useSceneStore.getState().bodySelection).toEqual({ system: SOL, ids: [LUNA] });
    useInspectorStore.getState().back();
    expect(useSceneStore.getState().bodySelection).toEqual({ system: SOL, ids: [EARTH] });
    useInspectorStore.getState().popTo(0);
    expect(useSceneStore.getState().bodySelection).toBeNull();
  });

  it("leaves two or more bodies selected whatever page the inspector shows", () => {
    useSceneStore.getState().enterSystem(SOL);
    useSceneStore.getState().selectBody(SOL, EARTH);
    useSceneStore.getState().toggleBody(SOL, MARS);
    useInspectorStore.getState().openFromMap(bodyEntry(SOL, LUNA, "Luna"));
    useInspectorStore.getState().popTo(0);
    expect(useSceneStore.getState().bodySelection).toEqual({ system: SOL, ids: [EARTH, MARS] });
  });

  it("is cleared by entering another system and kept on entering its own", () => {
    useSceneStore.getState().enterSystem(SOL);
    useSceneStore.getState().selectBody(SOL, EARTH);
    useSceneStore.getState().toggleBody(SOL, MARS);
    useSceneStore.getState().exitScene();
    useSceneStore.getState().enterSystem(SOL);
    expect(useSceneStore.getState().bodySelection).toEqual({ system: SOL, ids: [EARTH, MARS] });
    useSceneStore.getState().enterSystem(CENTAURI);
    expect(useSceneStore.getState().bodySelection).toBeNull();
  });

  it("starts again with each toggle on a scenario, whose planets cannot move", async () => {
    await openFixtureScenario();
    useSceneStore.getState().enterSystem(SOL);
    useSceneStore.getState().selectBody(SOL, EARTH);
    useSceneStore.getState().toggleBody(SOL, MARS);
    expect(useSceneStore.getState().bodySelection).toEqual({ system: SOL, ids: [MARS] });
    expect(
      cutAvailability(useSceneStore.getState().bodySelection, moves().selectionTargets),
    ).toEqual({ kind: "none" });
    expect(mockedIpc.planetMoveTargets).not.toHaveBeenCalled();
  });
});

describe("cut and paste", () => {
  it("cuts the planets the core normalises, from the selection's system", async () => {
    mockedIpc.planetMoveTargets.mockResolvedValue(targets([EARTH]));
    useSceneStore.getState().selectBody(SOL, EARTH);
    useSceneStore.getState().toggleBody(SOL, LUNA);
    expect(
      cutAvailability(useSceneStore.getState().bodySelection, moves().selectionTargets),
    ).toEqual({ kind: "pending" });
    expect(moves().cutSelection()).toBe(false);
    await settle();
    expect(
      cutAvailability(useSceneStore.getState().bodySelection, moves().selectionTargets),
    ).toEqual({ kind: "ready", planets: [EARTH] });
    expect(moves().cutSelection()).toBe(true);
    expect(moves().cut).toMatchObject({ planets: [EARTH], from: SOL });
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("replaces a cut with the next one", async () => {
    await selectTwo();
    moves().cutSelection();
    useSceneStore.getState().selectBody(SOL, JUPITER);
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
    expect(
      cutAvailability(useSceneStore.getState().bodySelection, moves().selectionTargets),
    ).toEqual({
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
    expect(useSceneStore.getState().bodySelection).toEqual({
      system: CENTAURI,
      ids: [EARTH, MARS],
    });
    expect(useEditorStore.getState().selection).toEqual([CENTAURI]);
    expect(useSceneStore.getState().scene).toEqual({ kind: "galaxy" });
  });

  it("pastes a lone planet at the clicked orbit in the system view, and stays there", async () => {
    useSceneStore.getState().enterSystem(SOL);
    useSceneStore.getState().selectBody(SOL, EARTH);
    await settle();
    moves().cutSelection();
    useSceneStore.getState().enterSystem(CENTAURI);
    expect(moves().cut?.planets).toEqual([EARTH]);
    const at = { radius: 108, angle: 20 };
    expect(await moves().paste(CENTAURI, at)).toBe(true);
    expect(mockedIpc.planetMoveOp).toHaveBeenCalledWith([EARTH], CENTAURI, at);
    expect(useSceneStore.getState().scene).toEqual({ kind: "system", id: CENTAURI });
    expect(useSceneStore.getState().bodySelection).toEqual({ system: CENTAURI, ids: [EARTH] });
  });

  it("moves a planet from its page on the galaxy map, leaving the selection and the page on the planet", async () => {
    await useEditorStore.getState().select(SOL);
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: SOL }, label: "Sol" });
    useInspectorStore.getState().openPage(bodyEntry(SOL, EARTH, "Earth"));
    const [root] = useInspectorStore.getState().stack;
    mockedIpc.planetMoveOp.mockResolvedValue({
      type: "MoveBodyToSystem",
      body: EARTH,
      to: BARNARD,
    });
    expect(await moves().movePlanet(EARTH, BARNARD)).toBe(true);
    expect(mockedIpc.applyOp).toHaveBeenCalledOnce();
    expect(useEditorStore.getState().selection).toEqual([SOL]);
    expect(useInspectorStore.getState().stack).toEqual([root, bodyEntry(BARNARD, EARTH, "Earth")]);
    expect(useSceneStore.getState().bodySelection).toBeNull();
    expect(useSceneStore.getState().bodyFocus).toBeNull();
  });

  it("follows a planet moved from its page in the system view, centred on it with its page open", async () => {
    useSceneStore.getState().enterSystem(SOL);
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: SOL }, label: "Sol" });
    useInspectorStore.getState().openFromMap(bodyEntry(SOL, EARTH, "Earth"));
    mockedIpc.planetMoveOp.mockResolvedValue({
      type: "MoveBodyToSystem",
      body: EARTH,
      to: BARNARD,
    });
    expect(await moves().movePlanet(EARTH, BARNARD)).toBe(true);
    expect(useSceneStore.getState().scene).toEqual({ kind: "system", id: BARNARD });
    expect(useEditorStore.getState().selection).toEqual([BARNARD]);
    expect(useInspectorStore.getState().stack.map((entry) => entry.ref)).toEqual([
      { kind: "system", id: BARNARD },
      { kind: "body", system: BARNARD, id: EARTH },
    ]);
    expect(useSceneStore.getState().bodySelection).toEqual({ system: BARNARD, ids: [EARTH] });
    expect(useSceneStore.getState().bodyFocus?.id).toBe(EARTH);
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

describe("targets", () => {
  it("are pending again while an edit's fresh answer is on its way", async () => {
    useSceneStore.getState().enterSystem(SOL);
    await selectTwo();
    expect(
      cutAvailability(useSceneStore.getState().bodySelection, moves().selectionTargets).kind,
    ).toBe("ready");
    const refused = { planet: EARTH, reason: "Earth is occupied" };
    mockedIpc.planetMoveTargets.mockResolvedValue(
      targets([EARTH, MARS], { refused: [refused], systems: [] }),
    );
    moves().refresh();
    expect(
      cutAvailability(useSceneStore.getState().bodySelection, moves().selectionTargets),
    ).toEqual({ kind: "pending" });
    expect(moves().cutSelection()).toBe(false);
    await settle();
    expect(
      cutAvailability(useSceneStore.getState().bodySelection, moves().selectionTargets),
    ).toEqual({ kind: "refused", reason: "Earth is occupied" });
  });

  it("drop a late answer for a selection that has changed since", async () => {
    let answerFirst!: (t: PlanetMoveTargets) => void;
    mockedIpc.planetMoveTargets.mockImplementationOnce(
      () => new Promise<PlanetMoveTargets>((resolve) => (answerFirst = resolve)),
    );
    useSceneStore.getState().enterSystem(SOL);
    useSceneStore.getState().selectBody(SOL, EARTH);
    useSceneStore.getState().toggleBody(SOL, MARS);
    await settle();
    expect(moves().selectionTargets?.planets).toEqual([EARTH, MARS]);
    answerFirst(targets([EARTH], { refused: [{ planet: EARTH, reason: "stale" }] }));
    await settle();
    expect(moves().selectionTargets?.planets).toEqual([EARTH, MARS]);
    expect(
      cutAvailability(useSceneStore.getState().bodySelection, moves().selectionTargets).kind,
    ).toBe("ready");
  });
});

describe("after an edit", () => {
  it("reads the cut's targets again and forgets cached checks", async () => {
    await selectTwo();
    moves().cutSelection();
    mockedIpc.planetMoveCheck.mockResolvedValue({ refusal: "x", warnings: [] });
    await moves().checkPaste(SOL);
    mockedIpc.planetMoveTargets.mockClear();
    await useEditorStore.getState().applyOp({ type: "MoveSystem", system: 3, x: 1, y: 1 });
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
    await useEditorStore.getState().applyOp({ type: "MoveSystem", system: 3, x: 1, y: 1 });
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
    useSceneStore.getState().selectBody(SOL, EARTH);
    useInspectorStore.getState().openFromMap(bodyEntry(SOL, EARTH, "Earth"));

    esc();
    expect(moves().cut).toBeNull();
    expect(useSceneStore.getState().bodySelection).toEqual({ system: SOL, ids: [EARTH] });
    expect(useInspectorStore.getState().stack).toHaveLength(2);

    esc();
    expect(useSceneStore.getState().bodySelection).toBeNull();
    expect(useInspectorStore.getState().stack).toHaveLength(1);
    expect(useSceneStore.getState().scene).toEqual({ kind: "system", id: SOL });

    esc();
    expect(useSceneStore.getState().scene).toEqual({ kind: "galaxy" });
  });

  it("clears two or more bodies, with the inspector back on the system, before leaving", async () => {
    useLayoutStore.setState({ tab: "inspector", collapsed: false });
    useSceneStore.getState().enterSystem(SOL);
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: SOL }, label: "Sol" });
    await selectTwo();
    useInspectorStore.getState().openFromMap(bodyEntry(SOL, LUNA, "Luna"));

    esc();
    expect(useSceneStore.getState().bodySelection).toBeNull();
    expect(topPage()).toEqual({ kind: "system", id: SOL });
    expect(useSceneStore.getState().scene).toEqual({ kind: "system", id: SOL });

    esc();
    expect(useSceneStore.getState().scene).toEqual({ kind: "galaxy" });
  });

  it("with one body selected steps back as it always has once the cut is gone", async () => {
    useLayoutStore.setState({ tab: "inspector", collapsed: false });
    useSceneStore.getState().enterSystem(SOL);
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: SOL }, label: "Sol" });
    useInspectorStore.getState().openFromMap(bodyEntry(SOL, EARTH, "Earth"));
    useInspectorStore.getState().open(bodyEntry(SOL, LUNA, "Luna"));
    expect(useSceneStore.getState().bodySelection).toEqual({ system: SOL, ids: [LUNA] });

    esc();
    expect(topPage()).toEqual({ kind: "body", system: SOL, id: EARTH });
    expect(useSceneStore.getState().bodySelection).toEqual({ system: SOL, ids: [EARTH] });

    esc();
    expect(topPage()).toEqual({ kind: "system", id: SOL });
    expect(useSceneStore.getState().bodySelection).toBeNull();
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
    expect(useSceneStore.getState().bodySelection).toEqual({ system: SOL, ids: [EARTH, MARS] });
  });
});
