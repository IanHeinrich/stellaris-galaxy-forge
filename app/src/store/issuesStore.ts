import { create } from "zustand";
import type { Issue } from "../generated/Issue";
import type { IssueCode } from "../generated/IssueCode";

/** Which issues the tab lists: the ones an edit introduced, the ones the save arrived with, or both. */
export type IssueFilter = "new" | "baseline" | "all";

/** What makes two reports the same issue across edits: the code and the systems it names. */
export function issueKey(issue: Issue): string {
  return `${issue.code}:${issue.systems.join(",")}`;
}

/**
 * The codes that are notes on how the document came to be, not findings the validator
 * would make again: they stay out of the baseline, count as new, and outlive every edit.
 */
const NOTE_CODES: readonly IssueCode[] = ["export_dropped", "home_initializer"];

export function isNote(issue: Issue): boolean {
  return NOTE_CODES.includes(issue.code);
}

export interface IssuesState {
  /** Keys of the issues the save already had when it opened; the badge never counts them. */
  baseline: Set<string>;
  /** The notes the document opened with, kept until it closes. */
  notes: Issue[];
  filter: IssueFilter;
  /** The one code the tab lists, or every code. */
  code: IssueCode | null;
  setFilter(filter: IssueFilter): void;
  setCode(code: IssueCode | null): void;
  /** Takes the open save's issues as the baseline; `null` clears it with the save. */
  setBaseline(issues: Issue[] | null): void;
}

export const useIssuesStore = create<IssuesState>((set) => ({
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
}));

/** The issues no edit is answerable for: they were there when the save opened. */
export function baselineIssues(issues: Issue[], baseline: ReadonlySet<string>): Issue[] {
  return issues.filter((issue) => baseline.has(issueKey(issue)));
}

/** The issues since load: everything the baseline does not hold. */
export function newIssues(issues: Issue[], baseline: ReadonlySet<string>): Issue[] {
  return issues.filter((issue) => !baseline.has(issueKey(issue)));
}

export function filteredIssues(
  issues: Issue[],
  baseline: ReadonlySet<string>,
  filter: IssueFilter,
  code: IssueCode | null,
): Issue[] {
  const byFilter =
    filter === "new"
      ? newIssues(issues, baseline)
      : filter === "baseline"
        ? baselineIssues(issues, baseline)
        : issues;
  return code === null ? byFilter : byFilter.filter((issue) => issue.code === code);
}
