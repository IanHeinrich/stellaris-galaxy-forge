import { fileName } from "../../lib/paths";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { Dialog, DialogFrame } from "../Dialog";
import { PaintChoice } from "./PaintChoice";
import "./open.css";

const AS_SCENARIO =
  "Take its galaxy into a new static galaxy scenario. The save is left untouched.";

/**
 * The question a save asks before it opens: edited as itself or taken into a scenario, with the
 * Paint a Galaxy choice beside the scenario. Without `onSave` the scenario is the only answer.
 */
function OpenAsDialog({
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
      className="dialog"
      label={onSave ? "Open as" : "Open as scenario"}
      onClose={onCancel}
      onDismiss={onCancel}
    >
      <DialogFrame
        title={heading}
        actions={
          <>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            {!onSave && (
              <button type="button" className="primary" onClick={onScenario}>
                Continue
              </button>
            )}
          </>
        }
      >
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
      </DialogFrame>
    </Dialog>
  );
}

/**
 * Which way a picked save opens: edited as itself, or taken as the start of a scenario. A save
 * already taken as a scenario asks only the Paint a Galaxy choice.
 */
export function OpenModeDialog() {
  const pendingOpen = useFileSessionStore((s) => s.pendingOpen);
  const asScenario = useFileSessionStore((s) => s.pendingAsScenario);
  const chooseOpenMode = useFileSessionStore((s) => s.chooseOpenMode);
  if (pendingOpen === null) return null;
  return (
    <OpenAsDialog
      path={pendingOpen}
      onSave={asScenario ? undefined : () => void chooseOpenMode("save")}
      onScenario={() => void chooseOpenMode("scenario")}
      onCancel={() => void chooseOpenMode(null)}
    />
  );
}
