import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { NewBody } from "../generated/NewBody";
import type { Op } from "../generated/Op";
import type { PlanetMoveTargets } from "../generated/PlanetMoveTargets";
import type { PlanetMoveWarning } from "../generated/PlanetMoveWarning";
import { mockedIpc } from "../test/ipc";
import { run, type CommandEffects } from "./commands";
import { useDetailsStore } from "./detailsStore";
import { openFixtureSave, sessionError } from "./editorFixture";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { editResult, name, OPEN_RESULT, planetSummary, systemDetails } from "./fixture";
import { bodyEntry, useInspectorStore } from "./inspectorStore";
import {
  cutAvailability,
  noteScenePointer,
  pasteCheckOf,
  pastesInto,
  usePlanetMoveStore,
} from "./planetMoveStore";
import { useSceneStore } from "./sceneStore";
import { flush } from "../test/flush";

const SOL = 0;
const CENTAURI = 1;
const BARNARD = 2;
const EARTH = 10;
const MARS = 11;
const LUNA = 12;
const JUPITER = 13;

const COLONY: PlanetMoveWarning = { planet: MARS, kind: "colony", owner: 0, new_owner: 1 };

const moves = () => usePlanetMoveStore.getState();

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
  await flush();
}

beforeEach(async () => {
  await openFixtureSave();
  mockedIpc.planetMoveTargets.mockImplementation(async (planets) => targets(planets));
  mockedIpc.planetMoveOp.mockResolvedValue(MOVE);
  mockedIpc.applyOp.mockResolvedValue(editResult());
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
    await flush();
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
    await flush();
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
    await flush();
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
    await flush();
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
    await flush();
    expect(moves().selectionTargets?.planets).toEqual([EARTH, MARS]);
    answerFirst(targets([EARTH], { refused: [{ planet: EARTH, reason: "stale" }] }));
    await flush();
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
    await flush();
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
    await flush();
    expect(moves().cut).toBeNull();
  });
});

/** A body as the core builds a copy of one: `planetClass` of size 16, nothing on it. */
function spec(planetClass: string): NewBody {
  return {
    class: planetClass,
    size: 16,
    moon_of: null,
    name: null,
    deposits: [],
    ring: false,
    entity: null,
    entity_name: null,
    modifiers: [],
    moons: [],
  };
}

const CONTINENTAL = spec("pc_continental");
const ARID = spec("pc_arid");
const PASTE: Op = { type: "Batch", description: "Pasted 2 planets into Alpha Centauri", ops: [] };
const effects: CommandEffects = { focusSearch: vi.fn(), browseInitializers: vi.fn() };

describe("copy and paste", () => {
  beforeEach(() => {
    mockedIpc.copyBodies.mockResolvedValue([CONTINENTAL, ARID]);
    mockedIpc.pasteBodiesOp.mockResolvedValue(PASTE);
  });

  it("copies the selection as the core builds it, named as the system lists it", async () => {
    const planets = [
      planetSummary({ id: EARTH, name: name("Earth"), name_key: "Earth" }),
      planetSummary({ id: MARS, name: name("Mars"), name_key: "Mars" }),
      planetSummary({ id: LUNA, name: name("Luna"), name_key: "Luna", moon: true, parent: EARTH }),
    ];
    useDetailsStore.setState({ details: new Map([[SOL, systemDetails({ id: SOL, planets })]]) });
    await selectTwo();
    useSceneStore.getState().toggleBody(SOL, LUNA);
    expect(await moves().copySelection()).toBe(true);
    expect(mockedIpc.copyBodies).toHaveBeenCalledWith([EARTH, MARS, LUNA]);
    expect(moves().copy).toEqual({
      copies: [CONTINENTAL, ARID],
      planets: [
        { name: "Earth", moon: false },
        { name: "Mars", moon: false },
      ],
      from: SOL,
    });
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("pastes the copies into any system as new bodies, its own included, and keeps them to paste again", async () => {
    await selectTwo();
    await moves().copySelection();
    expect(pastesInto(moves(), SOL)).toBe(true);
    expect(await moves().paste(CENTAURI)).toBe(true);
    expect(mockedIpc.pasteBodiesOp).toHaveBeenCalledWith(CENTAURI, [CONTINENTAL, ARID], null);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith(PASTE);
    expect(mockedIpc.planetMoveOp).not.toHaveBeenCalled();
    expect(useEditorStore.getState().selection).toEqual([CENTAURI]);
    expect(useSceneStore.getState().scene).toEqual({ kind: "galaxy" });

    expect(await moves().paste(SOL)).toBe(true);
    expect(mockedIpc.pasteBodiesOp).toHaveBeenLastCalledWith(SOL, [CONTINENTAL, ARID], null);
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(2);
    expect(moves().copy?.copies).toEqual([CONTINENTAL, ARID]);
  });

  it("pastes a lone copy at the clicked orbit in the system view, and stays there", async () => {
    mockedIpc.copyBodies.mockResolvedValue([CONTINENTAL]);
    useSceneStore.getState().enterSystem(SOL);
    useSceneStore.getState().selectBody(SOL, EARTH);
    await moves().copySelection();
    const at = { radius: 108, angle: 20 };
    expect(await moves().paste(SOL, at)).toBe(true);
    expect(mockedIpc.pasteBodiesOp).toHaveBeenCalledWith(SOL, [CONTINENTAL], at);
    expect(useSceneStore.getState().scene).toEqual({ kind: "system", id: SOL });
  });

  it("sends a group the point where the paste was asked, so it lines up at that angle", async () => {
    await selectTwo();
    await moves().copySelection();
    const at = { radius: 108, angle: 20 };
    await moves().paste(CENTAURI, at);
    expect(mockedIpc.pasteBodiesOp).toHaveBeenCalledWith(CENTAURI, [CONTINENTAL, ARID], at);
  });

  it("replaces a cut with a copy, and a copy with a cut", async () => {
    await selectTwo();
    moves().cutSelection();
    await moves().copySelection();
    expect(moves().cut).toBeNull();
    expect(moves().copy?.copies).toEqual([CONTINENTAL, ARID]);

    moves().cutSelection();
    expect(moves().copy).toBeNull();
    expect(moves().cut?.planets).toEqual([EARTH, MARS]);
  });

  it("drops a copy that lands after a newer cut", async () => {
    let answer!: (copies: NewBody[]) => void;
    mockedIpc.copyBodies.mockImplementationOnce(
      () => new Promise<NewBody[]>((resolve) => (answer = resolve)),
    );
    await selectTwo();
    const copying = moves().copySelection();
    moves().cutSelection();
    answer([CONTINENTAL]);
    expect(await copying).toBe(false);
    expect(moves().copy).toBeNull();
    expect(moves().cut?.planets).toEqual([EARTH, MARS]);
  });

  it("drops a copy that lands after Esc or after another file opens", async () => {
    const late = () => {
      let answer!: (copies: NewBody[]) => void;
      mockedIpc.copyBodies.mockImplementationOnce(
        () => new Promise<NewBody[]>((resolve) => (answer = resolve)),
      );
      return (copies: NewBody[]) => answer(copies);
    };
    await selectTwo();
    let answer = late();
    let copying = moves().copySelection();
    run("clearSelection", false, effects);
    answer([CONTINENTAL]);
    expect(await copying).toBe(false);
    expect(moves().copy).toBeNull();

    await selectTwo();
    answer = late();
    copying = moves().copySelection();
    await useFileSessionStore.getState().openSave(OPEN_RESULT.path);
    answer([CONTINENTAL]);
    expect(await copying).toBe(false);
    expect(moves().copy).toBeNull();
  });

  it("clears a copy on Esc, where a cut would be cancelled", async () => {
    await selectTwo();
    await moves().copySelection();
    useSceneStore.getState().enterSystem(SOL);
    run("clearSelection", false, effects);
    expect(moves().copy).toBeNull();
    expect(useSceneStore.getState().scene).toEqual({ kind: "system", id: SOL });
  });

  it("keeps a copy when another file opens, and drops a cut", async () => {
    await selectTwo();
    await moves().copySelection();
    await useFileSessionStore.getState().openSave(OPEN_RESULT.path);
    expect(moves().copy?.copies).toEqual([CONTINENTAL, ARID]);

    await selectTwo();
    moves().cutSelection();
    await useFileSessionStore.getState().openSave(OPEN_RESULT.path);
    expect(moves().cut).toBeNull();
  });

  it("shows the core's refusal of a copy, and keeps the cut", async () => {
    await selectTwo();
    moves().cutSelection();
    const refusal = "Sol is a star: only planets and moons can be copied";
    mockedIpc.copyBodies.mockRejectedValue({ kind: "refused", message: refusal });
    expect(await moves().copySelection()).toBe(false);
    expect(sessionError()).toBe(refusal);
    expect(moves().cut?.planets).toEqual([EARTH, MARS]);
    expect(moves().copy).toBeNull();
  });

  it("shows a refused paste, and keeps the copy", async () => {
    await selectTwo();
    await moves().copySelection();
    mockedIpc.pasteBodiesOp.mockRejectedValue({ kind: "refused", message: "Saves before 4.0" });
    expect(await moves().paste(CENTAURI)).toBe(false);
    expect(sessionError()).toBe("Saves before 4.0");
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(moves().copy).not.toBeNull();
  });
});

describe("Ctrl+X, Ctrl+C and Ctrl+V", () => {
  beforeEach(() => {
    mockedIpc.copyBodies.mockResolvedValue([CONTINENTAL]);
    mockedIpc.pasteBodiesOp.mockResolvedValue(PASTE);
  });

  it("copy the planets selected in the system view, and paste them there or into the one selected system", async () => {
    useSceneStore.getState().selectBody(SOL, EARTH);
    expect(run("copyPlanets", false, effects)).toBe(false);

    useSceneStore.getState().enterSystem(SOL);
    useSceneStore.getState().selectBody(SOL, EARTH);
    expect(run("copyPlanets", false, effects)).toBe(true);
    await flush();
    expect(mockedIpc.copyBodies).toHaveBeenCalledWith([EARTH]);

    expect(run("pastePlanets", false, effects)).toBe(true);
    await flush();
    expect(mockedIpc.pasteBodiesOp).toHaveBeenLastCalledWith(SOL, [CONTINENTAL], null);

    useSceneStore.getState().exitScene();
    await useEditorStore.getState().select(BARNARD);
    expect(run("pastePlanets", false, effects)).toBe(true);
    await flush();
    expect(mockedIpc.pasteBodiesOp).toHaveBeenLastCalledWith(BARNARD, [CONTINENTAL], null);

    await useEditorStore.getState().clearSelection();
    expect(run("pastePlanets", false, effects)).toBe(false);
  });

  it("paste a lone cut planet at the pointer, and several into the next free orbits", async () => {
    await selectTwo();
    moves().cutSelection();
    useSceneStore.getState().enterSystem(CENTAURI);
    noteScenePointer({ system: CENTAURI, x: 0, y: 108 });
    expect(run("pastePlanets", false, effects)).toBe(true);
    await flush();
    expect(mockedIpc.planetMoveOp).toHaveBeenLastCalledWith([EARTH, MARS], CENTAURI, null);

    useSceneStore.getState().enterSystem(SOL);
    useSceneStore.getState().selectBody(SOL, JUPITER);
    await flush();
    moves().cutSelection();
    useSceneStore.getState().enterSystem(CENTAURI);
    expect(run("pastePlanets", false, effects)).toBe(true);
    await flush();
    expect(mockedIpc.planetMoveOp).toHaveBeenLastCalledWith([JUPITER], CENTAURI, {
      radius: 108,
      angle: 90,
    });
    noteScenePointer(null);
  });

  it("paste a copied group at the pointer, lined up at its angle", async () => {
    mockedIpc.copyBodies.mockResolvedValue([CONTINENTAL, ARID]);
    await selectTwo();
    await moves().copySelection();
    useSceneStore.getState().enterSystem(CENTAURI);
    noteScenePointer({ system: CENTAURI, x: 0, y: 108 });
    expect(run("pastePlanets", false, effects)).toBe(true);
    await flush();
    expect(mockedIpc.pasteBodiesOp).toHaveBeenLastCalledWith(CENTAURI, [CONTINENTAL, ARID], {
      radius: 108,
      angle: 90,
    });
    noteScenePointer(null);
  });

  it("cut the planets selected in the system view, and leave a paste into their own system alone", async () => {
    useSceneStore.getState().enterSystem(SOL);
    useSceneStore.getState().selectBody(SOL, EARTH);
    await flush();
    expect(run("cutPlanets", false, effects)).toBe(true);
    expect(moves().cut?.planets).toEqual([EARTH]);
    expect(run("pastePlanets", false, effects)).toBe(false);
    expect(mockedIpc.planetMoveOp).not.toHaveBeenCalled();
  });
});
