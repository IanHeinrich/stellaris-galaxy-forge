import { vi } from "vitest";

import type { Issue } from "../generated/Issue";
import type { PaintModView } from "../generated/PaintModView";
import type { Progress } from "../generated/Progress";
import type { AppIssue, NoteCode } from "../lib/issues";
import { stubPrefs } from "../test/prefs";
import { bindStores } from "./bindStores";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore, type SaveIssuesAnswer } from "./fileSessionStore";
import { useIssuesStore } from "./issuesStore";
import { usePaintModStore } from "./paintModStore";
import { editResult } from "./fixture";
import { armSession, mocked, resetStores } from "./storeFixture";

export { mocked };

export const session = () => useFileSessionStore.getState();

/** The progress listener an open or a write registered, and what it hands back to stop it. */
export const listen = {
  progress: null as ((p: Progress) => void) | null,
  unlisten: vi.fn<() => void>(),
};

/**
 * What the save-time issues dialog is told, for every test but the ones that answer it
 * themselves; those set it to null in their own `beforeEach`.
 */
export const answers = { saveIssues: "save" as SaveIssuesAnswer | null };

export const stored = new Map<string, string>();

useFileSessionStore.subscribe((state) => {
  if (answers.saveIssues !== null && state.saveIssuesPrompt !== null) {
    session().answerSaveIssues(answers.saveIssues);
  }
});

/** Every scenario file these tests open is taken as its bytes say, whatever the prompt asks. */
useFileSessionStore.subscribe((state) => {
  if (state.scenarioPrompt !== null) session().answerScenarioPrompt("plain");
});

bindStores();

/** One applied edit, so the session is dirty. */
export async function edit(): Promise<void> {
  mocked.applyOp.mockResolvedValueOnce(editResult());
  await useEditorStore.getState().applyOp({ type: "MoveSystem", id: 0, x: 1, y: 1 });
}

/** What the launcher says of the Paint a Galaxy mod, taken the way the store asks the shell. */
export async function withPaintMod(view: PaintModView | null): Promise<void> {
  mocked.paintMod.mockResolvedValue(view);
  await usePaintModStore.getState().refresh();
}

/** Exactly `issues` standing: the findings as an edit hands them over, the notes as the app raises them. */
export function withIssues(issues: AppIssue[]): void {
  const store = useIssuesStore.getState();
  store.setFindings(issues.filter((issue) => !issue.note) as Issue[]);
  const notes = issues.filter((issue) => issue.note);
  const codes = new Set([...store.notes, ...notes].map((note) => note.code as NoteCode));
  for (const code of codes) {
    useIssuesStore.getState().setNotes(
      code,
      notes.filter((note) => note.code === code),
    );
  }
}

/** The state every session test starts from: cleared stores, armed commands, nothing open. */
export function resetSession(): void {
  resetStores();
  answers.saveIssues = "save";
  listen.progress = null;
  stubPrefs(stored);
  armSession();
  listen.unlisten = vi.fn<() => void>();
  mocked.onProgress.mockImplementation(async (h) => {
    listen.progress = h;
    return listen.unlisten;
  });
  mocked.isCloudSave.mockResolvedValue(false);
  mocked.paintMod.mockReset();
}
