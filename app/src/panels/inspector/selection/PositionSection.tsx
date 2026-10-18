import { useState } from "react";
import { ROTATE_TURNS } from "../../../lib/rotation";
import { ARRANGE_IN_SHAPE, ROTATE_NOTE } from "../../../lib/selectionCopy";
import { typedNumber } from "../../../lib/text";
import { useEditorStore } from "../../../store/editorStore";
import { useCanEdit } from "../../../store/fileSessionStore";
import { ArrangeButton } from "../../BulkActions";
import { useArrange } from "../../useSelectionActions";
import { BulkHeight } from "../../BulkHeight";
import { EditBlock, EditNote, EditRow, TextField, ToggleField } from "../../EditField";
import { Section } from "../parts";

/** Several systems selected: where they sit, turned together, raised or laid onto a shape. */
export function PositionSection() {
  const selection = useEditorStore((s) => s.selection);
  const heights = useCanEdit("system_heights");
  return (
    <Section id="selection.position" title="Position">
      <RotateBlock />
      {heights && <BulkHeight ids={selection} />}
      <ShapeBlock ids={selection} />
    </Section>
  );
}

/** Turns the selection about the pivot by a typed angle or a quarter or half turn. */
function RotateBlock() {
  const rotatePivot = useEditorStore((s) => s.rotatePivot);
  const rotateNebulae = useEditorStore((s) => s.rotateNebulae);
  const setRotatePivot = useEditorStore((s) => s.setRotatePivot);
  const setRotateNebulae = useEditorStore((s) => s.setRotateNebulae);
  const rotateSelection = useEditorStore((s) => s.rotateSelection);
  const [degrees, setDegrees] = useState(45);

  const turn = (by: number) => void rotateSelection(by);
  return (
    <EditBlock title="Rotate">
      <EditRow label="Degrees">
        <span
          className="rotate-angle"
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
          <button type="button" onClick={() => turn(degrees)}>
            Rotate
          </button>
        </span>
      </EditRow>
      <EditRow label="Quick">
        {ROTATE_TURNS.map(({ label, degrees: by }) => (
          <button type="button" key={label} onClick={() => turn(by)}>
            {label}
          </button>
        ))}
      </EditRow>
      <ToggleField
        label="Nebulae too"
        title="Also turn the nebulae centred inside the selection"
        checked={rotateNebulae}
        onChange={setRotateNebulae}
      />
      {rotatePivot !== null && (
        <EditRow label="Pivot">
          <span className="rotate-pivot">
            moved ·
            <button
              type="button"
              className="link"
              title="Turn about the middle of the selection again"
              onClick={() => setRotatePivot(null)}
            >
              Centre
            </button>
          </span>
        </EditRow>
      )}
      <EditNote>{ROTATE_NOTE}</EditNote>
    </EditBlock>
  );
}

/** Opens the Shape tool to lay the selection onto a shape, where the bar mode offers it. */
function ShapeBlock({ ids }: { ids: readonly number[] }) {
  if (useArrange(ids) === null) return null;
  return (
    <EditBlock title="Shape">
      <ArrangeButton className="edit-wide" ids={ids} label={ARRANGE_IN_SHAPE} />
    </EditBlock>
  );
}
