import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { EditRow } from "./EditField";
import { gridPlace, gridStep } from "./gridKeys";
import { ENTER, ESCAPE, SPACE } from "./keys";
import { useTextureUrl } from "./useTextureUrl";
import "./panels.css";

export interface TileItem {
  key: string;
  label: string;
  /** The thumbnail: the first of these textures that has landed. */
  textures: readonly string[];
}

/** One entry of the panel's dropdown and the tiles it shows. */
export interface TileGroup {
  key: string;
  label: string;
  /** The dropdown heading the group sits under; groups without one come first. */
  section?: string;
  items: readonly TileItem[];
}

function Thumb({ textures, className }: { textures: readonly string[]; className: string }) {
  const url = useTextureUrl(textures);
  return <span className={className}>{url !== undefined && <img src={url} alt="" />}</span>;
}

/** How many tiles a row of `grid` holds, as its layout resolved them. */
function columnsOf(grid: HTMLElement): number {
  return getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 1;
}

/** Scrolls `grid` alone, not the page around it, so that `tile` shows. */
function reveal(grid: HTMLElement, tile: HTMLElement | null) {
  if (tile === null) return;
  const bottom = tile.offsetTop + tile.offsetHeight;
  if (tile.offsetTop < grid.scrollTop) grid.scrollTop = tile.offsetTop;
  else if (bottom > grid.scrollTop + grid.clientHeight) grid.scrollTop = bottom - grid.clientHeight;
}

/** The groups as dropdown entries: those without a section first, then each section's. */
function GroupOptions({ groups }: { groups: readonly TileGroup[] }) {
  const sections = [...new Set(groups.map((g) => g.section))].filter((s) => s !== undefined);
  const option = (g: TileGroup) => (
    <option key={g.key} value={g.key}>
      {g.label}
    </option>
  );
  return (
    <>
      {groups.filter((g) => g.section === undefined).map(option)}
      {sections.map((section) => (
        <optgroup key={section} label={section}>
          {groups.filter((g) => g.section === section).map(option)}
        </optgroup>
      ))}
    </>
  );
}

/** The open panel: a dropdown of the groups when there is more than one, and the open group's tiles. */
function TilePanel({
  id,
  label,
  current,
  groups,
  onPick,
  onClose,
}: {
  id: string;
  label: string;
  current: TileItem;
  groups: readonly TileGroup[];
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const [start] = useState(() => gridPlace(groups, current.key));
  const [group, setGroup] = useState(start.group);
  const [active, setActive] = useState(start.index);
  const panel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLUListElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const tileId = (i: number) => `${id}-tile-${i}`;
  const items = groups[group]?.items ?? [];

  useEffect(() => {
    grid.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView({ block: "nearest" });
  }, []);
  useEffect(() => {
    if (grid.current) reveal(grid.current, document.getElementById(tileId(active)));
  });

  const showGroup = (key: string) => {
    const at = Math.max(
      0,
      groups.findIndex((g) => g.key === key),
    );
    setGroup(at);
    setActive(
      Math.max(
        0,
        groups[at].items.findIndex((item) => item.key === current.key),
      ),
    );
  };

  // The app's own keys act on the selection, so a key the panel takes goes no further.
  const onPanelKey = (e: KeyboardEvent) => {
    if (e.key !== ESCAPE) return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  const onSelectKey = (e: KeyboardEvent) => {
    if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") e.stopPropagation();
  };
  const onGridKey = (e: KeyboardEvent) => {
    if (items.length === 0) return;
    if (e.key === ENTER || e.key === SPACE) onPick(items[active].key);
    else {
      const to = grid.current && gridStep(active, e.key, items.length, columnsOf(grid.current));
      if (to === null) return;
      if (to !== "above") setActive(to);
      else select.current?.focus();
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="tile-panel" id={id} ref={panel} onKeyDown={onPanelKey}>
      {groups.length > 1 && (
        <select
          className="edit-field tile-panel-select"
          aria-label={`${label} group`}
          value={groups[group]?.key}
          ref={select}
          onChange={(e) => showGroup(e.currentTarget.value)}
          onKeyDown={onSelectKey}
        >
          <GroupOptions groups={groups} />
        </select>
      )}
      <ul
        className="tile-panel-grid"
        role="listbox"
        aria-label={groups.length > 1 ? `${label}: ${groups[group]?.label}` : label}
        aria-activedescendant={items.length > 0 ? tileId(active) : undefined}
        tabIndex={0}
        ref={grid}
        onKeyDown={onGridKey}
      >
        {items.map((item, i) => (
          <li
            key={item.key}
            id={tileId(i)}
            role="option"
            className={i === active ? "tile-panel-tile active" : "tile-panel-tile"}
            aria-selected={item.key === current.key}
            aria-label={item.label}
            title={item.label}
            onMouseMove={i === active ? undefined : () => setActive(i)}
            onClick={() => {
              setActive(i);
              onPick(item.key);
            }}
          >
            <Thumb className="tile-panel-thumb" textures={item.textures} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * An edit row whose field shows `current`'s thumbnail and label and opens a panel of tiles under
 * the row, across the whole block, pushing the rows below down. The caller holds whether it is
 * open, so a page can keep one panel open at a time. A pick applies and leaves the panel open;
 * the field or Esc closes it. Only the open group's tiles are drawn.
 */
export function TilePicker({
  label,
  current,
  groups,
  open,
  title,
  disabledReason,
  onOpenChange,
  onPick,
}: {
  label: string;
  current: TileItem;
  groups: readonly TileGroup[];
  open: boolean;
  title?: string;
  /** Set when the field cannot take an edit: it shows disabled, and says why on hover. */
  disabledReason?: string;
  onOpenChange: (open: boolean) => void;
  onPick: (key: string) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const disabled = disabledReason !== undefined;
  const shown = open && !disabled;
  const close = () => {
    onOpenChange(false);
    trigger.current?.focus();
  };
  const onTriggerKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    if (shown) document.getElementById(id)?.querySelector<HTMLElement>('[role="listbox"]')?.focus();
    else onOpenChange(true);
  };
  return (
    <>
      <EditRow label={label}>
        <button
          type="button"
          className="icon-picker-trigger edit-field tile-picker-trigger"
          ref={trigger}
          aria-expanded={shown}
          aria-controls={shown ? id : undefined}
          aria-label={`${label}: ${current.label}`}
          title={disabledReason ?? title}
          disabled={disabled}
          onClick={() => onOpenChange(!open)}
          onKeyDown={onTriggerKey}
        >
          <Thumb className="tile-picker-thumb" textures={current.textures} />
          <span className="tile-picker-label">{current.label}</span>
          <span className="icon-picker-caret">{shown ? "▴" : "▾"}</span>
        </button>
      </EditRow>
      {shown && (
        <TilePanel
          id={id}
          label={label}
          current={current}
          groups={groups}
          onPick={onPick}
          onClose={close}
        />
      )}
    </>
  );
}
