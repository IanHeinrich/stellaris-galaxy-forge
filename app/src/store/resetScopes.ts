import { useAnomalyPickerStore } from "./anomalyPickerStore";
import { useDepositPickerStore } from "./depositPickerStore";
import { setRollWithin } from "./detailsStore";
import { useDigSitePickerStore } from "./digSitePickerStore";
import { forgetReclassify } from "./editorEdits";
import { useEntityStore } from "./entityStore";
import { systemRadiiOf, useGameDataStore } from "./gameDataStore";
import { useGeneratorStore } from "./generatorStore";
import { useHeightPreviewStore } from "./heightPreviewStore";
import { forgetPlanetOpens, useInspectorStore } from "./inspectorStore";
import { useModifierPickerStore } from "./modifierPickerStore";
import { useOpCheckStore } from "./opCheckStore";
import { usePlanetDataStore } from "./planetDataStore";
import { usePlanetMoveStore } from "./planetMoveStore";
import { usePrepareStore } from "./prepareStore";
import { useSceneStore } from "./sceneStore";
import { useToolStore } from "./toolStore";

/** The planet page's pickers: what each read and where each is open. */
const PICKERS: readonly (() => void)[] = [
  () => useAnomalyPickerStore.getState().reset(),
  () => useDepositPickerStore.getState().reset(),
  () => useDigSitePickerStore.getState().reset(),
  () => useModifierPickerStore.getState().reset(),
];

/**
 * What was read from the open document's bytes, store or module counter alike. Reading its file
 * again in place runs each, and leaves the view as it was.
 */
export const FILE_SCOPED: readonly (() => void)[] = [
  () => useHeightPreviewStore.getState().clear(),
  () => useSceneStore.getState().clearBodies(),
  () => usePlanetMoveStore.getState().reset(),
  () => useEntityStore.getState().clear(),
  () => useGeneratorStore.getState().clearPicks(),
  () => useOpCheckStore.getState().reset(),
  () => usePrepareStore.getState().reset(),
  forgetReclassify,
  forgetPlanetOpens,
  ...PICKERS,
];

/**
 * What belongs to the open document: what was read from its file, and the map's tilt.
 * `bindStores` runs each whenever another document starts opening or none is left.
 */
export const DOCUMENT_SCOPED: readonly (() => void)[] = [
  ...FILE_SCOPED,
  () => useToolStore.getState().setTilt(0),
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
