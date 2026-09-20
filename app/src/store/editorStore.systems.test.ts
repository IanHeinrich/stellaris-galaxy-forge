import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { editor, mocked, openFixtureSave, sessionError } from "./editorFixture";
import { useGalaxyStore } from "./galaxyStore";
import { SYSTEMS, editResult, node } from "./fixture";

beforeEach(openFixtureSave);

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
    });
    expect(useGalaxyStore.getState().systems.get(9)).toEqual(added);
    expect(editor().selection).toEqual([9]);
    expect(editor().inspected?.system.id).toBe(9);
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
    });
    expect(editor().selection).toEqual([9]);
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
