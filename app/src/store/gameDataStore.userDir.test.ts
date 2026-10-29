import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("../lib/visual/textures", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/visual/textures")>();
  return { ...actual, clearTextures: vi.fn() };
});

import type { CampaignListing } from "../generated/CampaignListing";
import type { GameDataSummary } from "../generated/GameDataSummary";
import type { PaintModView } from "../generated/PaintModView";
import { USER_DIR_REFUSED } from "../lib/userDir";
import { TERRAN, VOID, campaignSave, modScenario, paintModView } from "../test/builders";
import { mockedIpc } from "../test/ipc";
import { until } from "../test/wait";
import { useFileSessionStore } from "./fileSessionStore";
import { useGameDataStore } from "./gameDataStore";
import { armGameData, listeners, loadGameData, releaseGameData, SUMMARY } from "./gameDataFixture";
import { useOpenScreenStore } from "./openScreenStore";
import { listed } from "./openScreenStore.fixture";
import { usePaintModStore } from "./paintModStore";

const MOVED = "E:/Paradox/Stellaris";
const INSTALL = "D:/Games/Stellaris";
const KEY = "sgf.userDir";
/** The folder the summary builder says game data read when none was chosen. */
const HOME = SUMMARY.user_dir!.path;
const data = () => useGameDataStore.getState();

/** A promise and the call that settles it, for a reply a test holds back. */
function held<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => (settle = resolve));
  return { promise, settle };
}

beforeEach(() => {
  armGameData();
  mockedIpc.isUserDir.mockResolvedValue(true);
});
afterEach(releaseGameData);

describe("user folder", () => {
  it("a chosen folder reloads game data with it and is remembered once the load succeeds", async () => {
    await loadGameData();
    await data().chooseUserDir(MOVED);
    expect(mockedIpc.isUserDir).toHaveBeenCalledWith(MOVED);
    expect(mockedIpc.loadGameData).toHaveBeenLastCalledWith(undefined, MOVED);
    expect(data().userDir).toBe(MOVED);
    expect(listeners.storage.get(KEY)).toBe(MOVED);
  });

  it("a load that fails does not remember the folder, and the next one that succeeds does", async () => {
    mockedIpc.loadGameData.mockRejectedValue({ kind: "no_install", message: "nope" });
    await data().load();
    await data().chooseUserDir(MOVED);
    expect(mockedIpc.loadGameData).toHaveBeenLastCalledWith(undefined, MOVED);
    expect(data().status).toBe("error");
    expect(listeners.storage.has(KEY)).toBe(false);

    await loadGameData();
    expect(mockedIpc.loadGameData).toHaveBeenLastCalledWith(undefined, MOVED);
    expect(listeners.storage.get(KEY)).toBe(MOVED);
  });

  it("a folder with no mods, playset or saves is refused and not remembered", async () => {
    await loadGameData();
    mockedIpc.loadGameData.mockClear();
    mockedIpc.isUserDir.mockResolvedValue(false);
    await data().chooseUserDir("E:/Empty");
    expect(data().userDirRefusal).toBe(USER_DIR_REFUSED);
    expect(data().userDir).toBeUndefined();
    expect(listeners.storage.has(KEY)).toBe(false);
    expect(mockedIpc.loadGameData).not.toHaveBeenCalled();

    mockedIpc.isUserDir.mockResolvedValue(true);
    await data().chooseUserDir(MOVED);
    expect(data().userDirRefusal).toBeNull();
  });

  it("picking the mod folder inside the folder takes the folder", async () => {
    await loadGameData();
    const windows = "D:\\Games\\Stellaris";
    mockedIpc.isUserDir.mockImplementation(async (path) => path === MOVED || path === windows);
    await data().chooseUserDir(`${MOVED}/mod`);
    expect(data().userDir).toBe(MOVED);
    expect(mockedIpc.loadGameData).toHaveBeenLastCalledWith(undefined, MOVED);

    await data().chooseUserDir(`${windows}\\Mod\\`);
    expect(data().userDir).toBe(windows);

    await data().chooseUserDir("E:\\Elsewhere\\mod");
    expect(data().userDirRefusal).toBe(USER_DIR_REFUSED);
    expect(data().userDir).toBe(windows);
  });

  it("using the default forgets the chosen folder and the next load sends none", async () => {
    await loadGameData();
    await data().chooseUserDir(MOVED);
    await data().forgetUserDir();
    expect(data().userDir).toBeUndefined();
    expect(listeners.storage.has(KEY)).toBe(false);
    expect(mockedIpc.loadGameData).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it("a folder chosen on the setup card is sent by the load Continue starts", async () => {
    await data().chooseUserDir(MOVED);
    expect(mockedIpc.loadGameData).not.toHaveBeenCalled();
    expect(listeners.storage.has(KEY)).toBe(false);
    await data().continueSetup(true);
    expect(mockedIpc.loadGameData).toHaveBeenCalledExactlyOnceWith(undefined, MOVED);
    expect(listeners.storage.get(KEY)).toBe(MOVED);
  });

  it("forgetting the folder while game data loads is not undone when the load finishes", async () => {
    listeners.storage.set(KEY, MOVED);
    useGameDataStore.setState({ userDir: MOVED });
    const reply = held<GameDataSummary>();
    mockedIpc.loadGameData.mockReturnValueOnce(reply.promise);
    const loading = data().load();
    await until(() => expect(mockedIpc.loadGameData).toHaveBeenCalledWith(undefined, MOVED));

    await data().forgetUserDir();
    reply.settle(SUMMARY);
    await loading;
    expect(data().userDir).toBeUndefined();
    expect(listeners.storage.has(KEY)).toBe(false);

    await data().load();
    expect(mockedIpc.loadGameData).toHaveBeenLastCalledWith(undefined, undefined);
  });

  it("a slow check of an earlier pick does not undo a later pick or forgetting the folder", async () => {
    const slow = held<boolean>();
    mockedIpc.isUserDir.mockReturnValueOnce(slow.promise);
    const first = data().chooseUserDir("E:/Earlier");
    await data().chooseUserDir(MOVED);
    slow.settle(true);
    await first;
    expect(data().userDir).toBe(MOVED);

    const again = held<boolean>();
    mockedIpc.isUserDir.mockReturnValueOnce(again.promise);
    const second = data().chooseUserDir("E:/Earlier");
    await data().forgetUserDir();
    again.settle(true);
    await second;
    expect(data().userDir).toBeUndefined();
  });

  it("a refusal is cleared when a load starts", async () => {
    mockedIpc.isUserDir.mockResolvedValue(false);
    await data().chooseUserDir("E:/Empty");
    expect(data().userDirRefusal).toBe(USER_DIR_REFUSED);
    await data().load();
    expect(data().userDirRefusal).toBeNull();
  });

  it("a folder chosen on the setup card is remembered when Continue loads no game data", async () => {
    await data().chooseUserDir(MOVED);
    await data().continueSetup(false);
    expect(mockedIpc.loadGameData).not.toHaveBeenCalled();
    expect(listeners.storage.get(KEY)).toBe(MOVED);
  });
});

describe("the Open screen and the user folder", () => {
  beforeEach(() => {
    mockedIpc.listCampaigns.mockResolvedValue([VOID, TERRAN]);
    mockedIpc.listCampaignSaves.mockResolvedValue([campaignSave()]);
    mockedIpc.listScenarios.mockResolvedValue(listed([modScenario()]));
    mockedIpc.missingPaths.mockResolvedValue([]);
  });

  it("lists the saves and scenarios of the chosen install and folder before game data loads", async () => {
    data().setInstallPath(INSTALL);
    await data().chooseUserDir(MOVED);
    await useOpenScreenStore.getState().load();
    const folders = { installPath: INSTALL, userDir: MOVED };
    expect(mockedIpc.listCampaigns).toHaveBeenCalledWith(folders);
    expect(mockedIpc.listScenarios).toHaveBeenCalledWith(folders);
  });

  it("reads the Paint a Galaxy mod from the chosen install and folder", async () => {
    mockedIpc.paintMod.mockResolvedValue(null);
    data().setInstallPath(INSTALL);
    await data().chooseUserDir(MOVED);
    await usePaintModStore.getState().refresh();
    expect(mockedIpc.paintMod).toHaveBeenLastCalledWith({ installPath: INSTALL, userDir: MOVED });
  });

  it("an answer for the Paint a Galaxy mod overtaken by a newer read lands nowhere", async () => {
    const late = held<PaintModView | null>();
    mockedIpc.paintMod.mockReturnValueOnce(late.promise).mockResolvedValueOnce(null);
    const first = usePaintModStore.getState().refresh();
    await usePaintModStore.getState().refresh();
    late.settle(paintModView());
    await first;
    expect(usePaintModStore.getState().paintMod).toBeNull();
    expect(usePaintModStore.getState().known).toBe(true);
  });

  it("lists the folder game data reads once it has loaded again without the chosen one", async () => {
    // The shell lists the folder it is given, else the one the loaded game data read.
    const saves: Record<string, CampaignListing[]> = { [HOME]: [VOID, TERRAN], [MOVED]: [TERRAN] };
    mockedIpc.listCampaigns.mockImplementation(
      async (folders = {}) => saves[folders.userDir ?? data().summary?.user_dir?.path ?? HOME],
    );
    await loadGameData();
    mockedIpc.loadGameData.mockImplementation(async (_install, userDir) => ({
      ...SUMMARY,
      user_dir: userDir ? { path: userDir, source: "chosen" } : { path: HOME, source: "default" },
    }));
    const listedDirs = () => (useOpenScreenStore.getState().campaigns ?? []).map((c) => c.dir);
    await useOpenScreenStore.getState().load();
    expect(listedDirs()).toEqual([TERRAN.dir, VOID.dir]);

    await data().chooseUserDir(MOVED);
    await until(() => expect(listedDirs()).toEqual([TERRAN.dir]));

    await data().forgetUserDir();
    await until(() => expect(listedDirs()).toEqual([TERRAN.dir, VOID.dir]));
  });

  it("game data failing or going away leaves the lists alone", async () => {
    await loadGameData();
    await useOpenScreenStore.getState().load();
    mockedIpc.listCampaigns.mockClear();
    mockedIpc.loadGameData.mockRejectedValueOnce({ kind: "no_install", message: "nope" });
    await data().load();
    await data().unload();
    expect(mockedIpc.listCampaigns).not.toHaveBeenCalled();
  });

  it("File > Open starts in the chosen folder's saves", async () => {
    data().setInstallPath(INSTALL);
    await data().chooseUserDir(MOVED);
    mockedIpc.saveDirs.mockResolvedValue([`${MOVED}/save games`]);
    mockedIpc.open.mockResolvedValueOnce(null);
    await useFileSessionStore.getState().pickAndOpen(undefined, undefined, null);
    expect(mockedIpc.saveDirs).toHaveBeenCalledWith({ installPath: INSTALL, userDir: MOVED });
    expect(mockedIpc.open).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: `${MOVED}/save games` }),
    );
  });
});
