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

/** The planet page's pickers: what each read and where each is open. */
export const PICKERS: readonly (() => void)[] = [
  () => useAnomalyPickerStore.getState().reset(),
  () => useDepositPickerStore.getState().reset(),
  () => useDigSitePickerStore.getState().reset(),
  () => useModifierPickerStore.getState().reset(),
];

/**
 * What was read from the open document's bytes, store or module counter alike. Reading its file
 * again in place runs each, and leaves the view as it was. Kept apart from `resetScopes.ts`, whose
 * Prepare reset reaches `prepareStore`, which reads the file session store as it is made.
 */
export const FILE_SCOPED: readonly (() => void)[] = [
  () => useHeightPreviewStore.getState().clear(),
  () => useSceneStore.getState().clearBodies(),
  () => usePlanetMoveStore.getState().reset(),
  () => useEntityStore.getState().clear(),
  () => useGeneratorStore.getState().clearPicks(),
  () => useOpCheckStore.getState().reset(),
  forgetReclassify,
  forgetPlanetOpens,
  ...PICKERS,
];
