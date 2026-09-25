import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import * as ipc from "../api/ipc";
import type { EditResult } from "../generated/EditResult";
import type { SearchHit } from "../generated/SearchHit";
import type { SystemNode } from "../generated/SystemNode";
import {
  addedAmong,
  deleteAddedLabel,
  IRONMAN,
  NEEDS_GAME_DATA,
  NEEDS_STELLARIS_4,
} from "../lib/addSystem";
import { run } from "./commands";
import { editor, mocked, openFixtureSave, sessionError } from "./editorFixture";
import { addSystemRefusalAt, canDelete } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { GALAXY_ENTRY, useInspectorStore } from "./inspectorStore";
import { useDetailsStore } from "./detailsStore";
import { useEditorStore } from "./editorStore";
import {
  editResult,
  historyEntry,
  name,
  node,
  planetSummary,
  saveMeta,
  systemDetails,
} from "./fixture";
import { useGeneratorStore } from "./generatorStore";
import { useWatchlistStore } from "./watchlistStore";
import type { AddSystemPicks } from "../generated/AddSystemPicks";
import type { PickSummary } from "../generated/PickSummary";

const addRandomSystem = vi.mocked(ipc.addRandomSystem);
const addSpecialSystem = vi.mocked(ipc.addSpecialSystem);
const rerollSystem = vi.mocked(ipc.rerollSystem);
const removeAddedSystems = vi.mocked(ipc.removeAddedSystems);
const getAddSystemPicks = vi.mocked(ipc.getAddSystemPicks);

function added(id: number, x: number, y: number, extra: Partial<SystemNode> = {}): SystemNode {
  return node(id, `NAME_Added_${id}`, x, y, "sc_g", [], { added: true, ...extra });
}

/** The fixture save with two systems added this session, 6 and 7, and game data loaded. */
function withAddedSystems(): [SystemNode, SystemNode] {
  const six = added(6, -50, -20);
  const seven = added(7, 50, 20);
  useGalaxyStore.getState().applyDelta({ systems: [six, seven] });
  mocked.getSystem.mockImplementation(async (id) => {
    const system = useGalaxyStore.getState().systems.get(id);
    if (!system) throw { kind: "not_found", message: `no system ${id}` };
    return { system, neighbours: [], nebula: null };
  });
  return [six, seven];
}

beforeEach(async () => {
  await openFixtureSave();
  useGameDataStore.setState({ status: "ready" });
});

describe("adding a system to a save", () => {
  it("rolls one at the point in one edit and selects it", async () => {
    const system = added(6, -50, -20);
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
    const system = added(6, -50, -20);
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
    added(6, -50, -20, { initializer: "trappist_initializer", star_class: "sc_m", ...extra });

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

describe("the Add system menu's picks", () => {
  const summary = (planets: number): PickSummary => ({
    star_classes: [],
    star_description: null,
    planets: { min: planets, max: planets },
    max_moons: 0,
    moons: "never",
    belts: { min: 0, max: 0 },
    belt_kinds: [],
    asteroids: { min: 0, max: 0 },
    named_bodies: [],
    notable_classes: [],
    modifiers: [],
    rings: "never",
    dlc: null,
    max_instances: null,
    in_galaxy: null,
  });
  const picks = (planets: number): AddSystemPicks => ({
    random: summary(planets),
    star_classes: [],
    special: [],
  });

  it("are read again each time, keeping the last ones until the next land, and drop a late answer", async () => {
    let answerSecond!: (value: AddSystemPicks) => void;
    getAddSystemPicks
      .mockResolvedValueOnce(picks(1))
      .mockReturnValueOnce(new Promise<AddSystemPicks>((r) => (answerSecond = r)))
      .mockResolvedValueOnce(picks(3));
    const generator = () => useGeneratorStore.getState();

    generator().refreshPicks();
    await vi.waitFor(() => expect(generator().picks?.random.planets.max).toBe(1));
    generator().refreshPicks();
    await Promise.resolve();
    expect(generator().picks?.random.planets.max).toBe(1);
    generator().refreshPicks();
    await vi.waitFor(() => expect(generator().picks?.random.planets.max).toBe(3));
    answerSecond(picks(2));
    await Promise.resolve();

    expect(generator().picks?.random.planets.max).toBe(3);
  });

  it("are forgotten when the document closes", async () => {
    getAddSystemPicks.mockResolvedValueOnce(picks(1));
    useGeneratorStore.getState().refreshPicks();
    await vi.waitFor(() => expect(useGeneratorStore.getState().picks).not.toBeNull());

    await useFileSessionStore.getState().close();

    expect(useGeneratorStore.getState().picks).toBeNull();
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

  it("asks for game data", () => {
    useGameDataStore.setState({ status: "idle" });
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

describe("following a delete that renumbers", () => {
  /** Removing 6 moves 7 down to 6, as the core reports it. */
  function removeSix(seven: SystemNode) {
    mocked.applyOp.mockResolvedValueOnce(
      editResult({
        entry: historyEntry(3, "Removed Added 6 (#6); renumbered 7 to 6"),
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
    return editor().applyOp({ type: "RemoveSystem", id: 6 });
  }

  it("moves the selection, the pages and the pinned searches to the new id", async () => {
    const [, seven] = withAddedSystems();
    await editor().select(7);
    const inspector = useInspectorStore.getState();
    inspector.setRoot({ ref: { kind: "system", id: 7 }, label: "Added 7" });
    inspector.open({ ref: { kind: "planet", id: 70 }, label: "Added 7 I" });
    useWatchlistStore.setState({ results: new Map([["added", [7, 3]]]) });

    await removeSix(seven);

    expect(editor().selection).toEqual([6]);
    expect(useInspectorStore.getState().stack.map((e) => e.ref)).toEqual([
      { kind: "system", id: 6 },
      { kind: "planet", id: 70 },
    ]);
    expect(useWatchlistStore.getState().results.get("added")).toEqual([6, 3]);
    expect(editor().inspected?.system.id).toBe(6);
  });

  it("closes the page of the system it removed and clears the selection", async () => {
    const [, seven] = withAddedSystems();
    await editor().select(6);
    const inspector = useInspectorStore.getState();
    inspector.setRoot({ ref: { kind: "system", id: 6 }, label: "Added 6" });
    inspector.open({ ref: { kind: "planet", id: 60 }, label: "Added 6 I" });
    useWatchlistStore.setState({ results: new Map([["added", [6, 3]]]) });

    await removeSix(seven);

    expect(editor().selection).toEqual([]);
    expect(editor().inspected).toBeNull();
    expect(useInspectorStore.getState().stack).toEqual([GALAXY_ENTRY]);
    expect(useWatchlistStore.getState().results.get("added")).toEqual([3]);
  });

  it("clears the hover and moves a selected lane", async () => {
    const [, seven] = withAddedSystems();
    const sirius = useGalaxyStore.getState().systems.get(3)!;
    const lane = { length: 20, bridge: false, stale: false };
    useGalaxyStore.getState().applyDelta({
      systems: [
        { ...seven, lanes: [{ to: 3, ...lane }] },
        { ...sirius, lanes: [...sirius.lanes, { to: 7, ...lane }] },
      ],
    });
    editor().setHover(7);
    editor().selectLane({ a: 3, b: 7 });
    mocked.applyOp.mockResolvedValueOnce(
      editResult({
        delta: {
          systems: [
            { ...seven, id: 6, lanes: [{ to: 3, ...lane }] },
            { ...sirius, lanes: [...sirius.lanes, { to: 6, ...lane }] },
          ],
          removed: [7],
          renumbered: [
            [6, null],
            [7, 6],
          ],
        },
      }),
    );

    await editor().applyOp({ type: "RemoveSystem", id: 6 });

    expect(editor().hover).toBeNull();
    expect(editor().selectedLane).toEqual({ a: 3, b: 6 });
  });

  it("moves the search rings and the recent hits, dropping what was in the removed system", async () => {
    const [, seven] = withAddedSystems();
    useEditorStore.setState({
      searchRings: [7, 3, 6],
      recentHits: [hit("system", 7, 7), hit("planet", 60, 6), hit("system", 3, 3)],
    });

    await removeSix(seven);

    expect(editor().searchRings).toEqual([6, 3]);
    expect(editor().recentHits.map((h) => [h.kind, h.id, h.system_id])).toEqual([
      ["system", 6, 6],
      ["system", 3, 3],
    ]);
  });

  it("closes a page on a planet of the removed system, wherever it was opened from", async () => {
    const [, seven] = withAddedSystems();
    useDetailsStore.setState({
      details: new Map([[6, systemDetails({ id: 6, planets: [planetSummary({ id: 60 })] })]]),
    });
    const inspector = useInspectorStore.getState();
    inspector.openPage({ ref: { kind: "planet", id: 60 }, label: "Added 6 I" });
    inspector.open({ ref: { kind: "deposit", id: 600 }, label: "Minerals" });

    await removeSix(seven);

    expect(useInspectorStore.getState().stack).toEqual([GALAXY_ENTRY]);
  });
});

describe("deleting several added systems at once", () => {
  /** 6, 7 and 8 added; removing 6 and 8 moves 7 down to 6, as the core reports it. */
  function withThreeAdded(): SystemNode {
    const [, seven] = withAddedSystems();
    useGalaxyStore.getState().applyDelta({ systems: [added(8, 30, -30)] });
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

  it("labels the entry with the added systems and the file's own it skips", () => {
    withThreeAdded();
    const systems = useGalaxyStore.getState().systems;
    const label = (ids: number[]) => {
      const among = addedAmong(systems, ids);
      return deleteAddedLabel(among.length, ids.length - among.length);
    };
    expect(label([6, 8])).toBe("Delete 2 added systems");
    expect(label([0, 6, 3, 8, 7])).toBe("Delete 3 added systems (skips 2 already in the save)");
    expect(label([7, 0])).toBe("Delete 1 added system (skips 1 already in the save)");
    expect(label([0, 3])).toBeNull();
  });

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
    const eight = added(8, 30, -30);
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

describe("history steps that bring an added system back", () => {
  it("an undone delete selects the system again and moves the later one back up", async () => {
    const [six, seven] = withAddedSystems();
    mocked.applyOp.mockResolvedValueOnce(
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
    await editor().applyOp({ type: "RemoveSystem", id: 6 });
    mocked.undo.mockResolvedValueOnce(
      editResult({ delta: { systems: [six, seven], renumbered: [[6, 7]] } }),
    );

    await editor().undo();

    await vi.waitFor(() => expect(editor().inspected?.system).toEqual(six));
    expect(editor().selection).toEqual([6]);
    expect(useGalaxyStore.getState().systems.get(7)).toEqual(seven);
  });

  it("a redone add selects the system again", async () => {
    withAddedSystems();
    const eight = added(8, 30, -30);
    mocked.redo.mockResolvedValueOnce(editResult({ delta: { systems: [eight] } }));

    await editor().redo();

    await vi.waitFor(() => expect(editor().inspected?.system.id).toBe(8));
    expect(editor().selection).toEqual([8]);
  });

  it("an undone reroll leaves the selection where it was", async () => {
    const [six] = withAddedSystems();
    await editor().select(7);
    mocked.undo.mockResolvedValueOnce(editResult({ delta: { systems: [six] } }));

    await editor().undo();

    expect(editor().selection).toEqual([7]);
  });
});

describe("edits queued behind others", () => {
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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function hit(kind: "system" | "planet", id: number, system: number): SearchHit {
  return {
    kind,
    id,
    name: name(`NAME_${id}`),
    name_key: `NAME_${id}`,
    system_id: system,
    owner: null,
    country_type: null,
    system_count: null,
    planet_class: null,
    position: [0, 0],
    matched_on: null,
  };
}
