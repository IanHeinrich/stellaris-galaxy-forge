import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import type { SaveResult } from "../generated/SaveResult";
import { duplicateNameNote, reservedSpawnsNote } from "../lib/issues";
import { paintModView } from "../test/builders";
import { type ChangedOnDiskAnswer, type SaveIssuesAnswer } from "./fileSessionStore";
import { OPEN_RESULT, SCENARIO_RESULT, saveResult } from "./fixture";
import { useIssuesStore } from "./issuesStore";
import { useLayoutStore } from "./layoutStore";
import { PREF_KEYS } from "./prefKeys";
import {
  answers,
  edit,
  listen,
  mocked,
  resetSession,
  session,
  stored,
  withIssues,
  withPaintMod,
} from "./sessionFixture";

beforeEach(resetSession);

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

    listen.progress = null;
    let finish!: (r: SaveResult) => void;
    mocked.save.mockReturnValueOnce(new Promise<SaveResult>((r) => (finish = r)));
    const p = session().save();
    await vi.waitFor(() => expect(listen.progress).not.toBeNull());
    expect(session().saving).toBe(true);
    listen.progress!({ phase: "write", fraction: 0.43 });
    expect(session().progress).toEqual({ phase: "write", fraction: 0.43 });

    finish(saveResult());
    await p;
    const state = session();
    expect(state.saving).toBe(false);
    expect(state.progress).toBeNull();
    expect(state.dirty).toBe(false);
    expect(listen.unlisten).toHaveBeenCalledTimes(2);
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
    withIssues([]);
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
    withIssues([]);
    await session().save();
    expect(mocked.confirm).toHaveBeenCalledTimes(1);
    expect(mocked.save).toHaveBeenCalledTimes(2);
  });

  it("saveAs asks the Rust side about the picked path and warns only for a cloud one", async () => {
    await session().openSave(OPEN_RESULT.path);
    withIssues([]);
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

describe("issues a save stops on", () => {
  const ISOLATED = OPEN_RESULT.issues[0];

  beforeEach(async () => {
    answers.saveIssues = null;
    await session().openSave(OPEN_RESULT.path);
    await edit();
  });

  /** Runs `start`, answers the dialog it raises, and waits for the save to settle. */
  async function answering(answer: SaveIssuesAnswer, start: () => Promise<void>): Promise<number> {
    const done = start();
    await vi.waitFor(() => expect(session().saveIssuesPrompt).not.toBeNull());
    const { count } = session().saveIssuesPrompt!;
    session().answerSaveIssues(answer);
    await done;
    return count;
  }

  it("View issues shows the tab, flashes the list and pauses the save, leaving the dock preference", async () => {
    useLayoutStore.getState().toggleDock();
    expect(await answering("review", () => session().save())).toBe(1);

    expect(useLayoutStore.getState().tab).toBe("issues");
    expect(useLayoutStore.getState().collapsed).toBe(false);
    expect(stored.get(PREF_KEYS.dockCollapsed)).toBe("true");
    expect(useIssuesStore.getState().attention).toBe(true);
    expect(session().pausedSave).toMatchObject({ count: 1, keys: ["system_isolated:5"] });
    expect(mocked.save).not.toHaveBeenCalled();
    expect(session().dirty).toBe(true);
    expect(session().dismissedIssues).toEqual([]);
  });

  it("Cancel writes nothing, pauses nothing and agrees to nothing", async () => {
    await answering("cancel", () => session().save());

    expect(session().saveIssuesPrompt).toBeNull();
    expect(session().pausedSave).toBeNull();
    expect(useIssuesStore.getState().attention).toBe(false);
    expect(useLayoutStore.getState().tab).toBe("inspector");
    expect(mocked.save).not.toHaveBeenCalled();
    expect(session().dirty).toBe(true);
    expect(session().dismissedIssues).toEqual([]);
  });

  it("Save anyway writes, and the same issues do not ask again", async () => {
    mocked.save.mockResolvedValue(saveResult({ dirty: false }));
    await answering("save", () => session().save());

    expect(mocked.save).toHaveBeenCalledTimes(1);
    expect(session().dismissedIssues).toEqual(["system_isolated:5"]);
    expect(useLayoutStore.getState().tab).toBe("inspector");

    await edit();
    await session().save();
    expect(session().saveIssuesPrompt).toBeNull();
    expect(mocked.save).toHaveBeenCalledTimes(2);
  });

  it("an issue with another code or other systems asks again", async () => {
    mocked.save.mockResolvedValue(saveResult({ dirty: false }));
    await answering("save", () => session().save());

    session().noteEdit({ issues: [ISOLATED, { ...ISOLATED, systems: [3] }], dirty: true });
    expect(await answering("save", () => session().save())).toBe(2);

    session().noteEdit({
      issues: [ISOLATED, { ...ISOLATED, severity: "error", code: "disconnected" }],
      dirty: true,
    });
    await answering("save", () => session().save());
    expect(mocked.save).toHaveBeenCalledTimes(3);
  });

  it("info issues and notes never ask", async () => {
    withIssues([{ ...ISOLATED, severity: "info" }, duplicateNameNote("Elysium", "other.txt")]);
    mocked.save.mockResolvedValueOnce(saveResult({ dirty: false }));
    await session().save();
    expect(session().saveIssuesPrompt).toBeNull();
    expect(mocked.save).toHaveBeenCalledTimes(1);
    expect(useLayoutStore.getState().tab).toBe("inspector");
  });

  it("the reserved seats note asks, since the map would not play as designed", async () => {
    withIssues([reservedSpawnsNote([2])]);
    await answering("review", () => session().save());
    expect(mocked.save).not.toHaveBeenCalled();
    expect(useLayoutStore.getState().tab).toBe("issues");
  });

  it("saveAs and saving into the mod ask once, before the picker", async () => {
    await answering("cancel", () => session().saveAs());
    expect(mocked.saveDialog).not.toHaveBeenCalled();

    mocked.saveDialog.mockResolvedValueOnce("C:/saves/other.sav");
    mocked.saveAs.mockResolvedValueOnce(saveResult({ path: "C:/saves/other.sav" }));
    await answering("save", () => session().saveAs());
    expect(mocked.saveAs).toHaveBeenCalledTimes(1);

    mocked.openSave.mockResolvedValueOnce(SCENARIO_RESULT);
    await session().requestOpen(SCENARIO_RESULT.path, { listings: null });
    await withPaintMod(paintModView());
    await answering("cancel", () => session().saveIntoPaintMod());
    expect(mocked.saveDialog).toHaveBeenCalledTimes(1);
  });

  it("opening or closing a document forgets what was dismissed", async () => {
    mocked.save.mockResolvedValue(saveResult({ dirty: false }));
    await answering("save", () => session().save());
    expect(session().dismissedIssues).toEqual(["system_isolated:5"]);

    await session().openSave(OPEN_RESULT.path);
    expect(session().dismissedIssues).toEqual([]);
    await edit();
    await answering("save", () => session().save());

    await session().close();
    expect(session().dismissedIssues).toEqual([]);
  });
});

describe("the paused save bar", () => {
  beforeEach(async () => {
    answers.saveIssues = null;
    await session().openSave(OPEN_RESULT.path);
    await edit();
  });

  /** Leaves `start` paused on the one issue the sample save opens with. */
  async function pause(start: () => Promise<void> = () => session().save()): Promise<void> {
    const done = start();
    await vi.waitFor(() => expect(session().saveIssuesPrompt).not.toBeNull());
    session().answerSaveIssues("review");
    await done;
    expect(session().pausedSave).not.toBeNull();
  }

  it("Save anyway writes with those issues agreed to, without asking again", async () => {
    await pause();
    mocked.save.mockResolvedValue(saveResult({ dirty: false }));
    await session().resumePausedSave();

    expect(session().saveIssuesPrompt).toBeNull();
    expect(session().pausedSave).toBeNull();
    expect(session().dismissedIssues).toEqual(["system_isolated:5"]);
    expect(mocked.save).toHaveBeenCalledTimes(1);
    expect(session().dirty).toBe(false);
  });

  it("Save anyway on a paused Save as picks the picker up again", async () => {
    await pause(() => session().saveAs());
    expect(mocked.saveDialog).not.toHaveBeenCalled();

    mocked.saveDialog.mockResolvedValueOnce("C:/saves/other.sav");
    mocked.saveAs.mockResolvedValueOnce(saveResult({ path: "C:/saves/other.sav" }));
    await session().resumePausedSave();
    expect(mocked.saveAs).toHaveBeenCalledWith("C:/saves/other.sav");
    expect(session().pausedSave).toBeNull();
  });

  it("Dismiss clears the bar, writing nothing and agreeing to nothing", async () => {
    await pause();
    session().dismissPausedSave();

    expect(session().pausedSave).toBeNull();
    expect(session().dismissedIssues).toEqual([]);
    expect(mocked.save).not.toHaveBeenCalled();
    expect(session().dirty).toBe(true);
  });

  it("a save that lands clears the bar", async () => {
    await pause();
    withIssues([]);
    mocked.save.mockResolvedValue(saveResult({ dirty: false }));
    await session().save();

    expect(mocked.save).toHaveBeenCalledTimes(1);
    expect(session().pausedSave).toBeNull();
  });

  it("closing the document clears the bar", async () => {
    await pause();
    await session().close();
    expect(session().pausedSave).toBeNull();
  });
});

describe("a file changed on disk", () => {
  const CHANGED = { kind: "changed_on_disk", message: "the file changed on disk" };

  beforeEach(async () => {
    await session().openSave(OPEN_RESULT.path);
    await edit();
    mocked.save.mockRejectedValueOnce(CHANGED);
  });

  /** Runs `start`, answers the dialog it raises, and waits for the save to settle. */
  async function answering(answer: ChangedOnDiskAnswer, start: () => Promise<void>) {
    const done = start();
    await vi.waitFor(() => expect(session().changedOnDiskPrompt).not.toBeNull());
    expect(session().error).toBeNull();
    expect(session().saving).toBe(false);
    session().answerChangedOnDisk(answer);
    await done;
    expect(session().changedOnDiskPrompt).toBeNull();
  }

  it("Overwrite saves again with force, and the save lands", async () => {
    const result = saveResult({ dirty: false });
    mocked.save.mockResolvedValueOnce(result);
    await answering("overwrite", () => session().save());

    expect(mocked.save).toHaveBeenCalledTimes(2);
    expect(mocked.save).toHaveBeenNthCalledWith(1);
    expect(mocked.save).toHaveBeenNthCalledWith(2, true);
    expect(session().dirty).toBe(false);
    expect(session().lastSave).toEqual(result);
    expect(session().error).toBeNull();
  });

  it("Save As picks a path and writes there, leaving the changed file alone", async () => {
    mocked.saveDialog.mockResolvedValueOnce("C:/saves/other.sav");
    mocked.saveAs.mockResolvedValueOnce(saveResult({ path: "C:/saves/other.sav", dirty: false }));
    await answering("save_as", () => session().save());

    expect(mocked.save).toHaveBeenCalledTimes(1);
    expect(mocked.saveAs).toHaveBeenCalledWith("C:/saves/other.sav");
    expect(session().path).toBe("C:/saves/other.sav");
    expect(session().dirty).toBe(false);
  });

  it("Cancel writes nothing and keeps the session dirty, with no error shown", async () => {
    await answering("cancel", () => session().save());

    expect(mocked.save).toHaveBeenCalledTimes(1);
    expect(mocked.saveAs).not.toHaveBeenCalled();
    expect(session().dirty).toBe(true);
    expect(session().lastSave).toBeNull();
    expect(session().error).toBeNull();
  });

  it("Ctrl+S or Save As while the prompt is open writes nothing", async () => {
    const done = session().save();
    await vi.waitFor(() => expect(session().changedOnDiskPrompt).not.toBeNull());

    await session().save();
    await session().saveAs();
    expect(mocked.save).toHaveBeenCalledTimes(1);
    expect(mocked.saveDialog).not.toHaveBeenCalled();
    expect(session().saving).toBe(false);
    expect(session().changedOnDiskPrompt).not.toBeNull();

    session().answerChangedOnDisk("cancel");
    await done;
  });

  it("a Save As onto the session's own changed file asks too, and Overwrite forces it", async () => {
    mocked.save.mockReset();
    mocked.saveDialog.mockResolvedValueOnce(OPEN_RESULT.path);
    mocked.saveAs.mockRejectedValueOnce(CHANGED);
    mocked.saveAs.mockResolvedValueOnce(saveResult({ dirty: false }));
    await answering("overwrite", () => session().saveAs());

    expect(mocked.saveAs).toHaveBeenNthCalledWith(1, OPEN_RESULT.path);
    expect(mocked.saveAs).toHaveBeenNthCalledWith(2, OPEN_RESULT.path, true);
    expect(session().dirty).toBe(false);
  });
});
