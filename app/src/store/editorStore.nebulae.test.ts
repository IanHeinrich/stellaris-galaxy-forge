import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { editor, openFixtureSave, sessionError } from "./editorFixture";
import { DEFAULT_NEBULA_RADIUS, useEditorStore } from "./editorStore";
import { useGalaxyStore } from "./galaxyStore";
import { useLayoutStore } from "./layoutStore";
import { useMapChromeStore } from "./mapChromeStore";
import { OPEN_RESULT, SYSTEMS, editResult, name } from "./fixture";
import { mockedIpc } from "../test/ipc";

const addNebula = mockedIpc.addNebula;

beforeEach(openFixtureSave);

describe("editing nebulae", () => {
  const cloud = OPEN_RESULT.galaxy.nebulae[0];

  it("moveNebula sends MoveNebula for the nebula at its file index and moves the cloud", async () => {
    const moved = { ...cloud, x: -20, y: 30 };
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [], nebulae: [moved] } }),
    );

    await editor().moveNebula(0, -20, 30);

    expect(mockedIpc.applyOp).toHaveBeenCalledWith({ type: "MoveNebula", index: 0, x: -20, y: 30 });
    expect(useGalaxyStore.getState().nebulae[0]).toEqual(moved);
  });

  it("addNebulaAt places a named nebula at once, with no prompt, and selects it", async () => {
    const added = { ...cloud, name: name("Yinarim_Nebula"), x: 60, y: -10, systems: [] };
    addNebula.mockResolvedValueOnce(
      editResult({ delta: { systems: [], nebulae: [cloud, added] } }),
    );

    expect(await editor().addNebulaAt(60, -10)).toBe(true);

    expect(addNebula).toHaveBeenCalledTimes(1);
    const [seed, x, y, radius] = addNebula.mock.calls[0];
    expect(Number.isSafeInteger(seed)).toBe(true);
    expect([x, y, radius]).toEqual([60, -10, DEFAULT_NEBULA_RADIUS]);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(useGalaxyStore.getState().nebulae).toEqual([cloud, added]);
    expect(editor().selectedNebula).toBe(1);
    expect(useLayoutStore.getState().tab).toBe("inspector");
    expect(Object.keys(editor())).not.toContain("nebulaPrompt");
  });

  it("each new nebula is asked for with a fresh seed", async () => {
    addNebula.mockResolvedValue(editResult({ delta: { systems: [], nebulae: [cloud] } }));

    await editor().addNebulaAt(0, 0);
    await editor().addNebulaAt(0, 0);

    const [first, second] = addNebula.mock.calls.map(([seed]) => seed);
    expect(first).not.toBe(second);
  });

  it("two nebulae asked for at once each select the one that call made", async () => {
    const first = { ...cloud, x: 60, y: -10, systems: [] };
    const second = { ...cloud, x: 70, y: -20, systems: [] };
    addNebula
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
    addNebula.mockResolvedValue(editResult({ delta: { systems: [], nebulae: [cloud] } }));

    await editor().addNebulaAt(0, 0, 45);
    expect(editor().lastNebulaRadius).toBe(45);
    expect(addNebula).toHaveBeenLastCalledWith(expect.any(Number), 0, 0, 45);

    await editor().addNebulaAt(10, 10);
    expect(addNebula).toHaveBeenLastCalledWith(expect.any(Number), 10, 10, 45);
  });

  it("a refused nebula selects nothing and leaves the remembered radius alone", async () => {
    addNebula.mockRejectedValueOnce({ kind: "op", message: "radius must be above 0" });

    expect(await editor().addNebulaAt(0, 0, 0)).toBe(false);

    expect(editor().selectedNebula).toBeNull();
    expect(editor().lastNebulaRadius).toBe(DEFAULT_NEBULA_RADIUS);
    expect(sessionError()).toBe("radius must be above 0");
  });

  it("addNebulaAt shows the nebulae layer, and leaves it on when it already was", async () => {
    addNebula.mockResolvedValue(editResult({ delta: { systems: [], nebulae: [cloud] } }));
    const chrome = useMapChromeStore.getState();
    useMapChromeStore.setState({ layers: { ...chrome.layers, nebulae: false } });

    await editor().addNebulaAt(60, -10);
    expect(useMapChromeStore.getState().layers.nebulae).toBe(true);

    await editor().addNebulaAt(20, 20);
    expect(useMapChromeStore.getState().layers.nebulae).toBe(true);
  });

  it("setNebulaName renames the cloud at its file index", async () => {
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [], nebulae: [{ ...cloud, name: name("Sea of Ghosts") }] } }),
    );

    await editor().setNebulaName(0, "Sea of Ghosts");

    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "SetNebulaName",
      index: 0,
      name: "Sea of Ghosts",
    });
    expect(useGalaxyStore.getState().nebulae[0].name.key).toBe("Sea of Ghosts");
  });

  it("setNebulaRadius resizes the cloud and the delta carries who joined it", async () => {
    const grown = { ...cloud, radius: 60, systems: [2, 5] };
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...SYSTEMS[2], nebula: 0 }], nebulae: [grown] } }),
    );

    editor().selectNebula(0);
    await editor().setNebulaRadius(0, 60);

    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "SetNebulaRadius",
      index: 0,
      radius: 60,
    });
    expect(useGalaxyStore.getState().nebulae).toEqual([grown]);
    expect(useGalaxyStore.getState().systems.get(2)?.nebula).toBe(0);
    expect(editor().selectedNebula).toBe(0);
  });

  it("deleteSelection removes the selected nebula and drops the selection", async () => {
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...SYSTEMS[5], nebula: null }], nebulae: [] } }),
    );

    editor().selectNebula(0);
    await editor().deleteSelection();

    expect(mockedIpc.confirm).toHaveBeenCalledWith(
      "Delete Cloud? 1 system will leave it.",
      expect.objectContaining({ kind: "warning" }),
    );
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({ type: "RemoveNebula", index: 0 });
    expect(useGalaxyStore.getState().nebulae).toEqual([]);
    expect(useGalaxyStore.getState().systems.get(5)?.nebula).toBeNull();
    expect(editor().selectedNebula).toBeNull();
  });

  it("deleteSelection asks first, and a declined question keeps the nebula", async () => {
    mockedIpc.confirm.mockResolvedValueOnce(false);

    editor().selectNebula(0);
    await editor().deleteSelection();

    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
    expect(editor().selectedNebula).toBe(0);
  });

  it("a refused RemoveNebula keeps the nebula selected", async () => {
    mockedIpc.applyOp.mockRejectedValueOnce({ kind: "op", message: "no nebula 0" });

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
