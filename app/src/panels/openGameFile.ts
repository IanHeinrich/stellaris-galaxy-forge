import * as ipc from "../api/ipc";
import { reportFailure } from "../store/fileSessionStore";

/**
 * Shows a game-data file in its folder. A file the install no longer holds, or that the shell
 * refuses, says so where every other failure does.
 */
export function showInFolder(file: string): void {
  reportFailure(ipc.openScript(file, true));
}
