import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CountryNode } from "../generated/CountryNode";
import type { EditResult } from "../generated/EditResult";
import type { SearchHit } from "../generated/SearchHit";
import type { SystemNode } from "../generated/SystemNode";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import {
  addedNode,
  editor,
  openFixtureSave,
  sessionError,
  withAddedSystems,
} from "./editorFixture";
import { useEditorStore } from "./editorStore";
import { useWatchlistStore } from "./watchlistStore";
import { useDetailsStore } from "./detailsStore";
import { useFileSessionStore } from "./fileSessionStore";
import { GALAXY_ENTRY, useInspectorStore } from "./inspectorStore";
import { useIssuesStore } from "./issuesStore";
import { useGalaxyStore } from "./galaxyStore";
import {
  OPEN_RESULT,
  SCENARIO_OWNERS,
  SYSTEMS,
  TERRITORY,
  editResult,
  historyEntry,
  planetSummary,
  systemDetails,
} from "./fixture";
import { name } from "../test/builders";
import { mockedIpc } from "../test/ipc";

beforeEach(openFixtureSave);

describe("editing", () => {
  it("applyOp applies the delta, updates history and dirty, and refreshes the inspected system", async () => {
    await editor().select(0);
    mockedIpc.getSystem.mockClear();

    const moved = { ...SYSTEMS[0], x: -150, y: 60 };
    const result = editResult({ delta: { systems: [moved] } });
    mockedIpc.applyOp.mockResolvedValueOnce(result);

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

    expect(mockedIpc.getSystem).toHaveBeenCalledTimes(1);
    expect(mockedIpc.getSystem).toHaveBeenCalledWith(0);
  });

  it("a delta hands the map a new systems map, so a selector on it re-renders", async () => {
    const before = useGalaxyStore.getState().systems;
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...SYSTEMS[0], x: 3, y: 3 }] } }),
    );
    await editor().applyOp({ type: "MoveSystem", id: 0, x: 3, y: 3 });
    expect(useGalaxyStore.getState().systems).not.toBe(before);
    expect(before.get(0)).toEqual(SYSTEMS[0]);
  });

  it("applyOp refused sets the error and leaves the galaxy untouched", async () => {
    const before = useGalaxyStore.getState().systems.get(0);
    mockedIpc.applyOp.mockRejectedValueOnce({
      kind: "op",
      message: "systems 0 and 1 are already linked",
    });

    expect(await editor().applyOp({ type: "AddLane", a: 0, b: 1, bridge: false })).toBe(false);
    expect(sessionError()).toBe("systems 0 and 1 are already linked");
    expect(useGalaxyStore.getState().systems.get(0)).toEqual(before);
  });

  it.each([
    ["undo", () => mockedIpc.undo, (): Promise<void> => editor().undo()],
    ["redo", () => mockedIpc.redo, (): Promise<void> => editor().redo()],
  ])("%s resolving null leaves state alone", async (_name, step, run) => {
    const before = editor().history;
    step().mockResolvedValueOnce(null);

    await run();

    expect(editor().history).toEqual(before);
    expect(useGalaxyStore.getState().systems.get(0)).toEqual(SYSTEMS[0]);
  });

  it.each([
    ["undo", () => mockedIpc.undo, (): Promise<void> => editor().undo()],
    ["redo", () => mockedIpc.redo, (): Promise<void> => editor().redo()],
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
    mockedIpc.redo.mockRejectedValueOnce({ kind: "op", message: "nothing to redo" });

    await editor().redo();

    expect(sessionError()).toBe("nothing to redo");
    expect(editor().history).toEqual(before);
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
      use_map_color: false,
      flag_icon: null,
      flag_background: null,
    };
    mockedIpc.openSave.mockResolvedValueOnce({
      ...OPEN_RESULT,
      galaxy: { ...OPEN_RESULT.galaxy, countries: [empire] },
    });
    await useFileSessionStore.getState().openSave(OPEN_RESULT.path);
    const chosen: CountryNode = {
      ...empire,
      colors: ["red", "purple", "black", "grey", "intense_red", "light_pink"],
      border_color: "intense_red",
      fill_color: "light_pink",
      use_map_color: true,
    };
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [], countries: [chosen] } }),
    );

    await editor().applyOp({
      type: "SetEmpireMapColors",
      country: 0,
      colors: { border: "intense_red", fill: "light_pink" },
    });
    expect(useGalaxyStore.getState().countries.get(0)).toEqual(chosen);

    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ delta: { systems: [], countries: [empire] } }),
    );
    await editor().undo();
    expect(useGalaxyStore.getState().countries.get(0)).toEqual(empire);
  });

  it("stale details stay cached, the projection is warmed again and the system is re-read", async () => {
    useDetailsStore.setState({
      details: new Map([[1, systemDetails({ id: 1 })]]),
      pending: new Set([2]),
    });
    await editor().select(1);
    mockedIpc.getSystem.mockClear();
    mockedIpc.warmDetails.mockClear();
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [1, 2] }));

    await editor().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 });

    const details = useDetailsStore.getState();
    expect(details.details.has(1)).toBe(true);
    expect(details.pending.has(2)).toBe(false);
    expect(mockedIpc.warmDetails).toHaveBeenCalledTimes(1);
    expect(mockedIpc.getSystem).toHaveBeenCalledWith(1);
  });

  it("a projection rebuild that fails says so on the session, and the edit still stands", async () => {
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [1] }));
    mockedIpc.warmDetails.mockRejectedValueOnce({ kind: "internal", message: "no projection" });

    expect(await editor().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 })).toBe(true);

    await vi.waitFor(() => expect(sessionError()).toBe("no projection"));
    expect(useFileSessionStore.getState().dirty).toBe(true);
  });

  it("a projection rebuild that fails once the document is gone says nothing", async () => {
    let fail: (e: unknown) => void = () => undefined;
    const warm = new Promise<void>((_warmed, rejected) => {
      fail = rejected;
    });
    mockedIpc.warmDetails.mockReturnValueOnce(warm);
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [1] }));

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
    mockedIpc.getSystem.mockClear();
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [7] }));

    await editor().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 });

    expect(mockedIpc.getSystem).toHaveBeenCalledWith(1);
  });

  it("leaves the selected system alone when nothing it shows was touched", async () => {
    await editor().select(1);
    useInspectorStore.getState().open({ ref: { kind: "planet", id: 42 }, label: "Planet" });
    mockedIpc.getSystem.mockClear();
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...SYSTEMS[0], x: 1, y: 1 }] } }),
    );

    await editor().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 });

    expect(mockedIpc.getSystem).not.toHaveBeenCalled();
  });

  it("applies deltas in the order the ops were sent when their results arrive out of order", async () => {
    let finishFirst!: (result: EditResult) => void;
    mockedIpc.applyOp.mockReturnValueOnce(new Promise<EditResult>((r) => (finishFirst = r)));
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...SYSTEMS[0], x: 20, y: 20 }] } }),
    );

    const first = editor().applyOp({ type: "MoveSystem", id: 0, x: 10, y: 10 });
    const second = editor().applyOp({ type: "MoveSystem", id: 0, x: 20, y: 20 });
    await vi.waitFor(() => expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1));

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

  beforeEach(async () => {
    mockedIpc.undo.mockImplementation(async () => {
      const applied = editor().history.undo.length;
      return applied === 0 ? null : at(applied - 1);
    });
    mockedIpc.redo.mockImplementation(async () => {
      const applied = editor().history.undo.length;
      return applied === entries.length ? null : at(applied + 1);
    });
    mockedIpc.applyOp.mockResolvedValueOnce(at(3));
    await editor().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 });
  });

  it("undoTo undoes until the entry is the last applied and redoTo redoes forward to it", async () => {
    await editor().undoTo(1);
    expect(mockedIpc.undo).toHaveBeenCalledTimes(2);
    expect(editor().history.undo.map((e) => e.seq)).toEqual([1]);
    expect(editor().history.redo.map((e) => e.seq)).toEqual([2, 3]);

    await editor().redoTo(3);
    expect(mockedIpc.redo).toHaveBeenCalledTimes(2);
    expect(editor().history.undo.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("clicking the current entry does nothing, and a failing step stops the loop", async () => {
    await editor().undoTo(3);
    expect(mockedIpc.undo).not.toHaveBeenCalled();

    mockedIpc.undo.mockRejectedValue({ kind: "op", message: "broken" });
    await editor().undoTo(1);
    expect(mockedIpc.undo).toHaveBeenCalledTimes(1);
    expect(sessionError()).toBe("broken");
    expect(editor().history.undo).toHaveLength(3);
  });
});

describe("the systems the core reports stale", () => {
  it("re-reads the contents of every system the core lists, keeping what is shown until it answers", async () => {
    await editor().select(1);
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: 1 }, label: "Alpha" });
    useDetailsStore.setState({ details: new Map([[1, systemDetails({ id: 1 })]]) });
    mockedIpc.getSystemDetails.mockResolvedValue([]);
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [1] }));

    await editor().applyOp({ type: "SetInitializer", id: 1, initializer: "guardian_dragon" });
    useDetailsStore.getState().request([1]);

    expect(useDetailsStore.getState().details.get(1)).toBeDefined();
    expect(useDetailsStore.getState().pending.has(1)).toBe(true);
  });
});

describe("re-classifying after an edit", () => {
  it("re-reads the special systems when the edit says it reclassifies", async () => {
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ reclassifies: true }));
    mockedIpc.getSpecialSystems.mockClear();

    await editor().applyOp({ type: "SetInitializer", id: 0, initializer: "guardian_dragon" });

    expect(mockedIpc.getSpecialSystems).toHaveBeenCalledTimes(1);
  });

  it("re-reads the scripted owners too, so a new initializer redraws its territory", async () => {
    mockedIpc.getScenarioOwners.mockResolvedValue(SCENARIO_OWNERS);
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ reclassifies: true }));
    mockedIpc.getScenarioOwners.mockClear();

    await editor().applyOp({
      type: "SetInitializer",
      id: 0,
      initializer: "empire_capital_init",
    });

    expect(mockedIpc.getScenarioOwners).toHaveBeenCalledTimes(1);
    expect(useGalaxyStore.getState().systems.get(1)?.owner).toBe(TERRITORY.id);
  });

  it("leaves them alone after an edit that says it does not", async () => {
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({}));
    mockedIpc.getSpecialSystems.mockClear();
    mockedIpc.getScenarioOwners.mockClear();

    await editor().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 2 });

    expect(mockedIpc.getSpecialSystems).not.toHaveBeenCalled();
    expect(mockedIpc.getScenarioOwners).not.toHaveBeenCalled();
  });

  it("leaves them alone when the op is refused", async () => {
    mockedIpc.applyOp.mockRejectedValueOnce({ kind: "op", message: "no" });
    mockedIpc.getSpecialSystems.mockClear();

    expect(await editor().applyOp({ type: "RemoveSystem", id: 5 })).toBe(false);

    expect(mockedIpc.getSpecialSystems).not.toHaveBeenCalled();
  });

  it("undoing an initializer edit re-classifies too", async () => {
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ reclassifies: true }));
    await editor().applyOp({ type: "SetInitializer", id: 0, initializer: "guardian_dragon" });
    mockedIpc.getSpecialSystems.mockClear();
    mockedIpc.undo.mockResolvedValueOnce(editResult({ reclassifies: true }));

    await editor().undo();

    expect(mockedIpc.getSpecialSystems).toHaveBeenCalledTimes(1);
  });

  it("a run of edits re-classifies once, and the edit behind them does not wait for it", async () => {
    await vi.waitFor(() => expect(mockedIpc.getSpecialSystems).toHaveBeenCalledTimes(2));
    mockedIpc.getSpecialSystems.mockClear();
    let release = (): void => undefined;
    const reading = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockedIpc.getSpecialSystems.mockImplementationOnce(async () => {
      await reading;
      return { systems: [], counts: [], with_game_data: false };
    });
    const reclassifying = editResult({ reclassifies: true });
    mockedIpc.applyOp
      .mockResolvedValueOnce(reclassifying)
      .mockResolvedValueOnce(reclassifying)
      .mockResolvedValueOnce(reclassifying);

    const run = [0, 1, 2].map((id) =>
      editor().applyOp({ type: "SetInitializer", id, initializer: "guardian_dragon" }),
    );
    await vi.waitFor(() => expect(mockedIpc.getSpecialSystems).toHaveBeenCalledTimes(1));

    mockedIpc.applyOp.mockResolvedValueOnce(editResult({}));
    expect(await editor().applyOp({ type: "MoveSystem", id: 0, x: 9, y: 9 })).toBe(true);

    release();
    await Promise.all(run);
    expect(mockedIpc.getSpecialSystems).toHaveBeenCalledTimes(1);
  });
});

describe("following a delete that renumbers", () => {
  /** Removing 6 moves 7 down to 6, as the core reports it. */
  function removeSix(seven: SystemNode) {
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({
        entry: historyEntry(3, "Removed Added 6 (#6); renumbered 7 to 6"),
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

  it("moves the selection, the pages and the pinned searches to the new id", async () => {
    const [, seven] = withAddedSystems();
    await editor().select(7);
    const inspector = useInspectorStore.getState();
    inspector.setRoot({ ref: { kind: "system", id: 7 }, label: "Added 7" });
    inspector.open({ ref: { kind: "planet", id: 70 }, label: "Added 7 I" });
    useWatchlistStore.setState({ results: new Map([["added", [7, 3]]]) });

    await removeSix(seven);

    expect(editor().selection).toEqual([6]);
    expect(useInspectorStore.getState().stack.map((e) => e.ref)).toEqual([
      { kind: "system", id: 6 },
      { kind: "planet", id: 70 },
    ]);
    expect(useWatchlistStore.getState().results.get("added")).toEqual([6, 3]);
    expect(editor().inspected?.system.id).toBe(6);
  });

  it("closes the page of the system it removed and clears the selection", async () => {
    const [, seven] = withAddedSystems();
    await editor().select(6);
    const inspector = useInspectorStore.getState();
    inspector.setRoot({ ref: { kind: "system", id: 6 }, label: "Added 6" });
    inspector.open({ ref: { kind: "planet", id: 60 }, label: "Added 6 I" });
    useWatchlistStore.setState({ results: new Map([["added", [6, 3]]]) });

    await removeSix(seven);

    expect(editor().selection).toEqual([]);
    expect(editor().inspected).toBeNull();
    expect(useInspectorStore.getState().stack).toEqual([GALAXY_ENTRY]);
    expect(useWatchlistStore.getState().results.get("added")).toEqual([3]);
  });

  it("clears the hover and moves a selected lane", async () => {
    const [, seven] = withAddedSystems();
    const sirius = useGalaxyStore.getState().systems.get(3)!;
    const lane = { length: 20, bridge: false, stale: false };
    useGalaxyStore.getState().applyDelta({
      systems: [
        { ...seven, lanes: [{ to: 3, ...lane }] },
        { ...sirius, lanes: [...sirius.lanes, { to: 7, ...lane }] },
      ],
    });
    editor().setHover(7);
    editor().selectLane({ a: 3, b: 7 });
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({
        delta: {
          systems: [
            { ...seven, id: 6, lanes: [{ to: 3, ...lane }] },
            { ...sirius, lanes: [...sirius.lanes, { to: 6, ...lane }] },
          ],
          removed: [7],
          renumbered: [
            [6, null],
            [7, 6],
          ],
        },
      }),
    );

    await editor().applyOp({ type: "RemoveSystem", id: 6 });

    expect(editor().hover).toBeNull();
    expect(editor().selectedLane).toEqual({ a: 3, b: 6 });
  });

  it("moves the search rings and the recent hits, dropping what was in the removed system", async () => {
    const [, seven] = withAddedSystems();
    useEditorStore.setState({
      searchRings: [7, 3, 6],
      recentHits: [hit("system", 7, 7), hit("planet", 60, 6), hit("system", 3, 3)],
    });

    await removeSix(seven);

    expect(editor().searchRings).toEqual([6, 3]);
    expect(editor().recentHits.map((h) => [h.kind, h.id, h.system_id])).toEqual([
      ["system", 6, 6],
      ["system", 3, 3],
    ]);
  });

  it("closes a page on a planet of the removed system, wherever it was opened from", async () => {
    const [, seven] = withAddedSystems();
    useDetailsStore.setState({
      details: new Map([[6, systemDetails({ id: 6, planets: [planetSummary({ id: 60 })] })]]),
    });
    const inspector = useInspectorStore.getState();
    inspector.openPage({ ref: { kind: "planet", id: 60 }, label: "Added 6 I" });
    inspector.open({ ref: { kind: "deposit", id: 600 }, label: "Minerals" });

    await removeSix(seven);

    expect(useInspectorStore.getState().stack).toEqual([GALAXY_ENTRY]);
  });
});

describe("history steps that bring an added system back", () => {
  it("an undone delete selects the system again and moves the later one back up", async () => {
    const [six, seven] = withAddedSystems();
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
    await editor().applyOp({ type: "RemoveSystem", id: 6 });
    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ delta: { systems: [six, seven], renumbered: [[6, 7]] } }),
    );

    await editor().undo();

    await vi.waitFor(() => expect(editor().inspected?.system).toEqual(six));
    expect(editor().selection).toEqual([6]);
    expect(useGalaxyStore.getState().systems.get(7)).toEqual(seven);
  });

  it("a redone add selects the system again", async () => {
    withAddedSystems();
    const eight = addedNode(8, 30, -30);
    mockedIpc.redo.mockResolvedValueOnce(editResult({ delta: { systems: [eight] } }));

    await editor().redo();

    await vi.waitFor(() => expect(editor().inspected?.system.id).toBe(8));
    expect(editor().selection).toEqual([8]);
  });

  it("an undone reroll leaves the selection where it was", async () => {
    const [six] = withAddedSystems();
    await editor().select(7);
    mockedIpc.undo.mockResolvedValueOnce(editResult({ delta: { systems: [six] } }));

    await editor().undo();

    expect(editor().selection).toEqual([7]);
  });
});

function hit(kind: "system" | "planet", id: number, system: number): SearchHit {
  return {
    kind,
    id,
    name: name(`NAME_${id}`),
    name_key: `NAME_${id}`,
    system_id: system,
    owner: null,
    country_type: null,
    system_count: null,
    planet_class: null,
    position: [0, 0],
    matched_on: null,
  };
}
