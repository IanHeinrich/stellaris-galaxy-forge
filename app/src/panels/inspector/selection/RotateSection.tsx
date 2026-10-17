import { useState } from "react";
import { ROTATE_TURNS } from "../../../lib/rotation";
import { typedNumber } from "../../../lib/text";
import { useEditorStore } from "../../../store/editorStore";
import { EditBlock, EditRow, TextField, ToggleField } from "../../EditField";
import { Section } from "../parts";

/** Several systems selected: turn them about the pivot by a typed angle or a quarter or half turn. */
export function RotateSection() {
  const rotatePivot = useEditorStore((s) => s.rotatePivot);
  const rotateNebulae = useEditorStore((s) => s.rotateNebulae);
  const setRotatePivot = useEditorStore((s) => s.setRotatePivot);
  const setRotateNebulae = useEditorStore((s) => s.setRotateNebulae);
  const rotateSelection = useEditorStore((s) => s.rotateSelection);
  const [degrees, setDegrees] = useState(45);

  const turn = (by: number) => void rotateSelection(by);
  return (
    <Section id="selection.rotate" title="Rotate">
      <EditBlock title="Angle">
        <EditRow label="Degrees">
          <span
            onKeyDown={(e) => {
              // Runs after the field's own Enter, which commits the draft: the typed text applies once.
              if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement)) return;
              const typed = typedNumber(e.target.value);
              if (typed !== null) turn(typed);
            }}
          >
            <TextField
              kind="number"
              label="Degrees"
              title="Clockwise; negative turns the other way. Press Enter to rotate."
              value={degrees}
              onCommit={setDegrees}
            />
          </span>
        </EditRow>
        <ToggleField
          label="Nebulae too"
          title="Also turn the nebulae centred inside the selection"
          checked={rotateNebulae}
          onChange={setRotateNebulae}
        />
      </EditBlock>
      <div className="ins-bulk">
        <button type="button" onClick={() => turn(degrees)}>
          Rotate
        </button>
        {ROTATE_TURNS.map(({ label, degrees: by }) => (
          <button type="button" key={label} onClick={() => turn(by)}>
            {label}
          </button>
        ))}
        {rotatePivot !== null && (
          <button type="button" onClick={() => setRotatePivot(null)}>
            Centre pivot
          </button>
        )}
      </div>
      <div className="muted ins-hint">
        Drag the handle on the map to turn by hand. Shift snaps to 15°.
      </div>
    </Section>
  );
}
