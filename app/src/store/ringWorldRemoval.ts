/**
 * Deleting a save's ring world whole: it reads what goes with the ring, asks the user, applies
 * one op, and closes the inspector's pages on what went.
 */
import * as ipc from "../api/ipc";
import { bodyName } from "../lib/details/labels";
import {
  deleteRingWorldQuestion,
  ringWorldParts,
  type RingColony,
  type RingWorldParts,
} from "../lib/details/ringWorldRemoval";
import { confirmDeletion } from "./confirmDeletion";
import { useEditorStore } from "./editorStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";

/** What deleting the ring worlds of `system` takes, with the pages of the colonised segments. */
async function lossOf(system: number): Promise<{ parts: RingWorldParts; colonies: RingColony[] }> {
  const [details] = await ipc.getSystemDetails([system]);
  const parts = ringWorldParts(details, useGameDataStore.getState().megastructureTypes);
  const pages = await Promise.all(parts.colonised.map((id) => ipc.getPlanetPage(id)));
  const names = useGameDataStore.getState().names;
  const colonies = pages.map((page) => ({ planet: bodyName(page, names), page }));
  return { parts, colonies };
}

/** Deletes every ring world of `system` once the user confirms, then shows the system's page. */
export function deleteRingWorld(system: number): Promise<boolean> {
  const name = useGalaxyStore.getState().systemName(system);
  return confirmDeletion({
    title: name,
    unreadable: `Couldn't read the ring world in ${name}, so nothing was deleted`,
    read: () => lossOf(system),
    question: ({ parts, colonies }) =>
      deleteRingWorldQuestion(name, parts.planets.length, colonies),
    apply: () => useEditorStore.getState().deleteRingWorld(system),
    gone: ({ parts, colonies }) => ({
      planets: parts.planets,
      megastructures: parts.rows,
      colonies: colonies.flatMap(({ page }) => (page.colony === null ? [] : [page.colony.id])),
    }),
    root: { ref: { kind: "system", id: system }, label: name },
  });
}
