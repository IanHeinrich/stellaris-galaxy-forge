import type { IssueCode } from "../generated/IssueCode";
import type { Severity } from "../generated/Severity";

/** The codes the app raises on its own, which the validator's list does not carry. */
export type NoteCode = "scenario_name_duplicate";

export type AppIssueCode = IssueCode | NoteCode;

/** A validator issue or one of the app's own notes: one shape, a code from either list. */
export interface AppIssue {
  severity: Severity;
  code: AppIssueCode;
  message: string;
  /** The systems involved, in the order the message names them. */
  systems: number[];
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
  };
}
