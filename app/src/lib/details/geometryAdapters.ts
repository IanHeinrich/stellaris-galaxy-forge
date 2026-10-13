/**
 * Which adapter edits a system's geometry in the open document: the one place a source is
 * chosen. Each kind's adapter lives in a module of its own.
 */
import type { Capabilities } from "../../generated/Capabilities";
import type { DocumentKind } from "../../generated/DocumentKind";
import type { GeometryAdapter } from "./orbitIntent";
import { NOTHING_EDITABLE, SAVE_GEOMETRY } from "./saveGeometry";

/** Nothing about the system's geometry may be edited. */
export const NO_GEOMETRY: GeometryAdapter = {
  ranges: false,
  editing: () => NOTHING_EDITABLE,
  preview: () => ({}),
  op: () => null,
};

/** The adapter each kind of document edits its geometry with, where its capabilities allow. */
const GEOMETRY_ADAPTERS: Readonly<Record<DocumentKind, GeometryAdapter>> = {
  save: SAVE_GEOMETRY,
  scenario: NO_GEOMETRY,
};

/**
 * The adapter that edits system `system`'s geometry in a document of `kind` that supports
 * `capabilities`. Before a document reports its kind, a save's, as `documentCapabilities`
 * assumes. Without the geometry capability or a system there is nothing to edit.
 */
export function geometryAdapterFor(
  kind: DocumentKind | null,
  capabilities: Capabilities,
  system: number | null,
): GeometryAdapter {
  if (!capabilities.geometry || system === null) return NO_GEOMETRY;
  return GEOMETRY_ADAPTERS[kind ?? "save"];
}
