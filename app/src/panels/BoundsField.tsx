import type { Bounds } from "../generated/Bounds";
import { withEdge } from "./boundsEdge";
import { TextField } from "./EditField";

/**
 * A number a source may leave to a draw, shown and edited as a `Bounds`. With `ranges` it has a
 * field for each end. Without, it has one field and every commit is a fixed value.
 */
export function BoundsField({
  label,
  title,
  value,
  ranges,
  editAs = (n) => n,
  display,
  disabledReason,
  onCommit,
}: {
  label: string;
  title?: string;
  value: Bounds;
  ranges: boolean;
  /** The number as a field edits it, for a value kept at more places than it is typed with. */
  editAs?: (n: number) => number;
  /** What a field shows until it is focused, from the value itself, when that differs from the text it edits. */
  display?: (n: number) => string;
  disabledReason?: string;
  onCommit: (next: Bounds) => void;
}) {
  if (!ranges) {
    return (
      <TextField
        kind="number"
        label={label}
        title={title}
        value={editAs(value.min)}
        display={display?.(value.min)}
        disabledReason={disabledReason}
        onCommit={(typed) => onCommit({ min: typed, max: typed })}
      />
    );
  }
  return (
    <span className="edit-bounds">
      {(["min", "max"] as const).map((edge) => (
        <TextField
          key={edge}
          kind="number"
          label={`${label} ${edge}`}
          title={title}
          value={editAs(value[edge])}
          display={display?.(value[edge])}
          disabledReason={disabledReason}
          onCommit={(typed) => onCommit(withEdge(value, edge, typed))}
        />
      ))}
    </span>
  );
}
