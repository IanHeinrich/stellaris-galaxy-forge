import { vi } from "vitest";

import { confirm } from "@tauri-apps/plugin-dialog";
import { onProgress } from "../api/events";
import * as ipc from "../api/ipc";
import { bindStores } from "./bindStores";
import { useDetailsStore } from "./detailsStore";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useInspectorStore } from "./inspectorStore";
import { useLayoutStore } from "./layoutStore";
import { useMapChromeStore } from "./mapChromeStore";
import { detailOf, OPEN_RESULT, SYSTEMS } from "./fixture";

export const mocked = {
  openSave: vi.mocked(ipc.openSave),
  getSystem: vi.mocked(ipc.getSystem),
  closeSave: vi.mocked(ipc.closeSave),
  applyOp: vi.mocked(ipc.applyOp),
  undo: vi.mocked(ipc.undo),
  redo: vi.mocked(ipc.redo),
  getSpecialSystems: vi.mocked(ipc.getSpecialSystems),
  getScenarioOwners: vi.mocked(ipc.getScenarioOwners),
  warmDetails: vi.mocked(ipc.warmDetails),
  getSystemDetails: vi.mocked(ipc.getSystemDetails),
  onProgress: vi.mocked(onProgress),
  confirm: vi.mocked(confirm),
};

export const editor = () => useEditorStore.getState();
export const sessionError = () => useFileSessionStore.getState().error;

bindStores();

/** The state every editor test starts from: cleared stores, armed commands, the sample save open. */
export async function openFixtureSave(): Promise<void> {
  vi.clearAllMocks();
  useGalaxyStore.getState().clear();
  useDetailsStore.getState().clear();
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useEditorStore.setState({ ...useEditorStore.getInitialState() });
  useMapChromeStore.setState({ ...useMapChromeStore.getInitialState() });
  useLayoutStore.setState({ ...useLayoutStore.getInitialState() });
  useInspectorStore.setState({ ...useInspectorStore.getInitialState() });
  mocked.onProgress.mockResolvedValue(() => undefined);
  mocked.openSave.mockResolvedValue(OPEN_RESULT);
  mocked.getSystem.mockImplementation(async (id) => {
    if (!SYSTEMS.some((s) => s.id === id)) throw { kind: "not_found", message: `no system ${id}` };
    return detailOf(id);
  });
  mocked.closeSave.mockResolvedValue();
  mocked.warmDetails.mockResolvedValue();
  mocked.confirm.mockResolvedValue(true);
  mocked.getSpecialSystems.mockResolvedValue({ systems: [], counts: [], with_game_data: false });
  await useFileSessionStore.getState().openSave(OPEN_RESULT.path);
}
