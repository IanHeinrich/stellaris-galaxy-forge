import { useState, type FormEvent } from "react";
import { counted } from "../../lib/text";
import { useEditorStore, type EditorState } from "../../store/editorStore";
import { Dialog, DialogFrame } from "../Dialog";
import "./overlays.css";

/**
 * How many automatic fallen empire zones to fit. The mod would fill the empty space on its own
 * at game start; fitting them here puts them on the map where they can be seen and moved.
 */
export function FeZoneFitDialog() {
  const prompt = useEditorStore((s) => s.feZoneFitPrompt);
  return prompt === null ? null : <FeZoneFitForm prompt={prompt} />;
}

/** The dialog's form for `prompt`, mounted afresh each time it opens. */
function FeZoneFitForm({ prompt }: { prompt: NonNullable<EditorState["feZoneFitPrompt"]> }) {
  const cancel = useEditorStore((s) => s.cancelFeZoneFit);
  const fit = useEditorStore((s) => s.fitFeZones);
  const { candidates, automatic } = prompt;
  const [count, setCount] = useState(automatic > 0 ? Math.min(automatic, candidates) : candidates);
  const roomless = candidates === 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (roomless) return;
    void fit(count);
  };

  return (
    <Dialog className="dialog" label="Fit fallen empire zones" onClose={cancel} onDismiss={cancel}>
      <DialogFrame
        title="Fit fallen empire zones"
        onSubmit={submit}
        actions={
          <>
            <button type="button" onClick={cancel}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={roomless}>
              {roomless ? "No room for a zone" : `Fit ${counted(count, "zone")}`}
            </button>
          </>
        }
      >
        <div className="muted">
          The mod fills empty space with fallen empire zones on its own. Choose how many to fit here
          so you can see and adjust them. Zones you placed by hand stay. Fitting again replaces the
          automatic ones.
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
      </DialogFrame>
    </Dialog>
  );
}
