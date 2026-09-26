import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemNode } from "../generated/SystemNode";
import { keyAction, type KeyAction, type KeyLike } from "../lib/keys";
import { LAYER_KEYS, SCENE_LAYER_IDS } from "../lib/visual/layerIds";
import { stubPrefs } from "../test/prefs";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { canGoBack, nudgeSelected, run, toggleLayerKey, type CommandEffects } from "./commands";
import { editor, openFixtureSave, openFixtureScenario, withAddedSystems } from "./editorFixture";
import { useFileSessionStore } from "./fileSessionStore";
import { OPEN_RESULT, editResult } from "./fixture";
import { loadGameData } from "./gameDataFixture";
import { useGalaxyStore } from "./galaxyStore";
import { bodyEntry, useInspectorStore, type Entry } from "./inspectorStore";
import { useLayoutStore } from "./layoutStore";
import { useMapChromeStore } from "./mapChromeStore";
import { GALAXY_SCENE, useSceneStore } from "./sceneStore";
import { useToolStore } from "./toolStore";
import { mockedIpc } from "../test/ipc";

const SOL: Entry = { ref: { kind: "system", id: 0 }, label: "Sol" };
const EARTH: Entry = { ref: { kind: "planet", id: 1207 }, label: "Earth" };
const ALPHA: Entry = { ref: { kind: "system", id: 1 }, label: "Alpha Centauri" };
const TARKIN = { kind: "body", system: 1, id: 100 };

const effects: CommandEffects = { focusSearch: vi.fn(), browseInitializers: vi.fn() };

const scene = () => useSceneStore.getState();
const tools = () => useToolStore.getState();
const chrome = () => useMapChromeStore.getState();
const labels = () => useInspectorStore.getState().stack.map((e) => e.label);
const inSystem = (id: number) => ({ kind: "system", id });
const GALAXY = { kind: "galaxy" };

function press(key: string): KeyLike {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
}

/** A key press as the app hands it to the commands: bound, then run. */
function key(name: string): boolean {
  const action: KeyAction | null = keyAction(press(name), false, canGoBack());
  return action !== null && run(action, false, effects);
}

const esc = () => run("clearSelection", false, effects);

/** A left click on body `id` of `system` in the scene, as the scene hands it to the inspector. */
const click = (system: number, id: number, label: string) =>
  useInspectorStore.getState().openFromMap(bodyEntry(system, id, label));

const refs = () => useInspectorStore.getState().stack.map((e) => e.ref);

/** Removing 6 moves 7 down to 6, as the core reports it. */
function removeSix(seven: SystemNode) {
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
    }),
  );
  return editor().applyOp({ type: "RemoveSystem", id: 6 });
}

/** The map's canvas, as far as Enter asks about it. */
class Canvas {
  closest(selector: string): object | null {
    return selector === ".map-host" ? {} : null;
  }
}

/** A button inside `.map-area`, such as a context menu item or a dialog's. */
const BUTTON = { closest: (selector: string) => (selector === ".map-area" ? {} : null) };
const BODY = {};

function focus(active: object | null): void {
  vi.stubGlobal("document", { activeElement: active, body: BODY });
}

beforeEach(async () => {
  stubPrefs();
  vi.stubGlobal("HTMLCanvasElement", Canvas);
  focus(null);
  await openFixtureSave();
});

describe("entering a system", () => {
  it("selects the system, sets Select and refuses a brush and Shift+M", async () => {
    await openFixtureScenario();
    expect(tools().setTool("paint")).toBe(true);
    const symmetry = tools().symmetry;

    scene().enterSystem(1);

    expect(scene().scene).toEqual(inSystem(1));
    expect(editor().selection).toEqual([1]);
    expect(tools().tool).toBe("select");
    expect(tools().setTool("paint")).toBe(false);
    expect(tools().setTool("cut")).toBe(false);
    expect(run("toggleSymmetry", false, effects)).toBe(false);
    expect(tools().symmetry).toEqual(symmetry);
    expect(tools().setTool("select")).toBe(true);
  });

  it("closes the menu and the tooltip and clears the galaxy's overlays, keeping the hidden initializers", () => {
    const hidden = new Set(["basic_init_01"]);
    useMapChromeStore.setState({
      contextMenu: { target: { kind: "system", id: 1 }, x: 1, y: 1 },
      addSystemPreview: { x: 0, y: 0, tooClose: false, edge: null },
      tooltip: { x: 1, y: 1, title: "Alpha Centauri", lines: [] },
      lanePreview: [[0, 1]],
      highlightInitializer: "basic_init_01",
      gesture: "lane",
      hiddenInitializers: hidden,
    });
    editor().setHover(1);

    scene().enterSystem(1);

    expect(chrome().contextMenu).toBeNull();
    expect(chrome().addSystemPreview).toBeNull();
    expect(chrome().tooltip).toBeNull();
    expect(chrome().lanePreview).toBeNull();
    expect(chrome().highlightInitializer).toBeNull();
    expect(chrome().gesture).toBeNull();
    expect(chrome().hiddenInitializers).toBe(hidden);
    expect(editor().hover).toBeNull();
  });

  it("entering a neighbour keeps the scene up on the neighbour", () => {
    scene().enterSystem(0);
    scene().enterSystem(1);

    expect(scene().scene).toEqual(inSystem(1));
    expect(editor().selection).toEqual([1]);
  });

  it("Enter with one system selected enters it, on a save or a scenario, and does nothing on two", async () => {
    await editor().setSelection([0, 1], "replace");
    expect(key("Enter")).toBe(false);
    expect(scene().scene).toEqual(GALAXY);

    await editor().select(2);
    expect(key("Enter")).toBe(true);
    expect(scene().scene).toEqual(inSystem(2));

    scene().leaveSystem();
    await openFixtureScenario();
    await editor().select(2);
    expect(key("Enter")).toBe(true);
    expect(scene().scene).toEqual(inSystem(2));
  });

  it("Enter enters with the canvas or the page focused, and leaves a focused button its own", async () => {
    await editor().select(2);

    focus(BUTTON);
    expect(key("Enter")).toBe(false);
    expect(scene().scene).toEqual(GALAXY);

    focus(BODY);
    expect(key("Enter")).toBe(true);
    expect(scene().scene).toEqual(inSystem(2));

    scene().leaveSystem();
    focus(new Canvas());
    expect(key("Enter")).toBe(true);
    expect(scene().scene).toEqual(inSystem(2));
  });
});

describe("leaving a system", () => {
  it("Esc pops a page, then leaves the scene, then clears the selection, with the dock shown", async () => {
    useLayoutStore.setState({ tab: "inspector", collapsed: false });
    scene().enterSystem(0);
    useInspectorStore.getState().setRoot(SOL);
    useInspectorStore.getState().open(EARTH);

    esc();
    expect(labels()).toEqual(["Sol"]);
    expect(scene().scene).toEqual(inSystem(0));

    esc();
    expect(scene().scene).toEqual(GALAXY);
    expect(editor().selection).toEqual([0]);

    esc();
    await vi.waitFor(() => expect(editor().selection).toEqual([]));
  });

  it("Esc leaves the scene at once with the dock collapsed, popping the pages with it", async () => {
    useLayoutStore.setState({ tab: "inspector", collapsed: false });
    scene().enterSystem(0);
    useInspectorStore.getState().setRoot(SOL);
    useInspectorStore.getState().open(EARTH);
    useLayoutStore.setState({ collapsed: true });

    esc();
    expect(scene().scene).toEqual(GALAXY);
    expect(labels()).toEqual(["Sol"]);
    expect(editor().selection).toEqual([0]);

    esc();
    await vi.waitFor(() => expect(editor().selection).toEqual([]));
  });

  it("Backspace pops a crumb, then leaves the scene with none to pop", () => {
    scene().enterSystem(0);
    useInspectorStore.getState().setRoot(SOL);
    useInspectorStore.getState().open(EARTH);

    key("Backspace");
    expect(labels()).toEqual(["Sol"]);
    expect(scene().scene).toEqual(inSystem(0));

    key("Backspace");
    expect(scene().scene).toEqual(GALAXY);
    expect(editor().selection).toEqual([0]);
    expect(keyAction(press("Backspace"), false, canGoBack())).toBe("deleteSelection");
  });
});

describe("M", () => {
  it("opens the one selected system and goes back to the galaxy, wherever focus is", async () => {
    withAddedSystems();
    await editor().setSelection([6], "replace");

    expect(run("toggleSystemView", false, effects)).toBe(true);
    expect(scene().scene).toEqual(inSystem(6));
    expect(run("toggleSystemView", false, effects)).toBe(true);
    expect(scene().scene).toEqual(GALAXY_SCENE);

    await editor().setSelection([], "replace");
    expect(run("toggleSystemView", false, effects)).toBe(false);
    expect(scene().scene).toEqual(GALAXY_SCENE);
  });
});

describe("the galaxy's keys while a system is up", () => {
  it("Delete, Ctrl+A, Shift+I and the nudge do nothing, and the number keys switch only the scene's own layers", async () => {
    withAddedSystems();
    scene().enterSystem(6);
    const layers = chrome().layers;

    expect(key("Delete")).toBe(true);
    run("selectAll", false, effects);
    run("browseInitializers", false, effects);
    nudgeSelected({ dx: 1, dy: 0 });
    toggleLayerKey(0);
    await Promise.resolve();

    const scenic = chrome().sceneLayers;
    for (const id of SCENE_LAYER_IDS) toggleLayerKey(LAYER_KEYS.indexOf(id));
    expect(chrome().layers).toBe(layers);
    for (const id of SCENE_LAYER_IDS) expect(chrome().sceneLayers[id]).toBe(!scenic[id]);

    expect(mockedIpc.confirm).not.toHaveBeenCalled();
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(effects.browseInitializers).not.toHaveBeenCalled();
    expect(editor().selection).toEqual([6]);
    expect(scene().scene).toEqual(inSystem(6));

    scene().leaveSystem();
    toggleLayerKey(LAYER_KEYS.indexOf("details"));
    expect(chrome().layers.details).toBe(!layers.details);
    expect(chrome().sceneLayers.details).toBe(!scenic.details);
  });
});

describe("the scene follows the selection", () => {
  it("leaves on jumpTo another system, and stays on jumpTo its own", async () => {
    scene().enterSystem(0);

    await editor().jumpTo(0);
    expect(scene().scene).toEqual(inSystem(0));

    await editor().jumpTo(1);
    expect(scene().scene).toEqual(GALAXY);
    expect(editor().selection).toEqual([1]);
  });

  it("leaves on clearSelection", async () => {
    scene().enterSystem(0);

    await editor().clearSelection();

    expect(scene().scene).toEqual(GALAXY);
  });

  it("leaves on a focus on another system, and stays on its own and on a pan", () => {
    scene().enterSystem(0);

    editor().focusOn(0);
    editor().panTo(100, 100);
    expect(scene().scene).toEqual(inSystem(0));

    editor().focusOn(1);
    expect(scene().scene).toEqual(GALAXY);
    expect(editor().selection).toEqual([0]);
  });

  it("leaves on an undo that drops the system from the selection", async () => {
    withAddedSystems();
    scene().enterSystem(7);
    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ delta: { systems: [], removed: [7], renumbered: [[7, null]] } }),
    );

    await editor().undo();

    expect(editor().selection).toEqual([]);
    expect(scene().scene).toEqual(GALAXY);
  });

  it("follows a pure renumber onto the system's new id", async () => {
    const [, seven] = withAddedSystems();
    scene().enterSystem(7);

    await removeSix(seven);

    expect(editor().selection).toEqual([6]);
    expect(scene().scene).toEqual(inSystem(6));
  });

  it("stays on the galaxy when an undone removal re-selects the system", async () => {
    const [six, seven] = withAddedSystems();
    scene().enterSystem(6);
    await removeSix(seven);
    expect(scene().scene).toEqual(GALAXY);
    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ delta: { systems: [six, seven], renumbered: [[6, 7]] } }),
    );

    await editor().undo();

    await vi.waitFor(() => expect(editor().selection).toEqual([6]));
    expect(scene().scene).toEqual(GALAXY);
  });

  it("goes back to the galaxy when a document opens or closes", async () => {
    scene().enterSystem(0);
    await useFileSessionStore.getState().openSave(OPEN_RESULT.path);
    expect(scene().scene).toEqual(GALAXY);

    scene().enterSystem(0);
    // The galaxy empties before the selection does, so this sees the reset on close, not the
    // selection being dropped.
    const seen: unknown[] = [];
    const stop = useGalaxyStore.subscribe((state) => {
      if (state.systems.size === 0) seen.push([scene().scene, editor().selection]);
    });
    await useFileSessionStore.getState().close();
    stop();

    expect(seen[0]).toEqual([GALAXY, [0]]);
    expect(scene().scene).toEqual(GALAXY);
  });
});

describe("a body clicked in the system view", () => {
  it("puts a save body's planet page straight above the system's, and Esc pops it before leaving", () => {
    scene().enterSystem(0);
    useInspectorStore.getState().setRoot(SOL);
    useLayoutStore.setState({ tab: "issues", previousTab: "issues", collapsed: false });

    click(0, 1207, "Earth");
    click(0, 1208, "Luna");

    expect(refs()).toEqual([SOL.ref, { kind: "planet", id: 1208 }]);
    expect(useInspectorStore.getState().stack[1].from).toBeUndefined();
    expect(useLayoutStore.getState().tab).toBe("inspector");

    esc();
    expect(labels()).toEqual(["Sol"]);
    expect(scene().scene).toEqual(inSystem(0));
    esc();
    expect(scene().scene).toEqual(GALAXY);
  });

  it("puts a scenario body's own page on the stack, keyed by its system", async () => {
    await openFixtureScenario();
    useInspectorStore.getState().setRoot(ALPHA);

    click(1, 100, "Tarkin");

    expect(refs()).toEqual([ALPHA.ref, TARKIN]);
    expect(labels()).toEqual(["Alpha Centauri", "Tarkin"]);
  });

  it("closes a scenario body's page on an edit that stales its system's details", async () => {
    await openFixtureScenario();
    useInspectorStore.getState().setRoot(ALPHA);
    click(1, 100, "Tarkin");

    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [2] }));
    await editor().applyOp({ type: "SetInitializer", id: 2, initializer: "basic_init_01" });
    expect(refs()).toEqual([ALPHA.ref, TARKIN]);

    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [1] }));
    await editor().applyOp({ type: "SetInitializer", id: 1, initializer: "basic_init_01" });
    expect(refs()).toEqual([ALPHA.ref]);
  });

  it("keeps a scenario body's page on its system's new id through a renumber, and a SetInitializer there closes it", async () => {
    await openFixtureScenario();
    const [, seven] = withAddedSystems();
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: 7 }, label: "Added" });
    click(7, 100, "Tarkin");

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
    await editor().applyOp({ type: "RemoveSystem", id: 6 });
    expect(refs()).toEqual([
      { kind: "system", id: 6 },
      { kind: "body", system: 6, id: 100 },
    ]);

    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [6] }));
    await editor().applyOp({ type: "SetInitializer", id: 6, initializer: "basic_init_01" });
    expect(refs()).toEqual([{ kind: "system", id: 6 }]);
  });

  it("closes a scenario body's page when the game data reloads, and keeps a save's planet page", async () => {
    await openFixtureScenario();
    useInspectorStore.getState().setRoot(ALPHA);
    click(1, 100, "Tarkin");

    await loadGameData();
    expect(refs()).toEqual([ALPHA.ref]);

    await openFixtureSave();
    useInspectorStore.getState().setRoot(SOL);
    click(0, 1207, "Earth");
    await loadGameData();
    expect(refs()).toEqual([SOL.ref, EARTH.ref]);
  });
});
