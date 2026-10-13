import type { Bounds } from "../../../generated/Bounds";
import type { PlanetEditAdapter } from "../../../lib/details/picker";
import { typedNumber } from "../../../lib/text";
import { BoundsField } from "../../BoundsField";
import { TextField } from "../../EditField";
import { rangeText } from "./bodyFields";

const NO_SIZE = "The save gives this body no size";

/**
 * A body's size, sent to `edits`, which refuses what its source can't take: a range, a fraction
 * or less than 1. A refused size puts the field back. For several bodies of different sizes,
 * `mixed` leaves the field empty with their range in grey, and a typed size goes to them all.
 */
export function SizeField({
  edits,
  size,
  mixed = false,
  title = "Change the body's size",
}: {
  edits: PlanetEditAdapter;
  size: Bounds | null;
  mixed?: boolean;
  title?: string;
}) {
  if (size === null) {
    return (
      <TextField
        kind="text"
        label="Size"
        value="none"
        disabledReason={NO_SIZE}
        onCommit={() => undefined}
      />
    );
  }
  if (mixed) {
    return (
      <TextField
        kind="text"
        label="Size"
        title={title}
        value=""
        placeholder={`${rangeText(size)} (mixed)`}
        onCommit={(text) => {
          const typed = typedNumber(text);
          if (typed !== null) void edits.setSize({ min: typed, max: typed }, size.min);
        }}
      />
    );
  }
  return (
    <BoundsField
      label="Size"
      title={title}
      value={size}
      ranges={edits.ranges}
      onCommit={(next) => void edits.setSize(next, size.min)}
    />
  );
}
