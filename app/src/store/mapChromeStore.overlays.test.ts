import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";
import { OPEN_RESULT, detailOf } from "./fixture";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { mockedIpc } from "../test/ipc";
import { MESH_BETA } from "../lib/geometry/mesh";
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

  it("a session change leaves the mesh β alone", async () => {
    chrome().setMeshBeta(2);
    await session().openSave(OPEN_RESULT.path);
    expect(chrome().meshBeta).toBe(2);
  });
});

describe("persisted preferences", () => {
  it("writes the shown kinds, the layers and the mesh β on change", () => {
    chrome().toggleKind("landmark");
    expect(JSON.parse(stored.get("sgf.layers.shownKinds") ?? "[]")).toContain("landmark");
    chrome().toggleAllKinds();
    expect(JSON.parse(stored.get("sgf.layers.shownKinds") ?? "[]")).toHaveLength(KIND_ORDER.length);

    chrome().toggleLayer("bypasses");
    expect(JSON.parse(stored.get("sgf.layers.visible") ?? "{}")).toMatchObject({
      bypasses: false,
    });

    chrome().setMeshBeta(2);
    expect(stored.get("sgf.mesh.beta")).toBe("2");
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

  it("reads the shown kinds, the layers and the mesh β back on init", async () => {
    stored.set("sgf.layers.shownKinds", JSON.stringify(["landmark"]));
    stored.set("sgf.layers.visible", JSON.stringify({ bypasses: false }));
    stored.set("sgf.mesh.beta", "2.5");
    vi.resetModules();
    const fresh = await import("./mapChromeStore");
    const state = fresh.useMapChromeStore.getState();
    expect([...state.shownKinds]).toEqual(["landmark"]);
    expect(state.layers.bypasses).toBe(false);
    expect(state.layers.lanes).toBe(true);
    expect(state.meshBeta).toBe(2.5);
  });

  it("falls back to the defaults when a stored value is missing, corrupt or the wrong shape", async () => {
    stored.set("sgf.layers.shownKinds", "not json");
    stored.set("sgf.layers.visible", JSON.stringify(["not", "a", "record"]));
    stored.set("sgf.mesh.beta", JSON.stringify("wide"));
    vi.resetModules();
    const fresh = await import("./mapChromeStore");
    const state = fresh.useMapChromeStore.getState();
    expect([...state.shownKinds]).toEqual(["leviathan", "enclave"]);
    expect(state.layers).toEqual(DEFAULT_LAYERS);
    expect(state.meshBeta).toBe(MESH_BETA.gabriel);
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
