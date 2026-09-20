import { useRef } from "react";
import type { BrowserGroup } from "../../lib/initializer/initializerBrowser";

const ALL = { id: null, label: "All" };

/**
 * The groups the browser lists down its left edge: everything first, then the pinned and recent
 * picks and the game data's own groups. One button is tabbable, and the arrows move between them.
 */
export function GroupTree({
  groups,
  total,
  selected,
  onSelect,
}: {
  groups: readonly BrowserGroup[];
  total: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const rows = [ALL, ...groups.map((g) => ({ id: g.id as string | null, label: g.label }))];
  const counts = [total, ...groups.map((g) => g.entries.length)];
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
      className="ib-tree"
      role="listbox"
      aria-label="Initializer groups"
      onKeyDown={(e) => {
        const move =
          e.key === "ArrowDown"
            ? at + 1
            : e.key === "ArrowUp"
              ? at - 1
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? rows.length - 1
                  : null;
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
          className={`ib-group${i === at ? " active" : ""}`}
          onClick={() => onSelect(row.id)}
        >
          <span className="ib-group-label">{row.label}</span>
          <span className="ib-count">{counts[i]}</span>
        </button>
      ))}
    </div>
  );
}
