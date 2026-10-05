import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { opensUp, popupPlace, type Across } from "./iconPickerPlace";
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

/** How far a popup stays inside the edge of the box that shows it. */
const POPUP_EDGE_PX = 4;

/** The part of the window `el` shows its overflow in: inside every ancestor that clips or scrolls it. */
function shownAcross(el: HTMLElement): Across {
  let left = 0;
  let right = document.documentElement.clientWidth;
  for (let at = el.parentElement; at !== null; at = at.parentElement) {
    if (getComputedStyle(at).overflowX === "visible") continue;
    const inner = at.getBoundingClientRect().left + at.clientLeft;
    left = Math.max(left, inner);
    right = Math.min(right, inner + at.clientWidth);
  }
  return { left: left + POPUP_EDGE_PX, right: right - POPUP_EDGE_PX };
}

/**
 * Hangs `popup` from whichever edge of `picker` keeps it inside the box that shows it, narrowed
 * where neither does, and above the picker where it has no room below.
 */
function fitPopup(popup: HTMLElement, picker: HTMLElement) {
  const { style } = popup;
  style.left = style.right = style.minWidth = style.maxWidth = "";
  const box = picker.getBoundingClientRect();
  popup.classList.toggle("up", opensUp(box, popup.offsetHeight, window.innerHeight));
  const { edge, maxWidth } = popupPlace(box, shownAcross(picker), popup.offsetWidth);
  if (edge === "right") {
    style.left = "auto";
    style.right = "0";
  }
  if (maxWidth !== null) {
    style.minWidth = "0";
    style.maxWidth = `${maxWidth}px`;
  }
}

/**
 * While `open`, fits `popup` to the box that shows `picker`, so it never widens that box into
 * scrolling sideways: before it paints, again as `rows` change and as the window resizes.
 */
function usePopupFit(
  open: boolean,
  picker: RefObject<HTMLElement | null>,
  popup: RefObject<HTMLElement | null>,
  rows: unknown,
): void {
  useLayoutEffect(() => {
    const at = picker.current;
    const el = popup.current;
    if (!open || at === null || el === null) return undefined;
    const place = () => fitPopup(el, at);
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, picker, popup, rows]);
}

/**
 * A button showing `current` that opens a list of `items` to pick from, each with its icon: what
 * a native `<select>` cannot draw. Arrows move, Enter picks, Esc or a press outside closes.
 * A long list opens with a filter box focused above it, which matches labels and keys.
 * `onOpen` runs as the list opens, and `empty` stands in the list while it has no items.
 * `triggerClassName` dresses the button, as the editable fields do. `onActive` hears the key of
 * the row the arrows or the pointer are on while the list is open, and null once it closes.
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
  onActive,
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
  onActive?: (key: string | null) => void;
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
  const filteredPop = useRef<HTMLDivElement>(null);
  const id = useId();
  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-${i}`;
  const rows = iconPickerRows(items, query);
  const at = activeRow(active, rows.length);
  const activeId = at >= 0 ? optionId(at) : undefined;
  const emptyRow = items.length > 0 ? "No matches" : empty;
  const activeKey = open && at >= 0 ? rows[at].item.key : null;

  useOutsidePress(open, () => setOpen(false), root);
  usePopupFit(open, root, filtered ? filteredPop : list, items);
  useEffect(() => {
    if (open) (filter.current ?? list.current)?.focus();
  }, [open]);
  useEffect(() => onActive?.(activeKey), [activeKey, onActive]);
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
          <div className="icon-picker-pop icon-picker-filtered" ref={filteredPop}>
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
