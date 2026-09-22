import { useState } from "react";
import {
  NEVER_WARN,
  NEVER_WARN_WHY,
  OPEN_NOT_FOR_PAINT,
  OPEN_PAINT_MOD_OFF,
} from "../../lib/paintCopy";
import { fileName } from "../../lib/paths";
import { useFileSessionStore, type ScenarioPrompt } from "../../store/fileSessionStore";
import { standingProfile, usePaintModStore } from "../../store/paintModStore";
import { PaintModStatus } from "../chrome/PaintModStatus";
import { Dialog } from "../overlays/Dialog";
import { PaintChoice } from "./PaintChoice";
import "./open.css";

/**
 * The Paint a Galaxy question a scenario file asks before it opens: whether to edit one that
 * isn't for the mod as if it were, or a warning that the mod one is for is off.
 */
export function OpenScenarioDialog() {
  const prompt = useFileSessionStore((s) => s.scenarioPrompt);
  if (prompt === null) return null;
  return <Question key={prompt.path} prompt={prompt} />;
}

function Question({ prompt }: { prompt: ScenarioPrompt }) {
  const answer = useFileSessionStore((s) => s.answerScenarioPrompt);
  const setWarnNotForPaint = usePaintModStore((s) => s.setWarnNotForPaint);
  const [neverWarn, setNeverWarn] = useState(false);
  const notForPaint = prompt.kind === "not_for_paint";

  const cancel = () => answer(null);
  const proceed = () => {
    if (notForPaint && neverWarn) setWarnNotForPaint(false);
    answer(notForPaint ? standingProfile() : "plain");
  };
  return (
    <Dialog className="open-dialog" label="Open scenario" onClose={cancel} onDismiss={cancel}>
      <div className="open-dialog-head">
        <h1>Open {fileName(prompt.path)}</h1>
      </div>
      <div className="open-dialog-body">
        {notForPaint ? (
          <>
            <p className="muted">{OPEN_NOT_FOR_PAINT}</p>
            <PaintChoice />
            <label className="setup-check">
              <input
                type="checkbox"
                checked={neverWarn}
                onChange={(e) => setNeverWarn(e.currentTarget.checked)}
              />
              <span>
                {NEVER_WARN}
                <span className="setup-why">{NEVER_WARN_WHY}</span>
              </span>
            </label>
          </>
        ) : (
          <>
            <p className="setup-warn" role="alert">
              <span aria-hidden="true">⚠</span>
              {OPEN_PAINT_MOD_OFF}
            </p>
            <PaintModStatus />
          </>
        )}
      </div>
      <div className="open-dialog-foot">
        <div className="setup-actions">
          <button type="button" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="open-primary" onClick={proceed}>
            Continue
          </button>
        </div>
      </div>
    </Dialog>
  );
}
