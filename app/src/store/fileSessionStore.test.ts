import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Capabilities } from "../generated/Capabilities";
import type { Progress } from "../generated/Progress";
import type { SaveResult } from "../generated/SaveResult";
import { OPEN_RESULT, SCENARIO_RESULT, detailOf, editResult, saveResult } from "./fixture";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import { confirm, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { onProgress } from "../api/events";
import * as ipc from "../api/ipc";
import { bindStores } from "./bindStores";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { laneCount, useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { useRecentsStore } from "./recentsStore";

const mocked = {
  saveDirs: vi.mocked(ipc.saveDirs),
  openSave: vi.mocked(ipc.openSave),
  openAsScenario: vi.mocked(ipc.openAsScenario),
  newScenario: vi.mocked(ipc.newScenario),
  exportScenario: vi.mocked(ipc.exportScenario),
  getSystem: vi.mocked(ipc.getSystem),
  closeSave: vi.mocked(ipc.closeSave),
  applyOp: vi.mocked(ipc.applyOp),
  save: vi.mocked(ipc.save),
  saveAs: vi.mocked(ipc.saveAs),
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

bindStores();

/** One applied edit, so the session is dirty. */
async function edit(): Promise<void> {
  mocked.applyOp.mockResolvedValueOnce(editResult());
  await useEditorStore.getState().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 });
}

beforeEach(() => {
  vi.clearAllMocks();
  progressHandler = null;
  useGalaxyStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useRecentsStore.setState({ recents: [] });
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
    expect(state.issues).toHaveLength(1);
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
    mocked.open.mockResolvedValueOnce("C:/saves/picked.sav");

    await session().pickAndOpen("scenario");

    expect(mocked.open).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "C:/saves",
        multiple: false,
        filters: [{ name: "Stellaris save", extensions: ["sav"] }],
      }),
    );
    expect(mocked.openAsScenario).toHaveBeenCalledWith("C:/saves/picked.sav");
    expect(mocked.openSave).not.toHaveBeenCalled();
    expect(session().pendingOpen).toBeNull();
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
    await session().save();
    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(mocked.save).toHaveBeenCalledTimes(2);
  });

  it("saveAs asks the Rust side about the picked path and warns only for a cloud one", async () => {
    await session().openSave(OPEN_RESULT.path);
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

describe("scenario documents", () => {
  const SCENARIO_PATH = SCENARIO_RESULT.path;

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
    mocked.openAsScenario.mockResolvedValue({ ...SCENARIO_RESULT, path: null });
    await session().requestOpen(OPEN_RESULT.path);
    expect(session().pendingOpen).toBe(OPEN_RESULT.path);
    expect(mocked.openSave).not.toHaveBeenCalled();
    expect(mocked.openAsScenario).not.toHaveBeenCalled();

    await session().chooseOpenMode("scenario");
    expect(mocked.openAsScenario).toHaveBeenCalledWith(OPEN_RESULT.path);
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
    expect(mocked.newScenario).toHaveBeenCalledWith("my_galaxy", 400, 100);
    expect(session().path).toBeNull();
    expect(session().title).toBe("my_galaxy");

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

  it("exporting writes a second file and leaves the save's own path, edits and save time alone", async () => {
    await session().openSave(OPEN_RESULT.path);
    await edit();

    const exported = "C:/mods/map/setup_scenarios/test_empire.txt";
    mocked.saveDialog.mockResolvedValueOnce(exported);
    const result = saveResult({ path: exported, dirty: true });
    mocked.exportScenario.mockResolvedValueOnce(result);
    await session().exportScenario();

    expect(mocked.saveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultPath: "Test Empire.txt",
        filters: [{ name: "Stellaris static galaxy scenario", extensions: ["txt"] }],
      }),
    );
    expect(mocked.exportScenario).toHaveBeenCalledWith(exported);
    const state = session();
    expect(state.path).toBe(OPEN_RESULT.path);
    expect(state.dirty).toBe(true);
    expect(state.saving).toBe(false);
    expect(state.lastSave).toEqual(result);
    expect(state.savedAt).toBeNull();
  });

  it("a cancelled export writes nothing, and a scenario has nothing to export", async () => {
    await session().openSave(OPEN_RESULT.path);
    mocked.saveDialog.mockResolvedValueOnce(null);
    await session().exportScenario();
    expect(mocked.exportScenario).not.toHaveBeenCalled();

    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().openSave(SCENARIO_PATH);
    await session().exportScenario();
    expect(mocked.saveDialog).toHaveBeenCalledTimes(1);
    expect(mocked.exportScenario).not.toHaveBeenCalled();
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
