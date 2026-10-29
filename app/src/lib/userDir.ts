import type { DiagnosticView } from "../generated/DiagnosticView";
import type { GameDataSummary } from "../generated/GameDataSummary";
import type { UserDirSource } from "../generated/UserDirSource";

/** The name the Setup card and the Game data panel give the user folder. */
export const USER_DIR_LABEL = "Mods and saves";

/** The action that picks the user folder, and the title of the folder dialog it opens. */
export const LOCATE_USER_DIR = "Locate mods and saves folder";

/** The folder above `path` when `path` is a folder named `mod`, which players often pick for their mods. */
export function aboveModFolder(path: string): string | null {
  const match = /^(.*?)[\\/]mod[\\/]?$/i.exec(path);
  return match?.[1] ? match[1] : null;
}

/** What choosing a folder that holds no mods, playset or saves says. */
export const USER_DIR_REFUSED =
  "That folder has no mods, playset or saves. Choose the Stellaris folder that holds them.";

/** The note beside the folder's path saying where it came from; none for the default. */
const SOURCE_NOTE: Record<UserDirSource, string | null> = {
  chosen: "chosen",
  launcher_settings: "from the game's launcher settings",
  default: null,
};

/** The user folder as the Setup card and the Game data menu show it. */
export interface UserDirShown {
  path: string;
  note: string | null;
}

/**
 * The folder the loaded game data read, or before a load the one the user chose; null when
 * neither is known yet.
 */
export function userDirShown(
  summary: GameDataSummary | null,
  chosen: string | undefined,
): UserDirShown | null {
  if (summary?.user_dir) {
    return { path: summary.user_dir.path, note: SOURCE_NOTE[summary.user_dir.source] };
  }
  return chosen === undefined ? null : { path: chosen, note: SOURCE_NOTE.chosen };
}

function isNoPlayset(d: DiagnosticView): boolean {
  return d.kind === "no_playset";
}

/** Whether the loaded game data found no playset or mods in the user folder. */
export function lacksPlayset(summary: GameDataSummary | null): boolean {
  return summary?.diagnostics.some(isNoPlayset) ?? false;
}

/** The diagnostics the Diagnostics list shows: the missing playset is shown by the folder instead. */
export function listedDiagnostics(diagnostics: DiagnosticView[]): DiagnosticView[] {
  return diagnostics.filter((d) => !isNoPlayset(d));
}
