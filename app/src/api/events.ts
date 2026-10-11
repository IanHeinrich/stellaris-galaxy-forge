/** Events the Rust side emits; their names come from `src/generated/shell.ts`. */
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { DocumentChanged } from "../generated/DocumentChanged";
import type { GameDataChanged } from "../generated/GameDataChanged";
import type { Progress } from "../generated/Progress";
import type { UpdateProgress } from "../generated/UpdateProgress";
import {
  DOCUMENT_CHANGED_EVENT,
  GAME_DATA_CHANGED_EVENT,
  PROGRESS_EVENT,
  UPDATE_PROGRESS_EVENT,
} from "../generated/shell";

/** Subscribe to load/save progress; resolves to the unsubscribe function. */
export function onProgress(handler: (p: Progress) => void): Promise<UnlistenFn> {
  return listen<Progress>(PROGRESS_EVENT, (e) => handler(e.payload));
}

/** Subscribe to rebuilt registries and to the auto-reload watcher pausing or resuming. */
export function onGameDataChanged(
  handler: (changed: GameDataChanged) => void,
): Promise<UnlistenFn> {
  return listen<GameDataChanged>(GAME_DATA_CHANGED_EVENT, (e) => handler(e.payload));
}

/** Subscribe to the open document's file changing on disk, other than by the app's own save. */
export function onDocumentChanged(
  handler: (changed: DocumentChanged) => void,
): Promise<UnlistenFn> {
  return listen<DocumentChanged>(DOCUMENT_CHANGED_EVENT, (e) => handler(e.payload));
}

/** Subscribe to the download an install drives; resolves to the unsubscribe function. */
export function onUpdateProgress(handler: (p: UpdateProgress) => void): Promise<UnlistenFn> {
  return listen<UpdateProgress>(UPDATE_PROGRESS_EVENT, (e) => handler(e.payload));
}
