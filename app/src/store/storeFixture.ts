import { vi } from "vitest";
import type { StoreApi } from "zustand";

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
import { useSceneStore } from "./sceneStore";
import { useScriptsStore } from "./scriptsStore";
import { useToolStore } from "./toolStore";
import { useUpdateStore } from "./updateStore";
import { useWatchlistStore } from "./watchlistStore";
import { mockedIpc } from "../test/ipc";

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
  useSceneStore,
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
  mockedIpc.onProgress.mockResolvedValue(() => undefined);
  mockedIpc.openSave.mockResolvedValue(OPEN_RESULT);
  mockedIpc.getSystem.mockImplementation(async (id) => {
    const system = useGalaxyStore.getState().systems.get(id);
    if (!system) throw { kind: "not_found", message: `no system ${id}` };
    if (!SYSTEMS.some((s) => s.id === id)) return { system, neighbours: [], nebula: null };
    return { ...detailOf(id), system };
  });
  mockedIpc.closeSave.mockResolvedValue();
  mockedIpc.warmDetails.mockResolvedValue();
  mockedIpc.confirm.mockResolvedValue(true);
  mockedIpc.getSpecialSystems.mockResolvedValue({ systems: [], counts: [], with_game_data: false });
  mockedIpc.getScenarioOwners.mockResolvedValue(null);
}
