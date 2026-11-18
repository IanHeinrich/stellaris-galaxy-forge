/**
 * Which adapter edits a system's geometry in the open document: the one place a source is
 * chosen, by what the document's capabilities say it edits. Each adapter lives in a module of
 * its own.
 */
import type { Capabilities } from "../../generated/Capabilities";
import type { GeometryAdapter } from "./orbitIntent";
import { NOTHING_EDITABLE, SAVE_GEOMETRY } from "./saveGeometry";
import { SCENARIO_GEOMETRY } from "./scenarioGeometry";

/** Nothing about the system's geometry may be edited. */
export const NO_GEOMETRY: GeometryAdapter = {
  ranges: false,
  editing: () => NOTHING_EDITABLE,
  preview: () => ({}),
  op: () => null,
};

/**
 * The adapter that edits system `system`'s geometry in a document that supports `capabilities`:
 * its layout where it has the geometry capability, the structures its systems' own blocks place
 * where it places structures, else nothing. Without a system there is nothing to edit.
 */
export function geometryAdapterFor(
  capabilities: Capabilities,
  system: number | null,
): GeometryAdapter {
  if (system === null) return NO_GEOMETRY;
  if (capabilities.geometry) return SAVE_GEOMETRY;
  return capabilities.place_structures ? SCENARIO_GEOMETRY : NO_GEOMETRY;
}
