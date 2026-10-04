import { bodyEntry, useInspectorStore, type Entry } from "../../../store/inspectorStore";

/**
 * Opens body `id` of system `system` as the system view opens it; one outside any system opens as
 * a planet.
 */
export function openBody(system: number | null, id: number, label: string): void {
  const entry: Entry =
    system === null ? { ref: { kind: "planet", id }, label } : bodyEntry(system, id, label);
  useInspectorStore.getState().open(entry);
}
