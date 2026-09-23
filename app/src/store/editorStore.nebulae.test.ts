import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { editor, mocked, openFixtureSave, sessionError } from "./editorFixture";
import { DEFAULT_NEBULA_RADIUS, useEditorStore } from "./editorStore";
import { useGalaxyStore } from "./galaxyStore";
import { useLayoutStore } from "./layoutStore";
import { useMapChromeStore } from "./mapChromeStore";
import { OPEN_RESULT, SYSTEMS, editResult, name } from "./fixture";

beforeEach(openFixtureSave);

describe("editing nebulae", () => {
  const cloud = OPEN_RESULT.galaxy.nebulae[0];

  it("addNebulaAt sends AddNebula at the point and selects the nebula it appends", async () => {
    const added = { ...cloud, x: 60, y: -10, systems: [] };
    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [], nebulae: [cloud, added] } }),
    );

    expect(await editor().addNebulaAt(60, -10)).toBe(true);

    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "AddNebula",
      x: 60,
      y: -10,
      radius: DEFAULT_NEBULA_RADIUS,
      name: null,
    });
    expect(useGalaxyStore.getState().nebulae).toEqual([cloud, added]);
    expect(editor().selectedNebula).toBe(1);
    expect(useLayoutStore.getState().tab).toBe("inspector");
  });

  it("two nebulae asked for at once each select the one that call made", async () => {
    const first = { ...cloud, x: 60, y: -10, systems: [] };
    const second = { ...cloud, x: 70, y: -20, systems: [] };
    mocked.applyOp
      .mockResolvedValueOnce(editResult({ delta: { systems: [], nebulae: [cloud, first] } }))
      .mockResolvedValueOnce(
        editResult({ delta: { systems: [], nebulae: [cloud, first, second] } }),
      );
    const selected: Array<number | null> = [];
    const unsubscribe = useEditorStore.subscribe((state, prev) => {
      if (state.selectedNebula !== prev.selectedNebula) selected.push(state.selectedNebula);
    });

    const both = [editor().addNebulaAt(60, -10), editor().addNebulaAt(70, -20)];
    expect(await Promise.all(both)).toEqual([true, true]);
    unsubscribe();

    expect(selected).toEqual([1, 2]);
  });

  it("addNebulaAt remembers the radius it was given for the next one", async () => {
    mocked.applyOp.mockResolvedValue(editResult({ delta: { systems: [], nebulae: [cloud] } }));

    await editor().addNebulaAt(0, 0, 45, "Far Cloud");
    expect(editor().lastNebulaRadius).toBe(45);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "AddNebula",
      x: 0,
      y: 0,
      radius: 45,
      name: "Far Cloud",
    });

    await editor().addNebulaAt(10, 10);
    expect(mocked.applyOp).toHaveBeenLastCalledWith(
      expect.objectContaining({ radius: 45, name: null }),
    );
  });

  it("a refused AddNebula selects nothing and leaves the remembered radius alone", async () => {
    mocked.applyOp.mockRejectedValueOnce({ kind: "op", message: "radius must be above 0" });

    expect(await editor().addNebulaAt(0, 0, 0)).toBe(false);

    expect(editor().selectedNebula).toBeNull();
    expect(editor().lastNebulaRadius).toBe(DEFAULT_NEBULA_RADIUS);
    expect(sessionError()).toBe("radius must be above 0");
  });

  it("addNebulaAt shows the nebulae layer, and leaves it on when it already was", async () => {
    mocked.applyOp.mockResolvedValue(editResult({ delta: { systems: [], nebulae: [cloud] } }));
    const chrome = useMapChromeStore.getState();
    useMapChromeStore.setState({ layers: { ...chrome.layers, nebulae: false } });

    await editor().addNebulaAt(60, -10);
    expect(useMapChromeStore.getState().layers.nebulae).toBe(true);

    await editor().addNebulaAt(20, 20);
    expect(useMapChromeStore.getState().layers.nebulae).toBe(true);
  });

  it("a new nebula is named before it is created, and a blank name creates nothing", async () => {
    mocked.applyOp.mockResolvedValue(editResult({ delta: { systems: [], nebulae: [cloud] } }));

    editor().promptNebulaAt(60, -10);
    expect(editor().nebulaPrompt).toEqual({ x: 60, y: -10 });

    expect(await editor().createPromptedNebula("  ")).toBe(false);
    expect(mocked.applyOp).not.toHaveBeenCalled();
    expect(editor().nebulaPrompt).toEqual({ x: 60, y: -10 });

    mocked.applyOp.mockRejectedValueOnce({ kind: "op", message: "radius must be above 0" });
    expect(await editor().createPromptedNebula("Far Cloud")).toBe(false);
    expect(editor().nebulaPrompt).toEqual({ x: 60, y: -10 });

    expect(await editor().createPromptedNebula("  Far Cloud  ")).toBe(true);
    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "AddNebula",
      x: 60,
      y: -10,
      radius: DEFAULT_NEBULA_RADIUS,
      name: "Far Cloud",
    });
    expect(editor().nebulaPrompt).toBeNull();
    expect(useMapChromeStore.getState().layers.nebulae).toBe(true);
  });

  it("a cancelled prompt forgets the point and creates nothing", async () => {
    editor().promptNebulaAt(1, 2);
    editor().cancelNebulaPrompt();

    expect(editor().nebulaPrompt).toBeNull();
    expect(await editor().createPromptedNebula("Far Cloud")).toBe(false);
    expect(mocked.applyOp).not.toHaveBeenCalled();
  });

  it("setNebulaName renames the cloud at its file index", async () => {
    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [], nebulae: [{ ...cloud, name: name("Sea of Ghosts") }] } }),
    );

    await editor().setNebulaName(0, "Sea of Ghosts");

    expect(mocked.applyOp).toHaveBeenCalledWith({
      type: "SetNebulaName",
      index: 0,
      name: "Sea of Ghosts",
    });
    expect(useGalaxyStore.getState().nebulae[0].name.key).toBe("Sea of Ghosts");
  });

  it("setNebulaRadius resizes the cloud and the delta carries who joined it", async () => {
    const grown = { ...cloud, radius: 60, systems: [2, 5] };
    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...SYSTEMS[2], nebula: 0 }], nebulae: [grown] } }),
    );

    editor().selectNebula(0);
    await editor().setNebulaRadius(0, 60);

    expect(mocked.applyOp).toHaveBeenCalledWith({ type: "SetNebulaRadius", index: 0, radius: 60 });
    expect(useGalaxyStore.getState().nebulae).toEqual([grown]);
    expect(useGalaxyStore.getState().systems.get(2)?.nebula).toBe(0);
    expect(editor().selectedNebula).toBe(0);
  });

  it("deleteSelection removes the selected nebula and drops the selection", async () => {
    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...SYSTEMS[5], nebula: null }], nebulae: [] } }),
    );

    editor().selectNebula(0);
    await editor().deleteSelection();

    expect(mocked.confirm).toHaveBeenCalledWith(
      "Delete Cloud? 1 system will leave it.",
      expect.objectContaining({ kind: "warning" }),
    );
    expect(mocked.applyOp).toHaveBeenCalledWith({ type: "RemoveNebula", index: 0 });
    expect(useGalaxyStore.getState().nebulae).toEqual([]);
    expect(useGalaxyStore.getState().systems.get(5)?.nebula).toBeNull();
    expect(editor().selectedNebula).toBeNull();
  });

  it("deleteSelection asks first, and a declined question keeps the nebula", async () => {
    mocked.confirm.mockResolvedValueOnce(false);

    editor().selectNebula(0);
    await editor().deleteSelection();

    expect(mocked.applyOp).not.toHaveBeenCalled();
    expect(editor().selectedNebula).toBe(0);
  });

  it("a refused RemoveNebula keeps the nebula selected", async () => {
    mocked.applyOp.mockRejectedValueOnce({ kind: "op", message: "no nebula 0" });

    editor().selectNebula(0);
    await editor().removeNebula(0);

    expect(editor().selectedNebula).toBe(0);
    expect(sessionError()).toBe("no nebula 0");
  });

  it("a nebula, a system and a lane take the selection from one another", async () => {
    editor().selectNebula(0);
    expect(editor().selectedNebula).toBe(0);

    await editor().select(1);
    expect(editor().selectedNebula).toBeNull();
    expect(editor().selection).toEqual([1]);

    editor().selectNebula(0);
    expect(editor().selection).toEqual([]);
    expect(editor().inspected).toBeNull();

    editor().selectLane({ a: 0, b: 1 });
    expect(editor().selectedNebula).toBeNull();

    editor().selectNebula(0);
    expect(editor().selectedLane).toBeNull();

    await editor().select(null);
    expect(editor().selectedNebula).toBeNull();
  });
});
