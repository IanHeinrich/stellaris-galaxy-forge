/**
 * Deleting a save's megastructure: it reads what goes with the row, asks the user, applies one
 * op, and closes the inspector's pages on what went.
 */
import * as ipc from "../api/ipc";
import type { MegastructureDismantle } from "../generated/MegastructureDismantle";
import {
  addedThisSession,
  deleteMegastructureQuestion,
  EMPTY_DISMANTLE,
  megastructureRow,
  type MegastructureLoss,
} from "../lib/details/megastructureRemoval";
import { confirmDeletion } from "./confirmDeletion";
import { useEditorStore } from "./editorStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";

/** What the confirm for deleting megastructure `id` says of it. */
async function lossOf(id: number): Promise<MegastructureLoss> {
  const view = await ipc.getEntity({ kind: "megastructure", id });
  const row = megastructureRow(view.nodes);
  return { row, added: addedThisSession(view), dismantle: dismantleOf(row.kind) };
}

/** What the loaded game data says a megastructure of `kind` takes back when deleted; null without it. */
function dismantleOf(kind: string): MegastructureDismantle | null {
  const gameData = useGameDataStore.getState();
  if (gameData.status !== "ready") return null;
  return gameData.megastructureTypes.get(kind)?.dismantle ?? EMPTY_DISMANTLE;
}

/**
 * Deletes megastructure `id`, named `name`, of `system` (null where no system read lists it),
 * once the user confirms.
 */
export function deleteMegastructure(
  id: number,
  name: string,
  system: number | null,
): Promise<boolean> {
  return confirmDeletion({
    title: name,
    unreadable: `Couldn't read ${name}, so nothing was deleted`,
    read: () => lossOf(id),
    question(loss) {
      const where = system === null ? null : useGalaxyStore.getState().systemName(system);
      return deleteMegastructureQuestion(name, where, loss);
    },
    apply: () => useEditorStore.getState().deleteMegastructure(id),
    gone: () => ({ megastructures: [id] }),
  });
}
