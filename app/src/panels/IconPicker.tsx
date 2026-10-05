import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { activeRow, hasFilter, iconPickerRows } from "./iconPickerRows";
import { ENTER, ESCAPE, SPACE } from "./keys";
import { FilterField } from "./parts";
import { useOutsidePress } from "./useOutsidePress";
import "./panels.css";

export interface IconPickerItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** The header the item sits under; a new header starts wherever the group changes. */
  group?: string;
  note?: ReactNode;
  /** Runs instead of picking this row: a local action (revealing more rows) that leaves the list open. */
  onSelect?: () => void;
}

function Row({ item }: { item: IconPickerItem }) {
  return (
    <>
      {item.icon !== undefined && <span className="icon-picker-icon">{item.icon}</span>}
      <span className="icon-picker-label">{item.label}</span>
      {item.note !== undefined && <span className="icon-picker-note muted">{item.note}</span>}
    </>
  );
}

/**
 * A button showing `current` that opens a list of `items` to pick from, each with its icon: what
 * a native `<select>` cannot draw. Arrows move, Enter picks, Esc or a press outside closes.
 * A long list opens with a filter box focused above it, which matches labels and keys.
 * `onOpen` runs as the list opens, and `empty` stands in the list while it has no items.
 * `triggerClassName` dresses the button, as the editable fields do.
 */
export function IconPicker({
  label,
  current,
  items,
  title,
  disabled,
  empty,
  triggerClassName,
  onOpen,
  onPick,
}: {
  label: string;
  current: IconPickerItem;
  items: readonly IconPickerItem[];
  title?: string;
  disabled?: boolean;
  empty?: ReactNode;
  triggerClassName?: string;
  onOpen?: () => void;
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  // Set as the list opens, so rows added or removed while it is open keep the filter box.
  const [filtered, setFiltered] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const filter = useRef<HTMLInputElement>(null);
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-${i}`;
  const rows = iconPickerRows(items, query);
  const at = activeRow(active, rows.length);
  const activeId = at >= 0 ? optionId(at) : undefined;
  const emptyRow = items.length > 0 ? "No matches" : empty;

  useOutsidePress(open, () => setOpen(false), root);
  useEffect(() => {
    if (open) (filter.current ?? list.current)?.focus();
  }, [open]);
  useEffect(() => {
    if (open && activeId !== undefined) {
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
    }
  });

  const show = () => {
    setQuery("");
    setFiltered(hasFilter(items));
    setActive(
      Math.max(
        0,
        items.findIndex((item) => item.key === current.key),
      ),
    );
    setOpen(true);
    onOpen?.();
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const pick = (key: string) => {
    const item = items.find((i) => i.key === key);
    if (item?.onSelect) {
      item.onSelect();
      return;
    }
    close();
    onPick(key);
  };

  // The app's own keys act on the selection, so a key the list takes goes no further.
  const onListKey = (e: KeyboardEvent) => {
    const move = (to: number) => setActive((to + rows.length) % rows.length);
    if (e.key === "Tab") setOpen(false);
    if (e.key === ESCAPE) close();
    else if (rows.length === 0) return;
    else if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(rows.length - 1);
    else if (e.key === ENTER || e.key === SPACE) pick(rows[at].item.key);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const onFilterKey = (e: KeyboardEvent) => {
    if (e.key !== SPACE && e.key !== "Home" && e.key !== "End") onListKey(e);
  };
  const onQuery = (value: string) => {
    setQuery(value);
    setActive(0);
  };
  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    e.stopPropagation();
    show();
  };

  const listbox = (
    <ul
      className={filtered ? "icon-picker-list" : "icon-picker-pop"}
      id={listId}
      role="listbox"
      aria-label={label}
      aria-activedescendant={activeId}
      tabIndex={-1}
      ref={list}
      onKeyDown={onListKey}
      onMouseDown={filtered ? (e) => e.preventDefault() : undefined}
    >
      {rows.length === 0 && emptyRow !== undefined && (
        <li className="icon-picker-empty muted" role="presentation">
          {emptyRow}
        </li>
      )}
      {rows.map(({ item, header }, i) => (
        <Option
          key={item.key}
          id={optionId(i)}
          item={item}
          header={header}
          active={i === at}
          selected={item.key === current.key}
          onHover={() => setActive(i)}
          onPick={() => pick(item.key)}
        />
      ))}
    </ul>
  );

  return (
    <span className="icon-picker" ref={root}>
      <button
        type="button"
        className={
          triggerClassName === undefined
            ? "icon-picker-trigger"
            : `icon-picker-trigger ${triggerClassName}`
        }
        ref={trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        title={title}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onTriggerKey}
      >
        <Row item={current} />
        <span className="icon-picker-caret">▾</span>
      </button>
      {open &&
        !disabled &&
        (filtered ? (
          <div className="icon-picker-pop icon-picker-filtered">
            <FilterField
              label={`Filter ${items.length} choices`}
              value={query}
              onChange={onQuery}
              ref={filter}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={activeId}
              onKeyDown={onFilterKey}
            />
            {listbox}
          </div>
        ) : (
          listbox
        ))}
    </span>
  );
}

function Option({
  id,
  item,
  header,
  active,
  selected,
  onHover,
  onPick,
}: {
  id: string;
  item: IconPickerItem;
  header: boolean;
  active: boolean;
  selected: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <>
      {header && (
        <li className="icon-picker-group" role="presentation">
          {item.group}
        </li>
      )}
      <li
        id={id}
        role="option"
        className={active ? "icon-picker-option active" : "icon-picker-option"}
        aria-selected={selected}
        onMouseMove={active ? undefined : onHover}
        onClick={onPick}
      >
        <Row item={item} />
      </li>
    </>
  );
}
