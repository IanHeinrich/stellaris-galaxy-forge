import { PAINT_CHECK, PAINT_CHOICE_WHY, PAINT_UNTICKED } from "../../lib/paintCopy";
import { usePaintModStore } from "../../store/paintModStore";
import { PaintModStatus } from "../chrome/PaintModStatus";
import { HelpLink } from "../HelpLink";

const BOX_ID = "paint-choice";

/**
 * The Paint a Galaxy checkbox of every dialog that asks the Paint question: the user's standing
 * choice, the mod's status while it is ticked, and a warning while it is not.
 */
export function PaintChoice() {
  const paint = usePaintModStore((s) => s.paintChoice);
  const setPaintChoice = usePaintModStore((s) => s.setPaintChoice);
  return (
    <div className="setup-check">
      <input
        type="checkbox"
        id={BOX_ID}
        checked={paint}
        onChange={(e) => setPaintChoice(e.currentTarget.checked)}
      />
      <span>
        <span>
          <label htmlFor={BOX_ID}>{PAINT_CHECK}</label>{" "}
          <HelpLink place="paintChoice" topic="Paint a Galaxy" />
        </span>
        <span className="setup-why">{PAINT_CHOICE_WHY}</span>
        {paint ? (
          <PaintModStatus />
        ) : (
          <span className="setup-warn" role="alert">
            <span aria-hidden="true">⚠</span>
            {PAINT_UNTICKED}
          </span>
        )}
      </span>
    </div>
  );
}
