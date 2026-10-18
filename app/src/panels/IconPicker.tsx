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
import {
  floatAcross,
  floatPlace,
  opensUp,
  popupPlace,
  type Across,
  type Down,
} from "./iconPickerPlace";
import { listStep } from "./gridKeys";
import { activeRow, hasFilter, iconPickerRows } from "./iconPickerRows";
import { ENTER, ESCAPE, SPACE } from "./keys";
import { FilterField } from "./parts";
import { scrollParents } from "./scrollParents";
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
      <span className="icon-picker-main">
        {item.icon !== undefined && <span className="icon-picker-icon">{item.icon}</span>}
        <span className="icon-picker-label">{item.label}</span>
      </span>
      {item.note !== undefined && <span className="icon-picker-note muted">{item.note}</span>}
    </>
  );
}

/**
 * A picker's button: the current choice and a caret, named for the field and its choice. It opens
 * the picker's list, or a dialog that makes the choice.
 */
export function PickerTrigger({
  className,
  ref,
  popup,
  expanded,
  label,
  current,
  title,
  disabled,
  onClick,
  onKeyDown,
}: {
  className?: string;
  ref?: RefObject<HTMLButtonElement | null>;
  popup: "listbox" | "dialog";
  expanded?: boolean;
  label: string;
  current: IconPickerItem;
  title?: string;
  disabled?: boolean;
  onClick: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}) {
  return (
    <button
      type="button"
      className={
        className === undefined ? "icon-picker-trigger" : `icon-picker-trigger ${className}`
      }
      ref={ref}
      aria-haspopup={popup}
      aria-expanded={expanded}
      aria-label={`${label}: ${current.label}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <Row item={current} />
      <span className="icon-picker-caret">▾</span>
    </button>
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
 * The part of the window `el` shows its overflow in from top to bottom: inside its nearest
 * ancestor that scrolls vertically, else the window.
 */
function shownDown(el: HTMLElement): Down {
  const [box] = scrollParents(el);
  if (box === undefined) return { top: 0, bottom: window.innerHeight };
  const { top, bottom } = box.getBoundingClientRect();
  return { top: Math.max(0, top), bottom: Math.min(window.innerHeight, bottom) };
}

/**
 * Hangs `popup` from whichever edge of `picker` keeps it inside the box that shows it, narrowed
 * where neither does, and above the picker where it has no room below.
 */
function fitPopup(popup: HTMLElement, picker: HTMLElement) {
  const { style } = popup;
  style.left = style.right = style.minWidth = style.maxWidth = "";
  const box = picker.getBoundingClientRect();
  popup.classList.toggle("up", opensUp(box, popup.offsetHeight, shownDown(picker)));
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

/** The space between a floating popup and its picker. */
const POPUP_GAP_PX = 4;

/** The widest a floating popup grows to fit its rows. */
const FLOAT_WIDTH_CAP_PX = 420;

/**
 * Floats `popup` over everything, fixed to the window beside `picker`: as wide as its rows need
 * and no narrower than the picker, and on the side with room, no taller than the window leaves
 * there, so opening it never grows or scrolls a box around it.
 */
function floatPopup(popup: HTMLElement, picker: HTMLElement) {
  const { style } = popup;
  Object.assign(style, {
    position: "fixed",
    margin: "0",
    right: "auto",
    bottom: "auto",
    left: "0",
    width: "",
    maxHeight: "",
  });
  popup.classList.remove("up");
  const box = picker.getBoundingClientRect();
  const across = {
    left: POPUP_EDGE_PX,
    right: document.documentElement.clientWidth - POPUP_EDGE_PX,
  };
  const place = floatAcross(box, popup.offsetWidth, across, FLOAT_WIDTH_CAP_PX);
  style.width = `${place.width}px`;
  style.left = `${place.left}px`;
  const view = { top: 0, bottom: window.innerHeight };
  const { up, maxHeight } = floatPlace(box, popup.offsetHeight, view, POPUP_GAP_PX, POPUP_EDGE_PX);
  style.maxHeight = `${maxHeight}px`;
  const height = Math.min(popup.offsetHeight, maxHeight);
  style.top = `${up ? box.top - POPUP_GAP_PX - height : box.bottom + POPUP_GAP_PX}px`;
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
  floating: boolean,
): void {
  useLayoutEffect(() => {
    const at = picker.current;
    const el = popup.current;
    if (!open || at === null || el === null) return undefined;
    const place = () => (floating ? floatPopup(el, at) : fitPopup(el, at));
    place();
    window.addEventListener("resize", place);
    if (floating) window.addEventListener("scroll", place, { capture: true, passive: true });
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, { capture: true });
    };
  }, [open, picker, popup, rows, floating]);
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
  floating = false,
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
  /**
   * Floats the list over everything, fixed to the window, for a picker in a box that must not
   * grow or scroll as the list opens, such as a dialog beside the map.
   */
  floating?: boolean;
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
  usePopupFit(open, root, filtered ? filteredPop : list, items, floating);
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
    const to = listStep(e.key, at, rows.length, { wrap: true });
    if (e.key === "Tab") setOpen(false);
    if (e.key === ESCAPE) close();
    else if (rows.length === 0) return;
    else if (e.key === ENTER || e.key === SPACE) pick(rows[at].item.key);
    else if (to !== null) setActive(to);
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
      className={
        filtered
          ? "icon-picker-list"
          : floating
            ? "icon-picker-pop icon-picker-floating pop-surface"
            : "icon-picker-pop pop-surface"
      }
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
      <PickerTrigger
        className={triggerClassName}
        ref={trigger}
        popup="listbox"
        expanded={open}
        label={label}
        current={current}
        title={title}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onTriggerKey}
      />
      {open &&
        !disabled &&
        (filtered ? (
          <div
            className={
              floating
                ? "icon-picker-pop icon-picker-filtered icon-picker-floating pop-surface"
                : "icon-picker-pop icon-picker-filtered pop-surface"
            }
            ref={filteredPop}
          >
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
        className={
          active ? "icon-picker-option listbox-option active" : "icon-picker-option listbox-option"
        }
        aria-selected={selected}
        onMouseMove={active ? undefined : onHover}
        onClick={onPick}
      >
        <Row item={item} />
      </li>
    </>
  );
}
