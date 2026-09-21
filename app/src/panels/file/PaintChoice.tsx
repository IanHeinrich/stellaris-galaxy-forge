import { useFileSessionStore } from "../../store/fileSessionStore";
import { PaintModStatus } from "../chrome/PaintModStatus";
import { PAINT_CHECK, PAINT_UNTICKED, PAINT_WHY } from "./paintCopy";

/**
 * The Paint a Galaxy checkbox the New scenario and Export dialogs share: the user's standing
 * choice, the mod's status while it is ticked, and a warning while it is not.
 */
export function PaintChoice() {
  const paint = useFileSessionStore((s) => s.paintChoice);
  const setPaintChoice = useFileSessionStore((s) => s.setPaintChoice);
  return (
    <label className="setup-check">
      <input
        type="checkbox"
        checked={paint}
        onChange={(e) => setPaintChoice(e.currentTarget.checked)}
      />
      <span>
        {PAINT_CHECK}
        <span className="setup-why">{PAINT_WHY}</span>
        {paint ? (
          <PaintModStatus />
        ) : (
          <span className="setup-warn" role="alert">
            <span aria-hidden="true">⚠</span>
            {PAINT_UNTICKED}
          </span>
        )}
      </span>
    </label>
  );
}
