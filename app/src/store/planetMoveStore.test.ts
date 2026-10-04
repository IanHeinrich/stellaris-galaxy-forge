import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { Op } from "../generated/Op";
import type { PlanetMoveTargets } from "../generated/PlanetMoveTargets";
import type { PlanetMoveWarning } from "../generated/PlanetMoveWarning";
import { planetPage } from "../test/builders";
import { mockedIpc } from "../test/ipc";
import { run, type CommandEffects } from "./commands";
import { openFixtureSave, openFixtureScenario } from "./editorFixture";
import { useEditorStore } from "./editorStore";
import { useEntityStore } from "./entityStore";
import { editResult } from "./fixture";
import { bodyEntry, useInspectorStore } from "./inspectorStore";
import { useLayoutStore } from "./layoutStore";
import { cutAvailability, usePlanetMoveStore } from "./planetMoveStore";
import { useSceneStore } from "./sceneStore";
import { until } from "../test/wait";
import { flush } from "../test/flush";

const SOL = 0;
const CENTAURI = 1;
const BARNARD = 2;
const EARTH = 10;
const MARS = 11;
const LUNA = 12;
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

describe("a moved planet's page", () => {
  const MOVED = editResult({ touched_entities: [{ kind: "planet", id: EARTH }] });

  /** Earth's page as its read says, standing in `system`. */
  async function readEarth(system: number): Promise<void> {
    mockedIpc.getPlanetPage.mockResolvedValueOnce(planetPage({ id: EARTH, system }));
    useEntityStore.getState().requestPlanetPage(EARTH);
    await until(() => expect(useEntityStore.getState().pages.get(EARTH)?.system).toBe(system));
  }

  /** Earth's page open above Sol's, and Earth moved to Barnard's Star from it. */
  async function moveEarth(): Promise<void> {
    await useEditorStore.getState().select(SOL);
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: SOL }, label: "Sol" });
    useInspectorStore.getState().openPage(bodyEntry(SOL, EARTH, "Earth"));
    await readEarth(SOL);
    mockedIpc.planetMoveOp.mockResolvedValue({
      type: "MoveBodyToSystem",
      body: EARTH,
      to: BARNARD,
    });
    mockedIpc.applyOp.mockResolvedValueOnce(MOVED);
    mockedIpc.getPlanetPage.mockResolvedValueOnce(planetPage({ id: EARTH, system: BARNARD }));
    await moves().movePlanet(EARTH, BARNARD);
    await until(() => expect(useEntityStore.getState().stalePages.has(EARTH)).toBe(false));
    expect(topPage()).toEqual({ kind: "body", system: BARNARD, id: EARTH });
  }

  it("follows the planet back on undo and out again on redo, as its page reads it", async () => {
    await moveEarth();

    mockedIpc.getPlanetPage.mockResolvedValueOnce(planetPage({ id: EARTH, system: SOL }));
    mockedIpc.undo.mockResolvedValueOnce(MOVED);
    await useEditorStore.getState().undo();
    await until(() => expect(topPage()).toEqual({ kind: "body", system: SOL, id: EARTH }));

    mockedIpc.getPlanetPage.mockResolvedValueOnce(planetPage({ id: EARTH, system: BARNARD }));
    mockedIpc.redo.mockResolvedValueOnce(MOVED);
    await useEditorStore.getState().redo();
    await until(() => expect(topPage()).toEqual({ kind: "body", system: BARNARD, id: EARTH }));
  });

  it("closes with the system it is back in once that system goes", async () => {
    await moveEarth();
    mockedIpc.getPlanetPage.mockResolvedValueOnce(planetPage({ id: EARTH, system: SOL }));
    mockedIpc.undo.mockResolvedValueOnce(MOVED);
    await useEditorStore.getState().undo();
    await until(() => expect(topPage()).toEqual({ kind: "body", system: SOL, id: EARTH }));

    useInspectorStore.getState().renumber([[SOL, null]]);
    expect(useInspectorStore.getState().stack.map((e) => e.ref.kind)).toEqual(["galaxy"]);
  });
});

describe("a planet page's System field", () => {
  it("keeps the warnings a move met through the view following it, until the next edit", async () => {
    useSceneStore.getState().enterSystem(SOL);
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: SOL }, label: "Sol" });
    useInspectorStore.getState().openFromMap(bodyEntry(SOL, EARTH, "Earth"));
    mockedIpc.planetMoveOp.mockResolvedValue({
      type: "MoveBodyToSystem",
      body: EARTH,
      to: BARNARD,
    });

    expect(await moves().movePlanet(EARTH, BARNARD, [COLONY])).toBe(true);
    expect(useSceneStore.getState().scene).toEqual({ kind: "system", id: BARNARD });
    expect(moves().lastMove).toEqual({ planet: EARTH, warnings: [COLONY] });

    mockedIpc.applyOp.mockResolvedValueOnce(editResult());
    await useEditorStore.getState().applyOp({ type: "MoveSystem", system: SOL, x: 1, y: 1 });
    expect(moves().lastMove).toBeNull();
  });

  it("forgets the warnings on undo", async () => {
    await moves().movePlanet(EARTH, BARNARD, [COLONY]);
    expect(moves().lastMove).toEqual({ planet: EARTH, warnings: [COLONY] });

    mockedIpc.undo.mockResolvedValueOnce(editResult());
    await useEditorStore.getState().undo();
    expect(moves().lastMove).toBeNull();
  });

  it("reads where the planet may move, and again after an edit", async () => {
    moves().followPlanet(EARTH);
    await flush();
    expect(moves().planetTargets).toEqual({ planet: EARTH, read: { targets: targets([EARTH]) } });
    expect(mockedIpc.planetMoveTargets).toHaveBeenLastCalledWith([EARTH]);
    mockedIpc.planetMoveTargets.mockClear();

    mockedIpc.applyOp.mockResolvedValueOnce(editResult());
    await useEditorStore.getState().applyOp({ type: "MoveSystem", system: SOL, x: 1, y: 1 });
    await flush();
    expect(mockedIpc.planetMoveTargets).toHaveBeenCalledWith([EARTH]);

    moves().followPlanet(null);
    expect(moves().planetTargets).toBeNull();
  });
});
