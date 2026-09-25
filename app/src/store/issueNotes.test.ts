import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import type { PaintSpawnKind } from "../generated/PaintSpawnKind";
import type { SystemNode } from "../generated/SystemNode";
import { paintModView } from "../test/builders";
import { useEditorStore } from "./editorStore";
import {
  OPEN_RESULT,
  SCENARIO_RESULT,
  SYSTEMS,
  editResult,
  gameDataSummary,
  initializerView,
  saveResult,
  systemNode,
} from "./fixture";
import { useGalaxyStore } from "./galaxyStore";
import { loadGameData } from "./gameDataFixture";
import { useGameDataStore } from "./gameDataStore";
import { useIssuesStore } from "./issuesStore";
import { resetSession, session, withPaintMod } from "./sessionFixture";
import { mockedIpc } from "../test/ipc";

const SCENARIO_PATH = SCENARIO_RESULT.path;
const PAINT_DIR = "C:/mods/pag/map/setup_scenarios";

/** A scenario of `count` systems, ids from 0. */
function scenarioOf(count: number): typeof SCENARIO_RESULT {
  const systems = Array.from({ length: count }, (_, id) => systemNode({ id, x: id, y: 0 }));
  return { ...SCENARIO_RESULT, issues: [], galaxy: { ...SCENARIO_RESULT.galaxy, systems } };
}

/** Game data whose largest galaxy size is Huge at 1,000 stars. */
const loadHuge = () =>
  loadGameData(
    gameDataSummary({ largest_galaxy: { name: "huge", label: "Huge", num_stars: 1000 } }),
  );

const sizeMessages = () =>
  useIssuesStore
    .getState()
    .issues.filter((issue) => issue.code === "galaxy_size_exceeded")
    .map((issue) => issue.message);

beforeEach(() => {
  resetSession();
  mockedIpc.getScenarioBypasses.mockResolvedValue(null);
  mockedIpc.getNames.mockResolvedValue({});
  mockedIpc.resolveNames.mockResolvedValue([]);
});

describe("scenario names the mod's folder already lists", () => {
  it("notes every other file in the mod's folder that lists the same name, on open and again on save", async () => {
    await withPaintMod(paintModView({ scenarios_dir: PAINT_DIR }));
    const mine = `${PAINT_DIR}/my_galaxy.txt`;
    mockedIpc.openSave.mockResolvedValueOnce({
      ...SCENARIO_RESULT,
      path: mine,
      galaxy: {
        ...SCENARIO_RESULT.galaxy,
        header: [{ key: "name", value: '"Elysium"', line: 1 }],
      },
    });
    mockedIpc.siblingScenarioNames.mockResolvedValueOnce([
      ["other.txt", "Elysium"],
      ["third.txt", "Arcadia"],
    ]);
    await session().requestOpen(mine, { listings: null });
    await vi.waitFor(() => expect(useIssuesStore.getState().issues).toHaveLength(2));
    expect(mockedIpc.siblingScenarioNames).toHaveBeenCalledWith(mine);
    expect(useIssuesStore.getState().issues[1]).toEqual({
      severity: "warning",
      code: "scenario_name_duplicate",
      message:
        'Another file in the mod lists the same name "Elysium": other.txt. ' +
        "The game shows one size per name.",
      systems: [],
      note: true,
    });
    expect(useIssuesStore.getState().notes).toEqual([useIssuesStore.getState().issues[1]]);

    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ issues: [] }));
    await useEditorStore.getState().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 });
    expect(useIssuesStore.getState().issues.map((issue) => issue.code)).toEqual([
      "scenario_name_duplicate",
    ]);

    mockedIpc.save.mockResolvedValueOnce(saveResult({ path: mine, dirty: false }));
    mockedIpc.siblingScenarioNames.mockResolvedValueOnce([["other.txt", "Renamed"]]);
    await session().save();
    await vi.waitFor(() => expect(useIssuesStore.getState().issues).toEqual([]));
    expect(useIssuesStore.getState().notes).toEqual([]);
  });
  it("notes nothing for a scenario outside the mod's folder, or when the folder cannot be read", async () => {
    await withPaintMod(paintModView({ scenarios_dir: PAINT_DIR }));
    mockedIpc.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_PATH, { listings: null });
    expect(mockedIpc.siblingScenarioNames).not.toHaveBeenCalled();

    const mine = `${PAINT_DIR}/my_galaxy.txt`;
    mockedIpc.openSave.mockResolvedValueOnce({
      ...SCENARIO_RESULT,
      path: mine,
      galaxy: {
        ...SCENARIO_RESULT.galaxy,
        header: [{ key: "name", value: '"Elysium"', line: 1 }],
      },
    });
    mockedIpc.siblingScenarioNames.mockRejectedValueOnce(new Error("unreadable"));
    await session().requestOpen(mine, { listings: null });
    await vi.waitFor(() => expect(mockedIpc.siblingScenarioNames).toHaveBeenCalledWith(mine));
    expect(useIssuesStore.getState().issues.map((issue) => issue.code)).toEqual([
      "system_isolated",
    ]);
    expect(session().error).toBeNull();
  });
});

describe("reserved seats", () => {
  it("notes the reserved seats while the launcher says the Reserved Spawns submod is not enabled", async () => {
    const seated = (kind: PaintSpawnKind): SystemNode => ({
      ...SYSTEMS[2],
      spawn_script: { paint_a_galaxy: { kind, random_value: 2, player: false } },
    });
    const codes = () => useIssuesStore.getState().issues.map((issue) => issue.code);
    const mod = (reserved_spawns: boolean) =>
      paintModView({ scenarios_dir: PAINT_DIR, reserved_spawns });
    mockedIpc.openSave.mockResolvedValueOnce({
      ...SCENARIO_RESULT,
      painted: true,
      galaxy: {
        ...SCENARIO_RESULT.galaxy,
        systems: SYSTEMS.map((s) => (s.id === 2 ? seated({ reserved: "a" }) : s)),
      },
    });
    await session().requestOpen(SCENARIO_PATH, { listings: null });
    expect(codes()).toEqual(["system_isolated"]);

    await withPaintMod(mod(false));
    expect(useIssuesStore.getState().issues[1]).toEqual({
      severity: "warning",
      code: "reserved_spawns_missing",
      message:
        "Reserved seats need the Reserved Spawns submod, which is not enabled. Subscribe to it " +
        "and enable it in your playset, or these seats spawn at random.",
      systems: [2],
      note: true,
    });
    expect(useIssuesStore.getState().notes).toEqual([useIssuesStore.getState().issues[1]]);

    await withPaintMod(mod(true));
    expect(codes()).toEqual(["system_isolated"]);
    expect(useIssuesStore.getState().notes).toEqual([]);

    await withPaintMod(null);
    expect(codes()).toEqual(["system_isolated", "reserved_spawns_missing"]);

    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ delta: { systems: [seated("sol")] } }));
    await useEditorStore.getState().applyOp({ type: "SetSpawnScript", id: 2, script: null });
    expect(codes()).toEqual(["system_isolated"]);

    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [seated({ reserved: "b" })] } }),
    );
    await useEditorStore.getState().applyOp({ type: "SetSpawnScript", id: 2, script: null });
    expect(codes()).toEqual(["system_isolated", "reserved_spawns_missing"]);

    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [seated("enabled")] } }),
    );
    await useEditorStore.getState().applyOp({ type: "SetSpawnScript", id: 2, script: null });
    expect(codes()).toEqual(["system_isolated"]);
  });
});

describe("the galaxy size note", () => {
  it("warns when a scenario has well over the largest galaxy size's stars, as systems come and go", async () => {
    await loadHuge();
    mockedIpc.openSave.mockResolvedValue(scenarioOf(1300));
    await session().openSave(SCENARIO_RESULT.path);
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
    mockedIpc.applyOp.mockResolvedValue(
      editResult({ issues: [], delta: { systems: [], removed } }),
    );
    await useEditorStore.getState().applyOp({ type: "RemoveSystem", id: 1250 });
    expect(useGalaxyStore.getState().systems.size).toBe(1250);
    expect(sizeMessages()).toEqual([]);

    const added = [systemNode({ id: 1250 })];
    mockedIpc.applyOp.mockResolvedValue(editResult({ issues: [], delta: { systems: added } }));
    await useEditorStore.getState().applyOp({ type: "MoveSystem", id: 1250, x: 0, y: 0 });
    expect(sizeMessages()).toEqual([
      "1,251 systems is well above Huge, the game's largest galaxy (1,000 stars). " +
        "Very large galaxies can make the game slow.",
    ]);
  });
  it("says nothing without game data, and stops once it goes away or comes back without sizes", async () => {
    mockedIpc.openSave.mockResolvedValue(scenarioOf(2000));
    await session().openSave(SCENARIO_RESULT.path);
    expect(sizeMessages()).toEqual([]);

    await loadHuge();
    expect(sizeMessages()).toHaveLength(1);

    await useGameDataStore.getState().unload();
    expect(sizeMessages()).toEqual([]);

    await loadGameData(gameDataSummary({ largest_galaxy: null }));
    expect(sizeMessages()).toEqual([]);
  });
  it("holds a save to no galaxy size", async () => {
    await loadHuge();
    mockedIpc.openSave.mockResolvedValue({
      ...scenarioOf(2000),
      kind: "save",
      path: OPEN_RESULT.path,
    });
    await session().openSave(OPEN_RESULT.path);
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
    mockedIpc.openSave.mockResolvedValue({
      ...SCENARIO_RESULT,
      issues: [],
      galaxy: { ...SCENARIO_RESULT.galaxy, systems },
    });
    await session().openSave(SCENARIO_RESULT.path);
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

    mockedIpc.applyOp.mockResolvedValue(
      editResult({ issues: [], delta: { systems: [], removed: [2] } }),
    );
    await useEditorStore.getState().applyOp({ type: "RemoveSystem", id: 2 });
    expect(limited()).toEqual([]);
  });
});
