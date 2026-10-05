import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CountryNode } from "../generated/CountryNode";
import type { EditResult } from "../generated/EditResult";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { editor, openFixtureSave, sessionError } from "./editorFixture";
import { useDetailsStore } from "./detailsStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useInspectorStore } from "./inspectorStore";
import { useIssuesStore } from "./issuesStore";
import { useGalaxyStore } from "./galaxyStore";
import { OPEN_RESULT, SYSTEMS, editResult, planetSummary, systemDetails } from "./fixture";
import { appIssue, name } from "../test/builders";
import { mockedIpc } from "../test/ipc";
import { until } from "../test/wait";

beforeEach(openFixtureSave);

const EMPIRE: CountryNode = {
  id: 0,
  name: name("EMPIRE_Fixture"),
  name_key: "EMPIRE_Fixture",
  country_type: "default",
  capital_system: 0,
  system_count: 1,
  colors: ["red", "purple", "black", "grey", "red", "purple"],
  border_color: null,
  fill_color: null,
  use_map_color: false,
  flag_icon: null,
  flag_background: null,
};

/** The fixture save opened again with one empire, `EMPIRE`. */
async function openWithEmpire(): Promise<void> {
  mockedIpc.openSave.mockResolvedValueOnce({
    ...OPEN_RESULT,
    galaxy: { ...OPEN_RESULT.galaxy, countries: [EMPIRE] },
  });
  await useFileSessionStore.getState().openSave(OPEN_RESULT.path);
}

describe("editing", () => {
  it("applyOp applies the delta, updates history and dirty, and refreshes the inspected system", async () => {
    await editor().select(0);
    mockedIpc.getSystem.mockClear();

    const moved = { ...SYSTEMS[0], x: -150, y: 60 };
    const result = editResult({ delta: { systems: [moved] } });
    mockedIpc.applyOp.mockResolvedValueOnce(result);

    expect(await editor().applyOp({ type: "MoveSystem", system: 0, x: -150, y: 60 })).toBe(true);

    const node = useGalaxyStore.getState().systems.get(0);
    expect(node?.x).toBe(-150);
    expect(node?.y).toBe(60);

    expect(editor().history).toEqual(result.history);
    expect(editor().history.undo).toHaveLength(1);
    const session = useFileSessionStore.getState();
    expect(session.dirty).toBe(true);
    expect(useIssuesStore.getState().issues).toEqual(result.issues);
    expect(session.error).toBeNull();

    expect(mockedIpc.getSystem).toHaveBeenCalledTimes(1);
    expect(mockedIpc.getSystem).toHaveBeenCalledWith(0);
  });

  it("applyOp refused sets the error and leaves the galaxy untouched", async () => {
    const before = useGalaxyStore.getState().systems.get(0);
    mockedIpc.applyOp.mockRejectedValueOnce({
      kind: "op",
      message: "systems 0 and 1 are already linked",
    });

    expect(await editor().applyOp({ type: "AddLane", a: 0, b: 1, bridge: false })).toBe(false);
    expect(sessionError()).toBe("systems 0 and 1 are already linked");
    expect(useGalaxyStore.getState().systems.get(0)).toEqual(before);
  });

  it.each([
    ["undo", () => mockedIpc.undo, (): Promise<void> => editor().undo()],
    ["redo", () => mockedIpc.redo, (): Promise<void> => editor().redo()],
  ])("%s resolving null leaves state alone", async (_name, step, run) => {
    const before = editor().history;
    step().mockResolvedValueOnce(null);

    await run();

    expect(editor().history).toEqual(before);
    expect(useGalaxyStore.getState().systems.get(0)).toEqual(SYSTEMS[0]);
  });

  it.each([
    ["undo", () => mockedIpc.undo, (): Promise<void> => editor().undo()],
    ["redo", () => mockedIpc.redo, (): Promise<void> => editor().redo()],
  ])("%s resolving an EditResult applies its delta and clears the error", async (_n, step, run) => {
    useFileSessionStore.getState().setError("stale error");
    const moved = { ...SYSTEMS[0], x: -150, y: 60 };
    const result = editResult({ delta: { systems: [moved] } });
    step().mockResolvedValueOnce(result);

    await run();

    expect(useGalaxyStore.getState().systems.get(0)).toEqual(moved);
    expect(sessionError()).toBeNull();
    expect(editor().history).toEqual(result.history);
    expect(useFileSessionStore.getState().dirty).toBe(result.dirty);
  });

  it("a rejected redo reports the message and leaves the history alone", async () => {
    const before = editor().history;
    mockedIpc.redo.mockRejectedValueOnce({ kind: "op", message: "nothing to redo" });

    await editor().redo();

    expect(sessionError()).toBe("nothing to redo");
    expect(editor().history).toEqual(before);
  });

  it("a delta's countries replace the copies the map paints, on an op and on its undo", async () => {
    await openWithEmpire();
    const chosen: CountryNode = {
      ...EMPIRE,
      colors: ["red", "purple", "black", "grey", "intense_red", "light_pink"],
      border_color: "intense_red",
      fill_color: "light_pink",
      use_map_color: true,
    };
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [], countries: [chosen] } }),
    );

    await editor().applyOp({
      type: "SetEmpireMapColors",
      country: 0,
      colors: { border: "intense_red", fill: "light_pink" },
    });
    expect(useGalaxyStore.getState().countries.get(0)).toEqual(chosen);

    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ delta: { systems: [], countries: [EMPIRE] } }),
    );
    await editor().undo();
    expect(useGalaxyStore.getState().countries.get(0)).toEqual(EMPIRE);
  });

  it("a rename gives the empire and the save title the new name, and undo the old one", async () => {
    await openWithEmpire();
    const renamed: CountryNode = {
      ...EMPIRE,
      name: { key: "Sgf Dominion", literal: true, variables: [] },
      name_key: "Sgf Dominion",
    };
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [], countries: [renamed] }, title: "Sgf Dominion" }),
    );

    await editor().applyOp({ type: "RenameEmpire", country: 0, name: "Sgf Dominion" });
    expect(useGalaxyStore.getState().countries.get(0)?.name_key).toBe("Sgf Dominion");
    expect(useFileSessionStore.getState().dirty).toBe(true);
    expect(useFileSessionStore.getState().title).toBe("Sgf Dominion");

    mockedIpc.undo.mockResolvedValueOnce(
      editResult({ delta: { systems: [], countries: [EMPIRE] } }),
    );
    await editor().undo();
    expect(useGalaxyStore.getState().countries.get(0)).toEqual(EMPIRE);
    expect(useFileSessionStore.getState().title).toBe(OPEN_RESULT.title);
  });

  it("stale details stay cached and the system is re-read, with no second ask for the findings", async () => {
    useDetailsStore.setState({
      details: new Map([[1, systemDetails({ id: 1 })]]),
      pending: new Set([2]),
    });
    await editor().select(1);
    mockedIpc.getSystem.mockClear();
    mockedIpc.warmDetails.mockClear();
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [1, 2] }));

    await editor().applyOp({ type: "MoveSystem", system: 0, x: 1, y: 1 });

    const details = useDetailsStore.getState();
    expect(details.details.has(1)).toBe(true);
    expect(details.pending.has(2)).toBe(false);
    expect(mockedIpc.warmDetails).not.toHaveBeenCalled();
    expect(mockedIpc.getSystem).toHaveBeenCalledWith(1);
  });

  it("shows the overlap findings an edit that staled the details returns", async () => {
    const overlap = appIssue({ code: "bodies_overlap", message: "overlap", systems: [1] });
    const lane = appIssue({ code: "system_isolated", message: "isolated", systems: [2] });
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [1], issues: [overlap] }));
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ issues: [lane, overlap] }));

    await editor().applyOp({ type: "MoveSystem", system: 0, x: 1, y: 1 });
    expect(useIssuesStore.getState().issues).toEqual([overlap]);
    await editor().applyOp({ type: "RemoveLane", a: 0, b: 1 });

    expect(useIssuesStore.getState().issues).toEqual([lane, overlap]);
  });

  it("re-reads the selected system when the inspector shows a planet of a system gone stale", async () => {
    useDetailsStore.setState({
      details: new Map([
        [7, { ...systemDetails({ id: 7 }), planets: [planetSummary({ id: 42 })] }],
      ]),
    });
    await editor().select(1);
    useInspectorStore
      .getState()
      .open({ ref: { kind: "body", system: 7, id: 42 }, label: "Planet" });
    mockedIpc.getSystem.mockClear();
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [7] }));

    await editor().applyOp({ type: "MoveSystem", system: 0, x: 1, y: 1 });

    expect(mockedIpc.getSystem).toHaveBeenCalledWith(1);
  });

  it("leaves the selected system alone when nothing it shows was touched", async () => {
    await editor().select(1);
    useInspectorStore
      .getState()
      .open({ ref: { kind: "body", system: 7, id: 42 }, label: "Planet" });
    mockedIpc.getSystem.mockClear();
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...SYSTEMS[0], x: 1, y: 1 }] } }),
    );

    await editor().applyOp({ type: "MoveSystem", system: 0, x: 1, y: 1 });

    expect(mockedIpc.getSystem).not.toHaveBeenCalled();
  });

  it("applies deltas in the order the ops were sent when their results arrive out of order", async () => {
    let finishFirst!: (result: EditResult) => void;
    mockedIpc.applyOp.mockReturnValueOnce(new Promise<EditResult>((r) => (finishFirst = r)));
    mockedIpc.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [{ ...SYSTEMS[0], x: 20, y: 20 }] } }),
    );

    const first = editor().applyOp({ type: "MoveSystem", system: 0, x: 10, y: 10 });
    const second = editor().applyOp({ type: "MoveSystem", system: 0, x: 20, y: 20 });
    await until(() => expect(mockedIpc.applyOp).toHaveBeenCalledTimes(1));

    finishFirst(editResult({ delta: { systems: [{ ...SYSTEMS[0], x: 10, y: 10 }] } }));
    expect(await first).toBe(true);
    expect(await second).toBe(true);

    expect(useGalaxyStore.getState().systems.get(0)).toMatchObject({ x: 20, y: 20 });
  });
});

describe("history navigation", () => {
  const entries = [1, 2, 3].map((seq) => ({
    seq,
    description: `Change ${seq}`,
  }));
  const at = (applied: number) =>
    editResult({ history: { undo: entries.slice(0, applied), redo: entries.slice(applied) } });

  beforeEach(async () => {
    mockedIpc.undo.mockImplementation(async () => {
      const applied = editor().history.undo.length;
      return applied === 0 ? null : at(applied - 1);
    });
    mockedIpc.redo.mockImplementation(async () => {
      const applied = editor().history.undo.length;
      return applied === entries.length ? null : at(applied + 1);
    });
    mockedIpc.applyOp.mockResolvedValueOnce(at(3));
    await editor().applyOp({ type: "MoveSystem", system: 0, x: 1, y: 1 });
  });

  it("undoTo undoes until the entry is the last applied and redoTo redoes forward to it", async () => {
    await editor().undoTo(1);
    expect(mockedIpc.undo).toHaveBeenCalledTimes(2);
    expect(editor().history.undo.map((e) => e.seq)).toEqual([1]);
    expect(editor().history.redo.map((e) => e.seq)).toEqual([2, 3]);

    await editor().redoTo(3);
    expect(mockedIpc.redo).toHaveBeenCalledTimes(2);
    expect(editor().history.undo.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("clicking the current entry does nothing, and a failing step stops the loop", async () => {
    await editor().undoTo(3);
    expect(mockedIpc.undo).not.toHaveBeenCalled();

    mockedIpc.undo.mockRejectedValue({ kind: "op", message: "broken" });
    await editor().undoTo(1);
    expect(mockedIpc.undo).toHaveBeenCalledTimes(1);
    expect(sessionError()).toBe("broken");
    expect(editor().history.undo).toHaveLength(3);
  });
});

describe("the systems the core reports stale", () => {
  it("re-reads the contents of every system the core lists, keeping what is shown until it answers", async () => {
    await editor().select(1);
    useInspectorStore.getState().setRoot({ ref: { kind: "system", id: 1 }, label: "Alpha" });
    useDetailsStore.setState({ details: new Map([[1, systemDetails({ id: 1 })]]) });
    mockedIpc.getSystemDetails.mockResolvedValue([]);
    mockedIpc.applyOp.mockResolvedValueOnce(editResult({ details_stale: [1] }));

    await editor().applyOp({ type: "SetInitializer", system: 1, initializer: "guardian_dragon" });
    useDetailsStore.getState().request([1]);

    expect(useDetailsStore.getState().details.get(1)).toBeDefined();
    expect(useDetailsStore.getState().pending.has(1)).toBe(true);
  });
});
