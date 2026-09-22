import * as ipc from "../../api/ipc";
import {
  LOCAL_CLUSTER_WORKSHOP_URL,
  PAINT_URL,
  PAINT_WORKSHOP_URL,
  RESERVED_SPAWNS_WORKSHOP_URL,
} from "../../lib/paint";
import { useFileSessionStore } from "../../store/fileSessionStore";

/** Opens one of the shell's allowlisted addresses in the user's browser; a refusal lands on the session. */
function openAllowlisted(url: string): void {
  void ipc.openUrl(url).catch((e) => useFileSessionStore.getState().setError(ipc.errorMessage(e)));
}

/** Opens the site in the user's browser, through the allowlisted address only. */
export function openPaintSite(): void {
  openAllowlisted(PAINT_URL);
}

/** Opens the mod's Workshop page in the user's browser, through the allowlisted address only. */
export function openPaintWorkshop(): void {
  openAllowlisted(PAINT_WORKSHOP_URL);
}

/** Opens the Reserved Spawns submod's Workshop page, through the allowlisted address only. */
export function openReservedSpawnsWorkshop(): void {
  openAllowlisted(RESERVED_SPAWNS_WORKSHOP_URL);
}

/** Opens the Local Cluster submod's Workshop page, through the allowlisted address only. */
export function openLocalClusterWorkshop(): void {
  openAllowlisted(LOCAL_CLUSTER_WORKSHOP_URL);
}
