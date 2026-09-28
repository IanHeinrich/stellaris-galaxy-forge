import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ENTER, ESCAPE, SPACE } from "./keys";
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
  /** What a list's filter matches, lower case; the label when not given. */
  search?: string;
}

/** Whether `item` matches what was typed in the list's filter. */
function matches(item: IconPickerItem, query: string): boolean {
  const words = query.trim().toLowerCase();
  return words === "" || (item.search ?? item.label.toLowerCase()).includes(words);
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
 * `onOpen` runs as the list opens, and `empty` stands in the list while it has no items.
 * `triggerClassName` dresses the button, as the editable fields do. With `filter`, a text box
 * heads the list and narrows it to the items that match what is typed, `filter` being its
 * placeholder.
 */
export function IconPicker({
  label,
  current,
  items,
  title,
  disabled,
  empty,
  triggerClassName,
  filter,
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
  filter?: string;
  onOpen?: () => void;
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const shown = filter === undefined ? items : items.filter((item) => matches(item, query));
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const optionId = (i: number) => `${id}-${i}`;

  useOutsidePress(open, () => setOpen(false), root);
  useEffect(() => {
    if (open) (input.current ?? list.current)?.focus();
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(optionId(active))?.scrollIntoView({ block: "nearest" });
  });

  const show = () => {
    setQuery("");
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
    const item = shown.find((i) => i.key === key);
    if (item?.onSelect) {
      item.onSelect();
      return;
    }
    close();
    onPick(key);
  };

  // The app's own keys act on the selection, so a key the list takes goes no further.
  const onListKey = (e: KeyboardEvent) => {
    const move = (to: number) => setActive((to + shown.length) % shown.length);
    // In the filter, space, Home and End edit the text.
    const typing = e.target === input.current;
    if (e.key === "Tab") setOpen(false);
    if (e.key === ESCAPE) close();
    else if (shown.length === 0) return;
    else if (e.key === "ArrowDown") move(active + 1);
    else if (e.key === "ArrowUp") move(active - 1);
    else if (e.key === "Home" && !typing) move(0);
    else if (e.key === "End" && !typing) move(shown.length - 1);
    else if (e.key === ENTER || (e.key === SPACE && !typing))
      pick(shown[Math.min(active, shown.length - 1)].key);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    e.stopPropagation();
    show();
  };

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
      {open && !disabled && (
        <ul
          className="icon-picker-pop"
          role="listbox"
          aria-label={label}
          aria-activedescendant={shown.length > 0 ? optionId(active) : undefined}
          tabIndex={-1}
          ref={list}
          onKeyDown={onListKey}
        >
          {filter !== undefined && (
            <li className="icon-picker-filter" role="presentation">
              <input
                ref={input}
                type="text"
                aria-label={`Filter ${label}`}
                placeholder={filter}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
              />
            </li>
          )}
          {shown.length === 0 && empty !== undefined && (
            <li className="icon-picker-empty muted" role="presentation">
              {empty}
            </li>
          )}
          {shown.map((item, i) => (
            <Option
              key={item.key}
              id={optionId(i)}
              item={item}
              header={item.group !== undefined && item.group !== shown[i - 1]?.group}
              active={i === active}
              selected={item.key === current.key}
              onHover={() => setActive(i)}
              onPick={() => pick(item.key)}
            />
          ))}
        </ul>
      )}
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
