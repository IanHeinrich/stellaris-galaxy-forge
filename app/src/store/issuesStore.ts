import { create } from "zustand";
import type { AppIssue, AppIssueCode, NoteCode } from "../lib/issues";

/** Which issues the tab lists: the ones an edit introduced, the ones the save arrived with, or both. */
export type IssueFilter = "new" | "baseline" | "all";

/** What makes two reports the same issue across edits: the code and the systems it names. */
export function issueKey(issue: AppIssue): string {
  return `${issue.code}:${issue.systems.join(",")}`;
}

/**
 * The codes that are notes on how the document came to be, not findings the validator
 * would make again: they stay out of the baseline, count as new, and outlive every edit.
 */
const NOTE_CODES: readonly AppIssueCode[] = [
  "export_dropped",
  "home_initializer",
  "scenario_name_duplicate",
  "reserved_spawns_missing",
];

export function isNote(issue: AppIssue): boolean {
  return NOTE_CODES.includes(issue.code);
}

export interface IssuesState {
  /** Keys of the issues the save already had when it opened; the badge never counts them. */
  baseline: Set<string>;
  /** The notes the document opened with and the app's own, kept until it closes. */
  notes: AppIssue[];
  filter: IssueFilter;
  /** The one code the tab lists, or every code. */
  code: AppIssueCode | null;
  setFilter(filter: IssueFilter): void;
  setCode(code: AppIssueCode | null): void;
  /** Takes the open save's issues as the baseline; `null` clears it with the save. */
  setBaseline(issues: AppIssue[] | null): void;
  /** Replaces the app's own notes of one code with `notes`, which may be none. */
  setNotes(code: NoteCode, notes: AppIssue[]): void;
}

export const useIssuesStore = create<IssuesState>((set, get) => ({
  baseline: new Set<string>(),
  notes: [],
  filter: "new",
  code: null,

  setFilter(filter) {
    set({ filter });
  },

  setCode(code) {
    set({ code });
  },

  setBaseline(issues) {
    const opened = issues ?? [];
    set({
      baseline: new Set(opened.filter((issue) => !isNote(issue)).map(issueKey)),
      notes: opened.filter(isNote),
      filter: "new",
      code: null,
    });
  },

  setNotes(code, notes) {
    set({ notes: [...get().notes.filter((note) => note.code !== code), ...notes] });
  },
}));

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
