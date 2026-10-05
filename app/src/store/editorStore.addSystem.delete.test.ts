import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { EditResult } from "../generated/EditResult";
import type { SystemNode } from "../generated/SystemNode";
import { run } from "./commands";
import {
  addedNode,
  deferred,
  joinBoth,
  editor,
  openFixtureSave,
  withAddedSystems,
} from "./editorFixture";
import { canDelete } from "./editorStore";
import { loadGameData } from "./gameDataFixture";
import { useGalaxyStore } from "./galaxyStore";
import { useInspectorStore } from "./inspectorStore";
import { editResult, historyEntry } from "./fixture";
import { mockedIpc } from "../test/ipc";
import { until } from "../test/wait";

const rerollSystem = mockedIpc.rerollSystem;
const removeAddedSystems = mockedIpc.removeAddedSystems;

beforeEach(async () => {
  await openFixtureSave();
  await loadGameData();
});

describe("pressing Delete on a save", () => {
  const effects = { focusSearch: vi.fn(), browseInitializers: vi.fn() };

  it("deletes the one added system selected once confirmed", async () => {
    withAddedSystems();
    await editor().setSelection([7], "replace");
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [], removed: [7], renumbered: [[7, null]] } }),
    );

    expect(canDelete(editor())).toBe(true);
    run("deleteSelection", false, effects);

    await until(() => expect(useGalaxyStore.getState().systems.has(7)).toBe(false));
    expect(mockedIpc.confirm).toHaveBeenCalled();
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({ type: "RemoveSystem", system: 7 });
  });

  it("deletes the added systems of a mixed selection as the Actions button does, leaving the save's own", async () => {
    withAddedSystems();
    await editor().setSelection([0, 7], "replace");
    removeAddedSystems.mockResolvedValueOnce(editResult({ delta: { systems: [], removed: [7] } }));

    run("deleteSelection", false, effects);

    await until(() => expect(removeAddedSystems).toHaveBeenCalledWith([7]));
    expect(mockedIpc.confirm).toHaveBeenCalledWith("Delete 1 added system?", {
      title: "Delete added systems",
      kind: "warning",
    });
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("offers nothing for a selection of the save's own systems", async () => {
    withAddedSystems();
    await editor().setSelection([0, 1], "replace");

    expect(canDelete(editor())).toBe(false);
  });
});

describe("deleting several added systems at once", () => {
  /** 6, 7 and 8 added; removing 6 and 8 moves 7 down to 6, as the core reports it. */
  function withThreeAdded(): SystemNode {
    const [, seven] = withAddedSystems();
    useGalaxyStore.getState().applyDelta({ systems: [addedNode(8, 30, -30)] });
    return seven;
  }

  function removedSixAndEight(seven: SystemNode): EditResult {
    return editResult({
      entry: historyEntry(4, "Removed 2 systems (#6, #8) and 0 lanes; renumbered 7 to 6"),
      delta: {
        systems: [{ ...seven, id: 6 }],
        removed: [7, 8],
        renumbered: [
          [6, null],
          [8, null],
          [7, 6],
        ],
      },
    });
  }

  it("deletes them in one edit once confirmed and drops them from the selection and the inspector", async () => {
    const seven = withThreeAdded();
    await editor().setSelection([0, 6, 8], "replace");
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: 8 }, label: "Added 8" });
    removeAddedSystems.mockResolvedValueOnce(removedSixAndEight(seven));

    expect(await editor().removeSystems([0, 6, 8])).toBe(true);

    expect(mockedIpc.confirm).toHaveBeenCalledWith("Delete 2 added systems?", {
      title: "Delete added systems",
      kind: "warning",
    });
    expect(removeAddedSystems).toHaveBeenCalledTimes(1);
    expect(removeAddedSystems).toHaveBeenCalledWith([6, 8]);
    const systems = useGalaxyStore.getState().systems;
    expect(systems.get(6)?.name).toEqual(seven.name);
    expect(systems.has(7) || systems.has(8)).toBe(false);
    expect(editor().selection).toEqual([0]);
    expect(useInspectorStore.getState().stack.map((e) => e.ref)).not.toContainEqual({
      kind: "system",
      id: 8,
    });
    await until(() => expect(editor().inspected?.system.id).toBe(0));
  });

  it("sends nothing without an added system among them, or when not confirmed", async () => {
    withThreeAdded();
    expect(await editor().removeSystems([0, 3])).toBe(false);
    expect(mockedIpc.confirm).not.toHaveBeenCalled();

    mockedIpc.confirm.mockResolvedValueOnce(false);
    expect(await editor().removeSystems([6, 8])).toBe(false);
    expect(removeAddedSystems).not.toHaveBeenCalled();
  });

  it("sends the ids a delete queued ahead of it moved them to", async () => {
    const [, seven] = withAddedSystems();
    const eight = addedNode(8, 30, -30);
    useGalaxyStore.getState().applyDelta({ systems: [eight] });
    const removal = deferred<EditResult>();
    mockedIpc.applyOp.mockReturnValueOnce(removal.promise);
    removeAddedSystems.mockResolvedValueOnce(editResult());

    const removing = editor().applyOp({ type: "RemoveSystem", system: 6 });
    const bulk = editor().removeSystems([7, 8]);
    removal.resolve(
      editResult({
        delta: {
          systems: [
            { ...seven, id: 6 },
            { ...eight, id: 7 },
          ],
          removed: [8],
          renumbered: [
            [6, null],
            [7, 6],
            [8, 7],
          ],
        },
      }),
    );
    await Promise.all([removing, bulk]);

    expect(removeAddedSystems).toHaveBeenCalledWith([6, 7]);
  });
});

describe("edits queued behind others", () => {
  /** Holds a delete of 6 in the queue; landing it moves 7 down to 6, as the core reports it. */
  function holdRemovalOfSix() {
    const removal = deferred<EditResult>();
    mockedIpc.applyOp.mockReturnValueOnce(removal.promise).mockResolvedValueOnce(editResult());
    const removing = editor().applyOp({ type: "RemoveSystem", system: 6 });
    const land = () =>
      removal.resolve(
        editResult({
          delta: {
            systems: [{ ...useGalaxyStore.getState().systems.get(7)!, id: 6 }],
            removed: [7],
            renumbered: [
              [6, null],
              [7, 6],
            ],
          },
        }),
      );
    return { removing, land };
  }

  const lastSent = () => mockedIpc.applyOp.mock.calls[mockedIpc.applyOp.mock.calls.length - 1][0];

  it("send a delete of one system to the id a delete ahead of it moved the system to", async () => {
    withAddedSystems();
    const { removing, land } = holdRemovalOfSix();
    const deleting = editor().removeSystems([7]);
    land();
    await Promise.all([removing, deleting]);

    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(2);
    expect(lastSent()).toEqual({ type: "RemoveSystem", system: 6 });
  });

  it("nudge the selection where a delete ahead of it moved it", async () => {
    withAddedSystems();
    await editor().setSelection([7], "replace");
    const { removing, land } = holdRemovalOfSix();
    const nudging = editor().nudgeSelection(1, 0);
    land();
    await Promise.all([removing, nudging]);

    expect(lastSent()).toEqual({ type: "MoveSystem", system: 6, x: 51, y: 20 });
  });

  it("work out a lane edit on the selection where a delete ahead of it moved it", async () => {
    withAddedSystems();
    joinBoth("lanes", [7, 3]);
    await editor().setSelection([7], "replace");
    const { removing, land } = holdRemovalOfSix();
    const isolating = editor().isolateSelected();
    land();
    await Promise.all([removing, isolating]);

    expect(lastSent()).toEqual({ type: "IsolateSystems", systems: [6] });
  });

  it("send a reroll to the id a delete ahead of it moved the system to", async () => {
    const [, seven] = withAddedSystems();
    const removal = deferred<EditResult>();
    mockedIpc.applyOp.mockReturnValueOnce(removal.promise);
    rerollSystem.mockResolvedValueOnce(editResult());

    const removing = editor().applyOp({ type: "RemoveSystem", system: 6 });
    const rolling = editor().rerollSystem(7);
    removal.resolve(
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
    await Promise.all([removing, rolling]);

    expect(rerollSystem).toHaveBeenCalledTimes(1);
    expect(rerollSystem.mock.calls[0][0]).toBe(6);
  });

  it("send nothing for a system a delete ahead of them removed", async () => {
    withAddedSystems();
    mockedIpc.applyOp
      .mockResolvedValueOnce(
        editResult({ delta: { systems: [], removed: [7], renumbered: [[7, null]] } }),
      )
      .mockResolvedValueOnce(editResult());

    const removing = editor().applyOp({ type: "RemoveSystem", system: 7 });
    const rolling = editor().rerollSystem(7);
    const renaming = editor().renameAddedSystem(7, "Dorellion");

    expect(await Promise.all([removing, rolling, renaming])).toEqual([true, false, false]);
    expect(rerollSystem).not.toHaveBeenCalled();
    expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1);
  });

  it("roll a reroll around the class a pick ahead of it chose", async () => {
    const [six] = withAddedSystems();
    const pick = deferred<EditResult>();
    rerollSystem.mockReturnValueOnce(pick.promise).mockResolvedValueOnce(editResult());

    const picking = editor().rerollSystem(6, "sc_m");
    const rolling = editor().rerollSystem(6);
    pick.resolve(editResult({ delta: { systems: [{ ...six, star_class: "sc_m" }] } }));
    await Promise.all([picking, rolling]);

    expect(rerollSystem.mock.calls.map(([id, , star]) => [id, star])).toEqual([
      [6, "sc_m"],
      [6, "sc_m"],
    ]);
  });
});
