import { useState, type FormEvent } from "react";
import { counted } from "../../lib/text";
import { useEditorStore } from "../../store/editorStore";
import { Dialog } from "../Dialog";
import "./overlays.css";

/**
 * How many automatic fallen empire zones to fit. The mod would fill the empty space on its own
 * at game start; fitting them here puts them on the map where they can be seen and moved.
 */
export function FeZoneFitDialog() {
  const prompt = useEditorStore((s) => s.feZoneFitPrompt);
  const cancel = useEditorStore((s) => s.cancelFeZoneFit);
  const fit = useEditorStore((s) => s.fitFeZones);
  const candidates = prompt?.candidates ?? 0;
  const automatic = prompt?.automatic ?? 0;
  const [count, setCount] = useState(automatic > 0 ? Math.min(automatic, candidates) : candidates);
  const roomless = candidates === 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (roomless) return;
    void fit(count);
  };

  return (
    <Dialog
      className="open-dialog"
      label="Fit fallen empire zones"
      onClose={cancel}
      onDismiss={cancel}
    >
      <form onSubmit={submit}>
        <div className="open-dialog-head">
          <h1>Fit fallen empire zones</h1>
        </div>
        <div className="open-dialog-body">
          <div className="muted">
            The mod fills empty space with fallen empire zones on its own. Choose how many to fit
            here so you can see and adjust them. Zones you placed by hand stay. Fitting again
            replaces the automatic ones.
          </div>
          <div className="field">
            <span>Fallen empire zones</span>
            <div className="fe-zone-fit-slider">
              <span className="muted">none</span>
              <input
                type="range"
                min={0}
                max={candidates}
                step={1}
                value={count}
                disabled={roomless}
                autoFocus
                onChange={(e) => setCount(Number(e.currentTarget.value))}
                aria-label="Zones to fit"
              />
              <span className="muted">all</span>
            </div>
            <output className="fe-zone-fit-count">
              {count} of {candidates}
            </output>
          </div>
        </div>
        <div className="open-dialog-foot">
          <div className="setup-actions">
            <button type="button" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" disabled={roomless}>
              {roomless ? "No room for a zone" : `Fit ${counted(count, "zone")}`}
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  );
}
