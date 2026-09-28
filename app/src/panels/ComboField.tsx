import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ENTER, ESCAPE } from "./keys";
import "./panels.css";

/** One row a combo field offers: its name, which typing filters on, and what it shows beside it. */
export interface ComboItem {
  key: string;
  label: string;
  detail?: ReactNode;
  aside?: ReactNode;
}

/** How many rows the list shows before it asks for more letters. */
const ROWS_SHOWN = 6;

/**
 * A choice typed for: the field shows `value`, and focusing it lists `items` in their order,
 * filtered by what is typed. Arrows move, Enter picks, Escape or leaving the field closes it.
 * `note` is the line under the field, told the highlighted row while the list is open.
 */
export function ComboField({
  label,
  value,
  items,
  disabledReason,
  title,
  more,
  empty,
  note,
  onPick,
}: {
  label: string;
  value: string;
  items: readonly ComboItem[];
  disabledReason?: string;
  title?: string;
  /** The last row while more items match than the list shows. */
  more: string;
  /** The list's one row while nothing matches. */
  empty: string;
  note?: (active: ComboItem | null) => ReactNode;
  onPick: (key: string) => void;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const disabled = disabledReason !== undefined;
  const open = query !== null && !disabled;
  const needle = (query ?? "").trim().toLowerCase();
  const matches = open ? items.filter((i) => i.label.toLowerCase().includes(needle)) : [];
  const shown = matches.slice(0, ROWS_SHOWN);
  const highlighted = shown[Math.min(active, shown.length - 1)] ?? null;
  const optionId = (i: number) => `${id}-${i}`;

  const close = () => setQuery(null);
  const pick = (item: ComboItem) => {
    close();
    input.current?.blur();
    onPick(item.key);
  };

  // The app's own keys act on the selection and the cut, so a key the field takes goes no further.
  const onKeyDown = (e: KeyboardEvent) => {
    const move = (to: number) => setActive((to + shown.length) % shown.length);
    if (e.key === ESCAPE) {
      close();
      input.current?.blur();
    } else if (!open || shown.length === 0) return;
    else if (e.key === "ArrowDown") move(active + 1);
    else if (e.key === "ArrowUp") move(active - 1);
    else if (e.key === ENTER && highlighted !== null) pick(highlighted);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const line = note?.(open ? highlighted : null);
  return (
    <span className="combo-field">
      <span
        className={
          disabled ? "edit-field edit-text combo-box disabled" : "edit-field edit-text combo-box"
        }
        title={disabledReason ?? title}
      >
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-activedescendant={
            highlighted === null ? undefined : optionId(shown.indexOf(highlighted))
          }
          aria-autocomplete="list"
          disabled={disabled}
          value={query ?? value}
          onFocus={() => {
            setQuery("");
            setActive(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onBlur={close}
          onKeyDown={onKeyDown}
        />
        <span className="edit-field-icon" aria-hidden="true">
          ▾
        </span>
      </span>
      {open && (
        <ul className="combo-pop" id={`${id}-list`} role="listbox" aria-label={label}>
          {shown.length === 0 && (
            <li className="combo-more muted" role="presentation">
              {empty}
            </li>
          )}
          {shown.map((item, i) => (
            <li
              key={item.key}
              id={optionId(i)}
              role="option"
              aria-selected={item === highlighted}
              className={item === highlighted ? "combo-option active" : "combo-option"}
              onMouseMove={item === highlighted ? undefined : () => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(item);
              }}
            >
              <span className="combo-label">{item.label}</span>
              <span className="combo-detail">{item.detail}</span>
              <span className="combo-aside">{item.aside}</span>
            </li>
          ))}
          {matches.length > shown.length && (
            <li className="combo-more muted" role="presentation">
              {more}
            </li>
          )}
        </ul>
      )}
      {line !== undefined && line !== null && <span className="combo-note">{line}</span>}
    </span>
  );
}
