import { fileName } from "../../lib/paths";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { Dialog } from "../overlays/Dialog";
import { PaintChoice } from "./PaintChoice";
import "./open.css";

const AS_SCENARIO =
  "Take its galaxy into a new static galaxy scenario. The save is left untouched.";

/**
 * The question a save asks before it opens: edited as itself or taken into a scenario, with the
 * Paint a Galaxy choice beside the scenario. Without `onSave` the scenario is the only answer.
 */
export function OpenAsDialog({
  path,
  onSave,
  onScenario,
  onCancel,
}: {
  path: string;
  onSave?: () => void;
  onScenario: () => void;
  onCancel: () => void;
}) {
  const heading = onSave ? `Open ${fileName(path)}` : `Open ${fileName(path)} as a scenario`;
  return (
    <Dialog
      className="open-dialog"
      label={onSave ? "Open as" : "Open as scenario"}
      onClose={onCancel}
      onDismiss={onCancel}
    >
      <div className="open-dialog-head">
        <h1>{heading}</h1>
      </div>
      <div className="open-dialog-body">
        {onSave ? (
          <>
            <button type="button" className="mode-choice" onClick={onSave}>
              <span className="mode-name">Edit as save</span>
              <span className="muted">
                Edit the galaxy in the save itself, with its empires, fleets and planets.
              </span>
            </button>
            <div className="mode-group" aria-label="Edit as scenario">
              <button type="button" className="mode-choice" onClick={onScenario}>
                <span className="mode-name">Edit as scenario</span>
                <span className="muted">{AS_SCENARIO}</span>
              </button>
              <div className="mode-option">
                <PaintChoice />
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="muted">{AS_SCENARIO}</p>
            <PaintChoice />
          </>
        )}
      </div>
      <div className="open-dialog-foot">
        <div className="setup-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          {!onSave && (
            <button type="button" className="open-primary" onClick={onScenario}>
              Continue
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

/** Which way a picked save opens: edited as itself, or taken as the start of a scenario. */
export function OpenModeDialog() {
  const pendingOpen = useFileSessionStore((s) => s.pendingOpen);
  const chooseOpenMode = useFileSessionStore((s) => s.chooseOpenMode);
  if (pendingOpen === null) return null;
  return (
    <OpenAsDialog
      path={pendingOpen}
      onSave={() => void chooseOpenMode("save")}
      onScenario={() => void chooseOpenMode("scenario")}
      onCancel={() => void chooseOpenMode(null)}
    />
  );
}
