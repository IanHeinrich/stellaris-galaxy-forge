import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditResult } from "../generated/EditResult";
import type { SearchHit } from "../generated/SearchHit";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { editor, openFixtureSave, sessionError } from "./editorFixture";
import { RECENT_HITS } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useInspectorStore } from "./inspectorStore";
import { useLayoutStore } from "./layoutStore";
import { useGalaxyStore } from "./galaxyStore";
import { OPEN_RESULT, SYSTEMS, editResult, withLaneLength } from "./fixture";
import { mockedIpc } from "../test/ipc";

beforeEach(openFixtureSave);

describe("selection and navigation", () => {
  it("select fetches the inspected system and select(null) clears it", async () => {
    await editor().select(1);
    let state = editor();
    expect(state.selection).toEqual([1]);
    expect(state.inspected?.system.name.key).toBe("NAME_Alpha_Centauri");
    expect(state.inspected?.neighbours.map((n) => n.id)).toEqual([0, 2, 3, 4]);
    expect(mockedIpc.getSystem).toHaveBeenCalledWith(1);

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
      matched_on: null,
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

describe("nudge", () => {
  beforeEach(() => {
    mockedIpc.applyOp.mockResolvedValue(editResult());
  });

  it("moves a single selected system with MoveSystem and several with one MoveSystems", async () => {
    await editor().select(2);
    await editor().nudgeSelection(-1, 10);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({ type: "MoveSystem", id: 2, x: 19, y: 20 });

    mockedIpc.applyOp.mockClear();
    await editor().setSelection([0, 5], "replace");
    await editor().nudgeSelection(1, -1);
    expect(mockedIpc.applyOp).toHaveBeenCalledWith({
      type: "MoveSystems",
      moves: [
        { id: 0, x: 1, y: -1 },
        { id: 5, x: -39, y: 39 },
      ],
    });
  });

  it("moves on from where the last nudge left the system when a second press comes before it lands", async () => {
    await editor().select(2);
    let land: (result: EditResult) => void = () => undefined;
    mockedIpc.applyOp.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const first = editor().nudgeSelection(-1, 10);
    const second = editor().nudgeSelection(-1, 10);
    await new Promise((resolve) => setTimeout(resolve, 0));

    land(editResult({ delta: { systems: [{ ...SYSTEMS[2], x: 19, y: 20 }] } }));
    await Promise.all([first, second]);

    expect(mockedIpc.applyOp.mock.calls.map(([op]) => op)).toEqual([
      { type: "MoveSystem", id: 2, x: 19, y: 20 },
      { type: "MoveSystem", id: 2, x: 18, y: 30 },
    ]);
  });

  it("does nothing with no selection or a lane selected", async () => {
    await editor().nudgeSelection(1, 0);
    editor().selectLane({ a: 0, b: 1 });
    await editor().nudgeSelection(1, 0);
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
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
    mockedIpc.applyOp.mockResolvedValueOnce(editResult());

    await editor().deleteSelection();

    expect(mockedIpc.applyOp).toHaveBeenCalledWith({ type: "RemoveLane", a: 0, b: 1 });
    expect(editor().selectedLane).toBeNull();
  });

  it("deleteSelection keeps the lane selected when the op is refused", async () => {
    editor().selectLane({ a: 0, b: 1 });
    mockedIpc.applyOp.mockRejectedValueOnce({ kind: "op", message: "refused" });

    await editor().deleteSelection();

    expect(editor().selectedLane).toEqual({ a: 0, b: 1 });
    expect(sessionError()).toBe("refused");
  });

  it("clears the selected lane when an applied delta removes it", async () => {
    editor().selectLane({ a: 0, b: 1 });
    const isolatedSol = { ...SYSTEMS[0], lanes: [] };
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ delta: { systems: [isolatedSol] } }));

    await editor().applyOp({ type: "IsolateSystem", id: 0 });

    expect(editor().selectedLane).toBeNull();
  });

  it("keeps the lane selected when an edit re-projects both of its ends", async () => {
    editor().selectLane({ a: 0, b: 1 });
    useInspectorStore
      .getState()
      .setRoot({ ref: { kind: "lane", a: 0, b: 1 }, label: "Sol — Alpha" });
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: withLaneLength(0, 1, 42) } }),
    );

    await editor().applyOp({ type: "SetLaneLengths", lanes: [{ a: 0, b: 1, length: 42 }] });

    expect(editor().selectedLane).toEqual({ a: 0, b: 1 });
    expect(mockedIpc.getSystem).not.toHaveBeenCalled();
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
    expect(mockedIpc.getSystem).toHaveBeenCalledTimes(1);

    await editor().toggleSelect(3);
    expect(editor().selection).toEqual([1, 3]);
    expect(editor().inspected).toBeNull();
    expect(mockedIpc.getSystem).toHaveBeenCalledTimes(1);

    await editor().toggleSelect(1);
    expect(editor().selection).toEqual([3]);
    expect(editor().inspected?.system.id).toBe(3);
    expect(mockedIpc.getSystem).toHaveBeenCalledTimes(2);
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

  it("Delete does nothing to a save's systems, or with nothing selected", async () => {
    await editor().deleteSelection();
    await editor().setSelection([0, 1], "replace");
    await editor().deleteSelection();
    expect(mockedIpc.applyOp).not.toHaveBeenCalled();
  });

  it("selection survives a delta and drops ids no longer present", async () => {
    await editor().setSelection([0, 2, 5], "replace");
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...SYSTEMS[0], x: -5, y: 5 }] } }),
    );
    await editor().applyOp({ type: "MoveSystem", id: 0, x: -5, y: 5 });
    expect(editor().selection).toEqual([0, 2, 5]);
    expect(mockedIpc.getSystem).not.toHaveBeenCalled();

    useGalaxyStore.getState().load({ ...OPEN_RESULT.galaxy, systems: SYSTEMS.slice(0, 5) });
    mockedIpc.applyOp.mockResolvedValueOnce(editResult());
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
    mockedIpc.applyOp.mockResolvedValue(
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
