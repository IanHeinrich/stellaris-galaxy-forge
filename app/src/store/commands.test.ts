import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { run, type CommandEffects } from "./commands";
import { useEditorStore } from "./editorStore";
import { useInitializerBrowserStore } from "./initializerBrowserStore";
import { useInspectorStore, type Entry } from "./inspectorStore";
import { useLayoutStore } from "./layoutStore";
import { useMapChromeStore } from "./mapChromeStore";

const SOL: Entry = { ref: { kind: "system", id: 452 }, label: "Sol" };
const EARTH: Entry = { ref: { kind: "planet", id: 1207 }, label: "Earth" };

const effects: CommandEffects = {
  focusSearch: vi.fn(),
  browseInitializers: vi.fn(),
  confirmRemoveNebula: vi.fn(),
};

const stored = new Map<string, string>();

beforeEach(() => {
  vi.clearAllMocks();
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useInitializerBrowserStore.setState({ ...useInitializerBrowserStore.getInitialState() });
  useInspectorStore.setState({ ...useInspectorStore.getInitialState() });
  useLayoutStore.setState({ ...useLayoutStore.getInitialState() });
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
});

describe("clearSelection", () => {
  const esc = (inInput = false) => run("clearSelection", inInput, effects);

  it("gives Esc to the browser, then the dialog, the menu, the drill and the selection", async () => {
    useEditorStore.setState({ selection: [1] });
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
});
