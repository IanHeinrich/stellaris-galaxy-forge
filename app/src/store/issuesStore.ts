import { create } from "zustand";
import type { Issue } from "../generated/Issue";
import type { AppIssue, AppIssueCode, NoteCode } from "../lib/issues";

/** Which issues the tab lists: the ones an edit introduced, the ones the save arrived with, or both. */
export type IssueFilter = "new" | "baseline" | "all";

/** What makes two reports the same issue across edits: the code and the systems it names. */
export function issueKey(issue: AppIssue): string {
  return `${issue.code}:${issue.systems.join(",")}`;
}

export interface IssuesState {
  /** The validator's findings, with the notes the document opened with and the app's own after them. */
  issues: AppIssue[];
  /** Keys of the issues the save already had when it opened; the badge never counts them. */
  baseline: Set<string>;
  /** The notes the document opened with and the app's own, kept until it closes. */
  notes: AppIssue[];
  filter: IssueFilter;
  /** The one code the tab lists, or every code. */
  code: AppIssueCode | null;
  /** The list is flashing, to show a save that stopped for its issues where they are. */
  attention: boolean;
  setFilter(filter: IssueFilter): void;
  setCode(code: AppIssueCode | null): void;
  /** Takes the open document's issues: its findings as the baseline, its notes as the standing ones. */
  load(issues: AppIssue[]): void;
  /** Drops everything with the document. */
  clear(): void;
  /** An edit's fresh findings; the standing notes are kept after them. */
  setFindings(findings: Issue[]): void;
  /** Swaps the app's notes of one `code` for `notes`, touching nothing when they already stand. */
  setNotes(code: NoteCode, notes: AppIssue[]): void;
  /** Flashes the list; it settles on its own shortly after. */
  flash(): void;
  /** Settles the flash, whether it ran its course or the user reached the list first. */
  settle(): void;
}

/** How long the flash lasts, matching the animation in `browser.css`. */
const FLASH_MS = 1200;

const EMPTY = {
  issues: [] as AppIssue[],
  baseline: new Set<string>(),
  notes: [] as AppIssue[],
  filter: "new" as IssueFilter,
  code: null as AppIssueCode | null,
  attention: false,
};

let flashTimer: ReturnType<typeof setTimeout> | null = null;

function stopFlash(): void {
  if (flashTimer !== null) clearTimeout(flashTimer);
  flashTimer = null;
}

/** The document a late answer still belongs to; a load or clear since leaves it to nobody. */
let documents = 0;

/** Which document the issues are of now, for an answer that has to know it is still the same one. */
export function issuesDocument(): number {
  return documents;
}

export const useIssuesStore = create<IssuesState>((set, get) => ({
  ...EMPTY,

  setFilter(filter) {
    set({ filter });
  },

  setCode(code) {
    set({ code });
  },

  load(issues) {
    documents++;
    stopFlash();
    set({
      ...EMPTY,
      issues,
      baseline: new Set(issues.filter((issue) => !issue.note).map(issueKey)),
      notes: issues.filter((issue) => issue.note),
    });
  },

  clear() {
    documents++;
    stopFlash();
    set(EMPTY);
  },

  setFindings(findings) {
    const { notes } = get();
    set({ issues: notes.length === 0 ? findings : [...findings, ...notes] });
  },

  setNotes(code, notes) {
    const { notes: standing, issues } = get();
    const current = standing.filter((note) => note.code === code);
    const same =
      current.length === notes.length &&
      current.every(
        (note, i) => issueKey(note) === issueKey(notes[i]) && note.message === notes[i].message,
      );
    if (same) return;
    set({
      notes: [...standing.filter((note) => note.code !== code), ...notes],
      issues: [...issues.filter((issue) => issue.code !== code), ...notes],
    });
  },

  flash() {
    stopFlash();
    set({ attention: true });
    flashTimer = setTimeout(() => {
      flashTimer = null;
      set({ attention: false });
    }, FLASH_MS);
  },

  settle() {
    stopFlash();
    if (get().attention) set({ attention: false });
  },
}));

/** The issues since load, and how many of them are errors, for the badge and the dock's tab. */
export function useFreshIssues(): { fresh: AppIssue[]; errors: number } {
  const issues = useIssuesStore((s) => s.issues);
  const baseline = useIssuesStore((s) => s.baseline);
  const fresh = newIssues(issues, baseline);
  return { fresh, errors: fresh.filter((i) => i.severity === "error").length };
}

/** The issues no edit is answerable for: they were there when the save opened. */
export function baselineIssues(issues: AppIssue[], baseline: ReadonlySet<string>): AppIssue[] {
  return issues.filter((issue) => baseline.has(issueKey(issue)));
}

/** The issues since load: everything the baseline does not hold. */
export function newIssues(issues: AppIssue[], baseline: ReadonlySet<string>): AppIssue[] {
  return issues.filter((issue) => !baseline.has(issueKey(issue)));
}

export function filteredIssues(
  issues: AppIssue[],
  baseline: ReadonlySet<string>,
  filter: IssueFilter,
  code: AppIssueCode | null,
): AppIssue[] {
  const byFilter =
    filter === "new"
      ? newIssues(issues, baseline)
      : filter === "baseline"
        ? baselineIssues(issues, baseline)
        : issues;
  return code === null ? byFilter : byFilter.filter((issue) => issue.code === code);
}
