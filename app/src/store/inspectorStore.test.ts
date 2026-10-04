import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";

vi.mock("../api/ipc");
vi.mock("../api/events");

import {
  bodyEntry,
  entityAddr,
  openPlanet,
  refFor,
  refKey,
  renumberedRef,
  tabsFor,
  useInspectorStore,
  wormholeEntry,
  type Entry,
} from "./inspectorStore";
import { openSystem } from "./commands";
import { editor, openFixtureSave, openFixtureScenario, withAddedSystems } from "./editorFixture";
import { editResult } from "./fixture";
import { listeners, loadGameData, SUMMARY } from "./gameDataFixture";
import type { PlanetPage } from "../generated/PlanetPage";
import { planetPage } from "../test/builders";
import { useEntityStore } from "./entityStore";
import { mockedIpc } from "../test/ipc";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { useLayoutStore } from "./layoutStore";

const inspector = () => useInspectorStore.getState();

const SOL: Entry = { ref: { kind: "system", id: 452 }, label: "Sol" };
const ALPHARD: Entry = { ref: { kind: "system", id: 12 }, label: "Alphard" };
const ALPHA: Entry = { ref: { kind: "system", id: 1 }, label: "Alpha Centauri" };
const EARTH: Entry = { ref: { kind: "body", system: 452, id: 1207 }, label: "Earth" };
const LUNA: Entry = { ref: { kind: "body", system: 452, id: 1208 }, label: "Luna" };
const COLONY: Entry = { ref: { kind: "colony", id: 1207 }, label: "Earth colony" };
const TARKIN: Entry = { ref: { kind: "body", system: 1, id: 100 }, label: "Tarkin" };
const YAVIN: Entry = { ref: { kind: "body", system: 1, id: 101 }, label: "Yavin" };
const SHIPS: Entry = {
  ref: { kind: "nodelist", parent: { kind: "fleet", id: 88 }, path: ["ships"], of: "ship" },
  label: "Ships",
};

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

describe("the entity stack", () => {
  it("restarts on a new selection and leaves a drill-down alone when the same one arrives again", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    expect(labels()).toEqual(["Sol", "Earth"]);

    inspector().setRoot({ ...SOL });
    expect(labels()).toEqual(["Sol", "Earth"]);

    inspector().setRoot(ALPHARD);
    expect(labels()).toEqual(["Alphard"]);
  });

  it("pushes a child of a child onto the same stack rather than nesting, and goes back", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    inspector().open(LUNA);
    expect(labels()).toEqual(["Sol", "Earth", "Luna"]);

    inspector().back();
    expect(labels()).toEqual(["Sol", "Earth"]);
    inspector().popTo(0);
    expect(labels()).toEqual(["Sol"]);
    inspector().back();
    expect(labels()).toEqual(["Sol"]);
  });

  it("ignores opening what is already on top", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    inspector().open({ ...EARTH, label: "Earth" });
    expect(labels()).toEqual(["Sol", "Earth"]);
  });

  it("follows a renamed root without losing the stack", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    inspector().setRoot({ ...SOL, label: "Sol renamed" });
    expect(labels()).toEqual(["Sol renamed", "Earth"]);
  });
});

describe("the Galaxy crumb", () => {
  it("brings a page opened over the galaxy back to the galaxy", () => {
    const empire: Entry = { ref: { kind: "country", id: 7 }, label: "Hissma Consciousness" };
    inspector().openPage(empire);
    expect(inspector().stack.map((e) => e.label)).toEqual(["Galaxy", "Hissma Consciousness"]);
    expect(inspector().home()).toBe(true);
    expect(inspector().stack.map((e) => e.label)).toEqual(["Galaxy"]);
  });

  it("leaves a selected system's stack to the selection to clear", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    expect(inspector().home()).toBe(false);
    expect(inspector().stack).toEqual([SOL, EARTH]);
  });
});

describe("back", () => {
  const empire: Entry = { ref: { kind: "country", id: 7 }, label: "Hissma Consciousness" };

  it("returns a page opened from another tab of the dock to that tab", () => {
    useLayoutStore.setState({ tab: "empires", previousTab: "empires" });
    inspector().openPage(empire);
    expect(useLayoutStore.getState().tab).toBe("inspector");

    inspector().back();

    expect(useLayoutStore.getState().tab).toBe("empires");
    expect(labels()).toEqual(["Galaxy"]);
  });

  it("stays in the inspector for a page opened from inside it", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);

    inspector().back();

    expect(useLayoutStore.getState().tab).toBe("inspector");
    expect(labels()).toEqual(["Sol"]);
  });

  it("names where it goes", () => {
    useLayoutStore.setState({ tab: "empires", previousTab: "empires" });
    inspector().openPage(empire);
    expect(inspector().backTo()).toBe("empires");
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    expect(inspector().backTo()).toBe("inspector");
  });
});

describe("drilling across kinds", () => {
  it("walks a system to a planet to its colony without nesting, and Alt+Left comes back", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    inspector().open(COLONY);
    expect(labels()).toEqual(["Sol", "Earth", "Earth colony"]);
    expect(inspector().stack.map((e) => e.ref.kind)).toEqual(["system", "body", "colony"]);

    inspector().back();
    expect(labels()).toEqual(["Sol", "Earth"]);
  });

  it("keys a node list by the entity it belongs to and the path inside it", () => {
    expect(refKey(SHIPS.ref)).toBe("nodelist:fleet:88/ships");
    expect(entityAddr(SHIPS.ref)).toEqual({ kind: "fleet", id: 88 });
    expect(entityAddr({ kind: "galaxy" })).toBeNull();
    expect(tabsFor(SHIPS.ref)).toEqual(["data"]);
  });

  it("keys a station by its own id, and opens one only where its system is known", () => {
    const ref = refFor({ kind: "starbase", id: 77 }, 452);
    expect(ref).toEqual({ kind: "starbase", system: 452, id: 77 });
    expect(refKey(ref!)).toBe("starbase:77");
    expect(refFor({ kind: "starbase", id: 77 }, null)).toBeNull();
    expect(refFor({ kind: "country", id: 12 }, null)).toEqual({ kind: "country", id: 12 });
  });

  it("pops one crumb on Esc and gives the key up once the stack is a single entity", () => {
    useLayoutStore.setState({ tab: "inspector", collapsed: false });
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    expect(inspector().escape()).toBe(true);
    expect(labels()).toEqual(["Sol"]);

    expect(inspector().escape()).toBe(false);
    expect(labels()).toEqual(["Sol"]);
  });

  it("leaves Esc alone while the dock shows something else, so it clears the selection", () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);

    useLayoutStore.setState({ tab: "changes", collapsed: false });
    expect(inspector().escape()).toBe(false);
    useLayoutStore.setState({ tab: "inspector", collapsed: true });
    expect(inspector().escape()).toBe(false);
    expect(labels()).toEqual(["Sol", "Earth"]);

    useLayoutStore.setState({ collapsed: false });
    expect(inspector().escape()).toBe(true);
  });
});

describe("tabs", () => {
  it("keeps a tab the next entity offers and falls back to its first otherwise", () => {
    inspector().setRoot(SOL);
    inspector().setTab("lanes");
    inspector().setRoot(ALPHARD);
    expect(inspector().tab).toBe("lanes");

    inspector().open(EARTH);
    expect(inspector().tab).toBe("overview");
    expect(tabsFor(EARTH.ref)).not.toContain("lanes");

    inspector().setTab("data");
    inspector().back();
    expect(inspector().tab).toBe("data");

    expect(tabsFor({ kind: "galaxy" })).toEqual(["overview"]);
    expect(tabsFor({ kind: "selection" })).toEqual(["overview"]);
    expect(tabsFor({ kind: "lane", a: 1, b: 2 })).toEqual(["overview"]);
  });

  it("gives a scenario system its scripts in place of the Data table a save's system has", () => {
    expect(tabsFor(SOL.ref, true, { scripts: true, data: false })).toEqual([
      "overview",
      "scripts",
      "contents",
      "lanes",
      "source",
    ]);
    expect(tabsFor(SOL.ref, true, { scripts: false, data: true })).toEqual([
      "overview",
      "contents",
      "lanes",
      "data",
      "source",
    ]);
  });

  it("does not hand a tab back once the open document's own flags stop offering it", () => {
    useFileSessionStore.setState({ kind: "scenario" });
    useGameDataStore.setState({ status: "ready" });
    inspector().setRoot(SOL);
    inspector().setTab("scripts");
    expect(inspector().tab).toBe("scripts");

    useGameDataStore.setState({ status: "idle" });
    inspector().setRoot(ALPHARD);
    expect(inspector().tab).toBe("overview");
  });

  it("drops Contents from a kind whose entity turns out to list nothing", () => {
    expect(tabsFor(COLONY.ref)).toEqual(["overview", "contents", "data", "source"]);
    expect(tabsFor(COLONY.ref, false)).toEqual(["overview", "data", "source"]);
    expect(tabsFor(SOL.ref, false)).toContain("contents");
  });
});

describe("sections", () => {
  it("toggles from each section's own default and remembers what the user chose", () => {
    expect(inspector().collapsed("system.planets", false)).toBe(false);
    expect(inspector().collapsed("system.flags", true)).toBe(true);

    inspector().toggleSection("system.flags", true);
    expect(inspector().collapsed("system.flags", true)).toBe(false);
    inspector().toggleSection("system.planets", false);
    expect(inspector().collapsed("system.planets", false)).toBe(true);
    expect(stored.get("sgf.inspector.sections")).toBe(
      JSON.stringify({ "system.flags": false, "system.planets": true }),
    );
  });

  it("resets only the sections it is given, leaving the rest as the user left them", () => {
    inspector().toggleSection("system.planets", false);
    inspector().toggleSection("system.scripts", true);
    inspector().toggleSection("system.flags", true);

    inspector().resetSections(["system.planets", "system.scripts", "system.station"]);

    expect(inspector().collapsed("system.planets", false)).toBe(false);
    expect(inspector().collapsed("system.scripts", true)).toBe(true);
    expect(inspector().collapsed("system.flags", true)).toBe(false);
    expect(stored.get("sgf.inspector.sections")).toBe(JSON.stringify({ "system.flags": false }));
  });
});

describe("opening a system's page", () => {
  it("goes back down the stack to a page on it, else selects the system, easing the map both ways", async () => {
    inspector().setRoot(SOL);
    inspector().open(EARTH);
    openSystem(452);
    expect(labels()).toEqual(["Sol"]);
    expect(useEditorStore.getState().focus?.id).toBe(452);

    openSystem(12);
    expect(useEditorStore.getState().focus?.id).toBe(12);
    await vi.waitFor(() => expect(useEditorStore.getState().selection).toEqual([12]));
  });
});

describe("a wormhole opened from the system view", () => {
  it("stands above the system's page on Overview, Data and Source, and Esc takes it off", () => {
    useLayoutStore.setState({ tab: "inspector", collapsed: false });
    inspector().setRoot(SOL);
    inspector().openFromMap(EARTH);
    const hole = wormholeEntry(452, 30, "Sol Wormhole");

    inspector().openFromMap(hole);
    expect(labels()).toEqual(["Sol", "Sol Wormhole"]);
    expect(entityAddr(hole.ref)).toEqual({ kind: "wormhole", id: 30 });
    expect(tabsFor(hole.ref)).toEqual(["overview", "data", "source"]);
    expect(refKey(hole.ref)).toBe("wormhole:30");

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
    await vi.waitFor(() => expect(listeners.changed).not.toBeNull());
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

    await vi.waitFor(() => expect(refs()).toEqual([ALPHA.ref]));
  });
});

describe("a save body's page", () => {
  it("is keyed by its system and id, and reads the planet for its Data and Source tabs", async () => {
    await openFixtureSave();
    expect(refKey(EARTH.ref)).toBe("body:452:1207");
    expect(entityAddr(EARTH.ref)).toEqual({ kind: "planet", id: 1207 });
    expect(tabsFor(EARTH.ref, false)).toEqual(["overview", "data", "source"]);
  });

  it("opens from a link that knows only the planet's id, on the system its page names", async () => {
    await openFixtureSave();
    inspector().setRoot(SOL);
    mockedIpc.getPlanetPage.mockResolvedValueOnce(planetPage({ id: 1207, system: 452 }));

    openPlanet(1207, "Earth");

    await vi.waitFor(() => expect(refs()).toEqual([SOL.ref, EARTH.ref]));
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
    await vi.waitFor(() => expect(useEntityStore.getState().pages.has(1207)).toBe(true));
    expect(refs()).toEqual([SOL.ref]);

    lunaRead(planetPage({ id: 1208, system: 452 }));
    await vi.waitFor(() => expect(refs()).toEqual([SOL.ref, LUNA.ref]));
  });
});

describe("a scenario body's page", () => {
  it("is keyed by its system and id, reads no entity and offers the Overview alone", async () => {
    await openFixtureScenario();
    expect(refKey(TARKIN.ref)).toBe("body:1:100");
    expect(refKey({ kind: "body", system: 2, id: 100 })).not.toBe(refKey(TARKIN.ref));
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
