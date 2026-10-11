/** The words of the Open buttons, the editor chooser and the editor setting. */

/** An Open button's label before an editor is remembered, or with the system default. */
export const OPEN_FILE = "Open file";

/** An Open button's tooltip while the open scenario has unsaved edits, so it opens at the top. */
export const SAVE_TO_OPEN_AT_LINE = "Save to open at this line";

/** The chooser's title. */
export const CHOOSER_TITLE = "Open with";

/** The chooser's entry for whatever the system opens a file with. */
export const SYSTEM_DEFAULT = "System default";

/** The chooser's entry for a program the user names. */
export const OTHER_EDITOR = "Other…";

/** The chooser's checkbox, ticked by default. */
export const REMEMBER_CHOICE = "Remember my choice";

/** What the chooser says once for a file of the game or of a Workshop mod. */
export const STEAM_REPLACES =
  "Steam replaces this file when the game or the mod updates, so changes you make here are lost.";

/** The hint under the arguments of a program the user names. */
export const ARGS_HINT =
  "{file} is the file and {line} the line. Without {file}, the file goes last.";

/** An Open button's label: the remembered editor's name, else "Open file". */
export function openLabel(remembered: string | null): string {
  return remembered === null ? OPEN_FILE : `Open in ${remembered}`;
}

/** The status bar's line when the editor would not start. */
export function fellBackNotice(editor: string | null): string {
  return `${editor ?? "The editor"} didn't start, so the file opened in your default program.`;
}

/** The Help menu's line saying where script files open. */
export function editorSettingNote(
  choice: { name: string | null; remember: boolean } | null,
): string {
  if (choice === null || !choice.remember) return "Asks which editor to use";
  return `Open in ${choice.name ?? "the system default"}`;
}
