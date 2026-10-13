import type { ReactNode } from "react";

/** The button that takes a row's thing off its body. */
export interface RemoveAction {
  title: string;
  label: string;
  run: () => void;
  /** The id of what describes the row, while it shows. */
  describedBy?: string;
}

/** A row's ✕ button, which runs `remove`. */
export function RemoveButton({ remove, className }: { remove: RemoveAction; className: string }) {
  return (
    <button
      type="button"
      className={className}
      title={remove.title}
      aria-label={remove.label}
      aria-describedby={remove.describedBy}
      onClick={remove.run}
    >
      ✕
    </button>
  );
}

/**
 * Who of several selected bodies has a row, and the buttons that act on it; drawn under the row's
 * other lines.
 */
export interface Spread {
  line: string;
  actions: ReactNode;
}

/** A spread row's line saying who has it, and its buttons under it. */
export function SpreadLines({ spread }: { spread: Spread | undefined }) {
  if (spread === undefined) return null;
  return (
    <>
      <span className="l3">{spread.line}</span>
      <span className="pl-spread-acts">{spread.actions}</span>
    </>
  );
}

/**
 * A spread row's buttons: Add to the `lacking` bodies without it, where any lack it, and Remove
 * from the `holders` that have it.
 */
export function SpreadActions({
  lacking,
  holders,
  addTitle,
  removeTitle,
  onAdd,
  onRemove,
}: {
  lacking: number;
  holders: number;
  addTitle: string;
  removeTitle: string;
  onAdd: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      {lacking > 0 && (
        <button type="button" className="dp-amount" title={addTitle} onClick={onAdd}>
          Add to the other {lacking}
        </button>
      )}
      <button type="button" className="dp-amount" title={removeTitle} onClick={onRemove}>
        Remove from {holders}
      </button>
    </>
  );
}
