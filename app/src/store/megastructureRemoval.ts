/**
 * Deleting a save's megastructure: it reads what goes with the row, asks the user, applies one
 * op, and closes the inspector's pages on what went.
 */
import * as ipc from "../api/ipc";
import type { MegastructureDismantle } from "../generated/MegastructureDismantle";
import { bodyName } from "../lib/details/labels";
import {
  addedThisSession,
  deleteMegastructureQuestion,
  EMPTY_DISMANTLE,
  madeByMegastructure,
  megastructureRow,
  type MegastructureLoss,
} from "../lib/details/megastructureRemoval";
import { confirmDeletion } from "./confirmDeletion";
import { useEditorStore } from "./editorStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";

/**
 * What deleting megastructure `id` takes besides its row: a bypass, and the colony on a planet
 * the megastructure made. The colony goes first only there; an ordinary colony stays.
 */
async function lossOf(id: number): Promise<MegastructureLoss> {
  const view = await ipc.getEntity({ kind: "megastructure", id });
  const row = megastructureRow(view.nodes);
  const added = addedThisSession(view);
  const dismantle = dismantleOf(row.kind);
  if (row.planet === null) return { row, added, colony: null, dismantle };
  const page = await ipc.getPlanetPage(row.planet);
  if (page.colony === null || page.flags === 0) return { row, added, colony: null, dismantle };
  const flags = await ipc.getEntity({ kind: "planet", id: row.planet }, ["flags"]);
  if (!madeByMegastructure(flags.nodes)) return { row, added, colony: null, dismantle };
  const planet = bodyName(page, useGameDataStore.getState().names);
  return { row, added, colony: { planet, page }, dismantle };
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
    gone: (loss) => ({
      megastructures: [id],
      colonies: loss.colony?.page.colony ? [loss.colony.page.colony.id] : [],
    }),
  });
}
