/**
 * The rows of a system's Megastructures and Ambient objects: the mark each carries for where it
 * comes from, the page a megastructure row opens, and what each section says with no rows.
 */
import type { Capabilities } from "../../generated/Capabilities";
import type { RowOrigin } from "../../generated/RowOrigin";

/** What a row the page can't edit is marked as. */
export type OriginMark = "initializer" | "file";

export const ORIGIN_MARK_TEXT: Record<OriginMark, string> = {
  initializer: "From the initializer",
  file: "From the file",
};

/**
 * The mark of a row from `origin`, which the open document edits when `editable`: none for a
 * save's row, which has one source, or for one the document edits, which opens its page instead.
 */
export function originMark(origin: RowOrigin | undefined, editable: boolean): OriginMark | null {
  switch (origin) {
    case undefined:
      return null;
    case "initializer":
      return "initializer";
    case "editable":
      return editable ? null : "file";
    case "read_only":
      return "file";
    default:
      return origin satisfies never;
  }
}

/**
 * What the open document must support for a megastructure row from `origin` to open its page:
 * a save's needs its details, a scenario's own row the placing of structures; null for a row
 * whose page would show nothing to edit.
 */
export function megastructurePageNeeds(origin: RowOrigin | undefined): keyof Capabilities | null {
  if (origin === undefined) return "details";
  return origin === "editable" ? "place_structures" : null;
}

/** What the Megastructures section says where the document can add one and the system has none. */
export const NO_MEGASTRUCTURES = "None. Right-click in the system view to add one.";

/** What the Ambient objects section says where the document can add one and the system has none. */
export const NO_AMBIENT_OBJECTS = "None. Right-click empty space in the system view to add one.";

/** Where an ambient object stands when the game picks the spot. */
export const AT_A_RANDOM_SPOT = "at a random spot";
