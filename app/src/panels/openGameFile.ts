import * as ipc from "../api/ipc";
import { useFileSessionStore } from "../store/fileSessionStore";

/**
 * Opens a game-data file in the shell's editor, or shows it in its folder. A file the install no
 * longer holds, or that the shell refuses, says so where every other failure does.
 */
export function openGameFile(file: string, reveal: boolean): void {
  void ipc
    .openScript(file, reveal)
    .catch((e) => useFileSessionStore.getState().setError(ipc.errorMessage(e)));
}
