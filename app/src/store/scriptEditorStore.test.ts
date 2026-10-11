import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("zustand", () => import("../test/zustandSnapshot"));

import * as ipc from "../api/ipc";
import type { EditorChoices } from "../generated/EditorChoices";
import { useFileSessionStore } from "./fileSessionStore";
import { openLabel } from "../lib/editorCopy";
import { PREF_KEYS } from "./prefKeys";
import {
  openInEditor,
  rememberedName,
  useOpenTitle,
  useScriptEditorStore,
} from "./scriptEditorStore";

const mocked = {
  editorChoices: vi.mocked(ipc.editorChoices),
  openInEditor: vi.mocked(ipc.openInEditor),
  chooseEditorProgram: vi.mocked(ipc.chooseEditorProgram),
  answerEditorChooser: vi.mocked(ipc.answerEditorChooser),
};

const FILE = "C:/Steam/steamapps/common/Stellaris/common/solar_system_initializers/sol.txt";
const SCENARIO = "C:/Users/me/Documents/mod/map/setup_scenarios/my_map.txt";
const VS_CODE = { kind: "found", id: "vscode" } as const;

const FOUND: EditorChoices = {
  editors: [
    { id: "vscode", name: "VS Code" },
    { id: "notepad_plus_plus", name: "Notepad++" },
  ],
  other: null,
  steam_replaces: true,
};

const stored = new Map<string, string>();
const state = () => useScriptEditorStore.getState();
const label = () => openLabel(rememberedName(state().choice));

beforeEach(() => {
  vi.clearAllMocks();
  stubPrefs(stored);
  useFileSessionStore.setState({ ...useFileSessionStore.getInitialState() });
  useScriptEditorStore.setState({ ...useScriptEditorStore.getInitialState() });
  mocked.editorChoices.mockResolvedValue(FOUND);
  mocked.openInEditor.mockResolvedValue({ fell_back: false, steam_replaces: false });
  mocked.answerEditorChooser.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the first Open", () => {
  it("asks which editor to use, then opens the file at its line and keeps the pick", async () => {
    expect(label()).toBe("Open file");

    await openInEditor({ file: FILE, line: 12 });
    expect(state().chooser).toEqual({ target: { file: FILE, line: 12 } });
    expect(state().choices).toEqual(FOUND);
    expect(mocked.editorChoices).toHaveBeenCalledWith(FILE);
    expect(mocked.openInEditor).not.toHaveBeenCalled();

    await state().choose(VS_CODE, "VS Code", true);
    expect(state().chooser).toBeNull();
    expect(mocked.openInEditor).toHaveBeenCalledWith(FILE, 12, VS_CODE);
    expect(JSON.parse(stored.get(PREF_KEYS.scriptEditor) ?? "null")).toEqual({
      pick: VS_CODE,
      name: "VS Code",
      remember: true,
    });
  });

  it("opens nothing when the chooser is cancelled", async () => {
    await openInEditor({ file: FILE, line: 12 });
    state().cancel();
    expect(state().chooser).toBeNull();
    expect(state().choice).toBeNull();
    expect(mocked.openInEditor).not.toHaveBeenCalled();
  });
});

describe("a remembered editor", () => {
  it("opens later files without asking, and names the editor on the button", async () => {
    await openInEditor({ file: FILE, line: 12 });
    await state().choose(VS_CODE, "VS Code", true);
    mocked.editorChoices.mockClear();

    await openInEditor({ file: FILE, line: 40 });
    expect(state().chooser).toBeNull();
    expect(mocked.editorChoices).not.toHaveBeenCalled();
    expect(mocked.openInEditor).toHaveBeenLastCalledWith(FILE, 40, VS_CODE);
    expect(label()).toBe("Open in VS Code");
  });

  it("reads Open file when it is the system default", async () => {
    await openInEditor({ file: FILE });
    await state().choose({ kind: "system_default" }, null, true);
    expect(mocked.openInEditor).toHaveBeenCalledWith(FILE, null, { kind: "system_default" });
    expect(label()).toBe("Open file");
  });

  it("says in the status bar when the editor would not start and the system default opened the file", async () => {
    useScriptEditorStore.setState({
      choice: { pick: VS_CODE, name: "VS Code", remember: true },
    });
    mocked.openInEditor.mockResolvedValueOnce({ fell_back: true, steam_replaces: false });

    await openInEditor({ file: FILE, line: 3 });
    expect(useFileSessionStore.getState().notice).toBe(
      "VS Code didn't start, so the file opened in your default program.",
    );
  });

  it("says in the status bar on every open that Steam replaces a file of the game or a Workshop mod", async () => {
    useScriptEditorStore.setState({
      choice: { pick: VS_CODE, name: "VS Code", remember: true },
    });
    mocked.openInEditor.mockResolvedValue({ fell_back: false, steam_replaces: true });
    const steam =
      "Steam replaces this file when the game or the mod updates, so your changes to it are lost.";

    await openInEditor({ file: FILE, line: 3 });
    expect(useFileSessionStore.getState().notice).toBe(steam);

    useFileSessionStore.getState().setNotice(null);
    await openInEditor({ file: FILE, line: 4 });
    expect(useFileSessionStore.getState().notice).toBe(steam);

    mocked.openInEditor.mockResolvedValueOnce({ fell_back: true, steam_replaces: true });
    await openInEditor({ file: FILE, line: 5 });
    expect(useFileSessionStore.getState().notice).toBe(
      `VS Code didn't start, so the file opened in your default program. ${steam}`,
    );
  });

  it("puts a refusal on the session", async () => {
    useScriptEditorStore.setState({
      choice: { pick: VS_CODE, name: "VS Code", remember: true },
    });
    mocked.openInEditor.mockRejectedValueOnce({ kind: "not_found", message: "not a file" });

    await openInEditor({ file: FILE, line: 3 });
    expect(useFileSessionStore.getState().error).toBe("not a file");
  });
});

describe("a pick that is not remembered", () => {
  it("shows the chooser each time, with the last pick, and the button stays Open file", async () => {
    await openInEditor({ file: FILE, line: 12 });
    await state().choose({ kind: "found", id: "notepad_plus_plus" }, "Notepad++", false);

    await openInEditor({ file: FILE, line: 13 });
    expect(state().chooser).toEqual({ target: { file: FILE, line: 13 } });
    expect(state().choice?.pick).toEqual({ kind: "found", id: "notepad_plus_plus" });
    expect(label()).toBe("Open file");
    expect(rememberedName(state().choice)).toBeNull();
  });
});

describe("the editor setting", () => {
  it("forgets the editor, so the next Open asks", async () => {
    useScriptEditorStore.setState({
      choice: { pick: VS_CODE, name: "VS Code", remember: true },
    });
    state().forget();
    expect(label()).toBe("Open file");
    expect(stored.get(PREF_KEYS.scriptEditor)).toBe("null");

    await openInEditor({ file: FILE, line: 1 });
    expect(state().chooser).not.toBeNull();
  });

  it("changes the editor from the Help menu without opening a file", async () => {
    await state().change();
    expect(state().chooser).toEqual({ target: null });
    expect(mocked.editorChoices).toHaveBeenCalledWith("");

    mocked.chooseEditorProgram.mockResolvedValueOnce(null);
    await state().pickProgram();
    expect(state().choices?.other).toBeNull();
    mocked.chooseEditorProgram.mockResolvedValueOnce("ed.exe");
    await state().pickProgram();
    expect(state().choices?.other).toBe("ed.exe");

    await state().choose({ kind: "other", args: "{file}" }, "ed.exe", true);
    expect(mocked.answerEditorChooser).toHaveBeenCalledWith({ kind: "other", args: "{file}" });
    expect(mocked.openInEditor).not.toHaveBeenCalled();
    expect(label()).toBe("Open in ed.exe");
  });

  it("tells the shell a cancel, so it drops the program Browse… found", async () => {
    await state().change();
    mocked.chooseEditorProgram.mockResolvedValueOnce("ed.exe");
    await state().pickProgram();

    state().cancel();
    expect(state().chooser).toBeNull();
    expect(mocked.answerEditorChooser).toHaveBeenCalledWith(null);
    expect(state().choice).toBeNull();
  });

  it("keeps nothing when the shell can't keep the program", async () => {
    await state().change();
    mocked.answerEditorChooser.mockRejectedValueOnce({ kind: "io", message: "disk full" });

    await state().choose({ kind: "other", args: "{file}" }, "ed.exe", true);
    expect(state().choice).toBeNull();
    expect(stored.get(PREF_KEYS.scriptEditor)).toBeUndefined();
    expect(useFileSessionStore.getState().error).toContain("disk full");
  });
});

describe("the open scenario's own file", () => {
  it("opens at the top while it has unsaved edits, and the button says why", async () => {
    useFileSessionStore.setState({ path: SCENARIO, dirty: true });
    useScriptEditorStore.setState({
      choice: { pick: VS_CODE, name: "VS Code", remember: true },
    });

    await openInEditor({ file: SCENARIO, line: 220 });
    expect(mocked.openInEditor).toHaveBeenCalledWith(SCENARIO, null, VS_CODE);
    expect(useOpenTitle(SCENARIO)).toBe("Save to open at this line");
    expect(useOpenTitle(FILE)).toBeUndefined();

    useFileSessionStore.setState({ dirty: false });
    await openInEditor({ file: SCENARIO, line: 220 });
    expect(mocked.openInEditor).toHaveBeenLastCalledWith(SCENARIO, 220, VS_CODE);
  });
});
