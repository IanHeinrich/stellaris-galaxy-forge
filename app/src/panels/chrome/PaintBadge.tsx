import { PAINT_MOD_WORKSHOP_ID, isPaintModEnabled } from "../../lib/paint";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGameDataStore } from "../../store/gameDataStore";
import "./chrome.css";

const PROFILE_TITLE = "Spawn points are written for the Paint a Galaxy mod";

const MOD_MISSING_TITLE =
  `This scenario needs the Paint a Galaxy mod (Steam Workshop ${PAINT_MOD_WORKSHOP_ID}), ` +
  "which is not among the mods enabled in your Stellaris launcher playset. Its spawn points are " +
  "read only with that mod enabled.";

/**
 * That the open document is written for the Paint a Galaxy mod, and a warning when the loaded
 * game data says the launcher's playset lacks it. No game data means unknown, not missing.
 */
export function PaintBadge() {
  const paint = useFileSessionStore((s) => s.paintProfile);
  const mods = useGameDataStore((s) => s.summary?.mods ?? null);
  if (!paint) return null;
  if (mods !== null && !isPaintModEnabled(mods)) {
    return (
      <span className="badge warn paint-badge" title={MOD_MISSING_TITLE}>
        ⚠ Paint a Galaxy mod not enabled
      </span>
    );
  }
  return (
    <span className="badge paint-badge" title={PROFILE_TITLE}>
      Paint a Galaxy
    </span>
  );
}
