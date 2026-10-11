import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchHit } from "../generated/SearchHit";
import type { SystemNode } from "../generated/SystemNode";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { addedNode, editor, openFixtureSave, withAddedSystems } from "./editorFixture";
import { useEditorStore } from "./editorStore";
import { useWatchlistStore } from "./watchlistStore";
import { useDetailsStore } from "./detailsStore";
import { GALAXY_ENTRY, useInspectorStore } from "./inspectorStore";
import { useGalaxyStore } from "./galaxyStore";
import {
  SCENARIO_OWNERS,
  TERRITORY,
  editResult,
  historyEntry,
  planetSummary,
  systemDetails,
} from "./fixture";
import { name } from "../test/builders";
import { mockedIpc } from "../test/ipc";
import { until } from "../test/wait";

beforeEach(openFixtureSave);

describe("re-classifying after an edit", () => {
  it("re-reads the special systems and the scripted owners when the edit says it reclassifies", async () => {
    mockedIpc.getScenarioOwners.mockResolvedValue(SCENARIO_OWNERS);
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ reclassifies: true }));
    mockedIpc.getSpecialSystems.mockClear();
    mockedIpc.getScenarioOwners.mockClear();

    await editor().applyOp({
      type: "SetInitializer",
      system: 0,
      initializer: "empire_capital_init",
    });

    expect(mockedIpc.getSpecialSystems, "special systems re-read").toHaveBeenCalledTimes(1);
    expect(mockedIpc.getScenarioOwners, "scripted owners re-read").toHaveBeenCalledTimes(1);
    expect(useGalaxyStore.getState().systems.get(1)?.owner, "territory redrawn").toBe(TERRITORY.id);
  });

  it("leaves them alone after an edit that says it does not", async () => {
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({}));
    mockedIpc.getSpecialSystems.mockClear();
    mockedIpc.getScenarioOwners.mockClear();

    await editor().applyOp({ type: "MoveSystem", system: 0, x: 1, y: 2 });

    expect(mockedIpc.getSpecialSystems).not.toHaveBeenCalled();
    expect(mockedIpc.getScenarioOwners).not.toHaveBeenCalled();
  });

  it("leaves them alone when the op is refused", async () => {
    mockedIpc.applyOp.mockRejectedValueOnce({ kind: "op", message: "no" });
    mockedIpc.getSpecialSystems.mockClear();

    expect(await editor().applyOp({ type: "RemoveSystem", system: 5 })).toBe(false);

    expect(mockedIpc.getSpecialSystems).not.toHaveBeenCalled();
  });

  it("undoing an initializer edit re-classifies too", async () => {
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ reclassifies: true }));
    await editor().applyOp({ type: "SetInitializer", system: 0, initializer: "guardian_dragon" });
    mockedIpc.getSpecialSystems.mockClear();
    mockedIpc.undo.mockResolvedValueOnce(editResult({ reclassifies: true }));

    await editor().undo();

    expect(mockedIpc.getSpecialSystems).toHaveBeenCalledTimes(1);
  });

  it("a run of edits re-classifies once, and the edit behind them does not wait for it", async () => {
    await until(() => expect(mockedIpc.getSpecialSystems).toHaveBeenCalledTimes(2));
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
      editor().applyOp({ type: "SetInitializer", system: id, initializer: "guardian_dragon" }),
    );
    await until(() => expect(mockedIpc.getSpecialSystems).toHaveBeenCalledTimes(1));

    mockedIpc.applyOp.mockResolvedValueOnce(editResult({}));
    expect(await editor().applyOp({ type: "MoveSystem", system: 0, x: 9, y: 9 })).toBe(true);

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
    return editor().applyOp({ type: "RemoveSystem", system: 6 });
  }

  it("moves the selection, the pages and the pinned searches to the new id", async () => {
    const [, seven] = withAddedSystems();
    await editor().select(7);
    const inspector = useInspectorStore.getState();
    inspector.setRoot({ ref: { kind: "system", id: 7 }, label: "Added 7" });
    inspector.open({ ref: { kind: "body", system: 7, id: 70 }, label: "Added 7 I" });
    useWatchlistStore.setState({ results: new Map([["added", [7, 3]]]) });

    await removeSix(seven);

    expect(editor().selection).toEqual([6]);
    expect(useInspectorStore.getState().stack.map((e) => e.ref)).toEqual([
      { kind: "system", id: 6 },
      { kind: "body", system: 6, id: 70 },
    ]);
    expect(useWatchlistStore.getState().results.get("added")).toEqual([6, 3]);
    expect(editor().inspected?.system.id).toBe(6);
  });

  it("closes the page of the system it removed and clears the selection", async () => {
    const [, seven] = withAddedSystems();
    await editor().select(6);
    const inspector = useInspectorStore.getState();
    inspector.setRoot({ ref: { kind: "system", id: 6 }, label: "Added 6" });
    inspector.open({ ref: { kind: "body", system: 6, id: 60 }, label: "Added 6 I" });
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

    await editor().applyOp({ type: "RemoveSystem", system: 6 });

    expect(editor().hover).toBeNull();
    expect(editor().selectedLane).toEqual({ a: 3, b: 6 });
  });

  it("moves the search rings and the recent hits, dropping what was in the removed system", async () => {
    const [, seven] = withAddedSystems();
    useEditorStore.setState({
      searchRings: [7, 3, 6],
      heldRings: [6, 7],
      recentHits: [hit("system", 7, 7), hit("planet", 60, 6), hit("system", 3, 3)],
    });

    await removeSix(seven);

    expect(editor().searchRings).toEqual([6, 3]);
    expect(editor().heldRings).toEqual([6]);
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
    inspector.openPage({ ref: { kind: "body", system: 6, id: 60 }, label: "Added 6 I" });
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
    await editor().applyOp({ type: "RemoveSystem", system: 6 });
    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ delta: { systems: [six, seven], renumbered: [[6, 7]] } }),
    );

    await editor().undo();

    await until(() => expect(editor().inspected?.system).toEqual(six));
    expect(editor().selection).toEqual([6]);
    expect(useGalaxyStore.getState().systems.get(7)).toEqual(seven);
  });

  it("a redone add selects the system again", async () => {
    withAddedSystems();
    const eight = addedNode(8, 30, -30);
    mockedIpc.redo.mockResolvedValueOnce(editResult({ delta: { systems: [eight] } }));

    await editor().redo();

    await until(() => expect(editor().inspected?.system.id).toBe(8));
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
