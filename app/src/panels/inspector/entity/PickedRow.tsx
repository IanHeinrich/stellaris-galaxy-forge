import type { ReactNode } from "react";
import { RemoveButton, SpreadLines, type RemoveAction, type Spread } from "./RowParts";

/** A line under a picked row's name; `className` is the line's own style. */
export interface PickedLine {
  className: "l2" | "l3" | "pl-anomaly-desc";
  text: ReactNode;
}

/**
 * A modifier, anomaly or dig site the body holds: its art, its name, the lines under it, and
 * where `remove` is given a button that takes it off. With `spread`, the row stands for several
 * bodies and says who has it.
 */
export function PickedRow({
  art,
  name,
  mono = false,
  lines,
  spread,
  remove,
}: {
  art: ReactNode;
  name: string;
  /** The name is a key the game data does not describe. */
  mono?: boolean;
  lines: readonly PickedLine[];
  spread?: Spread;
  remove: RemoveAction | null;
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
        <SpreadLines spread={spread} />
      </span>
      {remove !== null && <RemoveButton remove={remove} className="pl-dep-remove pl-mod-remove" />}
    </div>
  );
}
