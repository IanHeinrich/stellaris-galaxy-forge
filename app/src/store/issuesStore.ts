import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { Issue } from "../generated/Issue";
import {
  duplicateNameNote,
  reservedSpawnsNote,
  type AppIssue,
  type AppIssueCode,
  type NoteCode,
} from "../lib/issues";
import { reservedSeatIds, scenarioHeaderName } from "../lib/paint";
import { isUnder } from "../lib/paths";
import { getPaintLayer, useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { paintScenariosDir, usePaintModStore } from "./paintModStore";

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

export const DUPLICATE_NAME: NoteCode = "scenario_name_duplicate";
export const RESERVED_SPAWNS: NoteCode = "reserved_spawns_missing";

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
}

const EMPTY = {
  issues: [] as AppIssue[],
  baseline: new Set<string>(),
  notes: [] as AppIssue[],
  filter: "new" as IssueFilter,
  code: null as AppIssueCode | null,
};

/** The document a late answer still belongs to; a load or clear since leaves it to nobody. */
let documents = 0;

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
    set({
      ...EMPTY,
      issues,
      baseline: new Set(issues.filter((issue) => !isNote(issue)).map(issueKey)),
      notes: issues.filter(isNote),
    });
  },

  clear() {
    documents++;
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
}));

/**
 * Notes every other file in the Paint a Galaxy mod's scenarios folder whose header lists the
 * open scenario's name, since the game shows one size per name. Nothing for a file elsewhere,
 * and a folder that cannot be read leaves no note.
 */
export async function noteDuplicateNames(): Promise<void> {
  const mine = documents;
  const { kind, path } = useFileSessionStore.getState();
  const dir = paintScenariosDir();
  const name = scenarioHeaderName(useGalaxyStore.getState().header);
  let notes: AppIssue[] = [];
  if (kind === "scenario" && path !== null && dir !== null && isUnder(path, dir) && name !== null) {
    const siblings = await ipc.siblingScenarioNames(path).catch(() => []);
    if (mine !== documents || useFileSessionStore.getState().path !== path) return;
    notes = siblings
      .filter(([, other]) => other === name)
      .map(([file]) => duplicateNameNote(name, file));
  }
  useIssuesStore.getState().setNotes(DUPLICATE_NAME, notes);
}

/**
 * Notes the reserved seats of a scenario on the Paint a Galaxy layer once the launcher has
 * answered and its playset does not load the Reserved Spawns submod, whose traits those seats
 * need. Nothing until the launcher answers, and nothing for a Sol seat, which needs no trait.
 */
export function noteReservedSpawns(): void {
  const { known, paintMod } = usePaintModStore.getState();
  let notes: AppIssue[] = [];
  if (known && paintMod?.reserved_spawns !== true && getPaintLayer()) {
    const seats = reservedSeatIds(useGalaxyStore.getState().systems.values());
    if (seats.length > 0) notes = [reservedSpawnsNote(seats)];
  }
  useIssuesStore.getState().setNotes(RESERVED_SPAWNS, notes);
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
