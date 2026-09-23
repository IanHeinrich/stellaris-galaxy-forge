import * as ipc from "../../api/ipc";
import type { WorkshopLinks } from "../../generated/WorkshopLinks";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { usePaintModStore } from "../../store/paintModStore";

/** Opens one of the shell's Workshop pages in the user's browser; a refusal lands on the session. */
function openWorkshop(page: keyof WorkshopLinks): void {
  void usePaintModStore
    .getState()
    .workshopLink(page)
    .then(ipc.openUrl)
    .catch((e) => useFileSessionStore.getState().setError(ipc.errorMessage(e)));
}

/** Opens the mod's Workshop page in the user's browser. */
export function openPaintWorkshop(): void {
  openWorkshop("paint_a_galaxy");
}

/** Opens the Reserved Spawns submod's Workshop page. */
export function openReservedSpawnsWorkshop(): void {
  openWorkshop("reserved_spawns");
}

/** Opens the Local Cluster submod's Workshop page. */
export function openLocalClusterWorkshop(): void {
  openWorkshop("local_cluster");
}
