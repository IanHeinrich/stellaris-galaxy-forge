import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { EditorChoices } from "../generated/EditorChoices";
import type { EditorPick } from "../generated/EditorPick";
import { fellBackNotice, openLabel, SAVE_TO_OPEN_AT_LINE, STEAM_REPLACES } from "../lib/editorCopy";
import { normalise } from "../lib/paths";
import { useFileSessionStore } from "./fileSessionStore";
import { PREF_KEYS } from "./prefKeys";
import { prefField } from "./prefs";

/** A file to open, at a line or at its top. */
export interface OpenTarget {
  file: string;
  line?: number | null;
}

/** The editor last picked in the chooser. */
export interface EditorChoice {
  pick: EditorPick;
  /** What an Open button calls it; null for the system default. */
  name: string | null;
  /** Later opens use it without asking. */
  remember: boolean;
}

export interface ScriptEditorState {
  /** The last pick, kept per machine; null until the chooser has answered, and after Forget. */
  choice: EditorChoice | null;
  /** The chooser while it is open, with the file it opens; no file when it changes the setting. */
  chooser: { target: OpenTarget | null } | null;
  /** What the open chooser offers; null until the shell answers. */
  choices: EditorChoices | null;

  /** Opens `target` in the remembered editor, or shows the chooser first. */
  openInEditor(target: OpenTarget): Promise<void>;
  /** The chooser's answer: keeps `pick`, with the program Browse… found for Other…, and opens the chooser's file with it. */
  choose(pick: EditorPick, name: string | null, remember: boolean): Promise<void>;
  /** Has the shell ask for the program Other… opens files with, and names it in the chooser; the shell keeps it once Other… is chosen. */
  pickProgram(): Promise<void>;
  /** Closes the chooser; the shell drops a program Browse… found. */
  cancel(): void;
  /** Shows the chooser to change the editor, without opening a file. */
  change(): Promise<void>;
  /** Forgets the editor, so the next Open asks. */
  forget(): void;
}

function isEditorPick(value: unknown): value is EditorPick {
  if (typeof value !== "object" || value === null) return false;
  const pick = value as Record<string, unknown>;
  switch (pick.kind) {
    case "found":
      return typeof pick.id === "string";
    case "system_default":
      return true;
    case "other":
      return typeof pick.args === "string";
    default:
      return false;
  }
}

function isEditorChoice(value: unknown): value is EditorChoice | null {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const choice = value as Record<string, unknown>;
  return (
    isEditorPick(choice.pick) &&
    (choice.name === null || typeof choice.name === "string") &&
    typeof choice.remember === "boolean"
  );
}

const CHOICE = prefField<EditorChoice | null>(PREF_KEYS.scriptEditor, null, isEditorChoice);

/** Whether `file` is the open scenario with unsaved edits, so its lines on disk are not the app's. */
function unsaved({ path, dirty }: { path: string | null; dirty: boolean }, file: string): boolean {
  return dirty && path !== null && normalise(path) === normalise(file);
}

async function launch(file: string, line: number | null, choice: EditorChoice): Promise<void> {
  const session = useFileSessionStore.getState();
  try {
    const opened = await ipc.openInEditor(file, line, choice.pick);
    const notes = [
      ...(opened.fell_back ? [fellBackNotice(choice.name)] : []),
      ...(opened.steam_replaces ? [STEAM_REPLACES] : []),
    ];
    if (notes.length > 0) session.setNotice(notes.join(" "));
  } catch (e) {
    session.setError(ipc.errorMessage(e));
  }
}

export const useScriptEditorStore = create<ScriptEditorState>((set, get) => {
  /** Shows the chooser for `target` and asks the shell what it offers. */
  const ask = async (target: OpenTarget | null) => {
    const chooser = { target };
    set({ chooser, choices: null });
    try {
      const choices = await ipc.editorChoices(target?.file ?? "");
      if (get().chooser === chooser) set({ choices });
    } catch (e) {
      if (get().chooser === chooser) set({ chooser: null });
      useFileSessionStore.getState().setError(ipc.errorMessage(e));
    }
  };

  return {
    choice: CHOICE.read(),
    chooser: null,
    choices: null,

    async openInEditor({ file, line }) {
      const atTop = unsaved(useFileSessionStore.getState(), file);
      const target = { file, line: atTop ? null : (line ?? null) };
      const choice = get().choice;
      if (choice?.remember) {
        await launch(target.file, target.line, choice);
        return;
      }
      await ask(target);
    },

    async choose(pick, name, remember) {
      const target = get().chooser?.target ?? null;
      const choice = { pick, name, remember };
      try {
        await ipc.answerEditorChooser(pick);
      } catch (e) {
        useFileSessionStore.getState().setError(ipc.errorMessage(e));
        return;
      }
      CHOICE.save(choice);
      set({ choice, chooser: null, choices: null });
      if (target !== null) await launch(target.file, target.line ?? null, choice);
    },

    async pickProgram() {
      let name: string | null;
      try {
        name = await ipc.chooseEditorProgram();
      } catch (e) {
        useFileSessionStore.getState().setError(ipc.errorMessage(e));
        return;
      }
      const choices = get().choices;
      if (name !== null && choices !== null) set({ choices: { ...choices, other: name } });
    },

    cancel() {
      set({ chooser: null, choices: null });
      ipc
        .answerEditorChooser(null)
        .catch((e: unknown) => useFileSessionStore.getState().setError(ipc.errorMessage(e)));
    },

    change() {
      return ask(null);
    },

    forget() {
      CHOICE.save(null);
      set({ choice: null });
    },
  };
});

/** The name an Open button gives the remembered editor; null before one is remembered, and for the system default. */
export function rememberedName(choice: EditorChoice | null): string | null {
  return choice?.remember ? choice.name : null;
}

/** An Open button's label: "Open in VS Code" once an editor is remembered, else "Open file". */
export function useOpenLabel(): string {
  return useScriptEditorStore((s) => openLabel(rememberedName(s.choice)));
}

/** An Open button's tooltip for `file`: why it opens at the top, while it does. */
export function useOpenTitle(file: string): string | undefined {
  const opensAtTop = useFileSessionStore((s) => unsaved(s, file));
  return opensAtTop ? SAVE_TO_OPEN_AT_LINE : undefined;
}

/** Opens `target` in the modder's editor: the store action every Open button calls. */
export function openInEditor(target: OpenTarget): Promise<void> {
  return useScriptEditorStore.getState().openInEditor(target);
}
