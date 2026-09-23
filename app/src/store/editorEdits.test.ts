import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CountryNode } from "../generated/CountryNode";
import type { EditResult } from "../generated/EditResult";
import type { Op } from "../generated/Op";
import type { SystemDetails } from "../generated/SystemDetails";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { editor, mocked, openFixtureSave, sessionError } from "./editorFixture";
import { useEditorStore } from "./editorStore";
import { useDetailsStore } from "./detailsStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useInspectorStore } from "./inspectorStore";
import { useIssuesStore } from "./issuesStore";
import { useGalaxyStore } from "./galaxyStore";
import {
  OPEN_RESULT,
  SCENARIO_OWNERS,
  SYSTEMS,
  TERRITORY,
  editResult,
  planetSummary,
  systemDetails,
} from "./fixture";
import { name } from "../test/builders";

beforeEach(openFixtureSave);

describe("editing", () => {
  it("applyOp applies the delta, updates history and dirty, and refreshes the inspected system", async () => {
    await editor().select(0);
    mocked.getSystem.mockClear();

    const moved = { ...SYSTEMS[0], x: -150, y: 60 };
    const result = editResult({ delta: { systems: [moved] } });
    mocked.applyOp.mockResolvedValueOnce(result);

    expect(await editor().applyOp({ type: "MoveSystem", id: 0, x: -150, y: 60 })).toBe(true);

    const node = useGalaxyStore.getState().systems.get(0);
    expect(node?.x).toBe(-150);
    expect(node?.y).toBe(60);

    expect(editor().history).toEqual(result.history);
    expect(editor().history.undo).toHaveLength(1);
    const session = useFileSessionStore.getState();
    expect(session.dirty).toBe(true);
    expect(useIssuesStore.getState().issues).toEqual(result.issues);
    expect(session.error).toBeNull();

    expect(mocked.getSystem).toHaveBeenCalledTimes(1);
    expect(mocked.getSystem).toHaveBeenCalledWith(0);
  });

  it("a delta hands the map a new systems map, so a selector on it re-renders", async () => {
    const before = useGalaxyStore.getState().systems;
    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...SYSTEMS[0], x: 3, y: 3 }] } }),
    );
    await editor().applyOp({ type: "MoveSystem", id: 0, x: 3, y: 3 });
    expect(useGalaxyStore.getState().systems).not.toBe(before);
    expect(before.get(0)).toEqual(SYSTEMS[0]);
  });

  it("applyOp refused sets the error and leaves the galaxy untouched", async () => {
    const before = useGalaxyStore.getState().systems.get(0);
    mocked.applyOp.mockRejectedValueOnce({
      kind: "op",
      message: "systems 0 and 1 are already linked",
    });

    expect(await editor().applyOp({ type: "AddLane", a: 0, b: 1, bridge: false })).toBe(false);
    expect(sessionError()).toBe("systems 0 and 1 are already linked");
    expect(useGalaxyStore.getState().systems.get(0)).toEqual(before);
  });

  it.each([
    ["undo", () => mocked.undo, (): Promise<void> => editor().undo()],
    ["redo", () => mocked.redo, (): Promise<void> => editor().redo()],
  ])("%s resolving null leaves state alone", async (_name, step, run) => {
    const before = editor().history;
    step().mockResolvedValueOnce(null);

    await run();

    expect(editor().history).toEqual(before);
    expect(useGalaxyStore.getState().systems.get(0)).toEqual(SYSTEMS[0]);
  });

  it.each([
    ["undo", () => mocked.undo, (): Promise<void> => editor().undo()],
    ["redo", () => mocked.redo, (): Promise<void> => editor().redo()],
  ])("%s resolving an EditResult applies its delta and clears the error", async (_n, step, run) => {
    useFileSessionStore.getState().setError("stale error");
    const moved = { ...SYSTEMS[0], x: -150, y: 60 };
    const result = editResult({ delta: { systems: [moved] } });
    step().mockResolvedValueOnce(result);

    await run();

    expect(useGalaxyStore.getState().systems.get(0)).toEqual(moved);
    expect(sessionError()).toBeNull();
    expect(editor().history).toEqual(result.history);
    expect(useFileSessionStore.getState().dirty).toBe(result.dirty);
  });

  it("a rejected redo reports the message and leaves the history alone", async () => {
    const before = editor().history;
    mocked.redo.mockRejectedValueOnce({ kind: "op", message: "nothing to redo" });

    await editor().redo();

    expect(sessionError()).toBe("nothing to redo");
    expect(editor().history).toEqual(before);
  });

  it("moveNebula sends MoveNebula for the nebula at its file index and moves the cloud", async () => {
    const moved = { ...OPEN_RESULT.galaxy.nebulae[0], x: -20, y: 30 };
    mocked.applyOp.mockResolvedValueOnce(editResult({ delta: { systems: [], nebulae: [moved] } }));

    await editor().moveNebula(0, -20, 30);

    expect(mocked.applyOp).toHaveBeenCalledWith({ type: "MoveNebula", index: 0, x: -20, y: 30 });
    expect(useGalaxyStore.getState().nebulae[0]).toEqual(moved);
  });

  it("a delta's countries replace the copies the map paints, on an op and on its undo", async () => {
    const empire: CountryNode = {
      id: 0,
      name: name("EMPIRE_Fixture"),
      name_key: "EMPIRE_Fixture",
      country_type: "default",
      capital_system: 0,
      system_count: 1,
      colors: ["red", "purple", "black", "grey", "red", "purple"],
      border_color: null,
      fill_color: null,
      flag_colors: ["red", "purple", "black", "grey", "red", "purple"],
      use_map_color: false,
      flag_icon: null,
      flag_background: null,
    };
    mocked.openSave.mockResolvedValueOnce({
      ...OPEN_RESULT,
      galaxy: { ...OPEN_RESULT.galaxy, countries: [empire] },
    });
    await useFileSessionStore.getState().openSave(OPEN_RESULT.path);
    const chosen: CountryNode = {
      ...empire,
      colors: ["red", "purple", "black", "grey", "intense_red", "light_pink"],
      border_color: "intense_red",
      fill_color: "light_pink",
      flag_colors: ["red", "purple", "black", "grey", "intense_red", "light_pink"],
      use_map_color: true,
    };
    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [], countries: [chosen] } }),
    );

    await editor().applyOp({
      type: "SetEmpireMapColors",
      country: 0,
      colors: { border: "intense_red", fill: "light_pink" },
    });
    expect(useGalaxyStore.getState().countries.get(0)).toEqual(chosen);

    mocked.undo.mockResolvedValueOnce(editResult({ delta: { systems: [], countries: [empire] } }));
    await editor().undo();
    expect(useGalaxyStore.getState().countries.get(0)).toEqual(empire);
  });

  it("stale details stay cached, the projection is warmed again and the system is re-read", async () => {
    useDetailsStore.setState({
      details: new Map([[1, systemDetails({ id: 1 })]]),
      pending: new Set([2]),
    });
    await editor().select(1);
    mocked.getSystem.mockClear();
    mocked.warmDetails.mockClear();
    mocked.applyOp.mockResolvedValueOnce(editResult({ details_stale: [1, 2] }));

    await editor().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 });

    const details = useDetailsStore.getState();
    expect(details.details.has(1)).toBe(true);
    expect(details.pending.has(2)).toBe(false);
    expect(mocked.warmDetails).toHaveBeenCalledTimes(1);
    expect(mocked.getSystem).toHaveBeenCalledWith(1);
  });

  it("a projection rebuild that fails says so on the session, and the edit still stands", async () => {
    mocked.applyOp.mockResolvedValueOnce(editResult({ details_stale: [1] }));
    mocked.warmDetails.mockRejectedValueOnce({ kind: "internal", message: "no projection" });

    expect(await editor().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 })).toBe(true);

    await vi.waitFor(() => expect(sessionError()).toBe("no projection"));
    expect(useFileSessionStore.getState().dirty).toBe(true);
  });

  it("a projection rebuild that fails once the document is gone says nothing", async () => {
    let fail: (e: unknown) => void = () => undefined;
    const warm = new Promise<void>((_warmed, rejected) => {
      fail = rejected;
    });
    mocked.warmDetails.mockReturnValueOnce(warm);
    mocked.applyOp.mockResolvedValueOnce(editResult({ details_stale: [1] }));

    await editor().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 });
    editor().resetSession();
    fail({ kind: "internal", message: "no projection" });
    await warm.catch(() => undefined);

    expect(sessionError()).toBeNull();
  });

  it("re-reads the selected system when the inspector shows a planet of a system gone stale", async () => {
    useDetailsStore.setState({
      details: new Map([
        [7, { ...systemDetails({ id: 7 }), planets: [planetSummary({ id: 42 })] }],
      ]),
    });
    await editor().select(1);
    useInspectorStore.getState().open({ ref: { kind: "planet", id: 42 }, label: "Planet" });
    mocked.getSystem.mockClear();
    mocked.applyOp.mockResolvedValueOnce(editResult({ details_stale: [7] }));

    await editor().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 });

    expect(mocked.getSystem).toHaveBeenCalledWith(1);
  });

  it("leaves the selected system alone when nothing it shows was touched", async () => {
    await editor().select(1);
    useInspectorStore.getState().open({ ref: { kind: "planet", id: 42 }, label: "Planet" });
    mocked.getSystem.mockClear();
    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...SYSTEMS[0], x: 1, y: 1 }] } }),
    );

    await editor().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 });

    expect(mocked.getSystem).not.toHaveBeenCalled();
  });

  it("applies deltas in the order the ops were sent when their results arrive out of order", async () => {
    let finishFirst!: (result: EditResult) => void;
    mocked.applyOp.mockReturnValueOnce(new Promise<EditResult>((r) => (finishFirst = r)));
    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...SYSTEMS[0], x: 20, y: 20 }] } }),
    );

    const first = editor().applyOp({ type: "MoveSystem", id: 0, x: 10, y: 10 });
    const second = editor().applyOp({ type: "MoveSystem", id: 0, x: 20, y: 20 });
    await vi.waitFor(() => expect(mocked.applyOp).toHaveBeenCalledTimes(1));

    finishFirst(editResult({ delta: { systems: [{ ...SYSTEMS[0], x: 10, y: 10 }] } }));
    expect(await first).toBe(true);
    expect(await second).toBe(true);

    expect(useGalaxyStore.getState().systems.get(0)).toMatchObject({ x: 20, y: 20 });
  });
});

describe("history navigation", () => {
  const entries = [1, 2, 3].map((seq) => ({
    seq,
    description: `Change ${seq}`,
  }));
  const at = (applied: number) =>
    editResult({ history: { undo: entries.slice(0, applied), redo: entries.slice(applied) } });

  beforeEach(() => {
    mocked.undo.mockImplementation(async () => {
      const applied = editor().history.undo.length;
      return applied === 0 ? null : at(applied - 1);
    });
    mocked.redo.mockImplementation(async () => {
      const applied = editor().history.undo.length;
      return applied === entries.length ? null : at(applied + 1);
    });
    useEditorStore.setState({ history: at(3).history });
  });

  it("undoTo undoes until the entry is the last applied and redoTo redoes forward to it", async () => {
    await editor().undoTo(1);
    expect(mocked.undo).toHaveBeenCalledTimes(2);
    expect(editor().history.undo.map((e) => e.seq)).toEqual([1]);
    expect(editor().history.redo.map((e) => e.seq)).toEqual([2, 3]);

    await editor().redoTo(3);
    expect(mocked.redo).toHaveBeenCalledTimes(2);
    expect(editor().history.undo.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("clicking the current entry does nothing, and a failing step stops the loop", async () => {
    await editor().undoTo(3);
    expect(mocked.undo).not.toHaveBeenCalled();

    mocked.undo.mockRejectedValue({ kind: "op", message: "broken" });
    await editor().undoTo(1);
    expect(mocked.undo).toHaveBeenCalledTimes(1);
    expect(sessionError()).toBe("broken");
    expect(editor().history.undo).toHaveLength(3);
  });
});

describe("the systems the core reports stale", () => {
  /** What an edit comes back with: the system restated, the initializer it already had. */
  function restated(initializer: string): EditResult {
    const system = SYSTEMS.find((s) => s.id === 1)!;
    return editResult({
      delta: { systems: [{ ...system, initializer, spawn_weight: 1 }] },
      details_stale: [1],
    });
  }

  /** The details the edit left cached, once it has run; the id is asked for again. */
  async function edit(result: EditResult, op: Op): Promise<SystemDetails | undefined> {
    await editor().select(1);
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: 1 }, label: "Alpha" });
    const cached = systemDetails({ id: 1 });
    useDetailsStore.setState({ details: new Map([[1, cached]]) });
    mocked.getSystemDetails.mockResolvedValue([]);
    mocked.applyOp.mockResolvedValueOnce(result);
    await editor().applyOp(op);
    useDetailsStore.getState().request([1]);
    return useDetailsStore.getState().details.get(1);
  }

  it("re-reads the contents of a system the initializer moved under", async () => {
    const kept = await edit(restated("guardian_dragon"), {
      type: "SetInitializer",
      id: 1,
      initializer: "guardian_dragon",
    });

    // The contents the inspector is showing stay until the re-read answers.
    expect(kept).toBeDefined();
    expect(useDetailsStore.getState().pending.has(1)).toBe(true);
  });

  it("takes the list as given, even where the initializer it restated has not moved", async () => {
    const kept = await edit(restated("basic_init_01"), {
      type: "SetSpawnWeight",
      id: 1,
      base: 1,
    });

    expect(kept).toBeDefined();
    expect(useDetailsStore.getState().pending.has(1)).toBe(true);
  });
});

describe("re-classifying after an edit", () => {
  it("re-reads the special systems when the edit says it reclassifies", async () => {
    mocked.applyOp.mockResolvedValueOnce(editResult({ reclassifies: true }));
    mocked.getSpecialSystems.mockClear();

    await editor().applyOp({ type: "SetInitializer", id: 0, initializer: "guardian_dragon" });

    expect(mocked.getSpecialSystems).toHaveBeenCalledTimes(1);
  });

  it("re-reads the scripted owners too, so a new initializer redraws its territory", async () => {
    mocked.getScenarioOwners.mockResolvedValue(SCENARIO_OWNERS);
    mocked.applyOp.mockResolvedValueOnce(editResult({ reclassifies: true }));
    mocked.getScenarioOwners.mockClear();

    await editor().applyOp({
      type: "SetInitializer",
      id: 0,
      initializer: "empire_capital_init",
    });

    expect(mocked.getScenarioOwners).toHaveBeenCalledTimes(1);
    expect(useGalaxyStore.getState().systems.get(1)?.owner).toBe(TERRITORY.id);
  });

  it("leaves them alone after an edit that says it does not", async () => {
    mocked.applyOp.mockResolvedValueOnce(editResult({}));
    mocked.getSpecialSystems.mockClear();
    mocked.getScenarioOwners.mockClear();

    await editor().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 2 });

    expect(mocked.getSpecialSystems).not.toHaveBeenCalled();
    expect(mocked.getScenarioOwners).not.toHaveBeenCalled();
  });

  it("leaves them alone when the op is refused", async () => {
    mocked.applyOp.mockRejectedValueOnce({ kind: "op", message: "no" });
    mocked.getSpecialSystems.mockClear();

    expect(await editor().applyOp({ type: "RemoveSystem", id: 5 })).toBe(false);

    expect(mocked.getSpecialSystems).not.toHaveBeenCalled();
  });

  it("undoing an initializer edit re-classifies too", async () => {
    mocked.applyOp.mockResolvedValueOnce(editResult({ reclassifies: true }));
    await editor().applyOp({ type: "SetInitializer", id: 0, initializer: "guardian_dragon" });
    mocked.getSpecialSystems.mockClear();
    mocked.undo.mockResolvedValueOnce(editResult({ reclassifies: true }));

    await editor().undo();

    expect(mocked.getSpecialSystems).toHaveBeenCalledTimes(1);
  });

  it("a run of edits re-classifies once, and the edit behind them does not wait for it", async () => {
    await vi.waitFor(() => expect(mocked.getSpecialSystems).toHaveBeenCalledTimes(2));
    mocked.getSpecialSystems.mockClear();
    let release = (): void => undefined;
    const reading = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocked.getSpecialSystems.mockImplementationOnce(async () => {
      await reading;
      return { systems: [], counts: [], with_game_data: false };
    });
    const reclassifying = editResult({ reclassifies: true });
    mocked.applyOp
      .mockResolvedValueOnce(reclassifying)
      .mockResolvedValueOnce(reclassifying)
      .mockResolvedValueOnce(reclassifying);

    const run = [0, 1, 2].map((id) =>
      editor().applyOp({ type: "SetInitializer", id, initializer: "guardian_dragon" }),
    );
    await vi.waitFor(() => expect(mocked.getSpecialSystems).toHaveBeenCalledTimes(1));

    mocked.applyOp.mockResolvedValueOnce(editResult({}));
    expect(await editor().applyOp({ type: "MoveSystem", id: 0, x: 9, y: 9 })).toBe(true);

    release();
    await Promise.all(run);
    expect(mocked.getSpecialSystems).toHaveBeenCalledTimes(1);
  });
});
