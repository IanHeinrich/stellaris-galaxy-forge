/**
 * Deleting a save's ring world whole: it reads what goes with the ring, asks the user, applies
 * one op, and closes the inspector's pages on what went.
 */
import { confirm } from "@tauri-apps/plugin-dialog";
import * as ipc from "../api/ipc";
import { bodyName } from "../lib/details/labels";
import {
  deleteRingWorldQuestion,
  ringWorldParts,
  type RingColony,
  type RingWorldParts,
} from "../lib/details/ringWorldRemoval";
import { useEditorStore } from "./editorStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { useInspectorStore } from "./inspectorStore";

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
export async function deleteRingWorld(system: number): Promise<boolean> {
  const name = useGalaxyStore.getState().systemName(system);
  let loss: Awaited<ReturnType<typeof lossOf>>;
  try {
    loss = await lossOf(system);
  } catch (e) {
    const why = ipc.errorMessage(e);
    useFileSessionStore
      .getState()
      .setError(`Couldn't read the ring world in ${name}, so nothing was deleted: ${why}`);
    return false;
  }
  const { parts, colonies } = loss;
  const question = deleteRingWorldQuestion(name, parts.planets.length, colonies);
  if (!(await confirm(question, { title: name, kind: "warning" }))) return false;
  if (!(await useEditorStore.getState().deleteRingWorld(system))) return false;
  const colonyIds = colonies.flatMap(({ page }) => (page.colony === null ? [] : [page.colony.id]));
  const page = { ref: { kind: "system" as const, id: system }, label: name };
  useInspectorStore.getState().dropRingWorld(page, parts.planets, parts.rows, colonyIds);
  return true;
}
