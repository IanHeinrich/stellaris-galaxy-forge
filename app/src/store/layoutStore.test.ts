import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";
import { DEFAULT_LAYERS } from "../lib/visual/layerIds";
import { bindStores } from "./bindStores";
import { DOCK_MAX_WIDTH, DOCK_MIN_WIDTH, useLayoutStore } from "./layoutStore";
import { useMapChromeStore } from "./mapChromeStore";
import { isFiniteNumber, isStringArray, readPref } from "./prefs";

const layout = () => useLayoutStore.getState();

const stored = new Map<string, string>();

bindStores();

beforeEach(() => {
  stubPrefs(stored);
  useLayoutStore.setState({ ...useLayoutStore.getInitialState() });
  useMapChromeStore.setState({ layers: { ...DEFAULT_LAYERS } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dock tabs", () => {
  it("a selection made outside the dock switches to the inspector and Esc goes back", () => {
    layout().setTab("empires");
    layout().noteEventSource(false);
    layout().revealInspector();
    expect(layout().tab).toBe("inspector");
    layout().restoreTab();
    expect(layout().tab).toBe("empires");
  });

  it("a selection made from a dock row keeps the tab, and Esc has nowhere to go", () => {
    layout().setTab("issues");
    layout().noteEventSource(true);
    layout().revealInspector();
    expect(layout().tab).toBe("issues");
    layout().restoreTab();
    expect(layout().tab).toBe("issues");
  });

  it("picking a tab by hand makes it the one Esc returns to", () => {
    layout().setTab("changes");
    layout().noteEventSource(false);
    layout().revealInspector();
    layout().setTab("inspector");
    layout().restoreTab();
    expect(layout().tab).toBe("inspector");
  });
});

describe("the issues tab and the map", () => {
  const issuesLayer = () => useMapChromeStore.getState().layers.issues;

  it("turns the issue highlights on while the tab is open and off again on the way out", () => {
    expect(issuesLayer()).toBe(false);
    layout().setTab("issues");
    expect(issuesLayer()).toBe(true);
    layout().setTab("changes");
    expect(issuesLayer()).toBe(false);
    expect(stored.get("sgf.layers.issues")).toBeUndefined();
  });

  it("leaves a layer pinned on from the Layers menu while the tab is open", () => {
    layout().setTab("issues");
    expect(issuesLayer()).toBe(true);
    // The user takes the borrowed layer into their own hands: off, then on again.
    useMapChromeStore.getState().toggleLayer("issues");
    useMapChromeStore.getState().toggleLayer("issues");
    layout().setTab("changes");
    expect(issuesLayer()).toBe(true);
  });

  it("leaves a layer the user turned off while the tab was open off", () => {
    layout().setTab("issues");
    useMapChromeStore.getState().toggleLayer("issues");
    layout().setTab("changes");
    expect(issuesLayer()).toBe(false);
  });

  it("leaves a layer the user already had on alone", () => {
    useMapChromeStore.getState().toggleLayer("issues");
    layout().setTab("issues");
    expect(issuesLayer()).toBe(true);
    layout().noteEventSource(false);
    layout().revealInspector();
    expect(issuesLayer()).toBe(true);
  });
});

describe("dock size", () => {
  it("clamps the width to the dock's range and remembers it", () => {
    layout().setWidth(400);
    expect(layout().width).toBe(400);
    layout().setWidth(9000);
    expect(layout().width).toBe(DOCK_MAX_WIDTH);
    layout().setWidth(10);
    expect(layout().width).toBe(DOCK_MIN_WIDTH);
    expect(stored.get("sgf.dock.width")).toBe(String(DOCK_MIN_WIDTH));
  });

  it("collapses and restores, and remembers which it is", () => {
    expect(layout().collapsed).toBe(false);
    layout().toggleDock();
    expect(layout().collapsed).toBe(true);
    expect(stored.get("sgf.dock.collapsed")).toBe("true");
    layout().toggleDock();
    expect(layout().collapsed).toBe(false);
    expect(stored.get("sgf.dock.collapsed")).toBe("false");
  });
});

describe("stored preferences", () => {
  it("falls back to the default when a stored value is missing, corrupt or the wrong shape", () => {
    expect(readPref("sgf.test", 340, isFiniteNumber)).toBe(340);
    stored.set("sgf.test", "{not json");
    expect(readPref("sgf.test", 340, isFiniteNumber)).toBe(340);
    stored.set("sgf.test", '"wide"');
    expect(readPref("sgf.test", 340, isFiniteNumber)).toBe(340);
    stored.set("sgf.test", "[1, 2]");
    expect(readPref<string[]>("sgf.test", ["leviathan"], isStringArray)).toEqual(["leviathan"]);
  });
});

describe("open dialog", () => {
  it("opens over the map and closes again", () => {
    expect(layout().openDialog).toBe(false);
    layout().showOpenDialog();
    expect(layout().openDialog).toBe(true);
    layout().hideOpenDialog();
    expect(layout().openDialog).toBe(false);
  });
});
