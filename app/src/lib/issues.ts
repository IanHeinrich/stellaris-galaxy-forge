import type { GalaxySizeView } from "../generated/GalaxySizeView";
import type { IssueCode } from "../generated/IssueCode";
import type { Severity } from "../generated/Severity";
import type { SystemNode } from "../generated/SystemNode";

/** The codes the app raises on its own, which the validator's list does not carry. */
export type NoteCode =
  | "scenario_name_duplicate"
  | "reserved_spawns_missing"
  | "galaxy_size_exceeded"
  | "initializer_over_limit";

export type AppIssueCode = IssueCode | NoteCode;

/** A validator issue or one of the app's own notes: one shape, a code from either list. */
export interface AppIssue {
  severity: Severity;
  code: AppIssueCode;
  message: string;
  /** The systems involved, in the order the message names them. */
  systems: number[];
  /**
   * A note on how the document came to be, not a finding the validator would make again: it
   * stays out of the baseline, counts as new, and outlives every edit.
   */
  note: boolean;
}

/**
 * Whether saving with `issue` unresolved is worth a question: a warning or error the validator
 * found, or the one note under which the map will not play as designed.
 */
export function blocksSave(issue: AppIssue): boolean {
  if (issue.severity === "info") return false;
  return !issue.note || issue.code === "reserved_spawns_missing";
}

/** The note on another scenario file in the mod's folder whose header lists the same name. */
export function duplicateNameNote(name: string, file: string): AppIssue {
  return {
    severity: "warning",
    code: "scenario_name_duplicate",
    message:
      `Another file in the mod lists the same name "${name}": ${file}. ` +
      "The game shows one size per name.",
    systems: [],
    note: true,
  };
}

/** The note on reserved seats in a playset that does not load the Reserved Spawns submod. */
export function reservedSpawnsNote(systems: number[]): AppIssue {
  return {
    severity: "warning",
    code: "reserved_spawns_missing",
    message:
      "Reserved seats need the Reserved Spawns submod, which is not enabled. Subscribe to it " +
      "and enable it in your playset, or these seats spawn at random.",
    systems,
    note: true,
  };
}

/** How far past the game's largest galaxy size a scenario may go before it is noted. */
export const GALAXY_SIZE_MARGIN = 1.25;

/** Whether `systems` is far enough past the largest size to be worth a note. */
export function exceedsGalaxySize(systems: number, largest: GalaxySizeView): boolean {
  return systems > largest.num_stars * GALAXY_SIZE_MARGIN;
}

/** The note on a scenario with far more systems than the game's largest galaxy size. */
export function galaxySizeNote(systems: number, largest: GalaxySizeView): AppIssue {
  const count = (n: number) => n.toLocaleString("en-US");
  return {
    severity: "warning",
    code: "galaxy_size_exceeded",
    message:
      `${count(systems)} systems is well above ${largest.label}, the game's largest galaxy ` +
      `(${count(largest.num_stars)} stars). Very large galaxies can make the game slow.`,
    systems: [],
    note: true,
  };
}

/**
 * One note per initializer more systems use than the game's `max_instances` for it allows,
 * naming those systems. `limits` holds the initializers that state a limit.
 */
export function initializerLimitNotes(
  systems: Iterable<SystemNode>,
  limits: ReadonlyMap<string, number>,
): AppIssue[] {
  const users = new Map<string, number[]>();
  for (const s of systems) {
    if (!limits.has(s.initializer)) continue;
    const ids = users.get(s.initializer);
    if (ids) ids.push(s.id);
    else users.set(s.initializer, [s.id]);
  }
  return [...users].flatMap(([initializer, ids]): AppIssue[] => {
    const max = limits.get(initializer)!;
    if (ids.length <= max) return [];
    return [
      {
        severity: "warning",
        code: "initializer_over_limit",
        message: `${ids.length} systems use ${initializer}, which the game allows ${max === 1 ? "once" : `${max} times`}.`,
        systems: ids,
        note: true,
      },
    ];
  });
}
