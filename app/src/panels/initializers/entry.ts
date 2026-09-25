import { canEdit } from "../../store/fileSessionStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useInitializerBrowserStore } from "../../store/initializerBrowserStore";

/** What an entry point says while the initializers cannot be read. */
export const NEEDS_GAME_DATA =
  "Load game data to choose from the initializers the install and its mods define.";

/** Whether the browser is worth offering: a document that sets initializers, with game data read. */
export function canBrowseInitializers(): boolean {
  return canEdit("create_systems") && useGameDataStore.getState().status === "ready";
}

/** Opens the browser over `targets`, unless nothing is selected or the document has no use for it. */
export function browseInitializers(targets: readonly number[]): void {
  if (!canBrowseInitializers()) return;
  useInitializerBrowserStore.getState().openFor([...targets]);
}

/** Opens the browser to spawn a new system at a world point, chosen from the initializers. */
export function createSystemFrom(x: number, y: number): void {
  if (!canBrowseInitializers()) return;
  useInitializerBrowserStore.getState().openToCreate(x, y);
}
