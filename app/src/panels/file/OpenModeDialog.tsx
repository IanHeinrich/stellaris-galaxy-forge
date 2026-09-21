import { fileName } from "../../lib/paths";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { Dialog } from "../overlays/Dialog";
import { PaintChoice } from "./PaintChoice";
import "./open.css";

/** Which way a picked save opens: edited as itself, or taken as the start of a scenario. */
export function OpenModeDialog() {
  const pendingOpen = useFileSessionStore((s) => s.pendingOpen);
  const chooseOpenMode = useFileSessionStore((s) => s.chooseOpenMode);
  if (pendingOpen === null) return null;

  const cancel = () => void chooseOpenMode(null);
  return (
    <Dialog className="open-dialog" label="Open as" onClose={cancel} onDismiss={cancel}>
      <div className="open-dialog-head">
        <h1>Open {fileName(pendingOpen)}</h1>
      </div>
      <div className="open-dialog-body">
        <button type="button" className="mode-choice" onClick={() => void chooseOpenMode("save")}>
          <span className="mode-name">Edit as save</span>
          <span className="muted">
            Edit the galaxy in the save itself, with its empires, fleets and planets.
          </span>
        </button>
        <div className="mode-group" aria-label="Edit as scenario">
          <button
            type="button"
            className="mode-choice"
            onClick={() => void chooseOpenMode("scenario")}
          >
            <span className="mode-name">Edit as scenario</span>
            <span className="muted">
              Take its galaxy into a new static galaxy scenario. The save is left untouched.
            </span>
          </button>
          <div className="mode-option">
            <PaintChoice />
          </div>
        </div>
      </div>
      <div className="open-dialog-foot">
        <div className="setup-actions">
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}
