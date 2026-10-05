import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import type { EditResult } from "../generated/EditResult";
import type { PreparePreview } from "../generated/PreparePreview";
import type { PrepareRow } from "../generated/PrepareRow";
import { PREPARE_PRESETS } from "../generated/constants";
import { summaryLine } from "../lib/prepareCopy";
import { stubPrefs } from "../test/prefs";
import { mockedIpc } from "../test/ipc";
import { until } from "../test/wait";
import { deferred, editor, openFixtureSave, openFixtureScenario } from "./editorFixture";
import { editResult, historyEntry, SCENARIO_RESULT } from "./fixture";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";
import { useLayoutStore } from "./layoutStore";
import { PREF_KEYS } from "./prefKeys";
import {
  leftOutRows,
  nearestPreset,
  PREPARE_ROWS,
  PREPARE_SECTION,
  presetOf,
  ringedSystems,
  usePrepareStore,
} from "./prepareStore";

const prepare = () => usePrepareStore.getState();
const stored = stubPrefs();

/** A plain scenario's preview: only the rows named hold systems. */
function previewOf(
  changes: number,
  filled: Partial<Record<PrepareRow, number[]>> = { enclaves: [1, 2] },
): PreparePreview {
  return {
    profile: "plain",
    rows: PREPARE_ROWS.map((row) => ({ row, systems: filled[row] ?? [] })),
    changes,
  };
}

/** What `prepare_apply` answers: the edit as history line `seq`, and the count it changed. */
function prepared(seq: number, changes: number): { edit: EditResult; changes: number } {
  const entry = historyEntry(seq, `Prepared ${changes} systems for a new game`);
  return { edit: editResult({ entry, history: { undo: [entry], redo: [] } }), changes };
}

/** Reads the preview for `changes` and waits until it stands for the current choices. */
async function previewed(changes: number): Promise<void> {
  mockedIpc.preparePreview.mockResolvedValue(previewOf(changes));
  await prepare().refresh();
  await until(() => expect(prepare().current).toBe(true));
}

beforeEach(async () => {
  stubPrefs(stored);
  await openFixtureScenario();
  mockedIpc.preparePreview.mockResolvedValue(previewOf(0));
  mockedIpc.getInitializers.mockResolvedValue([]);
  useGameDataStore.setState({ status: "ready" });
  await until(() => expect(prepare().preview).not.toBeNull());
  mockedIpc.preparePreview.mockClear();
});

describe("the Prepare choices", () => {
  it("name their preset, show Custom once they match none, and remember the preset picked", () => {
    expect(presetOf(prepare().choices)).toBe("faithful");
    prepare().setPreset("fresh_start");
    expect(prepare().choices).toEqual(PREPARE_PRESETS.fresh_start);
    expect(stored.get(PREF_KEYS.preparePreset)).toBe(JSON.stringify("fresh_start"));

    prepare().setChoice("guardians", "plain");
    expect(presetOf(prepare().choices)).toBe("custom");
    expect(nearestPreset(prepare().choices)).toEqual({ preset: "fresh_start", rows: 1 });
    expect(stored.get(PREF_KEYS.preparePreset)).toBe(JSON.stringify("fresh_start"));

    prepare().reset();
    expect(prepare().choices).toEqual(PREPARE_PRESETS.fresh_start);
  });

  it("are previewed again when they change, and after an edit or an undo settles", async () => {
    mockedIpc.preparePreview.mockResolvedValue(previewOf(3));
    prepare().setPreset("bare_shell");
    await until(() => expect(prepare().preview?.changes).toBe(3));
    const sent = mockedIpc.preparePreview.mock.calls[0][0];
    expect(sent).toHaveLength(PREPARE_ROWS.length);
    expect(sent.find((c) => c.row === "wormhole_pairs")?.choice).toBe("none");

    mockedIpc.preparePreview.mockResolvedValue(previewOf(2));
    mockedIpc.applyOp.mockResolvedValueOnce(editResult());
    await editor().applyOp({ type: "MoveSystem", system: 0, x: 1, y: 1 });
    expect(prepare().current).toBe(false);
    await until(() => expect(prepare().preview?.changes).toBe(2));
    expect(prepare().current).toBe(true);

    mockedIpc.preparePreview.mockResolvedValue(previewOf(3));
    mockedIpc.undo.mockResolvedValueOnce(editResult({ history: { undo: [], redo: [] } }));
    await editor().undo();
    await until(() => expect(prepare().preview?.changes).toBe(3));
  });

  it("are read again only once the Galaxy page is in view", async () => {
    useLayoutStore.getState().setTab("issues");
    mockedIpc.applyOp.mockResolvedValueOnce(editResult());
    await editor().applyOp({ type: "MoveSystem", system: 0, x: 1, y: 1 });
    await new Promise((r) => setTimeout(r, 400));
    expect(mockedIpc.preparePreview).not.toHaveBeenCalled();

    useLayoutStore.getState().setTab("inspector");
    await until(() => expect(mockedIpc.preparePreview).toHaveBeenCalledTimes(1));
  });

  it("are never previewed on a save", async () => {
    await openFixtureSave();
    mockedIpc.getInitializers.mockResolvedValue([]);
    useGameDataStore.setState({ status: "ready" });
    await prepare().refresh();
    mockedIpc.applyOp.mockResolvedValueOnce(editResult());
    await editor().applyOp({ type: "MoveSystem", system: 0, x: 1, y: 1 });
    await new Promise((r) => setTimeout(r, 400));
    expect(mockedIpc.preparePreview).not.toHaveBeenCalled();
    expect(prepare().preview).toBeNull();
  });

  it("drop the preview without game data, and keep only the latest answer", async () => {
    const slow = deferred<PreparePreview>();
    mockedIpc.preparePreview.mockReturnValueOnce(slow.promise);
    const first = prepare().refresh();
    mockedIpc.preparePreview.mockResolvedValueOnce(previewOf(4));
    await prepare().refresh();
    slow.resolve(previewOf(9));
    await first;
    expect(prepare().preview?.changes).toBe(4);

    useGameDataStore.setState({ status: "idle" });
    await until(() => expect(prepare().preview).toBeNull());
  });

  it("leave a row out only when it has systems and its choice is not Keep", async () => {
    mockedIpc.preparePreview.mockResolvedValue(previewOf(5, { enclaves: [1, 2], guardians: [3] }));
    prepare().setPreset("bare_shell");
    await until(() => expect(prepare().current).toBe(true));
    // Bare shell takes wormhole pairs out, but a plain scenario has none; nor are there fallen empires.
    expect(leftOutRows(prepare())).toEqual(["guardians", "enclaves"]);

    prepare().setChoice("enclaves", "keep");
    expect(leftOutRows(prepare())).toEqual(["guardians"]);
  });

  it("ring the hovered row's systems", () => {
    prepare().hover("enclaves");
    expect(ringedSystems(prepare())).toEqual([1, 2]);
    prepare().hover(null);
    expect(ringedSystems(prepare())).toEqual([]);
  });
});

describe("Apply", () => {
  it("writes the choices as one edit, closes the section and names what it changed", async () => {
    useInspectorStore.getState().showGalaxy(PREPARE_SECTION);
    mockedIpc.preparePreview.mockResolvedValue(previewOf(5));
    prepare().setPreset("fresh_start");
    await until(() => expect(prepare().current).toBe(true));
    expect(summaryLine("fresh_start", 5, null)).toBe("Fresh start · changes 5 systems");

    mockedIpc.preparePreview.mockResolvedValue(previewOf(0));
    // The edit's own count, which a document edited since the preview may have moved.
    mockedIpc.prepareApply.mockResolvedValueOnce(prepared(1, 6));
    expect(await prepare().apply()).toBe(true);
    expect(mockedIpc.prepareApply).toHaveBeenCalledTimes(1);
    expect(mockedIpc.prepareApply.mock.calls[0][0]).toHaveLength(PREPARE_ROWS.length);
    expect(useInspectorStore.getState().sections[PREPARE_SECTION]).toBe(true);
    expect(prepare().applied).toEqual({ preset: "fresh_start", changed: 6, seq: 1 });
    await until(() => expect(prepare().preview?.changes).toBe(0));
    expect(useFileSessionStore.getState().dirty).toBe(true);
    const { choices, preview, applied } = prepare();
    expect(summaryLine(presetOf(choices), preview?.changes ?? null, applied)).toBe(
      "Fresh start · 6 systems changed",
    );
  });

  it("waits for the preview of the choices as they now stand", async () => {
    await previewed(5);
    mockedIpc.preparePreview.mockReturnValueOnce(new Promise(() => undefined));
    prepare().setChoice("guardians", "plain");
    expect(prepare().current).toBe(false);
    expect(await prepare().apply()).toBe(false);
    expect(mockedIpc.prepareApply).not.toHaveBeenCalled();

    await previewed(6);
    mockedIpc.prepareApply.mockResolvedValueOnce(prepared(1, 6));
    expect(await prepare().apply()).toBe(true);
  });

  it("is forgotten once undo takes its edit back", async () => {
    await previewed(5);
    mockedIpc.prepareApply.mockResolvedValueOnce(prepared(1, 5));
    await prepare().apply();
    expect(prepare().applied?.seq).toBe(1);

    const moved = historyEntry(2, "Moved Sol");
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ entry: moved, history: { undo: [historyEntry(1, "x"), moved], redo: [] } }),
    );
    await editor().applyOp({ type: "MoveSystem", system: 0, x: 1, y: 1 });
    expect(prepare().applied?.seq).toBe(1);

    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ history: { undo: [historyEntry(1, "x")], redo: [moved] } }),
    );
    await editor().undo();
    expect(prepare().applied?.seq).toBe(1);
    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ history: { undo: [], redo: [historyEntry(1, "x"), moved] } }),
    );
    await editor().undo();
    expect(prepare().applied).toBeNull();
  });

  it("sends nothing while the choices change nothing", async () => {
    await previewed(0);
    expect(await prepare().apply()).toBe(false);
    expect(mockedIpc.prepareApply).not.toHaveBeenCalled();
  });
});

describe("opening the section", () => {
  it("follows Open save as scenario to the Galaxy page", async () => {
    useLayoutStore.getState().setTab("issues");
    useInspectorStore.setState({ sections: {} });
    mockedIpc.openAsScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await useFileSessionStore.getState().openScenarioFrom("C:/saves/2277.05.20.sav");
    await until(() => expect(useLayoutStore.getState().tab).toBe("inspector"));
    expect(useInspectorStore.getState().stack.map((e) => e.ref.kind)).toEqual(["galaxy"]);
    expect(useInspectorStore.getState().sections[PREPARE_SECTION]).toBe(false);
  });

  it("clears the map selection when asked from the File menu", async () => {
    await editor().setSelection([0, 1], "replace");
    useInspectorStore.getState().closeSection(PREPARE_SECTION);
    await prepare().reveal();
    expect(editor().selection).toEqual([]);
    expect(useInspectorStore.getState().sections[PREPARE_SECTION]).toBe(false);
    expect(useLayoutStore.getState().tab).toBe("inspector");
  });
});
