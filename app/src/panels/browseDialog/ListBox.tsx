import { useEffect, useRef, type ReactNode } from "react";

export interface ListBoxProps<K extends string> {
  /** What the list is called to a screen reader. */
  label: string;
  /** The rows to draw, in order. */
  keys: readonly K[];
  highlighted: K | null;
  /** Prefixes a row's key to make its element id. */
  idPrefix: string;
  /** A class of the caller's own beside every row's `browse-row`. */
  rowClassName?: string;
  /** What a row shows. */
  renderRow: (key: K, active: boolean) => ReactNode;
  /** How many rows the list left out. */
  more: number;
  onHighlight: (key: K) => void;
  /** A double click picks the row. */
  onChoose: () => void;
}

/** A browser's list of rows, the highlighted one kept in view as the keys move. */
export function ListBox<K extends string>({
  label,
  keys,
  highlighted,
  idPrefix,
  rowClassName,
  renderRow,
  more,
  onHighlight,
  onChoose,
}: ListBoxProps<K>) {
  const ref = useRef<HTMLDivElement>(null);
  const rowClass = rowClassName === undefined ? "browse-row" : `browse-row ${rowClassName}`;

  useEffect(() => {
    ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [highlighted, keys]);

  return (
    <div
      className="browse-list"
      ref={ref}
      role="listbox"
      aria-label={label}
      aria-activedescendant={highlighted === null ? undefined : idPrefix + highlighted}
      tabIndex={0}
    >
      {keys.length === 0 && <div className="muted browse-empty">Nothing matches that search.</div>}
      {keys.map((key) => {
        const active = key === highlighted;
        return (
          <div
            key={key}
            id={idPrefix + key}
            role="option"
            aria-selected={active}
            className={`${rowClass}${active ? " active" : ""}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onHighlight(key);
            }}
            onDoubleClick={onChoose}
          >
            {renderRow(key, active)}
          </div>
        );
      })}
      {more > 0 && <div className="muted browse-empty">{more} more — refine the search.</div>}
    </div>
  );
}
