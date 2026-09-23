import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { isSgfError } from "../api/errors";
import { onProgress } from "../api/events";
import * as ipc from "../api/ipc";
import type { SaveResult } from "../generated/SaveResult";
import { paintLayer, scenarioHeaderName } from "../lib/paint";
import { fileName, isUnder, joinPath } from "../lib/paths";
import type { FileSessionState } from "./fileSessionStore";
import { confirmCloudWrite, confirmIssues, type SessionApi } from "./fileSessionStore.saveGate";
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
    if (await writeSave(session, () => ipc.saveAs(picked))) noteSavedIntoPaintMod(session);
  }

  return {
    async save() {
      const { status, saving, path, cloud } = get();
      if (status !== "ready" || saving) return;
      if (path === null) {
        await get().saveAs();
        return;
      }
      if (!(await confirmIssues(session, () => get().save()))) return;
      if (cloud && !(await confirmCloudWrite(session, path))) return;
      await writeSave(session, () => ipc.save());
    },

    async saveAs(defaultPath) {
      const { status, saving, kind, path, title } = get();
      if (status !== "ready" || saving) return;
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
 * Runs `write`, reporting its progress until it settles; `settle` says what its result changes.
 * Resolves true once the write landed, so a caller can act on a save that actually happened.
 */
async function runWrite<T>(
  { getState, setState }: SessionApi,
  write: () => Promise<T>,
  settle: (result: T) => Partial<FileSessionState>,
): Promise<boolean> {
  setState({ saving: true });
  let unlisten: (() => void) | null = null;
  let ok = false;
  try {
    unlisten = await onProgress((progress) => {
      if (getState().saving) setState({ progress });
    });
    const result = await write();
    setState({ ...settle(result), error: null, errorKind: null });
    ok = true;
  } catch (e) {
    setState({ error: ipc.errorMessage(e), errorKind: isSgfError(e) ? e.kind : null });
  } finally {
    unlisten?.();
    setState({ saving: false, progress: null });
  }
  return ok;
}

/** Writes the session to its own file: where it lands becomes the session's path. */
function writeSave(session: SessionApi, write: () => Promise<SaveResult>): Promise<boolean> {
  return runWrite(session, write, (result) => ({
    lastSave: result,
    path: result.path,
    cloud: result.cloud,
    dirty: result.dirty,
    savedAt: Date.now(),
    pausedSave: null,
  }));
}
