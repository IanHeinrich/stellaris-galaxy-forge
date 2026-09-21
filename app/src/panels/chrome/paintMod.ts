import * as ipc from "../../api/ipc";
import type { PaintModView } from "../../generated/PaintModView";
import { PAINT_WORKSHOP_URL } from "../../lib/paint";
import { useFileSessionStore } from "../../store/fileSessionStore";

export const PAINT_MOD_NOT_INSTALLED =
  "Subscribe to the Paint a Galaxy mod on the Steam Workshop, then enable it in the launcher's playset.";
export const PAINT_MOD_NOT_ENABLED =
  "Paint a Galaxy mod installed. Enable it in the launcher's playset.";
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
