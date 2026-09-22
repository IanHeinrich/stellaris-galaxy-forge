import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditResult } from "../generated/EditResult";
import type { Op } from "../generated/Op";
import type { SearchHit } from "../generated/SearchHit";
import type { SystemDetails } from "../generated/SystemDetails";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { editor, mocked, openFixtureSave, sessionError } from "./editorFixture";
import { RECENT_HITS, useEditorStore } from "./editorStore";
import { useDetailsStore } from "./detailsStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useInspectorStore } from "./inspectorStore";
import { useIssuesStore } from "./issuesStore";
import { useLayoutStore } from "./layoutStore";
import { useGalaxyStore } from "./galaxyStore";
import {
  OPEN_RESULT,
  SCENARIO_OWNERS,
  SYSTEMS,
  TERRITORY,
  editResult,
  planetSummary,
  systemDetails,
  withLaneLength,
} from "./fixture";

beforeEach(openFixtureSave);

describe("selection and navigation", () => {
  it("select fetches the inspected system and select(null) clears it", async () => {
    await editor().select(1);
    let state = editor();
    expect(state.selection).toEqual([1]);
    expect(state.inspected?.system.name.key).toBe("NAME_Alpha_Centauri");
    expect(state.inspected?.neighbours.map((n) => n.id)).toEqual([0, 2, 3, 4]);
    expect(mocked.getSystem).toHaveBeenCalledWith(1);

    await editor().select(null);
    state = editor();
    expect(state.selection).toEqual([]);
    expect(state.inspected).toBeNull();
  });

  it("select of an unknown id clears the selection and records the error", async () => {
    await editor().select(99);
    expect(editor().selection).toEqual([]);
    expect(editor().inspected).toBeNull();
    expect(sessionError()).toBe("no system 99");
  });

  it("jumpTo selects and sets a focus with an increasing nonce", async () => {
    await editor().jumpTo(3);
    const first = editor().focus!;
    expect(first.id).toBe(3);
    expect(editor().selection).toEqual([3]);

    await editor().jumpTo(3);
    const second = editor().focus!;
    expect(second.id).toBe(3);
    expect(second.nonce).toBeGreaterThan(first.nonce);
  });

  it("clearSelection drops the selection, the lane and the dock tab it interrupted", async () => {
    useLayoutStore.getState().setTab("empires");
    await editor().select(1);
    expect(useLayoutStore.getState().tab).toBe("inspector");

    await editor().clearSelection();
    expect(editor().selection).toEqual([]);
    expect(editor().selectedLane).toBeNull();
    expect(useLayoutStore.getState().tab).toBe("empires");
  });

  it("panTo eases the map without touching the selection", async () => {
    await editor().select(2);
    editor().panTo(10, -20);
    const first = editor().pan!;
    expect(first).toMatchObject({ x: 10, y: -20 });
    expect(editor().selection).toEqual([2]);

    editor().panTo(10, -20);
    expect(editor().pan!.nonce).toBeGreaterThan(first.nonce);
  });

  it("recent search hits are kept newest first, once each and capped", () => {
    const hit = (id: number): SearchHit => ({
      kind: "system",
      id,
      name: { key: `NAME_${id}`, literal: false, variables: [] },
      name_key: `NAME_${id}`,
      system_id: id,
      owner: null,
      country_type: null,
      system_count: null,
      planet_class: null,
      position: [0, 0],
    });
    for (let id = 0; id < RECENT_HITS + 2; id++) editor().noteSearchHit(hit(id));
    editor().noteSearchHit(hit(1));
    const recent = editor().recentHits;
    expect(recent.length).toBe(RECENT_HITS);
    expect(recent[0].id).toBe(1);
    expect(recent.filter((h) => h.id === 1).length).toBe(1);
  });

  it("hover and the two fit nonces are plain state", () => {
    editor().setHover(2);
    expect(editor().hover).toBe(2);
    const fit = editor().fitNonce;
    editor().requestFit();
    expect(editor().fitNonce).toBe(fit + 1);
    const framed = editor().fitSelectionNonce;
    editor().fitSelection();
    editor().fitSelection();
    expect(editor().fitSelectionNonce).toBe(framed + 2);
    expect(editor().fitNonce).toBe(fit + 1);
  });
});

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

describe("nudge", () => {
  beforeEach(() => {
    mocked.applyOp.mockResolvedValue(editResult());
  });

  it("moves a single selected system with MoveSystem and several with one MoveSystems", async () => {
    await editor().select(2);
    await editor().nudgeSelection(-1, 10);
    expect(mocked.applyOp).toHaveBeenCalledWith({ type: "MoveSystem", id: 2, x: 19, y: 20 });

    mocked.applyOp.mockClear();
    await editor().setSelection([0, 5], "replace");
    await editor().nudgeSelection(1, -1);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "MoveSystems",
      moves: [
        { id: 0, x: 1, y: -1 },
        { id: 5, x: -39, y: 39 },
      ],
    });
  });

  it("does nothing with no selection or a lane selected", async () => {
    await editor().nudgeSelection(1, 0);
    editor().selectLane({ a: 0, b: 1 });
    await editor().nudgeSelection(1, 0);
    expect(mocked.applyOp).not.toHaveBeenCalled();
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

describe("lane selection", () => {
  it("selectLane clears the system selection and inspected system, and select clears the lane", async () => {
    await editor().select(1);
    expect(editor().selection).toEqual([1]);

    editor().selectLane({ a: 0, b: 1 });
    let state = editor();
    expect(state.selectedLane).toEqual({ a: 0, b: 1 });
    expect(state.selection).toEqual([]);
    expect(state.inspected).toBeNull();

    await editor().select(2);
    state = editor();
    expect(state.selection).toEqual([2]);
    expect(state.selectedLane).toBeNull();
  });

  it("deleteSelection sends RemoveLane for the selected lane and clears it on success", async () => {
    editor().selectLane({ a: 0, b: 1 });
    mocked.applyOp.mockResolvedValueOnce(editResult());

    await editor().deleteSelection();

    expect(mocked.applyOp).toHaveBeenCalledWith({ type: "RemoveLane", a: 0, b: 1 });
    expect(editor().selectedLane).toBeNull();
  });

  it("deleteSelection keeps the lane selected when the op is refused", async () => {
    editor().selectLane({ a: 0, b: 1 });
    mocked.applyOp.mockRejectedValueOnce({ kind: "op", message: "refused" });

    await editor().deleteSelection();

    expect(editor().selectedLane).toEqual({ a: 0, b: 1 });
    expect(sessionError()).toBe("refused");
  });

  it("clears the selected lane when an applied delta removes it", async () => {
    editor().selectLane({ a: 0, b: 1 });
    const isolatedSol = { ...SYSTEMS[0], lanes: [] };
    mocked.applyOp.mockResolvedValueOnce(editResult({ delta: { systems: [isolatedSol] } }));

    await editor().applyOp({ type: "IsolateSystem", id: 0 });

    expect(editor().selectedLane).toBeNull();
  });

  it("keeps the lane selected when an edit re-projects both of its ends", async () => {
    editor().selectLane({ a: 0, b: 1 });
    useInspectorStore
      .getState()
      .setRoot({ ref: { kind: "lane", a: 0, b: 1 }, label: "Sol — Alpha" });
    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: withLaneLength(0, 1, 42) } }),
    );

    await editor().applyOp({ type: "SetLaneLengths", lanes: [{ a: 0, b: 1, length: 42 }] });

    expect(editor().selectedLane).toEqual({ a: 0, b: 1 });
    expect(mocked.getSystem).not.toHaveBeenCalled();
  });

  it("close resets the selected lane", async () => {
    editor().selectLane({ a: 0, b: 1 });
    await useFileSessionStore.getState().close();
    expect(editor().selectedLane).toBeNull();
  });
});

describe("multi-selection", () => {
  it("toggleSelect adds and removes ids and reads detail only for a single selection", async () => {
    await editor().toggleSelect(1);
    expect(editor().selection).toEqual([1]);
    expect(editor().inspected?.system.id).toBe(1);
    expect(mocked.getSystem).toHaveBeenCalledTimes(1);

    await editor().toggleSelect(3);
    expect(editor().selection).toEqual([1, 3]);
    expect(editor().inspected).toBeNull();
    expect(mocked.getSystem).toHaveBeenCalledTimes(1);

    await editor().toggleSelect(1);
    expect(editor().selection).toEqual([3]);
    expect(editor().inspected?.system.id).toBe(3);
    expect(mocked.getSystem).toHaveBeenCalledTimes(2);
  });

  it("setSelection replaces or unions in order without duplicates", async () => {
    await editor().setSelection([2, 0], "replace");
    expect(editor().selection).toEqual([2, 0]);

    await editor().setSelection([0, 4, 2, 5], "add");
    expect(editor().selection).toEqual([2, 0, 4, 5]);
    expect(editor().inspected).toBeNull();

    await editor().setSelection([3], "replace");
    expect(editor().selection).toEqual([3]);
    expect(editor().inspected?.system.id).toBe(3);
  });

  it("selectAll selects every system and clears the lane; select(null) clears all", async () => {
    editor().selectLane({ a: 0, b: 1 });
    await editor().selectAll();
    let state = editor();
    expect(state.selection).toEqual([0, 1, 2, 3, 4, 5]);
    expect(state.selectedLane).toBeNull();
    expect(state.inspected).toBeNull();

    await editor().select(null);
    state = editor();
    expect(state.selection).toEqual([]);
    expect(state.inspected).toBeNull();
  });

  it("selectLane clears a multi-selection", async () => {
    await editor().setSelection([0, 1], "replace");
    editor().selectLane({ a: 0, b: 1 });
    expect(editor().selection).toEqual([]);
  });

  it("Delete does nothing with systems selected or nothing at all", async () => {
    await editor().deleteSelection();
    await editor().setSelection([0, 1], "replace");
    await editor().deleteSelection();
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });

  it("selection survives a delta and drops ids no longer present", async () => {
    await editor().setSelection([0, 2, 5], "replace");
    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...SYSTEMS[0], x: -5, y: 5 }] } }),
    );
    await editor().applyOp({ type: "MoveSystem", id: 0, x: -5, y: 5 });
    expect(editor().selection).toEqual([0, 2, 5]);
    expect(mocked.getSystem).not.toHaveBeenCalled();

    useGalaxyStore.getState().load({ ...OPEN_RESULT.galaxy, systems: SYSTEMS.slice(0, 5) });
    mocked.applyOp.mockResolvedValueOnce(editResult());
    await editor().applyOp({ type: "MoveSystem", id: 0, x: 0, y: 0 });
    expect(editor().selection).toEqual([0, 2]);
  });
});

describe("the dock follows the selection", () => {
  it("switches to the inspector for one system picked on the map, but not from a dock row", async () => {
    useLayoutStore.getState().setTab("empires");
    useLayoutStore.getState().noteEventSource(false);
    await editor().select(2);
    expect(useLayoutStore.getState().tab).toBe("inspector");

    useLayoutStore.getState().setTab("empires");
    useLayoutStore.getState().noteEventSource(true);
    await editor().select(3);
    expect(useLayoutStore.getState().tab).toBe("empires");
  });

  it("stays put when an edit re-selects the system, so undo from Changes keeps its tab", async () => {
    useLayoutStore.getState().noteEventSource(false);
    await editor().select(0);
    useLayoutStore.getState().setTab("changes");
    mocked.applyOp.mockResolvedValue(
      editResult({ delta: { systems: [{ ...SYSTEMS[0], x: 5, y: 5 }] } }),
    );
    await editor().applyOp({ type: "MoveSystem", id: 0, x: 5, y: 5 });
    expect(useLayoutStore.getState().tab).toBe("changes");
  });

  it("leaves the tab alone for a selection of several systems", async () => {
    useLayoutStore.getState().setTab("issues");
    useLayoutStore.getState().noteEventSource(false);
    await editor().setSelection([0, 2], "replace");
    expect(useLayoutStore.getState().tab).toBe("issues");
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
