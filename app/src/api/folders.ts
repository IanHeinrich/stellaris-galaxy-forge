/**
 * The install and the user folder the user chose, which the commands that read the user folder
 * take; each one left out is found as the command's doc says.
 */
export interface ChosenFolders {
  installPath?: string;
  userDir?: string;
}

/** The command arguments `folders` sends. */
export function folderArgs({ installPath, userDir }: ChosenFolders) {
  return { installPath: installPath ?? null, userDir: userDir ?? null };
}
