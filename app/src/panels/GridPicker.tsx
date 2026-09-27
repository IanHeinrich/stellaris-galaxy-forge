import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { gridPlace, gridStep } from "./gridKeys";
import { ENTER, ESCAPE, SPACE } from "./keys";
import { useOutsidePress } from "./useOutsidePress";
import { useTextureUrl } from "./useTextureUrl";
import "./panels.css";

export interface GridPickerItem {
  key: string;
  label: string;
  /** The thumbnail: the first of these textures that has landed. */
  textures: readonly string[];
}

/** One tab of the grid; its label names the tab. */
export interface GridPickerGroup {
  key: string;
  label: string;
  items: readonly GridPickerItem[];
}

function Thumb({ textures, className }: { textures: readonly string[]; className: string }) {
  const url = useTextureUrl(textures);
  return <span className={className}>{url !== undefined && <img src={url} alt="" />}</span>;
}

/** How many tiles a row of `grid` holds, as its layout resolved them. */
function columnsOf(grid: HTMLElement | null): number {
  if (grid === null) return 1;
  return getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
}

/**
 * A field showing `current`'s thumbnail and label that opens a grid of thumbnails to pick from,
 * with a tab per group when there is more than one. It opens on the current item's tab. Arrows
 * move over the grid, Up from its first row reaches the tabs, and Left and Right there change
 * tab; Enter picks, Esc, Tab or a press outside closes. Only the open tab's tiles are drawn.
 */
export function GridPicker({
  label,
  current,
  groups,
  title,
  disabledReason,
  onPick,
}: {
  label: string;
  current: GridPickerItem;
  groups: readonly GridPickerGroup[];
  title?: string;
  /** Set when the field cannot take an edit: it shows disabled, and says why on hover. */
  disabledReason?: string;
  onPick: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(0);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  const id = useId();
  const tileId = (i: number) => `${id}-tile-${i}`;
  const tabId = (i: number) => `${id}-tab-${i}`;
  const disabled = disabledReason !== undefined;
  const tabbed = groups.length > 1;
  const items = groups[tab]?.items ?? [];

  useOutsidePress(open, () => setOpen(false), root);
  useEffect(() => {
    if (open) grid.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(tileId(active))?.scrollIntoView({ block: "nearest" });
  });

  const show = () => {
    const place = gridPlace(groups, current.key);
    setTab(place.group);
    setActive(place.index);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const pick = (key: string) => {
    close();
    onPick(key);
  };
  const showTab = (i: number) => {
    setTab(i);
    setActive(
      Math.max(
        0,
        groups[i].items.findIndex((item) => item.key === current.key),
      ),
    );
  };

  // The app's own keys act on the selection, so a key the picker takes goes no further.
  const onGridKey = (e: KeyboardEvent) => {
    if (e.key === "Tab") setOpen(false);
    if (e.key === ESCAPE) close();
    else if (items.length === 0) return;
    else if (e.key === ENTER || e.key === SPACE) pick(items[active].key);
    else {
      const to = gridStep(active, e.key, items.length, columnsOf(grid.current));
      if (to === null) return;
      if (to !== "above") setActive(to);
      else if (tabbed) document.getElementById(tabId(tab))?.focus();
    }
    e.preventDefault();
    e.stopPropagation();
  };
  const onTabKey = (e: KeyboardEvent) => {
    const go = (i: number) => {
      const to = (i + groups.length) % groups.length;
      showTab(to);
      document.getElementById(tabId(to))?.focus();
    };
    if (e.key === "Tab") setOpen(false);
    if (e.key === ESCAPE) close();
    else if (e.key === "ArrowLeft") go(tab - 1);
    else if (e.key === "ArrowRight") go(tab + 1);
    else if (e.key === "ArrowDown" || e.key === ENTER || e.key === SPACE) grid.current?.focus();
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
    <span className="grid-picker" ref={root}>
      <button
        type="button"
        className="icon-picker-trigger edit-field grid-picker-trigger"
        ref={trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        title={disabledReason ?? title}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onTriggerKey}
      >
        <Thumb className="grid-picker-thumb" textures={current.textures} />
        <span className="grid-picker-label">{current.label}</span>
        <span className="icon-picker-caret">▾</span>
      </button>
      {open && !disabled && (
        <div className="grid-picker-pop">
          {tabbed && (
            <div className="grid-picker-tabs" role="tablist" aria-label={label}>
              {groups.map((group, i) => (
                <button
                  key={group.key}
                  type="button"
                  id={tabId(i)}
                  role="tab"
                  className="grid-picker-tab"
                  aria-selected={i === tab}
                  tabIndex={-1}
                  onClick={() => showTab(i)}
                  onKeyDown={onTabKey}
                >
                  {group.label}
                </button>
              ))}
            </div>
          )}
          <ul
            className="grid-picker-grid"
            role="listbox"
            aria-label={tabbed ? `${label}: ${groups[tab].label}` : label}
            aria-activedescendant={items.length > 0 ? tileId(active) : undefined}
            tabIndex={-1}
            ref={grid}
            onKeyDown={onGridKey}
          >
            {items.map((item, i) => (
              <li
                key={item.key}
                id={tileId(i)}
                role="option"
                className={i === active ? "grid-picker-tile active" : "grid-picker-tile"}
                aria-selected={item.key === current.key}
                aria-label={item.label}
                title={item.label}
                onMouseMove={i === active ? undefined : () => setActive(i)}
                onClick={() => pick(item.key)}
              >
                <Thumb className="grid-picker-tile-thumb" textures={item.textures} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
