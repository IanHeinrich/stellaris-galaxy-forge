import type { ReactNode } from "react";

/** A line under a picked row's name; `className` is the line's own style. */
export interface PickedLine {
  className: "l2" | "l3" | "pl-anomaly-desc";
  text: ReactNode;
}

/** The button that takes a picked row off its body. */
export interface PickedRemove {
  title: string;
  label: string;
  run: () => void;
  /** The id of what describes the row, while it shows. */
  describedBy?: string;
}

/**
 * A modifier, anomaly or dig site the body holds: its art, its name, the lines under it, and
 * where `remove` is given a button that takes it off.
 */
export function PickedRow({
  art,
  name,
  mono = false,
  lines,
  remove,
}: {
  art: ReactNode;
  name: string;
  /** The name is a key the game data does not describe. */
  mono?: boolean;
  lines: readonly PickedLine[];
  remove: PickedRemove | null;
}) {
  return (
    <div className="pl-mod">
      <span className="pl-mod-icon">{art}</span>
      <span>
        <span className={mono ? "l1 mono" : "l1"}>{name}</span>
        {lines.map((line, i) => (
          <span key={i} className={line.className}>
            {line.text}
          </span>
        ))}
      </span>
      {remove !== null && (
        <button
          type="button"
          className="pl-dep-remove pl-mod-remove"
          title={remove.title}
          aria-label={remove.label}
          aria-describedby={remove.describedBy}
          onClick={remove.run}
        >
          ✕
        </button>
      )}
    </div>
  );
}
