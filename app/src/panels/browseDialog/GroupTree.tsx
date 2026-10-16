import { useRef } from "react";
import { listStep } from "../gridKeys";

/** One group a browser lists down its left edge, with how many entries it holds. */
export interface TreeGroup {
  id: string;
  label: string;
  count: number;
}

export interface GroupTreeProps {
  /** What the tree is called to a screen reader. */
  label: string;
  groups: readonly TreeGroup[];
  /** How many entries All holds. */
  total: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
}

/**
 * The groups a browser lists down its left edge: All first, then the groups it is given. One
 * button is tabbable, and the arrows move between them.
 */
export function GroupTree({ label, groups, total, selected, onSelect }: GroupTreeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = [{ id: null as string | null, label: "All", count: total }, ...groups];
  const at = Math.max(
    0,
    rows.findIndex((row) => row.id === selected),
  );

  const go = (index: number) => {
    const row = rows[Math.min(Math.max(index, 0), rows.length - 1)];
    onSelect(row.id);
    ref.current?.querySelectorAll<HTMLElement>("button")[rows.indexOf(row)]?.focus();
  };

  return (
    <div
      ref={ref}
      className="browse-tree"
      role="listbox"
      aria-label={label}
      onKeyDown={(e) => {
        const move = listStep(e.key, at, rows.length);
        if (move === null) return;
        e.preventDefault();
        e.stopPropagation();
        go(move);
      }}
    >
      {rows.map((row, i) => (
        <button
          key={row.id ?? "@all"}
          type="button"
          role="option"
          aria-selected={i === at}
          tabIndex={i === at ? 0 : -1}
          className={`browse-group${i === at ? " active" : ""}`}
          onClick={() => onSelect(row.id)}
        >
          <span className="browse-group-label">{row.label}</span>
          <span className="browse-count">{row.count}</span>
        </button>
      ))}
    </div>
  );
}
