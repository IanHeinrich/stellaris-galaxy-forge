import { isSgfError } from "../api/errors";
import { onDocumentChanged } from "../api/events";
import * as ipc from "../api/ipc";
import type { DocumentChange } from "../generated/DocumentChange";
import type { DocumentChanged } from "../generated/DocumentChanged";
import type { OpenResult } from "../generated/OpenResult";
import { fileName } from "../lib/paths";
import { useEditorStore } from "./editorStore";
import type { FileSessionState } from "./fileSessionStore";
import type { SessionApi } from "./fileSessionStore.saveGate";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { issuesDocument, useIssuesStore } from "./issuesStore";
import { useAnomalyPickerStore } from "./anomalyPickerStore";
import { useDepositPickerStore } from "./depositPickerStore";
import { useDigSitePickerStore } from "./digSitePickerStore";
import { forgetReclassify } from "./editorEdits";
import { useEntityStore } from "./entityStore";
import { useGeneratorStore } from "./generatorStore";
import { useHeightPreviewStore } from "./heightPreviewStore";
import { forgetPlanetOpens } from "./inspectorStore";
import { useModifierPickerStore } from "./modifierPickerStore";
import { useOpCheckStore } from "./opCheckStore";
import { usePlanetMoveStore } from "./planetMoveStore";
import { useSceneStore } from "./sceneStore";

/** The open document's file changed on disk, as the watcher or the focus check found it. */
export interface DiskChangeNote {
  change: DocumentChange;
  /** The user chose to keep editing; the badge stands in for the banner. */
  kept: boolean;
  /** When it was found, so a save made after it settles it. */
  at: number;
}

/** What the user says to a change on disk: read the file again, or go on with the edits. */
export type DiskChangeAnswer = "reload" | "keep";

type RefreshActions = Pick<FileSessionState, "noteDiskChange" | "answerDiskChange" | "checkDisk">;

/** What the window shows of a change on disk: the banner asking, the badge after Keep, or nothing. */
export function diskChangeShown(
  state: Pick<FileSessionState, "status" | "diskChange" | "savedAt">,
): "banner" | "badge" | null {
  const note = state.diskChange;
  if (state.status !== "ready" || note === null || note.change !== "changed") return null;
  if (state.savedAt !== null && state.savedAt >= note.at) return null;
  return note.kept ? "badge" : "banner";
}

/** Reading the open document's file again when something else changed it. */
export function refreshActions(session: SessionApi): RefreshActions {
  const { getState: get, setState: set } = session;
  /** One read at a time; a change found meanwhile is the one being read. */
  let reading = false;

  /** Raises the banner, unless the badge already stands for an earlier change the user kept. */
  const ask = () => {
    if (diskChangeShown(get()) === "badge") return;
    set({ diskChange: { change: "changed", kept: false, at: Date.now() } });
  };

  const reread = async (discard: boolean) => {
    reading = true;
    try {
      const result = await ipc.reloadDocument(discard);
      keepView(session, result);
      if (!discard) set({ notice: `Reloaded ${fileName(result.path)} after it changed on disk.` });
    } catch (e) {
      if (!discard && isSgfError(e) && e.kind === "op") ask();
      else set({ error: ipc.errorMessage(e) });
    } finally {
      reading = false;
    }
  };

  return {
    async noteDiskChange(changed) {
      const { status, path, kind, dirty, saving } = get();
      if (status !== "ready" || path !== changed.path || saving || reading) return;
      if (changed.change === "gone") {
        set({
          diskChange: { change: "gone", kept: false, at: Date.now() },
          notice: `${fileName(path)} was moved or deleted. Save writes it again.`,
        });
        return;
      }
      if (kind === "save" || dirty || changed.dirty) {
        ask();
        return;
      }
      await reread(false);
    },

    async answerDiskChange(answer) {
      const note = get().diskChange;
      if (note === null) return;
      if (answer === "keep") {
        set({ diskChange: { ...note, kept: true } });
        return;
      }
      await reread(true);
    },

    async checkDisk() {
      if (get().status !== "ready") return;
      try {
        const changed = await ipc.checkDocumentOnDisk();
        if (changed !== null) await get().noteDiskChange(changed);
      } catch {
        return;
      }
    },
  };
}

/**
 * What was read from the old bytes: `DOCUMENT_SCOPED` without the tilt, which is the view's, and
 * without Prepare, which follows the history the reload clears.
 */
const READ_FROM_THE_FILE: readonly (() => void)[] = [
  () => useHeightPreviewStore.getState().clear(),
  () => useSceneStore.getState().clearBodies(),
  () => usePlanetMoveStore.getState().reset(),
  () => useEntityStore.getState().clear(),
  () => useGeneratorStore.getState().clearPicks(),
  () => useOpCheckStore.getState().reset(),
  forgetReclassify,
  forgetPlanetOpens,
  () => useAnomalyPickerStore.getState().reset(),
  () => useDepositPickerStore.getState().reset(),
  () => useDigSitePickerStore.getState().reset(),
  () => useModifierPickerStore.getState().reset(),
];

/** The one subscription to the watcher's reports, held for the app's lifetime. */
let reports: Promise<() => void> | null = null;

/** Hands the watcher's reports to `note`, from the first document opened on. */
export function followDiskChanges(note: (changed: DocumentChanged) => void): void {
  reports ??= onDocumentChanged(note).catch(() => {
    reports = null;
    return () => undefined;
  });
}

/**
 * Takes `result` as the open document without the open's fresh start: the selection keeps the
 * systems the file still holds and the system view stays, while the undo history, the issues
 * and everything read from the old bytes are dropped.
 */
function keepView({ setState }: SessionApi, result: OpenResult): void {
  const ids = new Set(result.galaxy.systems.map((s) => s.id));
  const editor = useEditorStore.getState();
  const selection = editor.selection.filter((id) => ids.has(id));
  const lane = editor.selectedLane;
  const selectedLane = lane !== null && ids.has(lane.a) && ids.has(lane.b) ? lane : null;
  const nebula = editor.selectedNebula;
  const selectedNebula = nebula !== null && nebula < result.galaxy.nebulae.length ? nebula : null;

  setState({
    path: result.path,
    cloud: result.cloud,
    kind: result.kind,
    title: result.title,
    meta: result.meta,
    capabilities: result.capabilities,
    painted: result.painted,
    dirty: false,
    error: null,
    errorKind: null,
    diskChange: null,
  });
  for (const reset of READ_FROM_THE_FILE) reset();
  const scene = useSceneStore.getState();
  if (scene.scene.kind === "system" && !ids.has(scene.scene.id)) scene.exitScene();
  editor.resetSession();
  useIssuesStore.getState().load(result.issues);
  useGalaxyStore.getState().load(result.galaxy);
  useEditorStore.setState({ selection, selectedLane, selectedNebula });
  void useGameDataStore.getState().onSaveOpened();
  const opened = issuesDocument();
  void ipc
    .warmDetails()
    .then((findings) => {
      if (opened === issuesDocument()) useIssuesStore.getState().warmed(findings);
      return useGameDataStore.getState().refreshSpecial();
    })
    .catch(() => undefined);
}
