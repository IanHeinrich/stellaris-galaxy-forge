import * as ipc from "../api/ipc";
import { useFileSessionStore } from "../store/fileSessionStore";

/**
 * Shows a game-data file in its folder. A file the install no longer holds, or that the shell
 * refuses, says so where every other failure does.
 */
export function showInFolder(file: string): void {
  void ipc
    .openScript(file, true)
    .catch((e) => useFileSessionStore.getState().setError(ipc.errorMessage(e)));
}
