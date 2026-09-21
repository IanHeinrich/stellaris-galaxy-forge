import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Issue } from "../generated/Issue";
import { OPEN_RESULT, editResult } from "./fixture";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { onProgress } from "../api/events";
import * as ipc from "../api/ipc";
import { bindStores } from "./bindStores";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { filteredIssues, newIssues, useIssuesStore } from "./issuesStore";

const mocked = {
  openSave: vi.mocked(ipc.openSave),
  closeSave: vi.mocked(ipc.closeSave),
  applyOp: vi.mocked(ipc.applyOp),
  getSpecialSystems: vi.mocked(ipc.getSpecialSystems),
  warmDetails: vi.mocked(ipc.warmDetails),
  onProgress: vi.mocked(onProgress),
};

const AT_LOAD = OPEN_RESULT.issues[0];
const NOTES: Issue[] = [
  {
    severity: "warning",
    code: "export_dropped",
    message: "6 wormhole pairs were not carried into the scenario",
    systems: [],
  },
  {
    severity: "warning",
    code: "home_initializer",
    message: "system 2 is an empire seat on shattered_ring_start, not a generic home initializer",
    systems: [2],
  },
];
const SPLIT: Issue = {
  severity: "error",
  code: "disconnected",
  message: "galaxy has 3 components, 2 at load; newly separated: 2",
  systems: [2],
};

async function open(path = OPEN_RESULT.path): Promise<void> {
  await useFileSessionStore.getState().openSave(path);
}

bindStores();

beforeEach(() => {
  vi.clearAllMocks();
  useGalaxyStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useIssuesStore.getState().setBaseline(null);
  mocked.onProgress.mockResolvedValue(() => undefined);
  mocked.openSave.mockResolvedValue(OPEN_RESULT);
  mocked.closeSave.mockResolvedValue();
  mocked.warmDetails.mockResolvedValue();
  mocked.getSpecialSystems.mockResolvedValue({ systems: [], counts: [], with_game_data: false });
});

describe("issuesStore", () => {
  it("takes the issues an open reports as the baseline and counts nothing as new", async () => {
    await open();
    const { baseline } = useIssuesStore.getState();
    expect(baseline.size).toBe(1);
    expect(newIssues(useFileSessionStore.getState().issues, baseline)).toEqual([]);
  });

  it("counts only the issues an edit adds, keeping the baseline out of the badge", async () => {
    await open();
    mocked.applyOp.mockResolvedValue(editResult({ issues: [AT_LOAD, SPLIT] }));
    await useEditorStore.getState().applyOp({ type: "RemoveLane", a: 1, b: 2 });

    const { baseline } = useIssuesStore.getState();
    const issues = useFileSessionStore.getState().issues;
    expect(newIssues(issues, baseline)).toEqual([SPLIT]);
    expect(filteredIssues(issues, baseline, "baseline", null)).toEqual([AT_LOAD]);
    expect(filteredIssues(issues, baseline, "all", null)).toEqual([AT_LOAD, SPLIT]);
    expect(filteredIssues(issues, baseline, "all", "disconnected")).toEqual([SPLIT]);
  });

  it("keeps a baseline issue out of the count when it goes away and comes back", async () => {
    await open();
    mocked.applyOp.mockResolvedValue(editResult({ issues: [] }));
    await useEditorStore.getState().applyOp({ type: "RemoveLane", a: 1, b: 2 });
    expect(useIssuesStore.getState().baseline.size).toBe(1);

    mocked.applyOp.mockResolvedValue(editResult({ issues: [AT_LOAD] }));
    await useEditorStore.getState().applyOp({ type: "RemoveLane", a: 0, b: 1 });
    const { baseline } = useIssuesStore.getState();
    expect(newIssues(useFileSessionStore.getState().issues, baseline)).toEqual([]);
  });

  it("clears the baseline and the filters when the save closes", async () => {
    await open();
    useIssuesStore.getState().setFilter("all");
    useIssuesStore.getState().setCode("system_isolated");
    await useFileSessionStore.getState().close();

    const state = useIssuesStore.getState();
    expect(state.baseline.size).toBe(0);
    expect(state.filter).toBe("new");
    expect(state.code).toBeNull();
  });

  it("keeps the notes a document opened with out of the baseline and in the count", async () => {
    mocked.openSave.mockResolvedValue({ ...OPEN_RESULT, issues: [AT_LOAD, ...NOTES] });
    await open();

    const { baseline, notes } = useIssuesStore.getState();
    expect(baseline.size).toBe(1);
    expect(notes).toEqual(NOTES);
    expect(newIssues(useFileSessionStore.getState().issues, baseline)).toEqual(NOTES);
  });

  it("carries the notes through an edit's fresh issue list", async () => {
    mocked.openSave.mockResolvedValue({ ...OPEN_RESULT, issues: [AT_LOAD, ...NOTES] });
    await open();
    mocked.applyOp.mockResolvedValue(editResult({ issues: [AT_LOAD, SPLIT] }));
    await useEditorStore.getState().applyOp({ type: "RemoveLane", a: 1, b: 2 });

    const { baseline } = useIssuesStore.getState();
    const issues = useFileSessionStore.getState().issues;
    expect(issues).toEqual([AT_LOAD, SPLIT, ...NOTES]);
    expect(newIssues(issues, baseline)).toEqual([SPLIT, ...NOTES]);
    expect(filteredIssues(issues, baseline, "baseline", null)).toEqual([AT_LOAD]);
  });

  it("drops the notes when the document closes", async () => {
    mocked.openSave.mockResolvedValue({ ...OPEN_RESULT, issues: [AT_LOAD, ...NOTES] });
    await open();
    await useFileSessionStore.getState().close();
    expect(useIssuesStore.getState().notes).toEqual([]);

    mocked.openSave.mockResolvedValue(OPEN_RESULT);
    await open();
    mocked.applyOp.mockResolvedValue(editResult({ issues: [] }));
    await useEditorStore.getState().applyOp({ type: "RemoveLane", a: 1, b: 2 });
    expect(useFileSessionStore.getState().issues).toEqual([]);
  });

  it("takes a fresh baseline when another save opens", async () => {
    await open();
    mocked.openSave.mockResolvedValue({ ...OPEN_RESULT, issues: [AT_LOAD, SPLIT] });
    await open("C:/saves/other.sav");

    const { baseline } = useIssuesStore.getState();
    expect(baseline.size).toBe(2);
    expect(newIssues(useFileSessionStore.getState().issues, baseline)).toEqual([]);
  });
});
