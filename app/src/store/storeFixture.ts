import { vi } from "vitest";
import type { StoreApi } from "zustand";

import { confirm, open, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { onGameDataChanged, onProgress } from "../api/events";
import * as ipc from "../api/ipc";
import { useDetailsStore } from "./detailsStore";
import { useEditorStore } from "./editorStore";
import { useEntityStore } from "./entityStore";
import { useFileSessionStore } from "./fileSessionStore";
import { OPEN_RESULT, detailOf, SYSTEMS } from "./fixture";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { useGeneratorStore } from "./generatorStore";
import { useInitializerBrowserStore } from "./initializerBrowserStore";
import { useInspectorStore } from "./inspectorStore";
import { useIssuesStore } from "./issuesStore";
import { useLayoutStore } from "./layoutStore";
import { useLGateStore } from "./lgateStore";
import { useMapChromeStore } from "./mapChromeStore";
import { resetOpenScreen } from "./openScreenStore";
import { usePaintModStore } from "./paintModStore";
import { usePlanetDataStore } from "./planetDataStore";
import { useRecentsStore } from "./recentsStore";
import { useScriptsStore } from "./scriptsStore";
import { useToolStore } from "./toolStore";
import { useUpdateStore } from "./updateStore";
import { useWatchlistStore } from "./watchlistStore";

/** Every command, event and dialog a store test arms, each as its typed spy. */
export const mocked = {
  ...vi.mocked(ipc),
  onProgress: vi.mocked(onProgress),
  onGameDataChanged: vi.mocked(onGameDataChanged),
  confirm: vi.mocked(confirm),
  open: vi.mocked(open),
  saveDialog: vi.mocked(saveDialog),
};

const STORES: StoreApi<object>[] = [
  useEditorStore,
  useEntityStore,
  useFileSessionStore,
  useGameDataStore,
  useGeneratorStore,
  useInitializerBrowserStore,
  useInspectorStore,
  useIssuesStore,
  useLayoutStore,
  useLGateStore,
  useMapChromeStore,
  usePaintModStore,
  usePlanetDataStore,
  useRecentsStore,
  useScriptsStore,
  useToolStore,
  useUpdateStore,
  useWatchlistStore,
];

/** Every store back as it started, with no document open and nothing read; every spy reset. */
export function resetStores(): void {
  vi.resetAllMocks();
  useGalaxyStore.getState().clear();
  useDetailsStore.getState().clear();
  resetOpenScreen();
  for (const store of STORES) store.setState({ ...store.getInitialState() });
}

/**
 * The answers every session needs to open and edit: the sample save opens, a system reads back
 * as the galaxy store holds it, and every question is agreed to.
 */
export function armSession(): void {
  mocked.onProgress.mockResolvedValue(() => undefined);
  mocked.openSave.mockResolvedValue(OPEN_RESULT);
  mocked.getSystem.mockImplementation(async (id) => {
    const system = useGalaxyStore.getState().systems.get(id);
    if (!system) throw { kind: "not_found", message: `no system ${id}` };
    if (!SYSTEMS.some((s) => s.id === id)) return { system, neighbours: [], nebula: null };
    return { ...detailOf(id), system };
  });
  mocked.closeSave.mockResolvedValue();
  mocked.warmDetails.mockResolvedValue();
  mocked.confirm.mockResolvedValue(true);
  mocked.getSpecialSystems.mockResolvedValue({ systems: [], counts: [], with_game_data: false });
  mocked.getScenarioOwners.mockResolvedValue(null);
}
