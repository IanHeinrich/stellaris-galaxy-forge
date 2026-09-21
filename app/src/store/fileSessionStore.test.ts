import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Capabilities } from "../generated/Capabilities";
import type { ExportReport } from "../generated/ExportReport";
import type { Progress } from "../generated/Progress";
import type { PaintSpawnKind } from "../generated/PaintSpawnKind";
import type { SaveResult } from "../generated/SaveResult";
import type { SystemNode } from "../generated/SystemNode";
import { duplicateNameNote, reservedSpawnsNote } from "../lib/issues";
import {
  OPEN_RESULT,
  SCENARIO_RESULT,
  SYSTEMS,
  detailOf,
  editResult,
  exportReport,
  saveResult,
} from "./fixture";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { confirm, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { onProgress } from "../api/events";
import * as ipc from "../api/ipc";
import { bindStores } from "./bindStores";
import { useEditorStore } from "./editorStore";
import { getPaintLayer, useFileSessionStore } from "./fileSessionStore";
import { laneCount, useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { useIssuesStore } from "./issuesStore";
import { useLayoutStore } from "./layoutStore";
import { usePaintModStore } from "./paintModStore";
import { useRecentsStore } from "./recentsStore";

const mocked = {
  saveDirs: vi.mocked(ipc.saveDirs),
  openSave: vi.mocked(ipc.openSave),
  openAsScenario: vi.mocked(ipc.openAsScenario),
  newScenario: vi.mocked(ipc.newScenario),
  exportScenario: vi.mocked(ipc.exportScenario),
  previewExport: vi.mocked(ipc.previewExport),
  getSystem: vi.mocked(ipc.getSystem),
  closeSave: vi.mocked(ipc.closeSave),
  applyOp: vi.mocked(ipc.applyOp),
  save: vi.mocked(ipc.save),
  saveAs: vi.mocked(ipc.saveAs),
  siblingScenarioNames: vi.mocked(ipc.siblingScenarioNames),
  isCloudSave: vi.mocked(ipc.isCloudSave),
  getSpecialSystems: vi.mocked(ipc.getSpecialSystems),
  getScenarioOwners: vi.mocked(ipc.getScenarioOwners),
  warmDetails: vi.mocked(ipc.warmDetails),
  onProgress: vi.mocked(onProgress),
  open: vi.mocked(open),
  saveDialog: vi.mocked(saveDialog),
  confirm: vi.mocked(confirm),
};

const session = () => useFileSessionStore.getState();

let progressHandler: ((p: Progress) => void) | null = null;
let unlisten: ReturnType<typeof vi.fn<() => void>>;

const stored = new Map<string, string>();

bindStores();

/** One applied edit, so the session is dirty. */
async function edit(): Promise<void> {
  mocked.applyOp.mockResolvedValueOnce(editResult());
  await useEditorStore.getState().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 });
}

beforeEach(() => {
  vi.clearAllMocks();
  progressHandler = null;
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
  });
  useGalaxyStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useRecentsStore.setState({ recents: [] });
  usePaintModStore.setState({ ...usePaintModStore.getInitialState() });
  unlisten = vi.fn<() => void>();
  mocked.onProgress.mockImplementation(async (h) => {
    progressHandler = h;
    return unlisten;
  });
  mocked.openSave.mockResolvedValue(OPEN_RESULT);
  mocked.getSystem.mockImplementation(async (id) => detailOf(id));
  mocked.closeSave.mockResolvedValue();
  mocked.warmDetails.mockResolvedValue();
  mocked.confirm.mockResolvedValue(true);
  mocked.isCloudSave.mockResolvedValue(false);
  mocked.getSpecialSystems.mockResolvedValue({ systems: [], counts: [], with_game_data: false });
  mocked.getScenarioOwners.mockResolvedValue(null);
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
});

describe("openSave", () => {
  it("loads the galaxy, meta and issues and reports progress while loading", async () => {
    const p = session().openSave(OPEN_RESULT.path);
    await vi.waitFor(() => expect(progressHandler).not.toBeNull());
    expect(session().status).toBe("loading");
    progressHandler!({ phase: "read", fraction: 0.5 });
    expect(session().progress).toEqual({ phase: "read", fraction: 0.5 });
    await p;

    const state = session();
    expect(state.status).toBe("ready");
    expect(state.path).toBe(OPEN_RESULT.path);
    expect(state.meta).toEqual(OPEN_RESULT.meta);
    expect(useIssuesStore.getState().issues).toHaveLength(1);
    expect(state.progress).toBeNull();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(mocked.openSave).toHaveBeenCalledWith(OPEN_RESULT.path);

    const galaxy = useGalaxyStore.getState();
    expect(galaxy.galaxy).toBe(OPEN_RESULT.galaxy);
    expect(galaxy.systems.size).toBe(6);
    expect(galaxy.grid?.nearestSystem(21, 9, 5)?.id).toBe(2);
    expect(laneCount(galaxy.systems.values())).toBe(4);
  });

  it("settles what the document supports before the galaxy store hears about it", async () => {
    let atLoad: Capabilities | null | undefined;
    const unsubscribe = useGalaxyStore.subscribe((state, previous) => {
      if (state.galaxy !== previous.galaxy) atLoad = session().capabilities;
    });
    await session().openSave(OPEN_RESULT.path);
    unsubscribe();
    expect(atLoad).toEqual(OPEN_RESULT.capabilities);
  });

  it("asks for the special systems again once the details projection is warm", async () => {
    await session().openSave(OPEN_RESULT.path);
    expect(mocked.warmDetails).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mocked.getSpecialSystems).toHaveBeenCalledTimes(2));
  });

  it("a details projection that fails to warm says so on the session, which still opened", async () => {
    mocked.warmDetails.mockRejectedValueOnce({ kind: "internal", message: "no projection" });

    expect(await session().openSave(OPEN_RESULT.path)).toBe(true);

    expect(session().status).toBe("ready");
    await vi.waitFor(() => expect(session().error).toBe("no projection"));
  });

  it("reports a rejection as an error and closes the session left on the Rust side", async () => {
    mocked.openSave.mockRejectedValueOnce({ kind: "format", message: "not a zip" });
    mocked.closeSave.mockRejectedValueOnce({ kind: "no_session", message: "nothing open" });
    await session().openSave("bad.sav");
    const state = session();
    expect(state.status).toBe("error");
    expect(state.error).toBe("not a zip");
    expect(state.errorKind).toBe("format");
    expect(mocked.closeSave).toHaveBeenCalledTimes(1);
    expect(useGalaxyStore.getState().systems.size).toBe(0);
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("reports a missing file with the not_found kind", async () => {
    mocked.openSave.mockRejectedValueOnce({ kind: "not_found", message: "no such file" });
    await session().openSave("gone.sav");
    const state = session();
    expect(state.error).toBe("no such file");
    expect(state.errorKind).toBe("not_found");
  });

  it("an open forgets the selection and the history of the file before it", async () => {
    await session().openSave(OPEN_RESULT.path);
    await useEditorStore.getState().select(1);
    await edit();
    expect(useEditorStore.getState().history.undo).toHaveLength(1);

    await session().openSave(OPEN_RESULT.path);
    const editor = useEditorStore.getState();
    expect(editor.selection).toEqual([]);
    expect(editor.inspected).toBeNull();
    expect(editor.history).toEqual({ undo: [], redo: [] });
  });

  it("pickAndOpen asks how to open the picked save and does nothing when cancelled", async () => {
    mocked.saveDirs.mockResolvedValue(["C:/saves"]);
    mocked.open.mockResolvedValueOnce(null);
    await session().pickAndOpen();
    expect(mocked.openSave).not.toHaveBeenCalled();
    expect(mocked.confirm).not.toHaveBeenCalled();

    mocked.open.mockResolvedValueOnce("C:/saves/picked.sav");
    await session().pickAndOpen();
    expect(mocked.open).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "C:/saves",
        multiple: false,
        filters: [
          { name: "All supported", extensions: ["sav", "txt"] },
          { name: "Stellaris save", extensions: ["sav"] },
          { name: "Stellaris static galaxy scenario", extensions: ["txt"] },
        ],
      }),
    );
    expect(mocked.openSave).not.toHaveBeenCalled();
    expect(session().pendingOpen).toBe("C:/saves/picked.sav");

    await session().chooseOpenMode("save");
    expect(mocked.openSave).toHaveBeenCalledWith("C:/saves/picked.sav");
    expect(session().pendingOpen).toBeNull();
    expect(session().status).toBe("ready");
  });

  it("pickAndOpen with mode 'scenario' filters to .sav and skips the mode dialog", async () => {
    mocked.saveDirs.mockResolvedValue(["C:/saves"]);
    mocked.openAsScenario.mockResolvedValue(SCENARIO_RESULT);
    usePaintModStore.setState({ paintChoice: false });
    mocked.open.mockResolvedValueOnce("C:/saves/picked.sav");

    await session().pickAndOpen("scenario");

    expect(mocked.open).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "C:/saves",
        multiple: false,
        filters: [{ name: "Stellaris save", extensions: ["sav"] }],
      }),
    );
    expect(mocked.openAsScenario).toHaveBeenCalledWith("C:/saves/picked.sav", "plain");
    expect(mocked.openSave).not.toHaveBeenCalled();
    expect(session().pendingOpen).toBeNull();
  });

  it("a save taken as a scenario follows the standing Paint a Galaxy choice on every route", async () => {
    mocked.saveDirs.mockResolvedValue(["C:/saves"]);
    mocked.openAsScenario.mockResolvedValue(SCENARIO_RESULT);
    usePaintModStore.setState({ paintChoice: true });

    mocked.open.mockResolvedValueOnce("C:/saves/picked.sav");
    await session().pickAndOpen("scenario");
    expect(mocked.openAsScenario).toHaveBeenLastCalledWith("C:/saves/picked.sav", "paint_a_galaxy");

    mocked.open.mockResolvedValueOnce("C:/saves/other.sav");
    await session().pickAndOpen();
    await session().chooseOpenMode("scenario");
    expect(mocked.openAsScenario).toHaveBeenLastCalledWith("C:/saves/other.sav", "paint_a_galaxy");

    usePaintModStore.setState({ paintChoice: false });
    mocked.open.mockResolvedValueOnce("C:/saves/plain.sav");
    await session().pickAndOpen();
    await session().chooseOpenMode("scenario");
    expect(mocked.openAsScenario).toHaveBeenLastCalledWith("C:/saves/plain.sav", "plain");
  });

  it("pickAndOpen with a profile opens the picked save as a scenario written under it", async () => {
    mocked.saveDirs.mockResolvedValue(["C:/saves"]);
    mocked.openAsScenario.mockResolvedValue({ ...SCENARIO_RESULT, path: null, painted: true });
    mocked.open.mockResolvedValueOnce("C:/saves/picked.sav");

    await session().pickAndOpen("scenario", "paint_a_galaxy");

    expect(mocked.openAsScenario).toHaveBeenCalledWith("C:/saves/picked.sav", "paint_a_galaxy");
    expect(session().painted).toBe(true);
    expect(session().paintChosen).toBe(true);
    expect(getPaintLayer()).toBe(true);
  });

  it("pickAndOpen with an explicit plain profile opens plain even while the standing choice is on", async () => {
    mocked.saveDirs.mockResolvedValue(["C:/saves"]);
    mocked.openAsScenario.mockResolvedValue({ ...SCENARIO_RESULT, path: null });
    usePaintModStore.setState({ paintChoice: true });
    mocked.open.mockResolvedValueOnce("C:/saves/picked.sav");

    await session().pickAndOpen("scenario", "plain");

    expect(mocked.openAsScenario).toHaveBeenCalledWith("C:/saves/picked.sav", "plain");
    expect(session().paintChosen).toBe(false);
    expect(getPaintLayer()).toBe(false);

    mocked.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100, "plain");
    expect(mocked.newScenario).toHaveBeenCalledWith("my_galaxy", 400, 100, "plain");
    expect(getPaintLayer()).toBe(false);
  });
});

describe("reload", () => {
  it("re-reads the open file, and a refused discard leaves the session alone", async () => {
    await session().openSave(OPEN_RESULT.path);
    await edit();
    expect(session().dirty).toBe(true);

    mocked.confirm.mockResolvedValueOnce(false);
    await session().reload();
    expect(mocked.openSave).toHaveBeenCalledTimes(1);
    expect(session().dirty).toBe(true);

    await session().reload();
    expect(mocked.openSave).toHaveBeenLastCalledWith(OPEN_RESULT.path);
    expect(session().dirty).toBe(false);
  });
});

describe("close", () => {
  beforeEach(async () => {
    await session().openSave(OPEN_RESULT.path);
  });

  it("drops the session and the galaxy", async () => {
    await session().close();
    expect(mocked.closeSave).toHaveBeenCalledTimes(1);
    expect(session().status).toBe("empty");
    expect(useGalaxyStore.getState().galaxy).toBeNull();
  });

  it("when dirty and confirm -> false leaves the session open and calls no closeSave", async () => {
    await edit();
    mocked.confirm.mockResolvedValueOnce(false);
    await session().close();

    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(mocked.closeSave).not.toHaveBeenCalled();
    expect(session().status).toBe("ready");
  });

  it("when dirty and confirm -> true closes", async () => {
    await edit();
    mocked.confirm.mockResolvedValueOnce(true);
    await session().close();

    expect(mocked.closeSave).toHaveBeenCalledTimes(1);
    expect(session().status).toBe("empty");
  });
});

describe("save", () => {
  beforeEach(async () => {
    await session().openSave(OPEN_RESULT.path);
  });

  it("save after an edit clears dirty, sets lastSave and path, and notes the clock time", async () => {
    await edit();
    expect(session().dirty).toBe(true);
    expect(session().savedAt).toBeNull();

    const before = Date.now();
    const result = saveResult({ dirty: false });
    mocked.save.mockResolvedValueOnce(result);
    await session().save();

    const state = session();
    expect(state.dirty).toBe(false);
    expect(state.lastSave).toEqual(result);
    expect(state.path).toBe(result.path);
    expect(state.savedAt).toBeGreaterThanOrEqual(before);
    expect(state.error).toBeNull();
  });

  it("save failure leaves dirty true and sets error", async () => {
    await edit();
    mocked.save.mockRejectedValueOnce({ kind: "io", message: "disk full" });
    await session().save();

    const state = session();
    expect(state.dirty).toBe(true);
    expect(state.error).toBe("disk full");
  });

  it("save reports progress while writing and clears it after", async () => {
    await edit();

    progressHandler = null;
    let finish!: (r: SaveResult) => void;
    mocked.save.mockReturnValueOnce(new Promise<SaveResult>((r) => (finish = r)));
    const p = session().save();
    await vi.waitFor(() => expect(progressHandler).not.toBeNull());
    expect(session().saving).toBe(true);
    progressHandler!({ phase: "write", fraction: 0.43 });
    expect(session().progress).toEqual({ phase: "write", fraction: 0.43 });

    finish(saveResult());
    await p;
    const state = session();
    expect(state.saving).toBe(false);
    expect(state.progress).toBeNull();
    expect(state.dirty).toBe(false);
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it("saveAs cancelled calls no ipc", async () => {
    mocked.saveDialog.mockResolvedValueOnce(null);
    await session().saveAs();
    expect(mocked.saveAs).not.toHaveBeenCalled();
  });

  it("saveAs picked calls ipc.saveAs with the path and updates path", async () => {
    mocked.saveDialog.mockResolvedValueOnce("C:/saves/other.sav");
    const result = saveResult({ path: "C:/saves/other.sav" });
    mocked.saveAs.mockResolvedValueOnce(result);

    await session().saveAs();

    expect(mocked.saveAs).toHaveBeenCalledWith("C:/saves/other.sav");
    expect(session().path).toBe("C:/saves/other.sav");
    expect(session().lastSave).toEqual(result);
  });

  it("a refused saveAs keeps the session dirty on its own path and reports the message", async () => {
    await edit();
    mocked.saveDialog.mockResolvedValueOnce("D:/read-only/other.sav");
    mocked.saveAs.mockRejectedValueOnce({ kind: "io", message: "access denied" });

    await session().saveAs();

    const state = session();
    expect(state.error).toBe("access denied");
    expect(state.dirty).toBe(true);
    expect(state.saving).toBe(false);
    expect(state.path).toBe(OPEN_RESULT.path);
    expect(state.lastSave).toBeNull();
  });

  it("saveAs does nothing without a ready session", async () => {
    await session().close();
    await session().saveAs();
    expect(mocked.saveDialog).not.toHaveBeenCalled();
  });
});

describe("Steam Cloud", () => {
  const CLOUD_PATH = "C:/Steam/userdata/1/281990/remote/save games/test/cloud.sav";

  async function openCloudSave() {
    mocked.openSave.mockResolvedValueOnce({ ...OPEN_RESULT, path: CLOUD_PATH, cloud: true });
    await session().openSave(CLOUD_PATH);
    await edit();
    useIssuesStore.setState({ issues: [] });
    mocked.confirm.mockClear();
  }

  it("open sets cloud from the result and close resets it", async () => {
    await openCloudSave();
    expect(session().cloud).toBe(true);
    mocked.confirm.mockResolvedValueOnce(true);
    await session().close();
    expect(session().cloud).toBe(false);
  });

  it("save warns once; cancel keeps the session dirty and writes nothing", async () => {
    await openCloudSave();
    mocked.confirm.mockResolvedValueOnce(false);
    await session().save();

    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(mocked.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Steam can overwrite it with the cloud copy"),
      expect.objectContaining({ title: "Steam Cloud save", kind: "warning" }),
    );
    expect(mocked.save).not.toHaveBeenCalled();
    expect(session().dirty).toBe(true);
    expect(session().error).toBeNull();
  });

  it("save after agreeing writes, and a second save does not ask again", async () => {
    await openCloudSave();
    mocked.confirm.mockResolvedValueOnce(true);
    mocked.save.mockResolvedValue(saveResult({ path: CLOUD_PATH, cloud: true }));
    await session().save();
    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(mocked.save).toHaveBeenCalledTimes(1);
    expect(session().dirty).toBe(false);
    expect(session().cloud).toBe(true);

    await edit();
    useIssuesStore.setState({ issues: [] });
    await session().save();
    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(mocked.save).toHaveBeenCalledTimes(2);
  });

  it("saveAs asks the Rust side about the picked path and warns only for a cloud one", async () => {
    await session().openSave(OPEN_RESULT.path);
    useIssuesStore.setState({ issues: [] });
    expect(session().cloud).toBe(false);

    mocked.saveDialog.mockResolvedValueOnce(CLOUD_PATH);
    mocked.isCloudSave.mockResolvedValueOnce(true);
    mocked.confirm.mockResolvedValueOnce(false);
    await session().saveAs();
    expect(mocked.isCloudSave).toHaveBeenCalledWith(CLOUD_PATH);
    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(mocked.saveAs).not.toHaveBeenCalled();

    mocked.saveDialog.mockResolvedValueOnce("C:/saves/other.sav");
    mocked.isCloudSave.mockResolvedValueOnce(false);
    mocked.saveAs.mockResolvedValueOnce(saveResult({ path: "C:/saves/other.sav" }));
    await session().saveAs();
    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(mocked.saveAs).toHaveBeenCalledWith("C:/saves/other.sav");
    expect(session().cloud).toBe(false);
  });
});

describe("unresolved issues", () => {
  const ISOLATED = OPEN_RESULT.issues[0];
  const ISSUE_DIALOG = {
    title: "2206.11.16.sav",
    kind: "warning",
    okLabel: "Save anyway",
    cancelLabel: "Cancel",
  };

  beforeEach(async () => {
    useLayoutStore.setState({ tab: "inspector", collapsed: false });
    await session().openSave(OPEN_RESULT.path);
    await edit();
  });

  it("save shows the Issues tab and asks; cancel writes nothing", async () => {
    useLayoutStore.getState().toggleDock();
    mocked.confirm.mockResolvedValueOnce(false);
    await session().save();

    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(mocked.confirm).toHaveBeenCalledWith(
      "This map has 1 unresolved issue. Save anyway?",
      ISSUE_DIALOG,
    );
    expect(useLayoutStore.getState().tab).toBe("issues");
    expect(useLayoutStore.getState().collapsed).toBe(false);
    expect(mocked.save).not.toHaveBeenCalled();
    expect(session().dirty).toBe(true);
    expect(session().dismissedIssues).toEqual([]);
  });

  it("Save anyway writes, and the same issues do not ask again", async () => {
    mocked.confirm.mockResolvedValueOnce(true);
    mocked.save.mockResolvedValue(saveResult({ dirty: false }));
    await session().save();
    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(mocked.save).toHaveBeenCalledTimes(1);
    expect(session().dismissedIssues).toEqual(["system_isolated:5"]);

    await edit();
    await session().save();
    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(mocked.save).toHaveBeenCalledTimes(2);
  });

  it("an issue with another code or other systems asks again", async () => {
    mocked.save.mockResolvedValue(saveResult({ dirty: false }));
    await session().save();
    expect(mocked.confirm).toHaveBeenCalledTimes(1);

    session().noteEdit({ issues: [ISOLATED, { ...ISOLATED, systems: [3] }], dirty: true });
    await session().save();
    expect(mocked.confirm).toHaveBeenCalledTimes(2);
    expect(mocked.confirm).toHaveBeenLastCalledWith(
      "This map has 2 unresolved issues. Save anyway?",
      ISSUE_DIALOG,
    );

    session().noteEdit({
      issues: [ISOLATED, { ...ISOLATED, severity: "error", code: "disconnected" }],
      dirty: true,
    });
    await session().save();
    expect(mocked.confirm).toHaveBeenCalledTimes(3);
    expect(mocked.save).toHaveBeenCalledTimes(3);
  });

  it("info issues and notes never ask", async () => {
    useIssuesStore.setState({
      issues: [{ ...ISOLATED, severity: "info" }, duplicateNameNote("Elysium", "other.txt")],
    });
    mocked.save.mockResolvedValueOnce(saveResult({ dirty: false }));
    await session().save();
    expect(mocked.confirm).not.toHaveBeenCalled();
    expect(mocked.save).toHaveBeenCalledTimes(1);
    expect(useLayoutStore.getState().tab).toBe("inspector");
  });

  it("the reserved seats note asks, since the map would not play as designed", async () => {
    useIssuesStore.setState({ issues: [reservedSpawnsNote([2])] });
    mocked.confirm.mockResolvedValueOnce(false);
    await session().save();
    expect(mocked.confirm).toHaveBeenCalledWith(
      "This map has 1 unresolved issue. Save anyway?",
      ISSUE_DIALOG,
    );
    expect(mocked.save).not.toHaveBeenCalled();
    expect(useLayoutStore.getState().tab).toBe("issues");
  });

  it("saveAs and saving into the mod ask once, before the picker", async () => {
    mocked.confirm.mockResolvedValueOnce(false);
    await session().saveAs();
    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(mocked.saveDialog).not.toHaveBeenCalled();

    mocked.confirm.mockResolvedValueOnce(true);
    mocked.saveDialog.mockResolvedValueOnce("C:/saves/other.sav");
    mocked.saveAs.mockResolvedValueOnce(saveResult({ path: "C:/saves/other.sav" }));
    await session().saveAs();
    expect(mocked.confirm).toHaveBeenCalledTimes(2);
    expect(mocked.saveAs).toHaveBeenCalledTimes(1);

    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_RESULT.path);
    usePaintModStore.setState({
      known: true,
      paintMod: {
        scenarios_dir: "C:/mods/pag/map/setup_scenarios",
        enabled: true,
        reserved_spawns: true,
      },
    });
    mocked.confirm.mockResolvedValueOnce(false);
    await usePaintModStore.getState().saveIntoPaintMod();
    expect(mocked.confirm).toHaveBeenCalledTimes(3);
    expect(mocked.saveDialog).toHaveBeenCalledTimes(1);
  });

  it("opening or closing a document forgets what was dismissed", async () => {
    mocked.save.mockResolvedValue(saveResult({ dirty: false }));
    await session().save();
    expect(session().dismissedIssues).toEqual(["system_isolated:5"]);

    await session().openSave(OPEN_RESULT.path);
    expect(session().dismissedIssues).toEqual([]);
    await edit();
    await session().save();
    expect(mocked.confirm).toHaveBeenCalledTimes(2);

    await session().close();
    expect(session().dismissedIssues).toEqual([]);
  });
});

describe("scenario documents", () => {
  const SCENARIO_PATH = SCENARIO_RESULT.path;
  const PAINT_DIR = "C:/mods/pag/map/setup_scenarios";

  it("opening a scenario file takes its kind, title and capabilities, and has no save header", async () => {
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_PATH);

    const state = session();
    expect(mocked.openSave).toHaveBeenCalledWith(SCENARIO_PATH);
    expect(state.pendingOpen).toBeNull();
    expect(state.status).toBe("ready");
    expect(state.kind).toBe("scenario");
    expect(state.title).toBe("my_galaxy");
    expect(state.meta).toBeNull();
    expect(state.capabilities).toEqual(SCENARIO_RESULT.capabilities);
    expect(state.path).toBe(SCENARIO_PATH);
  });

  it("a save asks first: as a scenario, as a save, or not at all", async () => {
    usePaintModStore.setState({ paintChoice: false });
    mocked.openAsScenario.mockResolvedValue({ ...SCENARIO_RESULT, path: null });
    await session().requestOpen(OPEN_RESULT.path);
    expect(session().pendingOpen).toBe(OPEN_RESULT.path);
    expect(mocked.openSave).not.toHaveBeenCalled();
    expect(mocked.openAsScenario).not.toHaveBeenCalled();

    await session().chooseOpenMode("scenario");
    expect(mocked.openAsScenario).toHaveBeenCalledWith(OPEN_RESULT.path, "plain");
    expect(mocked.openSave).not.toHaveBeenCalled();
    expect(session().kind).toBe("scenario");
    expect(session().path).toBeNull();

    await session().requestOpen(OPEN_RESULT.path);
    await session().chooseOpenMode("save");
    expect(mocked.openSave).toHaveBeenCalledWith(OPEN_RESULT.path);
    expect(session().kind).toBe("save");

    await session().requestOpen(OPEN_RESULT.path);
    await session().chooseOpenMode(null);
    expect(session().pendingOpen).toBeNull();
    expect(mocked.openSave).toHaveBeenCalledTimes(1);
    expect(mocked.openAsScenario).toHaveBeenCalledTimes(1);
  });

  it("a new scenario has no path, so Save asks where to put it", async () => {
    mocked.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100);
    expect(mocked.newScenario).toHaveBeenCalledWith("my_galaxy", 400, 100, "plain");
    expect(session().path).toBeNull();
    expect(session().title).toBe("my_galaxy");
    expect(getPaintLayer()).toBe(false);

    mocked.saveDialog.mockResolvedValueOnce("C:/mods/map/setup_scenarios/my_galaxy.txt");
    mocked.saveAs.mockResolvedValueOnce(
      saveResult({ path: "C:/mods/map/setup_scenarios/my_galaxy.txt" }),
    );
    await session().save();

    expect(mocked.save).not.toHaveBeenCalled();
    expect(mocked.saveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "my_galaxy.txt",
        filters: [{ name: "Stellaris static galaxy scenario", extensions: ["txt"] }],
      }),
    );
    expect(mocked.saveAs).toHaveBeenCalledWith("C:/mods/map/setup_scenarios/my_galaxy.txt");
    expect(session().path).toBe("C:/mods/map/setup_scenarios/my_galaxy.txt");
  });

  it("a new scenario under the Paint a Galaxy profile asks for it and turns the layer on", async () => {
    mocked.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100, "paint_a_galaxy");
    expect(mocked.newScenario).toHaveBeenCalledWith("my_galaxy", 400, 100, "paint_a_galaxy");
    expect(session().paintChosen).toBe(true);
    expect(getPaintLayer()).toBe(true);

    mocked.openAsScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().openScenarioFrom(OPEN_RESULT.path, "paint_a_galaxy");
    expect(mocked.openAsScenario).toHaveBeenCalledWith(OPEN_RESULT.path, "paint_a_galaxy");
    expect(getPaintLayer()).toBe(true);

    mocked.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100);
    expect(session().paintChosen).toBe(false);
    expect(getPaintLayer()).toBe(false);
  });

  it("a painted file turns the layer on without a profile; a plain open turns it off again", async () => {
    mocked.openSave.mockResolvedValueOnce({ ...SCENARIO_RESULT, painted: true });
    await session().requestOpen(SCENARIO_PATH);
    expect(session().painted).toBe(true);
    expect(session().paintChosen).toBe(false);
    expect(getPaintLayer()).toBe(true);

    await session().close();
    expect(session().painted).toBe(false);
    expect(getPaintLayer()).toBe(false);

    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_PATH);
    expect(getPaintLayer()).toBe(false);
  });

  it("a file the site exported is opened as painted even when no seat was set", async () => {
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().openScenario(SCENARIO_PATH, "paint_a_galaxy");
    expect(mocked.openSave).toHaveBeenCalledWith(SCENARIO_PATH);
    expect(session().painted).toBe(false);
    expect(session().paintChosen).toBe(true);
    expect(getPaintLayer()).toBe(true);

    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().openScenario(SCENARIO_PATH);
    expect(session().paintChosen).toBe(false);
  });

  it("picking a painted file asks to discard before the picker, and opens what is picked as painted", async () => {
    await session().openSave(OPEN_RESULT.path);
    await edit();
    mocked.confirm.mockResolvedValueOnce(false);
    expect(await session().pickAndOpenScenario("paint_a_galaxy")).toBe(false);
    expect(mocked.open).not.toHaveBeenCalled();
    expect(session().kind).toBe("save");

    mocked.confirm.mockResolvedValueOnce(true);
    mocked.open.mockResolvedValueOnce(null);
    expect(await session().pickAndOpenScenario("paint_a_galaxy")).toBe(false);
    expect(mocked.open).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ name: "Stellaris static galaxy scenario", extensions: ["txt"] }],
      }),
    );
    expect(session().kind).toBe("save");

    mocked.confirm.mockResolvedValueOnce(true);
    mocked.open.mockResolvedValueOnce(SCENARIO_PATH);
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    expect(await session().pickAndOpenScenario("paint_a_galaxy")).toBe(true);
    expect(mocked.openSave).toHaveBeenLastCalledWith(SCENARIO_PATH);
    expect(session().kind).toBe("scenario");
    expect(session().paintChosen).toBe(true);
    expect(getPaintLayer()).toBe(true);
  });

  it("reloading keeps what was said of the file at open, since the bytes cannot say it", async () => {
    mocked.openSave.mockResolvedValue(SCENARIO_RESULT);
    await session().openScenario(SCENARIO_PATH, "paint_a_galaxy");
    expect(getPaintLayer()).toBe(true);

    await session().reload();
    expect(mocked.openSave).toHaveBeenCalledTimes(2);
    expect(session().paintChosen).toBe(true);
    expect(getPaintLayer()).toBe(true);

    await session().openScenario(SCENARIO_PATH);
    await session().reload();
    expect(session().paintChosen).toBe(false);
    expect(getPaintLayer()).toBe(false);
    mocked.openSave.mockResolvedValue(OPEN_RESULT);
  });

  it("a plain scenario inside the mod's scenarios folder is on the layer; the same file elsewhere is not", async () => {
    usePaintModStore.setState({
      known: true,
      paintMod: { scenarios_dir: PAINT_DIR, enabled: true, reserved_spawns: true },
    });
    mocked.openSave.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: `${PAINT_DIR}/mine.txt` });
    await session().requestOpen(`${PAINT_DIR}/mine.txt`);
    expect(getPaintLayer()).toBe(true);

    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_PATH);
    expect(getPaintLayer()).toBe(false);

    mocked.openSave.mockResolvedValueOnce({ ...OPEN_RESULT, path: `${PAINT_DIR}/mine.sav` });
    await session().openSave(`${PAINT_DIR}/mine.sav`);
    expect(getPaintLayer()).toBe(false);
  });

  it("a new scenario on the layer is offered the mod's scenarios folder; an existing file keeps its path", async () => {
    usePaintModStore.setState({
      known: true,
      paintMod: { scenarios_dir: PAINT_DIR, enabled: true, reserved_spawns: true },
    });
    mocked.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100, "paint_a_galaxy");

    mocked.saveDialog.mockResolvedValueOnce(null);
    await session().saveAs();
    expect(mocked.saveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: `${PAINT_DIR}/my_galaxy.txt` }),
    );

    mocked.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100);
    mocked.saveDialog.mockResolvedValueOnce(null);
    await session().saveAs();
    expect(mocked.saveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: "my_galaxy.txt" }),
    );

    mocked.openSave.mockResolvedValueOnce({ ...SCENARIO_RESULT, painted: true });
    await session().requestOpen(SCENARIO_PATH);
    mocked.saveDialog.mockResolvedValueOnce(null);
    await session().saveAs();
    expect(mocked.saveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: SCENARIO_PATH }),
    );
  });

  it("saving into the mod offers its folder under the file's own name, and does nothing without one", async () => {
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_PATH);
    await usePaintModStore.getState().saveIntoPaintMod();
    expect(mocked.saveDialog).not.toHaveBeenCalled();

    usePaintModStore.setState({
      known: true,
      paintMod: {
        scenarios_dir: "C:\\mods\\pag\\map\\setup_scenarios",
        enabled: false,
        reserved_spawns: true,
      },
    });
    const landed = "C:\\mods\\pag\\map\\setup_scenarios\\my_galaxy.txt";
    mocked.saveDialog.mockResolvedValueOnce(landed);
    mocked.saveAs.mockResolvedValueOnce(saveResult({ path: landed }));
    await usePaintModStore.getState().saveIntoPaintMod();
    expect(mocked.saveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        defaultPath: landed,
        filters: [{ name: "Stellaris static galaxy scenario", extensions: ["txt"] }],
      }),
    );
    expect(mocked.saveAs).toHaveBeenCalledWith(landed);
    expect(session().path).toBe(landed);
    expect(getPaintLayer()).toBe(true);

    await session().openSave(OPEN_RESULT.path);
    await usePaintModStore.getState().saveIntoPaintMod();
    expect(mocked.saveDialog).toHaveBeenCalledTimes(1);
  });

  it("says what to do next once a file lands in the mod's folder, named by the header's size", async () => {
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_PATH);
    useGalaxyStore.setState({ header: [{ key: "name", value: '"Elysium"', line: 1 }] });
    usePaintModStore.setState({
      known: true,
      paintMod: { scenarios_dir: PAINT_DIR, enabled: true, reserved_spawns: true },
    });

    const landed = `${PAINT_DIR}/my_galaxy.txt`;
    mocked.saveDialog.mockResolvedValueOnce(landed);
    mocked.saveAs.mockResolvedValueOnce(saveResult({ path: landed }));
    await usePaintModStore.getState().saveIntoPaintMod();

    expect(session().notice).toBe(
      "Saved into the Paint a Galaxy mod. In Stellaris, start a new game and pick the size Elysium.",
    );
  });

  it("says nothing next when the header names no size, or the file lands outside the mod's folder", async () => {
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_PATH);
    usePaintModStore.setState({
      known: true,
      paintMod: { scenarios_dir: PAINT_DIR, enabled: true, reserved_spawns: true },
    });

    mocked.saveDialog.mockResolvedValueOnce(`${PAINT_DIR}/my_galaxy.txt`);
    mocked.saveAs.mockResolvedValueOnce(saveResult({ path: `${PAINT_DIR}/my_galaxy.txt` }));
    await usePaintModStore.getState().saveIntoPaintMod();
    expect(session().notice).toBeNull();

    useGalaxyStore.setState({ header: [{ key: "name", value: '"Elysium"', line: 1 }] });
    mocked.saveDialog.mockResolvedValueOnce("C:/mods/mine/map/setup_scenarios/elsewhere.txt");
    mocked.saveAs.mockResolvedValueOnce(
      saveResult({ path: "C:/mods/mine/map/setup_scenarios/elsewhere.txt" }),
    );
    await session().saveAs();
    expect(session().notice).toBeNull();
  });

  it("notes every other file in the mod's folder that lists the same name, on open and again on save", async () => {
    usePaintModStore.setState({
      known: true,
      paintMod: { scenarios_dir: PAINT_DIR, enabled: true, reserved_spawns: true },
    });
    const mine = `${PAINT_DIR}/my_galaxy.txt`;
    mocked.openSave.mockResolvedValueOnce({
      ...SCENARIO_RESULT,
      path: mine,
      galaxy: {
        ...SCENARIO_RESULT.galaxy,
        header: [{ key: "name", value: '"Elysium"', line: 1 }],
      },
    });
    mocked.siblingScenarioNames.mockResolvedValueOnce([
      ["other.txt", "Elysium"],
      ["third.txt", "Arcadia"],
    ]);
    await session().requestOpen(mine);
    await vi.waitFor(() => expect(useIssuesStore.getState().issues).toHaveLength(2));
    expect(mocked.siblingScenarioNames).toHaveBeenCalledWith(mine);
    expect(useIssuesStore.getState().issues[1]).toEqual({
      severity: "warning",
      code: "scenario_name_duplicate",
      message:
        'Another file in the mod lists the same name "Elysium": other.txt. ' +
        "The game shows one size per name.",
      systems: [],
    });
    expect(useIssuesStore.getState().notes).toEqual([useIssuesStore.getState().issues[1]]);

    mocked.applyOp.mockResolvedValueOnce(editResult({ issues: [] }));
    await useEditorStore.getState().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 });
    expect(useIssuesStore.getState().issues.map((issue) => issue.code)).toEqual([
      "scenario_name_duplicate",
    ]);

    mocked.save.mockResolvedValueOnce(saveResult({ path: mine, dirty: false }));
    mocked.siblingScenarioNames.mockResolvedValueOnce([["other.txt", "Renamed"]]);
    await session().save();
    await vi.waitFor(() => expect(useIssuesStore.getState().issues).toEqual([]));
    expect(useIssuesStore.getState().notes).toEqual([]);
  });

  it("notes nothing for a scenario outside the mod's folder, or when the folder cannot be read", async () => {
    usePaintModStore.setState({
      known: true,
      paintMod: { scenarios_dir: PAINT_DIR, enabled: true, reserved_spawns: true },
    });
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_PATH);
    expect(mocked.siblingScenarioNames).not.toHaveBeenCalled();

    const mine = `${PAINT_DIR}/my_galaxy.txt`;
    mocked.openSave.mockResolvedValueOnce({
      ...SCENARIO_RESULT,
      path: mine,
      galaxy: {
        ...SCENARIO_RESULT.galaxy,
        header: [{ key: "name", value: '"Elysium"', line: 1 }],
      },
    });
    mocked.siblingScenarioNames.mockRejectedValueOnce(new Error("unreadable"));
    await session().requestOpen(mine);
    await vi.waitFor(() => expect(mocked.siblingScenarioNames).toHaveBeenCalledWith(mine));
    expect(useIssuesStore.getState().issues.map((issue) => issue.code)).toEqual([
      "system_isolated",
    ]);
    expect(session().error).toBeNull();
  });

  it("notes the reserved seats while the launcher says the Reserved Spawns submod is not enabled", async () => {
    const seated = (kind: PaintSpawnKind): SystemNode => ({
      ...SYSTEMS[2],
      spawn_script: { paint_a_galaxy: { kind, random_value: 2, player: false } },
    });
    const codes = () => useIssuesStore.getState().issues.map((issue) => issue.code);
    const mod = (reserved_spawns: boolean) => ({
      scenarios_dir: PAINT_DIR,
      enabled: true,
      reserved_spawns,
    });
    mocked.openSave.mockResolvedValueOnce({
      ...SCENARIO_RESULT,
      painted: true,
      galaxy: {
        ...SCENARIO_RESULT.galaxy,
        systems: SYSTEMS.map((s) => (s.id === 2 ? seated({ reserved: "a" }) : s)),
      },
    });
    await session().requestOpen(SCENARIO_PATH);
    expect(codes()).toEqual(["system_isolated"]);

    usePaintModStore.setState({ known: true, paintMod: mod(false) });
    expect(useIssuesStore.getState().issues[1]).toEqual({
      severity: "warning",
      code: "reserved_spawns_missing",
      message:
        "Reserved seats need the Reserved Spawns submod, which is not enabled. Subscribe to it " +
        "and enable it in your playset, or these seats spawn at random.",
      systems: [2],
    });
    expect(useIssuesStore.getState().notes).toEqual([useIssuesStore.getState().issues[1]]);

    usePaintModStore.setState({ paintMod: mod(true) });
    expect(codes()).toEqual(["system_isolated"]);
    expect(useIssuesStore.getState().notes).toEqual([]);

    usePaintModStore.setState({ paintMod: null });
    expect(codes()).toEqual(["system_isolated", "reserved_spawns_missing"]);

    mocked.applyOp.mockResolvedValueOnce(editResult({ delta: { systems: [seated("sol")] } }));
    await useEditorStore.getState().applyOp({ type: "SetSpawnScript", id: 2, script: null });
    expect(codes()).toEqual(["system_isolated"]);

    mocked.applyOp.mockResolvedValueOnce(
      editResult({ delta: { systems: [seated({ reserved: "b" })] } }),
    );
    await useEditorStore.getState().applyOp({ type: "SetSpawnScript", id: 2, script: null });
    expect(codes()).toEqual(["system_isolated", "reserved_spawns_missing"]);

    mocked.applyOp.mockResolvedValueOnce(editResult({ delta: { systems: [seated("enabled")] } }));
    await useEditorStore.getState().applyOp({ type: "SetSpawnScript", id: 2, script: null });
    expect(codes()).toEqual(["system_isolated"]);
  });

  it("exporting previews the report, then writes a second file and leaves the save's own path, edits and save time alone", async () => {
    await session().openSave(OPEN_RESULT.path);
    await edit();

    const report = exportReport({ dropped: { wormhole_pairs: 6, gateways: 0, lgates: 0 } });
    mocked.previewExport.mockResolvedValueOnce(report);
    await session().exportScenario();
    expect(session().pendingExport).toEqual(report);
    expect(mocked.saveDialog).not.toHaveBeenCalled();

    const exported = "C:/mods/map/setup_scenarios/test_empire.txt";
    mocked.saveDialog.mockResolvedValueOnce(exported);
    const save = saveResult({ path: exported, dirty: true });
    mocked.exportScenario.mockResolvedValueOnce({ save, report });
    const before = Date.now();
    await session().confirmExport("plain");

    expect(mocked.saveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "Test Empire.txt",
        filters: [{ name: "Stellaris static galaxy scenario", extensions: ["txt"] }],
      }),
    );
    expect(mocked.exportScenario).toHaveBeenCalledWith(exported, "plain");
    const state = session();
    expect(state.pendingExport).toBeNull();
    expect(state.path).toBe(OPEN_RESULT.path);
    expect(state.dirty).toBe(true);
    expect(state.saving).toBe(false);
    expect(state.lastSave).toBeNull();
    expect(state.lastExport).toEqual({ save, report });
    expect(state.exportedAt).toBeGreaterThanOrEqual(before);
    expect(state.savedAt).toBeNull();

    await session().openSave(OPEN_RESULT.path);
    expect(session().lastExport).toBeNull();
    expect(session().exportedAt).toBeNull();
  });

  it("exporting for Paint a Galaxy asks for that profile, and offers the mod's folder when known", async () => {
    await session().openSave(OPEN_RESULT.path);
    useFileSessionStore.setState({ pendingExport: exportReport() });
    const exported = "C:/mods/map/setup_scenarios/test_empire.txt";
    mocked.saveDialog.mockResolvedValueOnce(exported);
    mocked.exportScenario.mockResolvedValueOnce({
      save: saveResult({ path: exported }),
      report: exportReport(),
    });

    await session().confirmExport("paint_a_galaxy");

    expect(mocked.saveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: "Test Empire.txt" }),
    );
    expect(mocked.exportScenario).toHaveBeenCalledWith(exported, "paint_a_galaxy");
    expect(getPaintLayer()).toBe(false);

    usePaintModStore.setState({
      known: true,
      paintMod: { scenarios_dir: PAINT_DIR, enabled: true, reserved_spawns: true },
    });
    useFileSessionStore.setState({ pendingExport: exportReport() });
    mocked.saveDialog.mockResolvedValueOnce(null);
    await session().confirmExport("paint_a_galaxy");
    expect(mocked.saveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: `${PAINT_DIR}/Test Empire.txt` }),
    );

    useFileSessionStore.setState({ pendingExport: exportReport() });
    mocked.saveDialog.mockResolvedValueOnce(null);
    await session().confirmExport("plain");
    expect(mocked.saveDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ defaultPath: "Test Empire.txt" }),
    );
  });

  it("a cancelled export writes nothing, and a scenario has nothing to export", async () => {
    await session().openSave(OPEN_RESULT.path);
    mocked.previewExport.mockResolvedValueOnce(exportReport());
    await session().exportScenario();
    await session().confirmExport(null);
    let state = session();
    expect(state.pendingExport).toBeNull();
    expect(state.saving).toBe(false);
    expect(state.lastExport).toBeNull();
    expect(mocked.saveDialog).not.toHaveBeenCalled();

    mocked.previewExport.mockResolvedValueOnce(exportReport());
    await session().exportScenario();
    mocked.saveDialog.mockResolvedValueOnce(null);
    await session().confirmExport("plain");
    state = session();
    expect(mocked.saveDialog).toHaveBeenCalledTimes(1);
    expect(mocked.exportScenario).not.toHaveBeenCalled();
    expect(state.pendingExport).toBeNull();
    expect(state.saving).toBe(false);
    expect(state.lastExport).toBeNull();

    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().openSave(SCENARIO_PATH);
    await session().exportScenario();
    expect(mocked.previewExport).toHaveBeenCalledTimes(2);
    expect(session().pendingExport).toBeNull();
  });

  it("confirming with nothing pending is a no-op", async () => {
    await session().openSave(OPEN_RESULT.path);
    await session().confirmExport("plain");
    const state = session();
    expect(mocked.saveDialog).not.toHaveBeenCalled();
    expect(state.saving).toBe(false);
    expect(state.lastExport).toBeNull();
    expect(state.pendingExport).toBeNull();
  });

  it("a preview that lands after another document opened raises no dialog", async () => {
    await session().openSave(OPEN_RESULT.path);
    let land!: (report: ExportReport) => void;
    mocked.previewExport.mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    const previewing = session().exportScenario();
    await session().openSave(OPEN_RESULT.path);
    land(exportReport());
    await previewing;
    expect(session().pendingExport).toBeNull();
    expect(session().status).toBe("ready");
  });

  it("a preview that fails reports the message and asks nothing", async () => {
    await session().openSave(OPEN_RESULT.path);
    mocked.previewExport.mockRejectedValueOnce({ kind: "op", message: "no galaxy" });
    await session().exportScenario();
    expect(session().pendingExport).toBeNull();
    expect(session().error).toBe("no galaxy");
    expect(session().errorKind).toBe("op");
  });
});

describe("recents", () => {
  it("opening a save records a recent with the save's subtitle", async () => {
    await session().openSave(OPEN_RESULT.path);
    const recents = useRecentsStore.getState().recents;
    expect(recents).toHaveLength(1);
    expect(recents[0]).toMatchObject({
      kind: "save",
      path: OPEN_RESULT.path,
      title: OPEN_RESULT.title,
      subtitle: "Test Empire · 2206.11.16 · v4.4.6",
    });
  });

  it("a new scenario and a save opened as a scenario have no path, so nothing is recorded", async () => {
    mocked.newScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().newScenario("my_galaxy", 400, 100);
    expect(useRecentsStore.getState().recents).toHaveLength(0);

    mocked.openAsScenario.mockResolvedValueOnce({ ...SCENARIO_RESULT, path: null });
    await session().openScenarioFrom(OPEN_RESULT.path);
    expect(useRecentsStore.getState().recents).toHaveLength(0);
  });
});

describe("settling", () => {
  it("a scenario open with game data ready holds settling until the owners pass resolves", async () => {
    useGameDataStore.setState({ status: "ready" });
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    let resolveOwners!: (owners: null) => void;
    mocked.getScenarioOwners.mockImplementationOnce(
      () => new Promise((resolve) => (resolveOwners = resolve)),
    );

    const opening = session().openSave(SCENARIO_RESULT.path);
    await vi.waitFor(() => expect(session().settling).toBe(true));
    expect(session().status).toBe("ready");
    expect(session().loadingName).toBe("my_galaxy.txt");

    resolveOwners(null);
    await opening;
    expect(session().settling).toBe(false);
    expect(session().loadingName).toBeNull();
  });

  it("a save open never sets settling", async () => {
    useGameDataStore.setState({ status: "ready" });
    await session().openSave(OPEN_RESULT.path);
    expect(session().settling).toBe(false);
    expect(session().loadingName).toBeNull();
  });

  it("a scenario open before game data is ready never sets settling", async () => {
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().openSave(SCENARIO_RESULT.path);
    expect(session().settling).toBe(false);
  });

  it("a failing owners pass still clears settling", async () => {
    useGameDataStore.setState({ status: "ready" });
    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    mocked.getScenarioOwners.mockRejectedValueOnce({ kind: "ipc", message: "boom" });

    await session().openSave(SCENARIO_RESULT.path);
    expect(session().settling).toBe(false);
    expect(session().loadingName).toBeNull();
  });
});
