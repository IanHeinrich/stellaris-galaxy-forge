import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";

vi.mock("../api/ipc");
vi.mock("../api/events");

import {
  bodyEntry,
  entityAddr,
  openPlanet,
  refKey,
  renumberedRef,
  tabsFor,
  useInspectorStore,
  wormholeEntry,
  type Entry,
} from "./inspectorStore";
import { editor, openFixtureSave, openFixtureScenario, withAddedSystems } from "./editorFixture";
import { editResult } from "./fixture";
import { listeners, loadGameData, SUMMARY } from "./gameDataFixture";
import type { PlanetPage } from "../generated/PlanetPage";
import { planetPage } from "../test/builders";
import { useEntityStore } from "./entityStore";
import { mockedIpc } from "../test/ipc";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { useLayoutStore } from "./layoutStore";
import { until } from "../test/wait";

const inspector = () => useInspectorStore.getState();

const SOL: Entry = { ref: { kind: "system", id: 452 }, label: "Sol" };
const ALPHA: Entry = { ref: { kind: "system", id: 1 }, label: "Alpha Centauri" };
const EARTH: Entry = { ref: { kind: "body", system: 452, id: 1207 }, label: "Earth" };
const LUNA: Entry = { ref: { kind: "body", system: 452, id: 1208 }, label: "Luna" };
const COLONY: Entry = { ref: { kind: "colony", id: 1207 }, label: "Earth colony" };
const TARKIN: Entry = { ref: { kind: "body", system: 1, id: 100 }, label: "Tarkin" };
const YAVIN: Entry = { ref: { kind: "body", system: 1, id: 101 }, label: "Yavin" };
const stored = new Map<string, string>();

beforeEach(() => {
  stubPrefs(stored);
  useInspectorStore.setState(useInspectorStore.getInitialState());
  useLayoutStore.setState({ tab: "inspector", collapsed: false });
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const labels = () => inspector().stack.map((e) => e.label);
const refs = () => inspector().stack.map((e) => e.ref);

describe("a wormhole opened from the system view", () => {
  it("stands above the system's page on Overview, Data and Source, and Esc takes it off", () => {
    useLayoutStore.setState({ tab: "inspector", collapsed: false });
    inspector().setRoot(SOL);
    inspector().openFromMap(EARTH);
    const hole = wormholeEntry(452, 30, "Sol Wormhole");

    inspector().openFromMap(hole);
    expect(labels()).toEqual(["Sol", "Sol Wormhole"]);

    expect(inspector().escape()).toBe(true);
    expect(labels()).toEqual(["Sol"]);
  });
});

describe("a body opened from the system view", () => {
  it("stands straight above the system's page, however many bodies are clicked", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    inspector().open(COLONY);

    inspector().openFromMap(LUNA);
    expect(labels()).toEqual(["Sol", "Luna"]);
    inspector().openFromMap(EARTH);
    inspector().openFromMap(EARTH);
    expect(labels()).toEqual(["Sol", "Earth"]);
    expect(inspector().stack[1].from).toBeUndefined();
  });

  it("turns the dock to the inspector as a selection does, and Back stays there", () => {
    useLayoutStore.setState({ tab: "issues", previousTab: "issues", fromDock: false });
    inspector().setRoot(SOL);

    inspector().openFromMap(EARTH);

    expect(useLayoutStore.getState().tab).toBe("inspector");
    expect(inspector().backTo()).toBe("inspector");
    inspector().back();
    expect(labels()).toEqual(["Sol"]);
    expect(useLayoutStore.getState().tab).toBe("inspector");
  });

  it("opens a save's planet, and a scenario's body keyed by its system", async () => {
    await openFixtureSave();
    expect(bodyEntry(452, 1207, "Earth")).toEqual(EARTH);
    await openFixtureScenario();
    expect(bodyEntry(1, 100, "Tarkin")).toEqual(TARKIN);
  });

  it("keeps a scenario body's page through an edit to another system, and closes it on one that stales its own", async () => {
    await openFixtureScenario();
    inspector().setRoot(ALPHA);
    inspector().openFromMap(bodyEntry(1, 100, "Tarkin"));

    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [2] }));
    await editor().applyOp({ type: "SetInitializer", system: 2, initializer: "basic_init_01" });
    expect(refs()).toEqual([ALPHA.ref, TARKIN.ref]);

    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [1] }));
    await editor().applyOp({ type: "SetInitializer", system: 1, initializer: "basic_init_01" });
    expect(refs()).toEqual([ALPHA.ref]);
  });

  it("keeps a scenario body's page on its system's new id through a renumber, and a SetInitializer there closes it", async () => {
    await openFixtureScenario();
    const [, seven] = withAddedSystems();
    inspector().setRoot({ ref: { kind: "system", id: 7 }, label: "Added" });
    inspector().openFromMap(bodyEntry(7, 100, "Tarkin"));

    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({
        delta: {
          systems: [{ ...seven, id: 6 }],
          removed: [7],
          renumbered: [
            [6, null],
            [7, 6],
          ],
        },
        details_stale: [6, 7],
      }),
    );
    await editor().applyOp({ type: "RemoveSystem", system: 6 });
    expect(refs()).toEqual([
      { kind: "system", id: 6 },
      { kind: "body", system: 6, id: 100 },
    ]);

    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [6] }));
    await editor().applyOp({ type: "SetInitializer", system: 6, initializer: "basic_init_01" });
    expect(refs()).toEqual([{ kind: "system", id: 6 }]);
  });

  it("closes a scenario body's page when the game data reloads, and keeps a save's planet page", async () => {
    await openFixtureScenario();
    inspector().setRoot(ALPHA);
    inspector().openFromMap(bodyEntry(1, 100, "Tarkin"));
    await loadGameData();
    expect(refs()).toEqual([ALPHA.ref]);

    await openFixtureSave();
    inspector().setRoot(SOL);
    inspector().openFromMap(bodyEntry(452, 1207, "Earth"));
    await loadGameData();
    expect(refs()).toEqual([SOL.ref, EARTH.ref]);
  });

  it("closes a scenario body's page when a rebuilt registry finds the game data gone", async () => {
    await openFixtureScenario();
    await loadGameData();
    await until(() => expect(listeners.changed).not.toBeNull());
    inspector().setRoot(ALPHA);
    inspector().openFromMap(bodyEntry(1, 100, "Tarkin"));

    mockedIpc.gameDataSummary.mockResolvedValue(null);
    listeners.changed!({
      registries: ["localisation"],
      version: SUMMARY.generation + 1,
      watch: { watching: 1, paused: false, reason: null },
      hot_file: null,
      hot_count: 0,
    });

    await until(() => expect(refs()).toEqual([ALPHA.ref]));
  });
});

describe("a save body's page", () => {
  it("opens from a link that knows only the planet's id, on the system its page names", async () => {
    await openFixtureSave();
    inspector().setRoot(SOL);
    mockedIpc.getPlanetPage.mockResolvedValueOnce(planetPage({ id: 1207, system: 452 }));

    openPlanet(1207, "Earth");

    await until(() => expect(refs()).toEqual([SOL.ref, EARTH.ref]));
  });

  it("opens the last of two such links, whichever page is read first", async () => {
    await openFixtureSave();
    inspector().setRoot(SOL);
    let earthRead: (page: PlanetPage) => void = () => undefined;
    let lunaRead: (page: PlanetPage) => void = () => undefined;
    mockedIpc.getPlanetPage
      .mockReturnValueOnce(new Promise((resolve) => (earthRead = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (lunaRead = resolve)));

    openPlanet(1207, "Earth");
    openPlanet(1208, "Luna");
    earthRead(planetPage({ id: 1207, system: 452 }));
    await until(() => expect(useEntityStore.getState().pages.has(1207)).toBe(true));
    expect(refs()).toEqual([SOL.ref]);

    lunaRead(planetPage({ id: 1208, system: 452 }));
    await until(() => expect(refs()).toEqual([SOL.ref, LUNA.ref]));
  });
});

describe("a scenario body's page", () => {
  it("is keyed by its system and id, reads no entity and offers the Overview alone", async () => {
    await openFixtureScenario();
    expect(refKey(TARKIN.ref)).toBe("body:1:100");
    expect(entityAddr(TARKIN.ref)).toBeNull();
    expect(tabsFor(TARKIN.ref)).toEqual(["overview"]);
  });

  it("follows its system through a renumber, and goes with it", () => {
    expect(renumberedRef(TARKIN.ref, [[2, 1]])).toBe(TARKIN.ref);
    expect(
      renumberedRef(TARKIN.ref, [
        [1, 0],
        [0, null],
      ]),
    ).toEqual({ kind: "body", system: 0, id: 100 });
    expect(renumberedRef(TARKIN.ref, [[1, null]])).toBeNull();
  });

  it("closes with everything opened from it when its system's bodies are dropped", async () => {
    await openFixtureScenario();
    const alphard: Entry = { ref: { kind: "system", id: 1 }, label: "Alpha Centauri" };
    inspector().setRoot(alphard);
    inspector().setTab("lanes");
    inspector().openFromMap(TARKIN);
    expect(inspector().tab).toBe("overview");
    inspector().open(YAVIN);

    inspector().dropBodies([2]);
    expect(labels()).toEqual(["Alpha Centauri", "Tarkin", "Yavin"]);

    inspector().dropBodies([1]);
    expect(labels()).toEqual(["Alpha Centauri"]);

    inspector().openFromMap(TARKIN);
    inspector().dropBodies();
    expect(labels()).toEqual(["Alpha Centauri"]);
  });
});
