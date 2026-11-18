import { useEffect, useId, type KeyboardEvent, type ReactNode } from "react";
import { listStep } from "../gridKeys";
import { headerRows } from "../iconPickerRows";
import { ENTER } from "../keys";
import { FilterField, Icon } from "../parts";
import "../panels.css";

/**
 * A filtered list of things to add, each under its section's heading, with its picture or an empty
 * square, its name and the lines `details` gives under it. Up and Down move the selection, Enter
 * and a double click add it.
 */
export function PortraitList<T>({
  entries,
  current,
  keyOf,
  heading,
  portrait,
  name,
  details,
  filterLabel,
  listLabel,
  noMatch,
  query,
  onQuery,
  onSelect,
  onConfirm,
}: {
  entries: readonly T[];
  current: T | null;
  keyOf: (entry: T) => string;
  heading: (entry: T) => string;
  /** The texture key of its picture; null for an empty square. */
  portrait: (entry: T) => string | null;
  name: (entry: T) => string;
  details?: (entry: T) => ReactNode;
  filterLabel: string;
  listLabel: string;
  /** What the list says when nothing matches the filter. */
  noMatch: string;
  query: string;
  onQuery: (query: string) => void;
  onSelect: (entry: T) => void;
  onConfirm: () => void;
}) {
  const id = useId();
  const optionId = (i: number) => `${id}-entry-${i}`;
  const currentKey = current === null ? null : keyOf(current);
  const active = currentKey === null ? -1 : entries.findIndex((e) => keyOf(e) === currentKey);

  useEffect(() => {
    const option = active >= 0 ? document.getElementById(optionId(active)) : null;
    option?.scrollIntoView({ block: "nearest" });
  });

  const onKey = (e: KeyboardEvent) => {
    if (entries.length === 0) return;
    if (e.key === ENTER) {
      if (active >= 0) onConfirm();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const to = listStep(e.key, active, entries.length);
      if (to === null) return;
      onSelect(entries[to]);
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="megastructure-add-list-column">
      <FilterField label={filterLabel} value={query} onChange={onQuery} />
      <ul
        className="megastructure-add-list"
        role="listbox"
        aria-label={listLabel}
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        tabIndex={0}
        onKeyDown={onKey}
      >
        {entries.length === 0 && (
          <li className="muted" role="presentation">
            {noMatch}
          </li>
        )}
        {headerRows(entries, heading).flatMap(({ item: entry, header }, i) => {
          const key = keyOf(entry);
          const picture = portrait(entry);
          const head = header ? (
            <li key={`section-${key}`} className="megastructure-add-section" role="presentation">
              {heading(entry)}
            </li>
          ) : null;
          const option = (
            <li
              key={key}
              id={optionId(i)}
              className="listbox-option"
              role="option"
              aria-selected={key === currentKey}
              onClick={() => onSelect(entry)}
              onDoubleClick={onConfirm}
            >
              {picture === null ? (
                <span className="megastructure-add-portrait" />
              ) : (
                <Icon className="megastructure-add-portrait" keys={[picture]} lazy />
              )}
              <span className="megastructure-add-entry">
                <span className="megastructure-add-name">{name(entry)}</span>
                {details?.(entry)}
              </span>
            </li>
          );
          return head === null ? [option] : [head, option];
        })}
      </ul>
    </div>
  );
}
