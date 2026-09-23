import { vi } from "vitest";

import { confirm, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { onProgress } from "../api/events";
import * as ipc from "../api/ipc";
import type { Progress } from "../generated/Progress";
import { stubPrefs } from "../test/prefs";
import { bindStores } from "./bindStores";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore, type SaveIssuesAnswer } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { usePaintModStore } from "./paintModStore";
import { useRecentsStore } from "./recentsStore";
import { detailOf, editResult, OPEN_RESULT } from "./fixture";

export const mocked = {
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

export const session = () => useFileSessionStore.getState();

/** The progress listener an open or a write registered, and what it hands back to stop it. */
export const listen = {
  progress: null as ((p: Progress) => void) | null,
  unlisten: vi.fn<() => void>(),
};

/**
 * What the save-time issues dialog is told, for every test but the ones that answer it
 * themselves; those set it to null in their own `beforeEach`.
 */
export const answers = { saveIssues: "save" as SaveIssuesAnswer | null };

export const stored = new Map<string, string>();

useFileSessionStore.subscribe((state) => {
  if (answers.saveIssues !== null && state.saveIssuesPrompt !== null) {
    session().answerSaveIssues(answers.saveIssues);
  }
});

/** Every scenario file these tests open is taken as its bytes say, whatever the prompt asks. */
useFileSessionStore.subscribe((state) => {
  if (state.scenarioPrompt !== null) session().answerScenarioPrompt("plain");
});

bindStores();

/** One applied edit, so the session is dirty. */
export async function edit(): Promise<void> {
  mocked.applyOp.mockResolvedValueOnce(editResult());
  await useEditorStore.getState().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 });
}

/** The state every session test starts from: cleared stores, armed commands, nothing open. */
export function resetSession(): void {
  vi.clearAllMocks();
  answers.saveIssues = "save";
  listen.progress = null;
  stubPrefs(stored);
  useGalaxyStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useRecentsStore.setState({ recents: [] });
  usePaintModStore.setState({ ...usePaintModStore.getInitialState() });
  listen.unlisten = vi.fn<() => void>();
  mocked.onProgress.mockImplementation(async (h) => {
    listen.progress = h;
    return listen.unlisten;
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
}
