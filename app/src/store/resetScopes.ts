import { setRollWithin } from "./detailsStore";
import { systemRadiiOf, useGameDataStore } from "./gameDataStore";
import { useGeneratorStore } from "./generatorStore";
import { useInspectorStore } from "./inspectorStore";
import { usePlanetDataStore } from "./planetDataStore";
import { usePrepareStore } from "./prepareStore";
import { FILE_SCOPED, PICKERS } from "./resetScopes.file";
import { useToolStore } from "./toolStore";

/**
 * What belongs to the open document: what was read from its file, Prepare's choices and the map's
 * tilt. `bindStores` runs each whenever another document starts opening or none is left.
 */
export const DOCUMENT_SCOPED: readonly (() => void)[] = [
  ...FILE_SCOPED,
  () => usePrepareStore.getState().reset(),
  () => useToolStore.getState().setTilt(0),
  () => useInspectorStore.setState({ groups: {} }),
];

/**
 * What the loaded game data answers for. `bindStores` runs each whenever the game data loads,
 * reloads or goes away.
 */
export const GAME_DATA_SCOPED: readonly (() => void)[] = [
  () => usePlanetDataStore.getState().clear(),
  () => useGeneratorStore.getState().clear(),
  () => useInspectorStore.getState().dropBodies(),
  () => setRollWithin(systemRadiiOf(useGameDataStore.getState()).min_inner),
  ...PICKERS,
];
