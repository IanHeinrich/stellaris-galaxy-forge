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
import { GALAXY_ENTRY, useInspectorStore } from "./inspectorStore";
import { useLayoutStore } from "./layoutStore";
import { PREF_KEYS } from "./prefKeys";
import {
  changesRow,
  cutOffSeats,
  nearestPreset,
  offeredChoices,
  PREPARE_ROWS,
  PREPARE_SECTION,
  presetOf,
  ringedSystems,
  setupScreen,
  systemOutcomes,
  usePrepareStore,
} from "./prepareStore";

const prepare = () => usePrepareStore.getState();
const stored = stubPrefs();

/** A plain scenario's preview: only the rows named hold systems. */
function previewOf(
  changes: number,
  filled: Partial<Record<PrepareRow, number[]>> = { enclaves: [1, 2] },
  beside: Partial<Pick<PreparePreview, "kept_clear" | "cut_off" | "new_seats" | "new_zones">> = {},
): PreparePreview {
  return {
    profile: "plain",
    rows: PREPARE_ROWS.map((row) => ({ row, systems: filled[row] ?? [] })),
    changes,
    kept_clear: [],
    cut_off: [],
    new_seats: [],
    new_zones: [],
    ...beside,
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
    expect(presetOf(prepare().choices, "plain")).toBe("faithful");
    prepare().setPreset("fresh_start");
    expect(prepare().choices).toEqual(PREPARE_PRESETS.plain.fresh_start);
    expect(stored.get(PREF_KEYS.preparePreset)).toBe(JSON.stringify("fresh_start"));

    prepare().setChoice("guardians", "plain");
    expect(presetOf(prepare().choices, "plain")).toBe("custom");
    expect(nearestPreset(prepare().choices, "plain")).toEqual({ preset: "fresh_start", rows: 1 });
    expect(stored.get(PREF_KEYS.preparePreset)).toBe(JSON.stringify("fresh_start"));

    prepare().reset();
    expect(prepare().choices).toEqual(PREPARE_PRESETS.plain.fresh_start);
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

  it("change a row only when it has systems and its choice is not Keep", async () => {
    mockedIpc.preparePreview.mockResolvedValue(previewOf(5, { enclaves: [1, 2], guardians: [3] }));
    prepare().setPreset("bare_shell");
    await until(() => expect(prepare().current).toBe(true));
    // Bare shell takes wormhole pairs out, but a plain scenario has none.
    const changed = () => PREPARE_ROWS.filter((row) => changesRow(prepare(), row));
    expect(changed()).toEqual(["guardians", "enclaves"]);

    prepare().setChoice("enclaves", "keep");
    expect(changed()).toEqual(["guardians"]);
  });

  it("mark only the new starting positions and fallen empire zones Galaxy Forge draws", () => {
    const preview = previewOf(
      0,
      { guardians: [2], enclaves: [3, 4], fallen_empires: [5] },
      {
        kept_clear: [4],
        new_seats: [3],
        new_zones: [{ system: 7, zone: { radius: 20 } as never }],
      },
    );
    expect(Object.fromEntries(systemOutcomes({ preview }))).toEqual({ 3: "seat", 7: "zone" });
    expect(systemOutcomes({ preview: null }).size).toBe(0);
  });

  it("ring what keeping threats away turns into normal systems on hover", async () => {
    mockedIpc.preparePreview.mockResolvedValue(previewOf(1, {}, { kept_clear: [4, 5] }));
    await prepare().refresh();
    prepare().hover("clear_around");
    expect(ringedSystems(prepare())).toEqual([4, 5]);
  });

  it("ring the hovered row's systems", () => {
    prepare().hover("enclaves");
    expect(ringedSystems(prepare())).toEqual([1, 2]);
    prepare().hover(null);
    expect(ringedSystems(prepare())).toEqual([]);
  });

  it("ring the systems taking wormhole pairs out cuts off, and count the seats among them", async () => {
    mockedIpc.preparePreview.mockResolvedValue(
      previewOf(4, { wormhole_pairs: [5, 6], empire_seats: [7, 9] }, { cut_off: [6, 7, 8] }),
    );
    prepare().setChoice("wormhole_pairs", "none");
    await until(() => expect(prepare().current).toBe(true));
    prepare().hover("wormhole_pairs");
    expect(ringedSystems(prepare())).toEqual([5, 6, 7, 8]);
    expect(cutOffSeats(prepare().preview)).toBe(1);
  });

  it("offer a UNE seat for Sol only on a Paint a Galaxy map", () => {
    expect(offeredChoices("sol", "plain")).toEqual([
      "keep",
      "plain",
      "pre_ftl_earth",
      "game_decides",
    ]);
    expect(offeredChoices("sol", "paint_a_galaxy")).toContain("une_seat");
  });

  it("are read again for a new seed when rerolled", async () => {
    await previewed(5);
    mockedIpc.preparePreview.mockClear();
    const { seed } = prepare().options;
    prepare().reroll();
    expect(prepare().options.seed).not.toBe(seed);
    expect(prepare().current).toBe(false);
    await until(() => expect(prepare().current).toBe(true));
    expect(mockedIpc.preparePreview).toHaveBeenCalledTimes(1);
    expect(mockedIpc.preparePreview.mock.calls[0][1].seed).toBe(prepare().options.seed);
  });
});

describe("keeping the space around capitals clear", () => {
  it("is on by default, sent with every preview, and remembered apart from the preset", async () => {
    const { seed } = prepare().options;
    expect(prepare().options).toEqual({ clear_around_seats: true, seed });
    mockedIpc.preparePreview.mockResolvedValue(previewOf(3, {}, { kept_clear: [4, 5] }));
    prepare().setPreset("bare_shell");
    await until(() => expect(prepare().preview?.kept_clear).toEqual([4, 5]));
    expect(mockedIpc.preparePreview.mock.calls[0][1]).toEqual({ clear_around_seats: true, seed });

    mockedIpc.preparePreview.mockResolvedValue(previewOf(3));
    prepare().setClearAroundSeats(false);
    expect(prepare().current).toBe(false);
    await until(() => expect(prepare().preview?.kept_clear).toEqual([]));
    expect(mockedIpc.preparePreview.mock.calls[1][1]).toEqual({ clear_around_seats: false, seed });
    expect(stored.get(PREF_KEYS.prepareClearAroundSeats)).toBe("false");
    expect(presetOf(prepare().choices, "plain")).toBe("bare_shell");

    prepare().setPreset("faithful");
    expect(prepare().options.clear_around_seats).toBe(false);
    prepare().reset();
    expect(prepare().options.clear_around_seats).toBe(false);
    prepare().setClearAroundSeats(true);
  });
});

describe("Apply", () => {
  it("writes the choices as one edit, closes the section and names what it changed", async () => {
    useInspectorStore.getState().showGalaxy(PREPARE_SECTION);
    mockedIpc.preparePreview.mockResolvedValue(previewOf(5));
    prepare().setPreset("fresh_start");
    await until(() => expect(prepare().current).toBe(true));
    expect(summaryLine("fresh_start", 5, null)).toBe("New empires · changes 5 systems");

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
    expect(summaryLine(presetOf(choices, "plain"), preview?.changes ?? null, applied)).toBe(
      "New empires · 6 systems changed",
    );
  });

  it("writes with the space around capitals as the preview had it", async () => {
    await previewed(5);
    prepare().setClearAroundSeats(false);
    await until(() => expect(prepare().current).toBe(true));
    mockedIpc.prepareApply.mockResolvedValueOnce(prepared(1, 5));
    expect(await prepare().apply()).toBe(true);
    expect(mockedIpc.prepareApply.mock.calls[0][1]).toEqual({
      clear_around_seats: false,
      seed: prepare().options.seed,
    });
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

describe("the setup screen", () => {
  async function openFromSave(): Promise<void> {
    mockedIpc.openAsScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await useFileSessionStore.getState().openScenarioFrom("C:/saves/2277.05.20.sav");
    await until(() => expect(useFileSessionStore.getState().status).toBe("ready"));
  }

  it("is up for a scenario just taken from a save until Not now or Apply", async () => {
    expect(setupScreen()).toBe(false);
    await openFromSave();
    expect(setupScreen()).toBe(true);
    prepare().dismiss();
    expect(setupScreen()).toBe(false);
    expect(useInspectorStore.getState().sections[PREPARE_SECTION]).toBe(true);

    await openFromSave();
    expect(setupScreen()).toBe(true);
    await previewed(5);
    mockedIpc.prepareApply.mockResolvedValueOnce(prepared(1, 5));
    await prepare().apply();
    expect(setupScreen()).toBe(false);
  });

  it("comes back once undo takes the Apply back, even after Not now", async () => {
    await openFromSave();
    await previewed(5);
    prepare().dismiss();
    mockedIpc.prepareApply.mockResolvedValueOnce(prepared(1, 5));
    await prepare().apply();
    expect(setupScreen()).toBe(false);

    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ history: { undo: [], redo: [historyEntry(1, "x")] } }),
    );
    await editor().undo();
    expect(setupScreen()).toBe(true);
  });

  it("comes back on the Galaxy page when a system was selected since the Apply", async () => {
    await openFromSave();
    await previewed(5);
    mockedIpc.prepareApply.mockResolvedValueOnce(prepared(1, 5));
    await prepare().apply();
    await editor().setSelection([0], "replace");
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: 0 }, label: "Sol" });

    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ history: { undo: [], redo: [historyEntry(1, "x")] } }),
    );
    await editor().undo();
    expect(setupScreen()).toBe(true);
    await until(() => expect(editor().selection).toEqual([]));
    await until(() =>
      expect(useInspectorStore.getState().stack.map((e) => e.ref.kind)).toEqual(["galaxy"]),
    );
  });

  it("opens the section on the Galaxy page instead for a scenario not taken from a save", async () => {
    await previewed(5);
    mockedIpc.prepareApply.mockResolvedValueOnce(prepared(1, 5));
    await prepare().apply();
    expect(useInspectorStore.getState().sections[PREPARE_SECTION]).toBe(true);

    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ history: { undo: [], redo: [historyEntry(1, "x")] } }),
    );
    await editor().undo();
    await until(() => expect(useInspectorStore.getState().sections[PREPARE_SECTION]).toBe(false));
    expect(setupScreen()).toBe(false);
  });
});

describe("the map's outcome marks", () => {
  const shown = () => prepare().outcomeShown;

  it("show while the section is open on the Galaxy page or the setup screen is up, and not otherwise", async () => {
    useLayoutStore.getState().setTab("inspector");
    useInspectorStore.getState().showGalaxy(PREPARE_SECTION);
    expect(shown()).toBe(true);

    useInspectorStore.getState().closeSection(PREPARE_SECTION);
    expect(shown()).toBe(false);

    useInspectorStore.getState().showGalaxy(PREPARE_SECTION);
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: 0 }, label: "Sol" });
    expect(shown()).toBe(false);
    useInspectorStore.getState().setRoot(GALAXY_ENTRY);
    expect(shown()).toBe(true);

    mockedIpc.openAsScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await useFileSessionStore.getState().openScenarioFrom("C:/saves/2277.05.20.sav");
    useInspectorStore.getState().closeSection(PREPARE_SECTION);
    await until(() => expect(useInspectorStore.getState().stack[0].ref.kind).toBe("galaxy"));
    expect(setupScreen()).toBe(true);
    expect(shown()).toBe(true);
    prepare().dismiss();
    expect(shown()).toBe(false);
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
