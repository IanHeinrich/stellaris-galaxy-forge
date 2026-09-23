import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "../generated/Issue";
import {
  OPEN_RESULT,
  SCENARIO_RESULT,
  editResult,
  gameDataSummary,
  initializerView,
  systemNode,
} from "./fixture";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { onProgress } from "../api/events";
import * as ipc from "../api/ipc";
import { bindStores } from "./bindStores";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { filteredIssues, newIssues, useIssuesStore } from "./issuesStore";

const mocked = {
  openSave: vi.mocked(ipc.openSave),
  closeSave: vi.mocked(ipc.closeSave),
  applyOp: vi.mocked(ipc.applyOp),
  getSpecialSystems: vi.mocked(ipc.getSpecialSystems),
  getScenarioOwners: vi.mocked(ipc.getScenarioOwners),
  getScenarioBypasses: vi.mocked(ipc.getScenarioBypasses),
  getNames: vi.mocked(ipc.getNames),
  resolveNames: vi.mocked(ipc.resolveNames),
  warmDetails: vi.mocked(ipc.warmDetails),
  onProgress: vi.mocked(onProgress),
};

const AT_LOAD = OPEN_RESULT.issues[0];
const NOTES: Issue[] = [
  {
    severity: "warning",
    code: "export_dropped",
    message: "6 wormhole pairs were not carried into the scenario",
    systems: [],
    note: true,
  },
  {
    severity: "warning",
    code: "home_initializer",
    message: "system 2 is an empire seat on shattered_ring_start, not a generic home initializer",
    systems: [2],
    note: true,
  },
];
const SPLIT: Issue = {
  severity: "error",
  code: "disconnected",
  message: "galaxy has 3 components, 2 at load; newly separated: 2",
  systems: [2],
  note: false,
};

/** A scenario of `count` systems, ids from 0. */
function scenarioOf(count: number): typeof SCENARIO_RESULT {
  const systems = Array.from({ length: count }, (_, id) => systemNode({ id, x: id, y: 0 }));
  return { ...SCENARIO_RESULT, issues: [], galaxy: { ...SCENARIO_RESULT.galaxy, systems } };
}

/** Game data whose largest galaxy size is Huge at 1,000 stars. */
function loadHuge(): void {
  useGameDataStore.setState({
    status: "ready",
    summary: gameDataSummary({
      largest_galaxy: { name: "huge", label: "Huge", num_stars: 1000 },
    }),
  });
}

const sizeMessages = () =>
  useIssuesStore
    .getState()
    .issues.filter((issue) => issue.code === "galaxy_size_exceeded")
    .map((issue) => issue.message);

async function open(path = OPEN_RESULT.path): Promise<void> {
  await useFileSessionStore.getState().openSave(path);
}

bindStores();

beforeEach(() => {
  vi.clearAllMocks();
  useGalaxyStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useIssuesStore.getState().clear();
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
  mocked.onProgress.mockResolvedValue(() => undefined);
  mocked.openSave.mockResolvedValue(OPEN_RESULT);
  mocked.closeSave.mockResolvedValue();
  mocked.warmDetails.mockResolvedValue();
  mocked.getSpecialSystems.mockResolvedValue({ systems: [], counts: [], with_game_data: false });
  mocked.getScenarioOwners.mockResolvedValue(null);
  mocked.getScenarioBypasses.mockResolvedValue(null);
  mocked.getNames.mockResolvedValue({});
  mocked.resolveNames.mockResolvedValue([]);
});

describe("issuesStore", () => {
  it("takes the issues an open reports as the baseline and counts nothing as new", async () => {
    await open();
    const { baseline } = useIssuesStore.getState();
    expect(baseline.size).toBe(1);
    expect(newIssues(useIssuesStore.getState().issues, baseline)).toEqual([]);
  });

  it("counts only the issues an edit adds, keeping the baseline out of the badge", async () => {
    await open();
    mocked.applyOp.mockResolvedValue(editResult({ issues: [AT_LOAD, SPLIT] }));
    await useEditorStore.getState().applyOp({ type: "RemoveLane", a: 1, b: 2 });

    const { baseline } = useIssuesStore.getState();
    const issues = useIssuesStore.getState().issues;
    expect(newIssues(issues, baseline)).toEqual([SPLIT]);
    expect(filteredIssues(issues, baseline, "baseline", null)).toEqual([AT_LOAD]);
    expect(filteredIssues(issues, baseline, "all", null)).toEqual([AT_LOAD, SPLIT]);
    expect(filteredIssues(issues, baseline, "all", "disconnected")).toEqual([SPLIT]);
  });

  it("keeps a baseline issue out of the count when it goes away and comes back", async () => {
    await open();
    mocked.applyOp.mockResolvedValue(editResult({ issues: [] }));
    await useEditorStore.getState().applyOp({ type: "RemoveLane", a: 1, b: 2 });
    expect(useIssuesStore.getState().baseline.size).toBe(1);

    mocked.applyOp.mockResolvedValue(editResult({ issues: [AT_LOAD] }));
    await useEditorStore.getState().applyOp({ type: "RemoveLane", a: 0, b: 1 });
    const { baseline } = useIssuesStore.getState();
    expect(newIssues(useIssuesStore.getState().issues, baseline)).toEqual([]);
  });

  it("clears the baseline and the filters when the save closes", async () => {
    await open();
    useIssuesStore.getState().setFilter("all");
    useIssuesStore.getState().setCode("system_isolated");
    await useFileSessionStore.getState().close();

    const state = useIssuesStore.getState();
    expect(state.baseline.size).toBe(0);
    expect(state.filter).toBe("new");
    expect(state.code).toBeNull();
  });

  it("keeps the notes a document opened with out of the baseline and in the count", async () => {
    mocked.openSave.mockResolvedValue({ ...OPEN_RESULT, issues: [AT_LOAD, ...NOTES] });
    await open();

    const { baseline, notes } = useIssuesStore.getState();
    expect(baseline.size).toBe(1);
    expect(notes).toEqual(NOTES);
    expect(newIssues(useIssuesStore.getState().issues, baseline)).toEqual(NOTES);
  });

  it("carries the notes through an edit's fresh issue list", async () => {
    mocked.openSave.mockResolvedValue({ ...OPEN_RESULT, issues: [AT_LOAD, ...NOTES] });
    await open();
    mocked.applyOp.mockResolvedValue(editResult({ issues: [AT_LOAD, SPLIT] }));
    await useEditorStore.getState().applyOp({ type: "RemoveLane", a: 1, b: 2 });

    const { baseline } = useIssuesStore.getState();
    const issues = useIssuesStore.getState().issues;
    expect(issues).toEqual([AT_LOAD, SPLIT, ...NOTES]);
    expect(newIssues(issues, baseline)).toEqual([SPLIT, ...NOTES]);
    expect(filteredIssues(issues, baseline, "baseline", null)).toEqual([AT_LOAD]);
  });

  it("drops the notes when the document closes", async () => {
    mocked.openSave.mockResolvedValue({ ...OPEN_RESULT, issues: [AT_LOAD, ...NOTES] });
    await open();
    await useFileSessionStore.getState().close();
    expect(useIssuesStore.getState().notes).toEqual([]);

    mocked.openSave.mockResolvedValue(OPEN_RESULT);
    await open();
    mocked.applyOp.mockResolvedValue(editResult({ issues: [] }));
    await useEditorStore.getState().applyOp({ type: "RemoveLane", a: 1, b: 2 });
    expect(useIssuesStore.getState().issues).toEqual([]);
  });

  it("flashes the list for a save that stopped, and settles on its own", async () => {
    vi.useFakeTimers();
    try {
      await open();
      useIssuesStore.getState().flash();
      expect(useIssuesStore.getState().attention).toBe(true);
      vi.advanceTimersByTime(1200);
      expect(useIssuesStore.getState().attention).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles the flash when the list is touched, and when the document closes", async () => {
    vi.useFakeTimers();
    try {
      await open();
      useIssuesStore.getState().flash();
      useIssuesStore.getState().settle();
      expect(useIssuesStore.getState().attention).toBe(false);

      useIssuesStore.getState().flash();
      useIssuesStore.getState().clear();
      expect(useIssuesStore.getState().attention).toBe(false);
      vi.advanceTimersByTime(1200);
      expect(useIssuesStore.getState().attention).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes a fresh baseline when another save opens", async () => {
    await open();
    mocked.openSave.mockResolvedValue({ ...OPEN_RESULT, issues: [AT_LOAD, SPLIT] });
    await open("C:/saves/other.sav");

    const { baseline } = useIssuesStore.getState();
    expect(baseline.size).toBe(2);
    expect(newIssues(useIssuesStore.getState().issues, baseline)).toEqual([]);
  });

  it("warns when a scenario has well over the largest galaxy size's stars, as systems come and go", async () => {
    loadHuge();
    mocked.openSave.mockResolvedValue(scenarioOf(1300));
    await open(SCENARIO_RESULT.path);
    expect(useIssuesStore.getState().issues).toEqual([
      {
        severity: "warning",
        code: "galaxy_size_exceeded",
        message:
          "1,300 systems is well above Huge, the game's largest galaxy (1,000 stars). " +
          "Very large galaxies can make the game slow.",
        systems: [],
        note: true,
      },
    ]);

    const removed = Array.from({ length: 50 }, (_, i) => 1250 + i);
    mocked.applyOp.mockResolvedValue(editResult({ issues: [], delta: { systems: [], removed } }));
    await useEditorStore.getState().applyOp({ type: "RemoveSystem", id: 1250 });
    expect(useGalaxyStore.getState().systems.size).toBe(1250);
    expect(sizeMessages()).toEqual([]);

    const added = [systemNode({ id: 1250 })];
    mocked.applyOp.mockResolvedValue(editResult({ issues: [], delta: { systems: added } }));
    await useEditorStore.getState().applyOp({ type: "MoveSystem", id: 1250, x: 0, y: 0 });
    expect(sizeMessages()).toEqual([
      "1,251 systems is well above Huge, the game's largest galaxy (1,000 stars). " +
        "Very large galaxies can make the game slow.",
    ]);
  });

  it("says nothing without game data, and stops once it goes away or comes back without sizes", async () => {
    mocked.openSave.mockResolvedValue(scenarioOf(2000));
    await open(SCENARIO_RESULT.path);
    expect(sizeMessages()).toEqual([]);

    loadHuge();
    expect(sizeMessages()).toHaveLength(1);

    useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
    expect(sizeMessages()).toEqual([]);

    useGameDataStore.setState({
      status: "ready",
      summary: gameDataSummary({ largest_galaxy: null }),
    });
    expect(sizeMessages()).toEqual([]);
  });

  it("holds a save to no galaxy size", async () => {
    loadHuge();
    mocked.openSave.mockResolvedValue({
      ...scenarioOf(2000),
      kind: "save",
      path: OPEN_RESULT.path,
    });
    await open();
    expect(sizeMessages()).toEqual([]);
  });
});

describe("the initializer limit note", () => {
  const limited = () =>
    useIssuesStore.getState().issues.filter((issue) => issue.code === "initializer_over_limit");

  it("names the systems past an initializer's max_instances, and none for unlimited ones", async () => {
    const systems = [
      ...[0, 1, 2].map((id) => systemNode({ id, x: id, initializer: "distar_crystal_system" })),
      ...[3, 4, 5, 6].map((id) => systemNode({ id, x: id, initializer: "basic_init_01" })),
    ];
    mocked.openSave.mockResolvedValue({
      ...SCENARIO_RESULT,
      issues: [],
      galaxy: { ...SCENARIO_RESULT.galaxy, systems },
    });
    await open(SCENARIO_RESULT.path);
    expect(limited()).toEqual([]);

    useGameDataStore.setState({
      initializers: [
        initializerView({ name: "distar_crystal_system", max_instances: 2 }),
        initializerView({ name: "basic_init_01" }),
      ],
    });
    expect(limited()).toEqual([
      {
        severity: "warning",
        code: "initializer_over_limit",
        message: "3 systems use distar_crystal_system, which the game allows 2 times.",
        systems: [0, 1, 2],
        note: true,
      },
    ]);

    mocked.applyOp.mockResolvedValue(
      editResult({ issues: [], delta: { systems: [], removed: [2] } }),
    );
    await useEditorStore.getState().applyOp({ type: "RemoveSystem", id: 2 });
    expect(limited()).toEqual([]);
  });
});
