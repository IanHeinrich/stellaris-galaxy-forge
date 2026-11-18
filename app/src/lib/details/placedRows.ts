/**
 * The rows of a system's Megastructures and Ambient objects: the mark each carries for where it
 * comes from, the page a megastructure row opens, and what each section says with no rows.
 */
import type { CapabilityFlag } from "../capabilities";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import type { RowOrigin } from "../../generated/RowOrigin";
import type { SystemDetails } from "../../generated/SystemDetails";

/** What a row the page can't edit is marked as. */
export type OriginMark = "initializer" | "file";

export const ORIGIN_MARK_TEXT: Record<OriginMark, string> = {
  initializer: "From the initializer",
  file: "From the file",
};

/** Where a megastructure row comes from: what its scenario spawn says; none in a save. */
export function originOf(row: MegastructureSummary): RowOrigin | undefined {
  return row.spawn?.origin;
}

/** The id the ops address a row from `origin` by, where the editor edits it as it stands. */
export function editableId(origin: RowOrigin | undefined): number | null {
  return origin?.from === "effect" && origin.editable ? origin.id : null;
}

/**
 * The mark of a row from `origin`, which the open document edits when `editable`: none for a
 * save's row, which has one source, or for one the document edits, which opens its page instead.
 */
export function originMark(origin: RowOrigin | undefined, editable: boolean): OriginMark | null {
  if (origin === undefined) return null;
  if (origin.from === "initializer") return "initializer";
  return origin.editable && editable ? null : "file";
}

/**
 * What the open document must support for a megastructure row from `origin` to open its page:
 * a save's needs its details, a scenario's own row the placing of structures; null for a row
 * whose page would show nothing to edit.
 */
export function megastructurePageNeeds(origin: RowOrigin | undefined): CapabilityFlag | null {
  if (origin === undefined) return "details";
  return editableId(origin) !== null ? "place_structures" : null;
}

/** What the Megastructures section says where the document can add one and the system has none. */
export const NO_MEGASTRUCTURES = "None. Right-click in the system view to add one.";

/** What the Ambient objects section says where the document can add one and the system has none. */
export const NO_AMBIENT_OBJECTS = "None. Right-click empty space in the system view to add one.";

/** Where an ambient object stands when the game picks the spot. */
export const AT_A_RANDOM_SPOT = "at a random spot";

/** A row of a scenario system's own block: the id the ops address it by, and what and where it is. */
export interface PlacedRow {
  id: number;
  what: string;
}

/** The ruins of a scenario system's own block, from its details. */
export function placedRuinRows(details: SystemDetails): PlacedRow[] {
  return details.megastructures.flatMap((row) => {
    const origin = originOf(row);
    return origin?.from === "effect" ? [{ id: origin.id, what: `${row.kind}|${row.at}` }] : [];
  });
}

/** The ambient objects of a scenario system's own block, from its details. */
export function placedObjectRows(details: SystemDetails): PlacedRow[] {
  return (details.spawn?.ambient_objects ?? []).flatMap((o) =>
    o.origin.from === "effect"
      ? [{ id: o.origin.id, what: `${o.kind}|${JSON.stringify(o.place)}` }]
      : [],
  );
}

/**
 * The ids of `before` an edit gave to another row or took away, where it changed how many rows
 * there are: an id is a place in the block, so adding or taking out a row, undo and redo included,
 * moves the rows after it. Where the count stayed, as after a move, no id changed hands.
 */
export function renumberedPlaced(
  before: readonly PlacedRow[],
  after: readonly PlacedRow[],
): number[] {
  if (before.length === after.length) return [];
  const now = new Map(after.map((row) => [row.id, row.what]));
  return before.filter((row) => now.get(row.id) !== row.what).map((row) => row.id);
}
