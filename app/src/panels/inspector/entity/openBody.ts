import { bodyEntry, openPlanet, useInspectorStore } from "../../../store/inspectorStore";

/** Opens body `id` of system `system` as the system view opens it; one outside any system by its id. */
export function openBody(system: number | null, id: number, label: string): void {
  if (system === null) openPlanet(id, label);
  else useInspectorStore.getState().open(bodyEntry(system, id, label));
}
