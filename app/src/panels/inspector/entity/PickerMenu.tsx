import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ChipItem, PickerSection } from "../../../lib/details/picker";
import { useGameDataStore } from "../../../store/gameDataStore";
import type { PickerState } from "../../../store/pickerSlice";
import { ENTER, ESCAPE } from "../../keys";
import { useOutsidePress } from "../../useOutsidePress";

export const NO_DESCRIPTION = "No description";

/** A picker's store, as the menu reads it. */
export type PickerHook<C extends string> = <U>(selector: (state: PickerState<C>) => U) => U;

/** One of a row's add buttons. */
export interface PickerButton {
  text: string;
  label: string;
  title: string;
  disabled?: boolean;
}

/** What a row shows. */
export interface PickerItem {
  key: string;
  label: string;
  /** What it gives, spelled out; empty for nothing. */
  gives: string;
  /** What the details under the list say about it. */
  description: string | null;
  art: ReactNode;
  /** Added to the art's class. */
  artClass?: string;
  /** Drawn before what it gives. */
  yields?: ReactNode;
  /** More than one makes the row a family, its buttons on a line of their own. */
  buttons: readonly PickerButton[];
}

/** Where the keyboard stands in the list: a row, and one of its buttons. */
interface Cursor {
  row: number;
  button: number;
}

function PickerRow({
  item,
  id,
  lit,
  cursor,
  describedBy,
  onHover,
  onAdd,
}: {
  item: PickerItem;
  id: string;
  /** The details under the list describe this row. */
  lit: boolean;
  /** The button the keyboard stands on, when it stands on this row and nothing else is lit. */
  cursor: number | null;
  /** The details' id, when they describe the row the keyboard stands on. */
  describedBy: string | undefined;
  onHover: () => void;
  onAdd: (button: number) => void;
}) {
  return (
    <div
      id={id}
      className={`dp-row${item.buttons.length > 1 ? " family" : ""}${lit ? " active" : ""}`}
      aria-describedby={describedBy}
      onMouseEnter={onHover}
    >
      <span className={`dp-art${item.artClass === undefined ? "" : ` ${item.artClass}`}`}>
        {item.art}
      </span>
      <span className="dp-text">
        <span className="l1">{item.label}</span>
        <span className="l2">
          {item.yields}
          {item.gives === "" ? <span className="muted">No effect</span> : item.gives}
        </span>
      </span>
      <span className="dp-amounts">
        {item.buttons.map((button, i) => (
          <button
            key={i}
            type="button"
            className={`dp-amount${cursor === i ? " active" : ""}`}
            aria-label={button.label}
            disabled={button.disabled}
            title={button.title}
            onClick={() => onAdd(i)}
          >
            {button.text}
          </button>
        ))}
      </span>
    </div>
  );
}

/**
 * The name and description of the row under the pointer or the keyboard, at a fixed height; empty
 * without rows.
 */
function PickerDetails({ id, item }: { id: string; item: PickerItem | null }) {
  return (
    <div id={id} className="dp-details">
      {item !== null && (
        <>
          <span className="dp-details-name">{item.label}</span>
          {item.description === null ? (
            <span className="muted">{NO_DESCRIPTION}</span>
          ) : (
            <span className="dp-details-text">{item.description}</span>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The open picker: a search, the chips, the picker's own `controls`, a line saying what was added,
 * the rows under their headings, and the details of the row under the pointer, else the keyboard.
 * It stays open after an add; Escape, Done or a press outside closes it. The arrows move between
 * rows, and Enter in the search adds the button they stand on.
 */
export function PickerMenu<R, C extends string>({
  usePicker,
  name,
  searchName,
  placeholder,
  chips,
  chipsName,
  sections,
  reading,
  noneMatch,
  idPrefix,
  item,
  onAdd,
  variants = false,
  controls,
  notice,
}: {
  usePicker: PickerHook<C>;
  /** What the menu is called, for a screen reader. */
  name: string;
  searchName: string;
  placeholder: string;
  chips: readonly ChipItem<C>[];
  chipsName: string;
  /** The rows the chip and search leave; `null` while the choices are read. */
  sections: readonly PickerSection<R>[] | null;
  reading: string;
  noneMatch: string;
  /** Starts each row's element id. */
  idPrefix: string;
  item: (row: R) => PickerItem;
  onAdd: (row: R, button: number) => void;
  /**
   * Left and Right step between a row's buttons, and typing outside the search goes to it. Off
   * where `controls` take typing of their own.
   */
  variants?: boolean;
  /** Drawn under the chips. */
  controls?: ReactNode;
  /** Drawn in place of the line saying what was added. */
  notice?: ReactNode;
}) {
  const query = usePicker((s) => s.query);
  const chip = usePicker((s) => s.chip);
  const added = usePicker((s) => s.added);
  const setQuery = usePicker((s) => s.setQuery);
  const setChip = usePicker((s) => s.setChip);
  const close = usePicker((s) => s.close);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState<Cursor>({ row: 0, button: 0 });
  const [hovered, setHovered] = useState<number | null>(null);
  useOutsidePress(true, close, root);
  useEffect(() => search.current?.focus(), []);

  const flat = (sections ?? []).flatMap((s) => s.rows);
  const at = Math.min(cursor.row, flat.length - 1);
  const rowId = (i: number) => `${idPrefix}-${i}`;
  useEffect(() => {
    document.getElementById(`${idPrefix}-${at}`)?.scrollIntoView?.({ block: "nearest" });
  }, [idPrefix, at]);

  const onKey = (e: KeyboardEvent) => {
    const inSearch = e.target === search.current;
    const row = flat[at];
    const stepping = variants && !(inSearch && query !== "");
    const move = (to: number) => {
      setHovered(null);
      setCursor({ row: Math.max(0, Math.min(to, flat.length - 1)), button: 0 });
    };
    const step = (by: number) =>
      row !== undefined &&
      setCursor({
        row: at,
        button: Math.max(0, Math.min(cursor.button + by, item(row).buttons.length - 1)),
      });
    if (e.key === ESCAPE) close();
    else if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "ArrowRight" && stepping) step(1);
    else if (e.key === "ArrowLeft" && stepping) step(-1);
    else if (e.key === ENTER && inSearch && row !== undefined) onAdd(row, cursor.button);
    else {
      const typed = e.key.length === 1 && !e.ctrlKey && !e.metaKey;
      if (variants && !inSearch && typed) search.current?.focus();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const restart = () => {
    setHovered(null);
    setCursor({ row: 0, button: 0 });
  };
  const lit = hovered ?? at;
  const detailed = flat[lit];
  const detailsId = `${idPrefix}-details`;
  let index = 0;
  return (
    <div
      className="dp"
      ref={root}
      role="group"
      aria-label={name}
      onKeyDown={onKey}
      onMouseLeave={() => setHovered(null)}
    >
      <div className="dp-head">
        <input
          ref={search}
          type="search"
          aria-label={searchName}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            restart();
          }}
        />
        <button type="button" className="dp-done" onClick={() => close()}>
          Done
        </button>
      </div>
      {chips.length > 0 && (
        <div className="dp-chips" role="group" aria-label={chipsName}>
          {chips.map(({ chip: each, label }) => (
            <button
              key={each}
              type="button"
              className="dp-chip"
              aria-pressed={chip === each}
              onClick={() => {
                setChip(each);
                restart();
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {controls}
      {notice ??
        (added !== null && (
          <div className="dp-added" role="status">
            ✓ {added}
          </div>
        ))}
      <div className="dp-list">
        {sections === null && <div className="dp-empty muted">{reading}</div>}
        {sections !== null && flat.length === 0 && (
          <div className="dp-empty muted">{noneMatch}</div>
        )}
        {(sections ?? []).map((section) => (
          <div key={section.title}>
            {section.title !== "" && (
              <div className="dp-group">
                {section.title} · {section.rows.length}
              </div>
            )}
            {section.rows.map((row) => {
              const i = index++;
              const shown = item(row);
              return (
                <PickerRow
                  key={shown.key}
                  item={shown}
                  id={rowId(i)}
                  lit={i === lit}
                  cursor={
                    i === at && lit === at
                      ? Math.min(cursor.button, shown.buttons.length - 1)
                      : null
                  }
                  describedBy={i === at && lit === at ? detailsId : undefined}
                  onHover={() => setHovered(i)}
                  onAdd={(button) => {
                    setCursor({ row: i, button });
                    onAdd(row, button);
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <PickerDetails id={detailsId} item={detailed === undefined ? null : item(detailed)} />
    </div>
  );
}

/** A closed picker's button, which needs the game data to open. */
export function PickerOpener({
  label,
  title,
  needsGameData,
  onOpen,
}: {
  label: string;
  title: string;
  needsGameData: string;
  onOpen: () => void;
}) {
  const ready = useGameDataStore((s) => s.status === "ready");
  return (
    <div className="pl-dep-add">
      <button
        type="button"
        className="edit-field dp-open"
        disabled={!ready}
        title={ready ? title : needsGameData}
        onClick={onOpen}
      >
        {label}
      </button>
    </div>
  );
}
