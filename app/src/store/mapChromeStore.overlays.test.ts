import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";
import { OPEN_RESULT, detailOf } from "./fixture";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { mockedIpc } from "../test/ipc";
import { betaOfDensity, DEFAULT_LANE_DENSITY } from "../lib/geometry/mesh";
import { KIND_ORDER } from "../lib/special";
import { DEFAULT_LAYERS } from "../lib/visual/layerIds";
import { session } from "./sessionFixture";
import { armSession, resetStores } from "./storeFixture";
import { useMapChromeStore } from "./mapChromeStore";

const chrome = () => useMapChromeStore.getState();
const stored = new Map<string, string>();

beforeEach(() => {
  resetStores();
  stubPrefs(stored);
  armSession();
  mockedIpc.getSystem.mockImplementation(async (id) => detailOf(id));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hidden initializers and precursors", () => {
  const filters = [
    {
      name: "initializer",
      key: "guardian_dragon",
      toggle: (key: string) => chrome().toggleInitializer(key),
      hidden: () => chrome().hiddenInitializers,
    },
    {
      name: "precursor",
      key: "precursor_1",
      toggle: (key: string) => chrome().togglePrecursor(key),
      hidden: () => chrome().hiddenPrecursors,
    },
  ];

  it.each(filters)(
    "hides one $name key and shows it again, and the same for the systems with none",
    ({ key, toggle, hidden }) => {
      toggle(key);
      expect([...hidden()]).toEqual([key]);
      toggle(key);
      expect(hidden().size).toBe(0);

      toggle("");
      expect(hidden().has("")).toBe(true);
      toggle("");
      expect(hidden().has("")).toBe(false);
    },
  );

  it.each(filters)("reset drops the $name filter", ({ key, toggle, hidden }) => {
    toggle(key);
    chrome().resetLayers();
    expect(hidden().size).toBe(0);
  });
});

describe("hidden initializers", () => {
  it("hides or shows the whole legend", () => {
    chrome().hideAllInitializers(["", "guardian_dragon"]);
    expect(chrome().hiddenInitializers.has("")).toBe(true);
    expect(chrome().hiddenInitializers.has("guardian_dragon")).toBe(true);

    chrome().showAllInitializers();
    expect(chrome().hiddenInitializers.size).toBe(0);
  });

  it("a group hides every key under it, then shows them all again", () => {
    const group = ["guardian_dragon", "guardian_hive"];
    chrome().toggleInitializers(group);
    expect([...chrome().hiddenInitializers].sort()).toEqual(group);

    chrome().toggleInitializer("guardian_dragon");
    chrome().toggleInitializers(group);
    expect([...chrome().hiddenInitializers].sort()).toEqual(group);

    chrome().toggleInitializers(group);
    expect(chrome().hiddenInitializers.size).toBe(0);
  });

  it("a new session drops the filter", async () => {
    chrome().toggleInitializer("guardian_dragon");
    await session().openSave(OPEN_RESULT.path);
    expect(chrome().hiddenInitializers.size).toBe(0);
  });
});

describe("overlays", () => {
  it("the context menu and the tooltip open and close", () => {
    chrome().openContextMenu({ target: { kind: "system", id: 0 }, x: 10, y: 20 });
    expect(chrome().contextMenu).toMatchObject({ x: 10, y: 20 });
    chrome().closeContextMenu();
    expect(chrome().contextMenu).toBeNull();

    chrome().showTooltip({ x: 1, y: 2, title: "Sol", lines: ["one lane"] });
    expect(chrome().tooltip?.title).toBe("Sol");
    chrome().hideTooltip();
    expect(chrome().tooltip).toBeNull();
  });

  it("shows one row's card at a time: a submenu's entry takes the turn from a focused row", () => {
    const row = (name: string) => ({ name }) as unknown as HTMLElement;
    const [classA, binaries, pair] = [row("Class A Star"), row("Binary stars"), row("A + B")];
    chrome().openContextMenu({ target: { kind: "space", x: 0, y: 0 }, x: 0, y: 0 });
    chrome().enterMenuRow({ el: classA, card: "class-a" });
    expect(chrome().menuRow?.card).toBe("class-a");

    chrome().enterMenuRow({ el: binaries, card: null });
    chrome().leaveMenuRow(classA);
    expect(chrome().menuRow).toEqual({ el: binaries, card: null });

    chrome().leaveMenuRow(binaries);
    chrome().enterMenuRow({ el: pair, card: "pair" });
    expect(chrome().menuRow?.card).toBe("pair");

    chrome().closeContextMenu();
    expect(chrome().menuRow).toBeNull();
  });

  it("opening and closing a save clear the menu, the tooltip and the lane ghosts", async () => {
    chrome().setLanePreview([[0, 5]]);
    chrome().openContextMenu({ target: { kind: "lane", lane: { a: 0, b: 1 } }, x: 1, y: 1 });
    expect(chrome().lanePreview).toEqual([[0, 5]]);

    await session().openSave(OPEN_RESULT.path);
    expect(chrome().lanePreview).toBeNull();
    expect(chrome().contextMenu).toBeNull();

    chrome().setLanePreview([[0, 5]]);
    chrome().showTooltip({ x: 1, y: 2, title: "Sol", lines: [] });
    await session().close();
    expect(chrome().lanePreview).toBeNull();
    expect(chrome().tooltip).toBeNull();
  });

  it("the highlighted initializer is set, cleared, and dropped by clearOverlays", () => {
    chrome().setHighlightInitializer("guardian_dragon");
    expect(chrome().highlightInitializer).toBe("guardian_dragon");

    chrome().setHighlightInitializer(null);
    expect(chrome().highlightInitializer).toBeNull();

    chrome().setHighlightInitializer("guardian_dragon");
    chrome().clearOverlays();
    expect(chrome().highlightInitializer).toBeNull();
  });

  it("a session change leaves the lane density alone", async () => {
    chrome().setLaneDensity(0.2);
    await session().openSave(OPEN_RESULT.path);
    expect(chrome().laneDensity).toBe(0.2);
  });
});

describe("persisted preferences", () => {
  it("writes the shown kinds, the layers and the lane density on change", () => {
    chrome().toggleKind("landmark");
    expect(JSON.parse(stored.get("sgf.layers.shownKinds") ?? "[]")).toContain("landmark");
    chrome().toggleAllKinds();
    expect(JSON.parse(stored.get("sgf.layers.shownKinds") ?? "[]")).toHaveLength(KIND_ORDER.length);

    chrome().toggleLayer("bypasses");
    expect(JSON.parse(stored.get("sgf.layers.visible") ?? "{}")).toMatchObject({
      bypasses: false,
    });

    chrome().setLaneDensity(0.2);
    expect(stored.get("sgf.lanes.density")).toBe("0.2");
  });

  it("writes only the keys the toggle changed, over the record already stored", () => {
    stored.set("sgf.layers.visible", JSON.stringify({ labels: false }));
    chrome().toggleLayer("bypasses");
    expect(JSON.parse(stored.get("sgf.layers.visible") ?? "{}")).toEqual({
      labels: false,
      bypasses: false,
    });
  });

  it("leaves a layer the app borrowed out of storage when the user toggles another", () => {
    chrome().setLayerQuietly("issues", true);
    chrome().toggleLayer("bypasses");
    expect(chrome().layers.issues).toBe(true);
    expect(JSON.parse(stored.get("sgf.layers.visible") ?? "{}")).toEqual({ bypasses: false });
  });

  it("writes nothing for a layer the app shows for an edit the user must see", () => {
    chrome().setLayerQuietly("nebulae", true);
    expect(chrome().layers.nebulae).toBe(true);
    expect(stored.has("sgf.layers.visible")).toBe(false);
  });

  it("reads the shown kinds, the layers and the lane density back on init", async () => {
    stored.set("sgf.layers.shownKinds", JSON.stringify(["landmark"]));
    stored.set("sgf.layers.visible", JSON.stringify({ bypasses: false }));
    stored.set("sgf.lanes.density", "0.8");
    vi.resetModules();
    const fresh = await import("./mapChromeStore");
    const state = fresh.useMapChromeStore.getState();
    expect([...state.shownKinds]).toEqual(["landmark"]);
    expect(state.layers.bypasses).toBe(false);
    expect(state.layers.lanes).toBe(true);
    expect(state.laneDensity).toBe(0.8);
  });

  it("falls back to the defaults when a stored value is missing, corrupt or the wrong shape", async () => {
    stored.set("sgf.layers.shownKinds", "not json");
    stored.set("sgf.layers.visible", JSON.stringify(["not", "a", "record"]));
    stored.set("sgf.lanes.density", JSON.stringify("wide"));
    vi.resetModules();
    const fresh = await import("./mapChromeStore");
    const state = fresh.useMapChromeStore.getState();
    expect([...state.shownKinds]).toEqual(["leviathan", "enclave"]);
    expect(state.layers).toEqual(DEFAULT_LAYERS);
    expect(state.laneDensity).toBe(DEFAULT_LANE_DENSITY);
  });

  it("carries a β stored by the old slider over to the density that cuts at that β", async () => {
    const densityAfter = async (beta: number) => {
      stored.set("sgf.mesh.beta", String(beta));
      vi.resetModules();
      const fresh = await import("./mapChromeStore");
      return fresh.useMapChromeStore.getState().laneDensity;
    };
    for (const beta of [2, 1.5, 1.2]) {
      expect(betaOfDensity(await densityAfter(beta))).toBeCloseTo(beta, 9);
    }
    expect(await densityAfter(1)).toBeCloseTo(DEFAULT_LANE_DENSITY, 9);
    expect(await densityAfter(0.1)).toBe(1);

    stored.set("sgf.lanes.density", "0.8");
    expect(await densityAfter(2)).toBe(0.8);
  });
});

describe("the add system preview", () => {
  it("goes with the menu that drew it, and with any menu opening", () => {
    const chrome = useMapChromeStore.getState();
    const preview = { x: 1, y: 2, tooClose: false, edge: null };
    chrome.openContextMenu({ target: { kind: "space", x: 1, y: 2 }, x: 0, y: 0 });
    chrome.setAddSystemPreview(preview);
    chrome.closeContextMenu();
    expect(useMapChromeStore.getState().addSystemPreview).toBeNull();

    chrome.setAddSystemPreview(preview);
    chrome.openContextMenu({ target: { kind: "system", id: 6 }, x: 0, y: 0 });
    expect(useMapChromeStore.getState().addSystemPreview).toBeNull();
  });
});
