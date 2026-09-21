import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GameDataSummary } from "../generated/GameDataSummary";
import type { InitializerView } from "../generated/InitializerView";
import { gameDataSummary, initializerView, SYSTEMS, editResult } from "./fixture";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import * as ipc from "../api/ipc";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import {
  browserGroupsOf,
  lastUsed,
  RANDOM_KEY,
  searchEntries,
  useInitializerBrowserStore,
  visibleEntriesOf,
} from "./initializerBrowserStore";
import { useMapChromeStore } from "./mapChromeStore";

const mocked = {
  applyOp: vi.mocked(ipc.applyOp),
  getInitializers: vi.mocked(ipc.getInitializers),
};

const INSTALL = "C:/Stellaris";
const VANILLA = INSTALL + "/common/solar_system_initializers";

const entry = (name: string, file: string, rest: Partial<InitializerView> = {}): InitializerView =>
  initializerView({ name, source: VANILLA + "/" + file, ...rest });

const HOME = entry("empire_init_01", "empire_initializers.txt", {
  usage: "empire_init",
  empire_spawn: true,
});
const SOL = entry("sol_system", "sol_initializers.txt", { usage: "misc_system_init" });
const BASIC = entry("basic_init_01", "misc_system_initializers.txt");
const LIST = [HOME, SOL, BASIC];

const SUMMARY: GameDataSummary = gameDataSummary({ install: INSTALL, mods: [] });

const stored = new Map<string, string>();

const browser = () => useInitializerBrowserStore.getState();
const appliedOps = () => mocked.applyOp.mock.calls.map((call) => call[0]);

/** What `useVisibleEntries` derives, from the stores as they stand. */
const visible = () => {
  const { pinned, recent, query, group } = browser();
  const { initializers, summary, names } = useGameDataStore.getState();
  const list = initializers ?? [];
  const mods = summary?.mods ?? [];
  const systems = useGalaxyStore.getState().systems;
  const tree = browserGroupsOf(list, mods, pinned, recent, systems);
  return visibleEntriesOf(searchEntries(list, mods, names), query, group, tree);
};

beforeEach(() => {
  vi.clearAllMocks();
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
  mocked.applyOp.mockResolvedValue(editResult());
  mocked.getInitializers.mockResolvedValue(LIST);
  useGameDataStore.setState({
    status: "ready",
    summary: SUMMARY,
    initializers: LIST,
    initializersPending: false,
    names: new Map(),
  });
  useGalaxyStore.setState({ galaxy: null, systems: new Map(SYSTEMS.map((s) => [s.id, s])) });
  useMapChromeStore.setState({ highlightInitializer: null });
  useInitializerBrowserStore.setState({
    open: false,
    mode: "assign",
    targets: [],
    pending: null,
    query: "",
    group: null,
    highlighted: null,
    pinned: [],
    recent: [],
    defaultKey: null,
    spawnWeight: null,
  });
});

describe("openFor", () => {
  it("captures the targets it was opened over", () => {
    browser().openFor([1, 4, 5]);
    expect(browser().open).toBe(true);
    expect(browser().targets).toEqual([1, 4, 5]);
  });

  it("does nothing without a target", () => {
    browser().openFor([]);
    expect(browser().open).toBe(false);
    expect(browser().targets).toEqual([]);
  });

  it("reads the initializers when the game data has not, and not when it has", () => {
    useGameDataStore.setState({ initializers: null });
    browser().openFor([1]);
    expect(mocked.getInitializers).toHaveBeenCalledTimes(1);

    useGameDataStore.setState({ initializers: LIST, initializersPending: false });
    browser().openFor([1]);
    expect(mocked.getInitializers).toHaveBeenCalledTimes(1);
  });
});

describe("highlight", () => {
  it("rings the highlighted key on the map, and the empty key for random", () => {
    browser().highlight(SOL.name);
    expect(useMapChromeStore.getState().highlightInitializer).toBe("sol_system");

    browser().highlight(RANDOM_KEY);
    expect(useMapChromeStore.getState().highlightInitializer).toBe("");

    browser().highlight(null);
    expect(useMapChromeStore.getState().highlightInitializer).toBe(null);
  });

  it("puts the spawn weight back to the entry's default on every change", () => {
    browser().highlight(HOME.name);
    expect(browser().spawnWeight).toBe(1);

    browser().setSpawnWeight(7);
    browser().highlight(HOME.name);
    expect(browser().spawnWeight).toBe(7);

    browser().highlight(SOL.name);
    expect(browser().spawnWeight).toBe(null);
  });
});

describe("close", () => {
  it("clears the map highlight", () => {
    browser().openFor([1]);
    browser().highlight(SOL.name);
    browser().close();
    expect(browser().open).toBe(false);
    expect(useMapChromeStore.getState().highlightInitializer).toBe(null);
  });
});

describe("assign", () => {
  it("sends one SetInitializer for one target, and no weight with it", async () => {
    browser().openFor([2]);
    browser().highlight(HOME.name);
    await browser().assign();
    expect(appliedOps()).toEqual([
      { type: "SetInitializer", id: 2, initializer: "empire_init_01" },
    ]);

    browser().openFor([2]);
    browser().highlight(SOL.name);
    await browser().assign();
    expect(appliedOps()[1]).toEqual({
      type: "SetInitializer",
      id: 2,
      initializer: "sol_system",
    });
  });

  it("writes no initializer for random", async () => {
    browser().openFor([2]);
    browser().highlight(RANDOM_KEY);
    await browser().assign();
    expect(appliedOps()).toEqual([{ type: "SetInitializer", id: 2, initializer: null }]);
    expect(browser().recent).toEqual([]);
  });

  it("sends one SetInitializers for several targets", async () => {
    browser().openFor([0, 2, 3]);
    browser().highlight(SOL.name);
    await browser().assign();
    expect(appliedOps()).toEqual([
      {
        type: "SetInitializers",
        entries: [
          { id: 0, initializer: "sol_system" },
          { id: 2, initializer: "sol_system" },
          { id: 3, initializer: "sol_system" },
        ],
      },
    ]);
  });

  it("closes unless it is asked to stay open", async () => {
    browser().openFor([2]);
    browser().highlight(SOL.name);
    await browser().assign(true);
    expect(browser().open).toBe(true);
    await browser().assign();
    expect(browser().open).toBe(false);
  });

  it("notes the key as recent, newest first, deduped and capped, and persists it", async () => {
    browser().openFor([2]);
    for (let i = 0; i < 11; i++) {
      browser().highlight("init_" + i);
      await browser().assign(true);
    }
    browser().highlight("init_5");
    await browser().assign(true);

    const recent = browser().recent;
    expect(recent).toHaveLength(10);
    expect(recent[0]).toBe("init_5");
    expect(recent.filter((key) => key === "init_5")).toHaveLength(1);
    expect(recent).not.toContain("init_0");
    expect(JSON.parse(stored.get("sgf.initializers.recent") ?? "[]")).toEqual(recent);
  });

  it("does nothing without a target or a highlighted choice", async () => {
    browser().highlight(SOL.name);
    expect(await browser().assign()).toBe(false);

    useInitializerBrowserStore.setState({ targets: [2], highlighted: null });
    expect(await browser().assign()).toBe(false);
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });
});

describe("setDefault", () => {
  it("remembers the machine's default and clears it back to random", () => {
    browser().setDefault(SOL.name);
    expect(browser().defaultKey).toBe("sol_system");
    expect(JSON.parse(stored.get("sgf.initializers.default") ?? "null")).toBe("sol_system");

    browser().setDefault(null);
    expect(browser().defaultKey).toBe(null);
    expect(JSON.parse(stored.get("sgf.initializers.default") ?? '"kept"')).toBe(null);
  });
});

describe("lastUsed", () => {
  it("is the newest recent pick, and nothing before the first", async () => {
    expect(lastUsed()).toBe(null);

    browser().openFor([2]);
    browser().highlight(SOL.name);
    await browser().assign();
    expect(lastUsed()).toBe("sol_system");

    browser().openFor([2]);
    browser().highlight(HOME.name);
    await browser().assign();
    expect(lastUsed()).toBe("empire_init_01");
  });
});

describe("create mode", () => {
  it("opens over a world point with no targets", () => {
    browser().openToCreate(-120.5, 45);
    expect(browser().open).toBe(true);
    expect(browser().mode).toBe("create");
    expect(browser().pending).toEqual({ x: -120.5, y: 45 });
    expect(browser().targets).toEqual([]);
  });

  it("sends one AddSystem for the highlighted entry, notes it and closes", async () => {
    browser().openToCreate(10, -4);
    browser().highlight(HOME.name);

    expect(await browser().assign()).toBe(true);
    expect(appliedOps()).toEqual([
      {
        type: "AddSystem",
        id: null,
        x: 10,
        y: -4,
        name: null,
        initializer: "empire_init_01",
        spawn_weight: 1,
        spawn_script: null,
      },
    ]);
    expect(browser().recent).toEqual(["empire_init_01"]);
    expect(browser().open).toBe(false);
  });

  it("creates a system with no initializer and no weight for random", async () => {
    browser().openToCreate(1, 2);
    browser().highlight(RANDOM_KEY);
    await browser().assign();
    expect(appliedOps()).toEqual([
      {
        type: "AddSystem",
        id: null,
        x: 1,
        y: 2,
        name: null,
        initializer: null,
        spawn_weight: null,
        spawn_script: null,
      },
    ]);
    expect(browser().recent).toEqual([]);
  });

  it("keeps the point to create another, and creates nothing when it is closed", async () => {
    browser().openToCreate(1, 2);
    browser().highlight(SOL.name);
    await browser().assign(true);
    expect(browser().open).toBe(true);
    expect(browser().pending).toEqual({ x: 1, y: 2 });

    browser().close();
    expect(browser().open).toBe(false);
    expect(mocked.applyOp).toHaveBeenCalledTimes(1);
  });
});

describe("togglePin", () => {
  it("pins, unpins and persists", () => {
    browser().togglePin(SOL.name);
    expect(browser().pinned).toEqual(["sol_system"]);
    expect(JSON.parse(stored.get("sgf.initializers.pinned") ?? "[]")).toEqual(["sol_system"]);

    browser().togglePin(SOL.name);
    expect(browser().pinned).toEqual([]);
    expect(JSON.parse(stored.get("sgf.initializers.pinned") ?? "[]")).toEqual([]);
  });
});

describe("the visible entries", () => {
  it("is every entry the query matches, narrowed to the selected group", () => {
    expect(visible().map((e) => e.name)).toEqual([HOME.name, SOL.name, BASIC.name]);

    browser().setGroup("empire");
    expect(visible().map((e) => e.name)).toEqual([HOME.name]);

    browser().setQuery("sol");
    expect(visible()).toEqual([]);

    browser().setGroup(null);
    expect(visible().map((e) => e.name)).toEqual([SOL.name]);
  });
});
