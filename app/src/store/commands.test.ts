import { beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { SAVE_Y_SIGN } from "../lib/geometry/geometry";
import { mockedIpc } from "../test/ipc";
import { nudgeSelected, run, type CommandEffects } from "./commands";
import { useDetailsStore } from "./detailsStore";
import { openFixtureSave } from "./editorFixture";
import { useEditorStore } from "./editorStore";
import { editResult, OPEN_RESULT, orbitClasses, orbitSystem } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { useGalaxyStore } from "./galaxyStore";
import { useInitializerBrowserStore } from "./initializerBrowserStore";
import { bodyEntryOf, useInspectorStore, type Entry } from "./inspectorStore";
import { useLayoutStore } from "./layoutStore";
import { useMapChromeStore } from "./mapChromeStore";
import { useSceneStore } from "./sceneStore";
import { resetStores } from "./storeFixture";

const SOL: Entry = { ref: { kind: "system", id: 452 }, label: "Sol" };
const EARTH: Entry = { ref: { kind: "planet", id: 1207 }, label: "Earth" };

const effects: CommandEffects = {
  focusSearch: vi.fn(),
  browseInitializers: vi.fn(),
};

const stored = new Map<string, string>();

beforeEach(() => {
  resetStores();
  stubPrefs(stored);
});

describe("clearSelection", () => {
  const esc = (inInput = false) => run("clearSelection", inInput, effects);

  it("gives Esc to the browser, then the dialog, the menu, the drill, the system and the selection", async () => {
    useEditorStore.setState({ selection: [1] });
    useGalaxyStore.getState().load(OPEN_RESULT.galaxy);
    useSceneStore.getState().enterSystem(1);
    useInitializerBrowserStore.setState({ open: true });
    useLayoutStore.setState({ openDialog: true, tab: "inspector", collapsed: false });
    useMapChromeStore.getState().openContextMenu({ target: { kind: "system", id: 1 }, x: 1, y: 1 });
    useInspectorStore.getState().setRoot(SOL);
    useInspectorStore.getState().open(EARTH);

    expect(esc()).toBe(false);
    expect(useInitializerBrowserStore.getState().open).toBe(false);
    expect(useLayoutStore.getState().openDialog).toBe(true);

    esc();
    expect(useLayoutStore.getState().openDialog).toBe(false);
    expect(useMapChromeStore.getState().contextMenu).not.toBeNull();

    esc();
    expect(useMapChromeStore.getState().contextMenu).toBeNull();
    expect(useInspectorStore.getState().stack.map((e) => e.label)).toEqual(["Sol", "Earth"]);

    esc();
    expect(useInspectorStore.getState().stack.map((e) => e.label)).toEqual(["Sol"]);
    expect(useSceneStore.getState().scene).toEqual({ kind: "system", id: 1 });

    esc();
    expect(useSceneStore.getState().scene).toEqual({ kind: "galaxy" });
    expect(useEditorStore.getState().selection).toEqual([1]);

    esc();
    await vi.waitFor(() => expect(useEditorStore.getState().selection).toEqual([]));
  });

  it("leaves everything but the browser standing while a field has the caret", () => {
    useLayoutStore.setState({ openDialog: true });
    useInitializerBrowserStore.setState({ open: true });

    esc(true);
    expect(useInitializerBrowserStore.getState().open).toBe(false);

    esc(true);
    expect(useLayoutStore.getState().openDialog).toBe(true);
  });
});

describe("fitSelection", () => {
  it("frames the selection, and the whole galaxy when there is none", () => {
    const fitted = useEditorStore.getState().fitNonce;
    run("fitSelection", false, effects);
    expect(useEditorStore.getState().fitNonce).toBe(fitted + 1);
    expect(effects.focusSearch).not.toHaveBeenCalled();

    const framed = useEditorStore.getState().fitSelectionNonce;
    useEditorStore.setState({ selection: [1] });
    run("fitSelection", false, effects);

    expect(useEditorStore.getState().fitSelectionNonce).toBe(framed + 1);
  });

  it("frames a nebula selected alone, rather than fitting the whole galaxy", () => {
    const fitted = useEditorStore.getState().fitNonce;
    const framed = useEditorStore.getState().fitSelectionNonce;
    useEditorStore.setState({ selectedNebula: 0 });
    run("fitSelection", false, effects);
    expect(useEditorStore.getState().fitSelectionNonce).toBe(framed + 1);
    expect(useEditorStore.getState().fitNonce).toBe(fitted);
  });
});

describe("Shift+Arrow", () => {
  const SYSTEM = 0;
  const LONE = 5;

  beforeEach(async () => {
    await openFixtureSave();
    useDetailsStore.setState({ details: new Map([[SYSTEM, orbitSystem({ id: SYSTEM })]]) });
    useGameDataStore.setState({ planetClasses: orbitClasses() });
    mockedIpc.applyOp.mockResolvedValue(editResult());
  });

  it("in a system view, steps the inspected body one unit out and leaves the selected systems alone", async () => {
    useEditorStore.setState({ selection: [SYSTEM] });
    useSceneStore.getState().enterSystem(SYSTEM);
    useInspectorStore.getState().openFromMap(bodyEntryOf(true, SYSTEM, LONE, "Body"));

    nudgeSelected({ dx: 0, dy: -SAVE_Y_SIGN });
    await vi.waitFor(() => expect(mockedIpc.applyOp).toHaveBeenCalledOnce());
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "MoveSaveBody",
      system: SYSTEM,
      body: LONE,
      radius: 101,
      angle: expect.closeTo(120, 9),
    });
  });

  it("on the galaxy, moves the selected systems", async () => {
    useEditorStore.setState({ selection: [SYSTEM] });
    nudgeSelected({ dx: 1, dy: 0 });
    await vi.waitFor(() => expect(mockedIpc.applyOp).toHaveBeenCalledOnce());
    expect(mockedIpc.applyOp).toHaveBeenCalledWith(expect.objectContaining({ type: "MoveSystem" }));
  });
});
