import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { run } from "./commands";
import {
  editor,
  mocked,
  openFixtureSave,
  openFixtureScenario,
  sessionError,
} from "./editorFixture";
import { canDelete, deletableSelection, useEditorStore } from "./editorStore";
import { useGalaxyStore } from "./galaxyStore";
import { SCENARIO_RESULT, SYSTEMS, editResult, node } from "./fixture";

beforeEach(() => openFixtureScenario());

describe("adding and removing systems", () => {
  it("addSystemAt sends AddSystem at the point and selects what comes back", async () => {
    const added = node(9, "", -120, 45, "sc_g");
    mocked.applyOp.mockResolvedValueOnce(editResult({ delta: { systems: [added] } }));
    mocked.getSystem.mockResolvedValueOnce({ system: added, neighbours: [], nebula: null });

    await editor().addSystemAt(-120, 45);

    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "AddSystem",
      id: null,
      x: -120,
      y: 45,
      name: null,
      initializer: null,
      spawn_weight: null,
      spawn_script: null,
    });
    expect(useGalaxyStore.getState().systems.get(9)).toEqual(added);
    expect(editor().selection).toEqual([9]);
    expect(editor().inspected?.system.id).toBe(9);
  });

  it("addSystemAt selects the system its own edit added, whatever lands while it reclassifies", async () => {
    const mine = node(9, "", -120, 45, "sc_g");
    const later = node(10, "", 200, 200, "sc_g");
    mocked.applyOp
      .mockResolvedValueOnce(editResult({ delta: { systems: [mine] }, reclassifies: true }))
      .mockResolvedValueOnce(editResult({ delta: { systems: [later] } }));
    mocked.getSystem.mockImplementation(async (id) => ({
      system: id === 9 ? mine : later,
      neighbours: [],
      nebula: null,
    }));
    const selected: number[][] = [];
    const unsubscribe = useEditorStore.subscribe((state, prev) => {
      if (state.selection !== prev.selection) selected.push(state.selection);
    });

    await Promise.all([editor().addSystemAt(-120, 45), editor().addSystemAt(200, 200)]);
    unsubscribe();

    expect(selected).toEqual([[10], [9]]);
  });

  it("addSystemAt carries the initializer and its spawn weight", async () => {
    const added = node(9, "", 10, -4, "sc_g");
    mocked.applyOp.mockResolvedValueOnce(editResult({ delta: { systems: [added] } }));
    mocked.getSystem.mockResolvedValueOnce({ system: added, neighbours: [], nebula: null });

    expect(await editor().addSystemAt(10, -4, "empire_init_01", 1)).toBe(true);

    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "AddSystem",
      id: null,
      x: 10,
      y: -4,
      name: null,
      initializer: "empire_init_01",
      spawn_weight: 1,
      spawn_script: null,
    });
    expect(editor().selection).toEqual([9]);
  });

  it("addSystemAt under the Paint a Galaxy profile writes the seat as script in the one op, keyed to the next id", async () => {
    await openFixtureScenario({ ...SCENARIO_RESULT, painted: true });
    const added = node(6, "", 10, -4, "sc_g");
    mocked.applyOp.mockResolvedValueOnce(editResult({ delta: { systems: [added] } }));
    mocked.getSystem.mockResolvedValueOnce({ system: added, neighbours: [], nebula: null });

    expect(await editor().addSystemAt(10, -4, "empire_init_01", 1)).toBe(true);

    expect(mocked.applyOp).toHaveBeenCalledTimes(1);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "AddSystem",
      id: null,
      x: 10,
      y: -4,
      name: null,
      initializer: "empire_init_01",
      spawn_weight: null,
      spawn_script: { paint_a_galaxy: { kind: "enabled", random_value: 6, player: false } },
    });
    expect(editor().selection).toEqual([6]);

    mocked.applyOp.mockClear();
    mocked.applyOp.mockResolvedValueOnce(editResult({ delta: { systems: [added] } }));
    await editor().addSystemAt(10, -4, null, null);
    expect(mocked.applyOp).toHaveBeenCalledTimes(1);
  });

  it("a refused AddSystem selects nothing", async () => {
    mocked.applyOp.mockRejectedValueOnce({ kind: "op", message: "a save cannot add systems" });

    await editor().addSystemAt(1, 2);

    expect(editor().selection).toEqual([]);
    expect(sessionError()).toBe("a save cannot add systems");
  });

  it.each([
    [1, "Delete Alpha Centauri and its 4 lanes?"],
    [0, "Delete Sol and its 1 lane?"],
    [5, "Delete Deneb?"],
  ])("removeSystem asks about %i and sends nothing when declined", async (id, question) => {
    mocked.confirm.mockResolvedValueOnce(false);

    await editor().removeSystem(id);

    expect(mocked.confirm).toHaveBeenCalledWith(
      question,
      expect.objectContaining({ kind: "warning" }),
    );
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });

  it("removeSystem drops the system from the galaxy, the selection and the inspector", async () => {
    await editor().select(1);
    editor().setHover(1);
    expect(editor().inspected?.system.id).toBe(1);
    const neighbours = SYSTEMS.filter((s) => s.lanes.some((l) => l.to === 1)).map((s) => ({
      ...s,
      lanes: s.lanes.filter((l) => l.to !== 1),
    }));
    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: neighbours, removed: [1] } }),
    );

    await editor().removeSystem(1);

    expect(mocked.applyOp).toHaveBeenCalledWith({ type: "RemoveSystem", id: 1 });
    expect(useGalaxyStore.getState().systems.has(1)).toBe(false);
    expect(useGalaxyStore.getState().systems.get(0)?.lanes).toEqual([]);
    expect(editor().selection).toEqual([]);
    expect(editor().hover).toBeNull();
    expect(editor().inspected).toBeNull();
  });

  it("removeSystem of an unknown id asks nothing", async () => {
    await editor().removeSystem(99);

    expect(mocked.confirm).not.toHaveBeenCalled();
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });
});

describe("deleting a selection of systems", () => {
  const effects = { focusSearch: vi.fn(), browseInitializers: vi.fn() };

  beforeEach(() => {
    mocked.applyOp.mockResolvedValue(editResult());
  });

  it("asks, counting each lane touching them once, then removes them all as one edit", async () => {
    await editor().setSelection([0, 1, 2], "replace");
    run("deleteSelection", false, effects);
    await vi.waitFor(() => expect(mocked.applyOp).toHaveBeenCalled());
    expect(mocked.confirm).toHaveBeenCalledWith(
      "Delete 3 systems and their 4 lanes?",
      expect.objectContaining({ kind: "warning" }),
    );
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "Batch",
      description: "Deleted 3 systems",
      ops: [{ type: "RemoveSystems", ids: [0, 1, 2] }],
    });
  });

  it("sends nothing when the question is declined", async () => {
    mocked.confirm.mockResolvedValueOnce(false);
    await editor().setSelection([0, 5], "replace");
    await editor().deleteSelection();
    expect(mocked.confirm).toHaveBeenCalledWith("Delete 2 systems and their 1 lane?", {
      title: "Delete systems",
      kind: "warning",
    });
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });

  it("deletes a single selected system too, asking about it and its lanes", async () => {
    await editor().select(1);
    run("deleteSelection", false, effects);
    await vi.waitFor(() => expect(mocked.applyOp).toHaveBeenCalled());
    expect(mocked.confirm).toHaveBeenCalledWith(
      "Delete Alpha Centauri and its 4 lanes?",
      expect.objectContaining({ kind: "warning" }),
    );
    expect(mocked.applyOp).toHaveBeenCalledWith({ type: "RemoveSystem", id: 1 });
  });

  it("names the selection as deletable on a scenario, and nothing on a save", async () => {
    await editor().setSelection([0, 1], "replace");
    expect(deletableSelection(editor())).toEqual({ kind: "systems", ids: [0, 1] });
    expect(canDelete(editor())).toBe(true);

    await openFixtureSave();
    await editor().setSelection([0, 1], "replace");
    expect(canDelete(editor())).toBe(false);
    await editor().deleteSelection();
    expect(mocked.confirm).not.toHaveBeenCalled();
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });
});
