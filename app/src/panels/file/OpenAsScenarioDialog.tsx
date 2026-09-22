import { fileName } from "../../lib/paths";
import { Dialog } from "../overlays/Dialog";
import { PaintChoice } from "./PaintChoice";
import "./open.css";

/** The Paint a Galaxy choice, asked before a save's galaxy is taken into a new scenario. */
export function OpenAsScenarioDialog({
  path,
  onContinue,
  onCancel,
}: {
  path: string;
  onContinue: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      className="open-dialog"
      label="Open as scenario"
      onClose={onCancel}
      onDismiss={onCancel}
    >
      <div className="open-dialog-head">
        <h1>Open {fileName(path)} as a scenario</h1>
      </div>
      <div className="open-dialog-body">
        <p className="muted">
          Take its galaxy into a new static galaxy scenario. The save is left untouched.
        </p>
        <PaintChoice />
      </div>
      <div className="open-dialog-foot">
        <div className="setup-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="open-primary" onClick={onContinue}>
            Continue
          </button>
        </div>
      </div>
    </Dialog>
  );
}
