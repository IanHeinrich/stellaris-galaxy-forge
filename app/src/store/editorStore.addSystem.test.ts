import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import type { EditResult } from "../generated/EditResult";
import type { SystemNode } from "../generated/SystemNode";
import { IRONMAN, NEEDS_GAME_DATA, NEEDS_STELLARIS_4 } from "../lib/addSystem";
import { run } from "./commands";
import {
  addedNode,
  deferred,
  joinBoth,
  editor,
  mocked,
  openFixtureSave,
  sessionError,
  withAddedSystems,
} from "./editorFixture";
import { addSystemRefusalAt, canDelete } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { loadGameData } from "./gameDataFixture";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";
import { editResult, historyEntry, saveMeta } from "./fixture";

const addRandomSystem = mocked.addRandomSystem;
const addSpecialSystem = mocked.addSpecialSystem;
const rerollSystem = mocked.rerollSystem;
const removeAddedSystems = mocked.removeAddedSystems;

beforeEach(async () => {
  await openFixtureSave();
  await loadGameData();
});

describe("adding a system to a save", () => {
  it("rolls one at the point in one edit and selects it", async () => {
    const system = addedNode(6, -50, -20);
    addRandomSystem.mockResolvedValueOnce(editResult({ delta: { systems: [system] } }));
    mocked.getSystem.mockResolvedValueOnce({ system, neighbours: [], nebula: null });

    expect(await editor().addRandomSystemAt(-50, -20, "sc_m")).toBe(true);

    const [seed, x, y, starClass] = addRandomSystem.mock.calls[0];
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect([x, y, starClass]).toEqual([-50, -20, "sc_m"]);
    expect(editor().selection).toEqual([6]);
    expect(editor().inspected?.system.id).toBe(6);
  });

  it("gives each roll a fresh seed", async () => {
    addRandomSystem.mockResolvedValue(editResult({ delta: { systems: [] } }));
    await editor().addRandomSystemAt(-50, -20);
    await editor().addRandomSystemAt(-50, -20);
    const [first, second] = addRandomSystem.mock.calls.map(([seed]) => seed);
    expect(first).not.toBe(second);
  });

  it("undoing the add clears the selection", async () => {
    const system = addedNode(6, -50, -20);
    addRandomSystem.mockResolvedValueOnce(editResult({ delta: { systems: [system] } }));
    mocked.getSystem.mockResolvedValueOnce({ system, neighbours: [], nebula: null });
    await editor().addRandomSystemAt(-50, -20);
    mocked.undo.mockResolvedValueOnce(
      editResult({ delta: { systems: [], removed: [6] }, history: { undo: [], redo: [] } }),
    );

    await editor().undo();

    expect(editor().selection).toEqual([]);
    expect(editor().inspected).toBeNull();
  });

  it("reports a refused spot without asking the core", async () => {
    expect(await editor().addRandomSystemAt(3, 0)).toBe(false);
    expect(addRandomSystem).not.toHaveBeenCalled();
    expect(sessionError()).toMatch(/^Too close to .+: 3 away, the game needs 10$/);
  });
});

describe("placing a special layout", () => {
  const trappist = (extra: Partial<SystemNode> = {}) =>
    addedNode(6, -50, -20, { initializer: "trappist_initializer", star_class: "sc_m", ...extra });

  it("adds it at the point in one edit, selects it, and undo and redo take it away and back", async () => {
    const system = trappist();
    addSpecialSystem.mockResolvedValueOnce(editResult({ delta: { systems: [system] } }));
    mocked.getSystem.mockResolvedValue({ system, neighbours: [], nebula: null });

    expect(await editor().addSpecialSystemAt(-50, -20, "trappist_initializer")).toBe(true);

    const [seed, x, y, layout] = addSpecialSystem.mock.calls[0];
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect([x, y, layout]).toEqual([-50, -20, "trappist_initializer"]);
    expect(editor().selection).toEqual([6]);
    expect(editor().inspected?.system.id).toBe(6);
    expect(addRandomSystem).not.toHaveBeenCalled();

    mocked.undo.mockResolvedValueOnce(editResult({ delta: { systems: [], removed: [6] } }));
    await editor().undo();
    expect(editor().selection).toEqual([]);

    mocked.redo.mockResolvedValueOnce(editResult({ delta: { systems: [system] } }));
    await editor().redo();
    await vi.waitFor(() => expect(editor().selection).toEqual([6]));
  });

  it("rolls the same layout again, and a new class rolls a regular system", async () => {
    useGalaxyStore.getState().applyDelta({ systems: [trappist()] });
    rerollSystem.mockResolvedValue(editResult());

    expect(await editor().rerollSystem(6)).toBe(true);
    expect(await editor().rerollSystem(6, "sc_g")).toBe(true);

    expect(rerollSystem.mock.calls.map(([id, , star, keep]) => [id, star, keep])).toEqual([
      [6, "sc_m", true],
      [6, "sc_g", false],
    ]);
  });

  it("reports a refused spot without asking the core", async () => {
    expect(await editor().addSpecialSystemAt(3, 0, "trappist_initializer")).toBe(false);
    expect(addSpecialSystem).not.toHaveBeenCalled();
    expect(sessionError()).toMatch(/^Too close to .+/);
  });
});

describe("why a system cannot be added", () => {
  it("is null on a clear spot of a loaded 4.x save", () => {
    expect(addSystemRefusalAt(-50, -20)).toBeNull();
  });

  it("names the system inside the spawn buffer", () => {
    const refusal = addSystemRefusalAt(6, 8);
    expect(refusal?.tooClose).toBe(true);
    expect(refusal?.reason).toMatch(/^Too close to .+: \d+ away, the game needs 10$/);
  });

  it("names the galaxy's edge past its radius", () => {
    expect(addSystemRefusalAt(100, 0)).toEqual({
      reason: "Outside the galaxy's edge (radius 60)",
      tooClose: false,
      outside: true,
    });
  });

  it("asks for game data", async () => {
    await useGameDataStore.getState().unload();
    expect(addSystemRefusalAt(-50, -20)?.reason).toBe(NEEDS_GAME_DATA);
  });

  it("asks for a Stellaris 4 save", () => {
    useFileSessionStore.setState({ meta: saveMeta({ version: "Libra v3.4.5" }) });
    expect(addSystemRefusalAt(-50, -20)?.reason).toBe(NEEDS_STELLARIS_4);
  });

  it("is off for an Ironman save", () => {
    useFileSessionStore.setState({ meta: saveMeta({ ironman: true }) });
    expect(addSystemRefusalAt(-50, -20)?.reason).toBe(IRONMAN);
  });
});

describe("editing a system added this session", () => {
  it("rolls it again with the class asked for", async () => {
    const [six] = withAddedSystems();
    rerollSystem.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...six, star_class: "sc_m" }] } }),
    );

    expect(await editor().rerollSystem(6, "sc_m")).toBe(true);

    const [id, seed, starClass] = rerollSystem.mock.calls[0];
    expect([id, starClass]).toEqual([6, "sc_m"]);
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect(useGalaxyStore.getState().systems.get(6)?.star_class).toBe("sc_m");
  });

  it("leaves a system the file already held alone", async () => {
    expect(await editor().rerollSystem(0, null)).toBe(false);
    expect(await editor().renameAddedSystem(0, "Dorellion")).toBe(false);
    expect(rerollSystem).not.toHaveBeenCalled();
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });

  it("renames it with one op", async () => {
    withAddedSystems();
    mocked.applyOp.mockResolvedValueOnce(editResult());

    expect(await editor().renameAddedSystem(6, "  Dorellion ")).toBe(true);

    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "RenameSaveSystem",
      system: 6,
      name: "Dorellion",
    });
  });

  it("deletes it once confirmed", async () => {
    withAddedSystems();
    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [], removed: [7], renumbered: [[7, null]] } }),
    );

    await editor().removeSystem(7);

    expect(mocked.confirm).toHaveBeenCalled();
    expect(mocked.applyOp).toHaveBeenCalledWith({ type: "RemoveSystem", id: 7 });
    expect(useGalaxyStore.getState().systems.has(7)).toBe(false);
  });
});

describe("pressing Delete on a save", () => {
  const effects = { focusSearch: vi.fn(), browseInitializers: vi.fn() };

  it("deletes the one added system selected", async () => {
    withAddedSystems();
    await editor().setSelection([7], "replace");
    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [], removed: [7], renumbered: [[7, null]] } }),
    );

    expect(canDelete(editor())).toBe(true);
    run("deleteSelection", false, effects);

    await vi.waitFor(() =>
      expect(mocked.applyOp).toHaveBeenCalledWith({ type: "RemoveSystem", id: 7 }),
    );
  });

  it.each([
    [
      [0, 6, 7],
      [6, 7],
    ],
    [[0, 7], [7]],
  ])(
    "deletes the added systems of %j as the Actions button does, leaving the save's own",
    async (selection, deleted) => {
      withAddedSystems();
      await editor().setSelection(selection, "replace");
      removeAddedSystems.mockResolvedValueOnce(
        editResult({ delta: { systems: [], removed: deleted } }),
      );

      run("deleteSelection", false, effects);

      await vi.waitFor(() => expect(removeAddedSystems).toHaveBeenCalledWith(deleted));
      expect(mocked.confirm).toHaveBeenCalledWith(
        `Delete ${deleted.length} added system${deleted.length === 1 ? "" : "s"}?`,
        { title: "Delete added systems", kind: "warning" },
      );
      expect(mocked.applyOp).not.toHaveBeenCalled();
    },
  );

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

    expect(await editor().removeAddedSystems([0, 6, 8])).toBe(true);

    expect(mocked.confirm).toHaveBeenCalledWith("Delete 2 added systems?", {
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
    await vi.waitFor(() => expect(editor().inspected?.system.id).toBe(0));
  });

  it("sends nothing without an added system among them, or when not confirmed", async () => {
    withThreeAdded();
    expect(await editor().removeAddedSystems([0, 3])).toBe(false);
    expect(mocked.confirm).not.toHaveBeenCalled();

    mocked.confirm.mockResolvedValueOnce(false);
    expect(await editor().removeAddedSystems([6, 8])).toBe(false);
    expect(removeAddedSystems).not.toHaveBeenCalled();
  });

  it("sends the ids a delete queued ahead of it moved them to", async () => {
    const [, seven] = withAddedSystems();
    const eight = addedNode(8, 30, -30);
    useGalaxyStore.getState().applyDelta({ systems: [eight] });
    const removal = deferred<EditResult>();
    mocked.applyOp.mockReturnValueOnce(removal.promise);
    removeAddedSystems.mockResolvedValueOnce(editResult());

    const removing = editor().applyOp({ type: "RemoveSystem", id: 6 });
    const bulk = editor().removeAddedSystems([7, 8]);
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
    mocked.applyOp.mockReturnValueOnce(removal.promise).mockResolvedValueOnce(editResult());
    const removing = editor().applyOp({ type: "RemoveSystem", id: 6 });
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

  const lastSent = () => mocked.applyOp.mock.calls[mocked.applyOp.mock.calls.length - 1][0];

  it("send a delete of one system to the id a delete ahead of it moved the system to", async () => {
    withAddedSystems();
    const { removing, land } = holdRemovalOfSix();
    const deleting = editor().removeSystem(7);
    land();
    await Promise.all([removing, deleting]);

    expect(mocked.applyOp).toHaveBeenCalledTimes(2);
    expect(lastSent()).toEqual({ type: "RemoveSystem", id: 6 });
  });

  it("nudge the selection where a delete ahead of it moved it", async () => {
    withAddedSystems();
    await editor().setSelection([7], "replace");
    const { removing, land } = holdRemovalOfSix();
    const nudging = editor().nudgeSelection(1, 0);
    land();
    await Promise.all([removing, nudging]);

    expect(lastSent()).toEqual({ type: "MoveSystem", id: 6, x: 51, y: 20 });
  });

  it("work out a lane edit on the selection where a delete ahead of it moved it", async () => {
    withAddedSystems();
    joinBoth("lanes", [7, 3]);
    await editor().setSelection([7], "replace");
    const { removing, land } = holdRemovalOfSix();
    const isolating = editor().isolateSelected();
    land();
    await Promise.all([removing, isolating]);

    expect(lastSent()).toEqual({ type: "IsolateSystems", ids: [6] });
  });

  it("send a reroll to the id a delete ahead of it moved the system to", async () => {
    const [, seven] = withAddedSystems();
    const removal = deferred<EditResult>();
    mocked.applyOp.mockReturnValueOnce(removal.promise);
    rerollSystem.mockResolvedValueOnce(editResult());

    const removing = editor().applyOp({ type: "RemoveSystem", id: 6 });
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
    mocked.applyOp
      .mockResolvedValueOnce(
        editResult({ delta: { systems: [], removed: [7], renumbered: [[7, null]] } }),
      )
      .mockResolvedValueOnce(editResult());

    const removing = editor().applyOp({ type: "RemoveSystem", id: 7 });
    const rolling = editor().rerollSystem(7);
    const renaming = editor().renameAddedSystem(7, "Dorellion");

    expect(await Promise.all([removing, rolling, renaming])).toEqual([true, false, false]);
    expect(rerollSystem).not.toHaveBeenCalled();
    expect(mocked.applyOp).toHaveBeenCalledTimes(1);
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
