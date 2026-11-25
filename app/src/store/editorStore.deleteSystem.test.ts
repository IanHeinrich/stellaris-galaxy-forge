import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { run } from "./commands";
import { editor, openFixtureSave, sessionError, withAddedSystems } from "./editorFixture";
import { canDelete, deletableSelection } from "./editorStore";
import { editResult, OPEN_RESULT, SYSTEMS } from "./fixture";
import { useGalaxyStore } from "./galaxyStore";
import { mockedIpc } from "../test/ipc";
import { openWith } from "../test/session";
import { until } from "../test/wait";

const effects = { focusSearch: vi.fn(), browseInitializers: vi.fn() };
const REFUSAL = "system 1 cannot be deleted: it has an owner, and that hasn't been tested in game";

/** The fixture save as one whose own systems can be deleted, or as one too old for that. */
async function openSave(delete_systems: boolean): Promise<void> {
  await openFixtureSave();
  await openWith(OPEN_RESULT, { capabilities: { ...OPEN_RESULT.capabilities, delete_systems } });
}

/** System 1's neighbours with their lanes to it cut, as its deletion leaves them. */
const CUT = SYSTEMS.filter((s) => s.lanes.some((l) => l.to === 1)).map((s) => ({
  ...s,
  lanes: s.lanes.filter((l) => l.to !== 1),
}));

describe("deleting a system the save already had", () => {
  beforeEach(async () => {
    await openSave(true);
    await editor().setSelection([1], "replace");
  });

  it("asks the core and then the user, and sends one DeleteSystem", async () => {
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: CUT, removed: [1], renumbered: [[1, null]] } }),
    );
    expect(deletableSelection(editor())).toEqual({ kind: "held", ids: [1] });
    expect(canDelete(editor())).toBe(true);

    run("deleteSelection", false, effects);

    await until(() => expect(useGalaxyStore.getState().systems.has(1)).toBe(false));
    expect(mockedIpc.checkOp.mock.calls).toEqual([[{ type: "DeleteSystem", system: 1 }]]);
    expect(mockedIpc.confirm.mock.calls).toEqual([
      ["Delete Alpha Centauri and its 4 lanes?", { title: "Alpha Centauri", kind: "warning" }],
    ]);
    expect(mockedIpc.applyOp.mock.calls).toEqual([[{ type: "DeleteSystem", system: 1 }]]);
    expect(mockedIpc.removeAddedSystems).not.toHaveBeenCalled();
    expect(useGalaxyStore.getState().systems.get(0)?.lanes).toEqual([]);
    expect(editor().selection).toEqual([]);
  });

  it("comes back with its lanes on undo", async () => {
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: CUT, removed: [1], renumbered: [[1, null]] } }),
    );
    expect(await editor().removeSystems([1])).toBe(true);
    expect(useGalaxyStore.getState().systems.has(1)).toBe(false);

    const back = SYSTEMS.filter((s) => s.id === 1 || CUT.some((c) => c.id === s.id));
    mockedIpc.undo.mockResolvedValueOnce(editResult({ delta: { systems: back } }));
    await editor().undo();

    expect([...useGalaxyStore.getState().systems.keys()].sort()).toEqual(
      SYSTEMS.map((s) => s.id).sort(),
    );
    expect(useGalaxyStore.getState().systems.get(1)).toEqual(SYSTEMS.find((s) => s.id === 1));
  });

  it("shows the core's refusal and asks nothing", async () => {
    mockedIpc.checkOp.mockResolvedValueOnce(REFUSAL);

    expect(await editor().removeSystems([1])).toBe(false);

    expect(sessionError()).toBe(REFUSAL);
    expect(mockedIpc.confirm).not.toHaveBeenCalled();
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("shows why the core could not be asked, and asks nothing", async () => {
    mockedIpc.checkOp.mockRejectedValueOnce({ kind: "no_session", message: "no file is open" });

    expect(await editor().removeSystems([1])).toBe(false);

    expect(sessionError()).toBe("no file is open");
    expect(mockedIpc.confirm).not.toHaveBeenCalled();
  });

  it("sends nothing when declined", async () => {
    mockedIpc.confirm.mockResolvedValueOnce(false);

    expect(await editor().removeSystems([1])).toBe(false);

    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("is for one system at a time: a selection deletes only the ones added", async () => {
    withAddedSystems();
    await editor().setSelection([0, 1], "replace");
    expect(canDelete(editor())).toBe(false);
    expect(await editor().removeSystems([0, 1])).toBe(false);
    expect(mockedIpc.confirm).not.toHaveBeenCalled();

    await editor().setSelection([1, 7], "replace");
    expect(deletableSelection(editor())).toEqual({ kind: "added", ids: [7] });
    mockedIpc.removeAddedSystems.mockResolvedValueOnce(editResult());
    expect(await editor().removeSystems([1, 7])).toBe(true);
    expect(mockedIpc.removeAddedSystems.mock.calls).toEqual([[[7]]]);
    expect(mockedIpc.checkOp).not.toHaveBeenCalled();
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("leaves one added this session to RemoveSystem", async () => {
    withAddedSystems();
    mockedIpc.applyOp.mockResolvedValueOnce(editResult());

    expect(await editor().removeSystems([7])).toBe(true);

    expect(mockedIpc.checkOp).not.toHaveBeenCalled();
    expect(mockedIpc.applyOp.mock.calls).toEqual([[{ type: "RemoveSystem", system: 7 }]]);
  });

  it("is not offered on an older save", async () => {
    await openSave(false);
    await editor().setSelection([1], "replace");

    expect(canDelete(editor())).toBe(false);
    expect(await editor().removeSystems([1])).toBe(false);
    expect(mockedIpc.checkOp).not.toHaveBeenCalled();
    expect(mockedIpc.confirm).not.toHaveBeenCalled();
  });
});
