import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { isSgfError } from "../api/errors";
import { onProgress } from "../api/events";
import * as ipc from "../api/ipc";
import type { SaveResult } from "../generated/SaveResult";
import { paintLayer, scenarioHeaderName } from "../lib/paint";
import { fileName, isUnder, joinPath } from "../lib/paths";
import type { FileSessionState } from "./fileSessionStore";
import {
  askChangedOnDisk,
  confirmCloudWrite,
  confirmIssues,
  type SessionApi,
} from "./fileSessionStore.saveGate";
import { useGalaxyStore } from "./galaxyStore";
import { paintScenariosDir, usePaintModStore } from "./paintModStore";

export const SAVE_FILTER = { name: "Stellaris save", extensions: ["sav"] };
export const SCENARIO_FILTER = { name: "Stellaris static galaxy scenario", extensions: ["txt"] };

type WriteActions = Pick<
  FileSessionState,
  "save" | "saveAs" | "saveIntoPaintMod" | "exportScenario" | "confirmExport"
>;

/**
 * Everything that writes a file: the session's own, or an export beside it. `opens` counts the
 * documents opened, so a preview that lands after another one opened is dropped.
 */
export function writeActions(session: SessionApi, opens: () => number): WriteActions {
  const { getState: get, setState: set } = session;

  /** Asks where the file goes, starting at `defaultPath`, and writes it there. */
  async function saveTo(
    defaultPath: string | undefined,
    filter: { name: string; extensions: string[] },
  ): Promise<void> {
    if (!(await confirmIssues(session, () => saveTo(defaultPath, filter)))) return;
    const picked = await saveDialog({ defaultPath, filters: [filter] });
    if (picked === null) return;
    const cloud = await ipc.isCloudSave(picked).catch(() => false);
    if (cloud && !(await confirmCloudWrite(session, picked))) return;
    const saved = await writeOwnFile(
      session,
      () => ipc.saveAs(picked),
      () => ipc.saveAs(picked, true),
    );
    if (saved) noteSavedIntoPaintMod(session);
  }

  return {
    async save() {
      const { status, saving, changedOnDiskPrompt, path, cloud } = get();
      if (status !== "ready" || saving || changedOnDiskPrompt !== null) return;
      if (path === null) {
        await get().saveAs();
        return;
      }
      if (!(await confirmIssues(session, () => get().save()))) return;
      if (cloud && !(await confirmCloudWrite(session, path))) return;
      await writeOwnFile(
        session,
        () => ipc.save(),
        () => ipc.save(true),
      );
    },

    async saveAs(defaultPath) {
      const { status, saving, changedOnDiskPrompt, kind, path, title } = get();
      if (status !== "ready" || saving || changedOnDiskPrompt !== null) return;
      const filter = kind === "scenario" ? SCENARIO_FILTER : SAVE_FILTER;
      const forPaintMod = paintLayer(get(), usePaintModStore.getState().paintMod);
      await saveTo(
        defaultPath ?? path ?? newFilePath(title, filter.extensions[0], forPaintMod),
        filter,
      );
    },

    async saveIntoPaintMod() {
      const dir = paintScenariosDir();
      const { kind, path, title } = get();
      if (kind !== "scenario" || dir === null) return;
      const name = fileName(path) || defaultName(title, "txt");
      await get().saveAs(name === undefined ? dir : joinPath(dir, name));
    },

    async exportScenario() {
      const { status, saving, kind } = get();
      if (status !== "ready" || saving || kind !== "save") return;
      const mine = opens();
      try {
        const report = await ipc.previewExport();
        // A preview that lands after another document opened belongs to nobody.
        if (mine !== opens() || get().status !== "ready") return;
        set({ pendingExport: report });
      } catch (e) {
        set({ error: ipc.errorMessage(e), errorKind: isSgfError(e) ? e.kind : null });
      }
    },

    async confirmExport(profile) {
      const { pendingExport, status, saving, kind, title } = get();
      if (pendingExport === null || status !== "ready" || saving || kind !== "save") return;
      set({ pendingExport: null });
      if (profile === null) return;
      const picked = await saveDialog({
        defaultPath: newFilePath(title, "txt", profile === "paint_a_galaxy"),
        filters: [SCENARIO_FILTER],
      });
      if (picked === null) return;
      // The export is a second file: the session keeps its own path, and its edits stay unsaved.
      await runWrite(
        session,
        () => ipc.exportScenario(picked, profile),
        (result) => ({ lastExport: result, exportedAt: Date.now() }),
      );
    },
  };
}

/** What a document with no file of its own is offered as a name. */
function defaultName(title: string | null, extension: string): string | undefined {
  return title === null ? undefined : `${title}.${extension}`;
}

/** Where a new file is offered: inside the mod's scenarios folder when it is written for the mod. */
function newFilePath(title: string | null, extension: string, forPaintMod: boolean) {
  const name = defaultName(title, extension);
  const dir = forPaintMod ? paintScenariosDir() : null;
  return dir !== null && name !== undefined ? joinPath(dir, name) : name;
}

/**
 * The "now what": once the file the session just wrote sits inside the mod's scenarios folder,
 * says how to find it in Stellaris. Silent when the header names no size yet.
 */
function noteSavedIntoPaintMod({ getState }: SessionApi): void {
  const { kind, path, setNotice } = getState();
  const dir = paintScenariosDir();
  if (kind !== "scenario" || path === null || dir === null || !isUnder(path, dir)) return;
  const name = scenarioHeaderName(useGalaxyStore.getState().header);
  if (name === null) return;
  setNotice(
    `Saved into the Paint a Galaxy mod. In Stellaris, start a new game and pick the size ${name}.`,
  );
}

/**
 * How a write ended: it landed, it failed with the error shown, or it was refused because
 * something else wrote the session's file since, which is left to the caller to ask about.
 */
type WriteOutcome = "written" | "failed" | "changed_on_disk";

/**
 * Runs `write`, reporting its progress until it settles; `settle` says what its result changes.
 * Resolves "written" once the write landed, so a caller can act on a save that actually happened.
 */
async function runWrite<T>(
  { getState, setState }: SessionApi,
  write: () => Promise<T>,
  settle: (result: T) => Partial<FileSessionState>,
): Promise<WriteOutcome> {
  setState({ saving: true });
  let unlisten: (() => void) | null = null;
  let outcome: WriteOutcome = "failed";
  try {
    unlisten = await onProgress((progress) => {
      if (getState().saving) setState({ progress });
    });
    const result = await write();
    setState({ ...settle(result), error: null, errorKind: null });
    outcome = "written";
  } catch (e) {
    if (isSgfError(e) && e.kind === "changed_on_disk") outcome = "changed_on_disk";
    else setState({ error: ipc.errorMessage(e), errorKind: isSgfError(e) ? e.kind : null });
  } finally {
    unlisten?.();
    setState({ saving: false, progress: null });
  }
  return outcome;
}

/**
 * Writes the session to its own file with `write`. When something else wrote that file since it
 * was opened or last saved, asks first: `overwrite` writes over it, or Save As picks elsewhere.
 * Resolves true once a write landed here.
 */
async function writeOwnFile(
  session: SessionApi,
  write: () => Promise<SaveResult>,
  overwrite: () => Promise<SaveResult>,
): Promise<boolean> {
  const outcome = await writeSave(session, write);
  if (outcome !== "changed_on_disk") return outcome === "written";
  const answer = await askChangedOnDisk(session);
  if (answer === "overwrite") return (await writeSave(session, overwrite)) === "written";
  if (answer === "save_as") await session.getState().saveAs();
  return false;
}

/** Writes the session to its own file: where it lands becomes the session's path. */
function writeSave(session: SessionApi, write: () => Promise<SaveResult>): Promise<WriteOutcome> {
  return runWrite(session, write, (result) => ({
    lastSave: result,
    path: result.path,
    cloud: result.cloud,
    dirty: result.dirty,
    savedAt: Date.now(),
    pausedSave: null,
  }));
}
