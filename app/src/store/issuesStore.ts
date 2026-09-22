import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { Issue } from "../generated/Issue";
import {
  duplicateNameNote,
  exceedsGalaxySize,
  galaxySizeNote,
  reservedSpawnsNote,
  type AppIssue,
  type AppIssueCode,
  type NoteCode,
} from "../lib/issues";
import { reservedSeatIds, scenarioHeaderName } from "../lib/paint";
import { isUnder } from "../lib/paths";
import { getPaintLayer, useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
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
  "galaxy_size_exceeded",
];

export function isNote(issue: AppIssue): boolean {
  return NOTE_CODES.includes(issue.code);
}

export const DUPLICATE_NAME: NoteCode = "scenario_name_duplicate";
export const RESERVED_SPAWNS: NoteCode = "reserved_spawns_missing";
export const GALAXY_SIZE: NoteCode = "galaxy_size_exceeded";

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
      baseline: new Set(issues.filter((issue) => !isNote(issue)).map(issueKey)),
      notes: issues.filter(isNote),
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

/**
 * Notes a scenario with far more systems than the largest galaxy size the loaded game data
 * defines. Nothing for a save, and nothing without game data or a size to compare against.
 */
export function noteGalaxySize(): void {
  const { status, summary } = useGameDataStore.getState();
  const largest = status === "ready" ? (summary?.largest_galaxy ?? null) : null;
  let notes: AppIssue[] = [];
  if (largest !== null && useFileSessionStore.getState().kind === "scenario") {
    const systems = useGalaxyStore.getState().systems.size;
    if (exceedsGalaxySize(systems, largest)) notes = [galaxySizeNote(systems, largest)];
  }
  useIssuesStore.getState().setNotes(GALAXY_SIZE, notes);
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
