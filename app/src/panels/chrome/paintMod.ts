import * as ipc from "../../api/ipc";
import type { PaintModView } from "../../generated/PaintModView";
import {
  LOCAL_CLUSTER_WORKSHOP_URL,
  PAINT_WORKSHOP_URL,
  RESERVED_SPAWNS_WORKSHOP_URL,
} from "../../lib/paint";
import { useFileSessionStore } from "../../store/fileSessionStore";

export const PAINT_MOD_NOT_INSTALLED =
  "The Paint a Galaxy mod is not installed. Subscribe to it on the Steam Workshop, then enable it in your playset.";
export const PAINT_MOD_NOT_ENABLED =
  "The Paint a Galaxy mod is installed but not enabled. Turn it on in your playset in the launcher.";
export const PAINT_MOD_ENABLED = "Paint a Galaxy mod enabled ✓";

/** The one sentence on the mod's state, for a title. */
export function paintModStatusTitle(paintMod: PaintModView | null): string {
  if (paintMod === null) return PAINT_MOD_NOT_INSTALLED;
  return paintMod.enabled ? PAINT_MOD_ENABLED : PAINT_MOD_NOT_ENABLED;
}

/** Opens the mod's Workshop page in the user's browser, through the allowlisted address only. */
export function openPaintWorkshop(): void {
  void ipc
    .openUrl(PAINT_WORKSHOP_URL)
    .catch((e) => useFileSessionStore.getState().setError(ipc.errorMessage(e)));
}

/** Opens the Reserved Spawns submod's Workshop page, through the allowlisted address only. */
export function openReservedSpawnsWorkshop(): void {
  void ipc
    .openUrl(RESERVED_SPAWNS_WORKSHOP_URL)
    .catch((e) => useFileSessionStore.getState().setError(ipc.errorMessage(e)));
}

/** Opens the Local Cluster submod's Workshop page, through the allowlisted address only. */
export function openLocalClusterWorkshop(): void {
  void ipc
    .openUrl(LOCAL_CLUSTER_WORKSHOP_URL)
    .catch((e) => useFileSessionStore.getState().setError(ipc.errorMessage(e)));
}
