import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PlanetPage } from "../../../generated/PlanetPage";
import {
  amountText,
  blockerChips,
  DEPOSIT_CHIPS,
  depositRows,
  depositSections,
  type DepositRow,
  type PickerMode,
} from "../../../lib/details/depositPicker";
import { resourceAbbrev } from "../../../lib/details/resources";
import { useDepositPickerStore } from "../../../store/depositPickerStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { usePlanetDataStore } from "../../../store/planetDataStore";
import { ENTER, ESCAPE } from "../../keys";
import { Icon } from "../../parts";
import { useOutsidePress } from "../../useOutsidePress";

export const PICKER_NEEDS_GAME_DATA = "Adding a deposit needs the game data";
export const READING_CHOICES = "Reading the deposit types…";
export const NONE_MATCH = "No deposit type matches";

/** What each picker's button says, and its hover text. */
const OPENERS: Record<PickerMode, { label: string; title: string }> = {
  deposits: {
    label: "+ Add deposit…",
    title: "Add deposits of any type. The ones the game places on this planet come first.",
  },
  blockers: {
    label: "+ Add blocker…",
    title: "Add blockers of any type. The ones the game places on this planet come first.",
  },
};

/** Where the keyboard stands in the list: a row, and one of its amounts. */
interface Cursor {
  row: number;
  amount: number;
}

function PickerRow({
  row,
  id,
  cursor,
  onAdd,
}: {
  row: DepositRow;
  id: string;
  /** The amount the keyboard stands on, when it stands on this row. */
  cursor: number | null;
  onAdd: (amount: number) => void;
}) {
  const view = row.view;
  return (
    <div
      id={id}
      className={`dp-row${row.amounts.length > 1 ? " family" : ""}${cursor === null ? "" : " active"}`}
      title={row.description ?? undefined}
    >
      <span className="dp-art">
        {view !== undefined && <Icon className="pl-art" keys={[view.texture_key]} glyph="" />}
      </span>
      <span className="dp-text">
        <span className="l1">{row.label}</span>
        <span className="l2">
          {view?.yields.map((y) => (
            <Icon
              key={y.resource}
              className="gi"
              keys={y.icon === null ? [] : [y.icon]}
              glyph={resourceAbbrev(y.resource)}
            />
          ))}
          {row.gives === "" ? <span className="muted">No effect</span> : row.gives}
        </span>
      </span>
      <span className="dp-amounts">
        {row.amounts.map((amount, i) => (
          <button
            key={amount.key}
            type="button"
            className={`dp-amount${cursor === i ? " active" : ""}`}
            aria-label={`Add ${amount.amount === null ? "" : `${amountText(amount)} `}${row.label}`}
            title={amount.title}
            onClick={() => onAdd(i)}
          >
            {amountText(amount)}
          </button>
        ))}
      </span>
    </div>
  );
}

/**
 * The open picker: a search, the chips (categories for deposits, clearing techs for blockers), a
 * line saying what was added, and one row per deposit family with a button per amount. It stays open after an add; Escape, Done or a press
 * outside closes it. Typing goes to the search, the arrows move between rows and amounts, and
 * Enter adds the amount they stand on.
 */
function DepositPopover({
  page,
  moon,
  mode,
}: {
  page: PlanetPage;
  moon: boolean;
  mode: PickerMode;
}) {
  const store = useDepositPickerStore.getState();
  const query = useDepositPickerStore((s) => s.query);
  const chip = useDepositPickerStore((s) => s.chip);
  const added = useDepositPickerStore((s) => s.added);
  const choices = useDepositPickerStore((s) => s.choices);
  const views = usePlanetDataStore((s) => s.depositTypes);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState<Cursor>({ row: 0, amount: 0 });
  useOutsidePress(true, () => useDepositPickerStore.getState().close(), root);
  useEffect(() => search.current?.focus(), []);
  useEffect(() => useDepositPickerStore.getState().open(page, moon, mode), [page, moon, mode]);

  const rows = useMemo(
    () => (choices === null ? null : depositRows(choices.list, views, mode)),
    [choices, views, mode],
  );
  const sections = rows === null ? [] : depositSections(rows, chip, query);
  const chips = mode === "deposits" ? DEPOSIT_CHIPS : blockerChips(rows ?? []);
  const flat = sections.flatMap((s) => s.rows);
  const at = Math.min(cursor.row, flat.length - 1);
  const rowId = (i: number) => `dp-row-${page.id}-${mode}-${i}`;
  useEffect(() => {
    document.getElementById(rowId(at))?.scrollIntoView?.({ block: "nearest" });
  });

  const add = (row: DepositRow, amount: number) => {
    const picked = row.amounts[amount];
    if (picked !== undefined) void store.add(row, picked);
  };
  const onKey = (e: KeyboardEvent) => {
    const inSearch = e.target === search.current;
    const row = flat[at];
    const move = (to: number) =>
      setCursor({ row: Math.max(0, Math.min(to, flat.length - 1)), amount: 0 });
    const step = (by: number) =>
      row &&
      setCursor({
        row: at,
        amount: Math.max(0, Math.min(cursor.amount + by, row.amounts.length - 1)),
      });
    if (e.key === ESCAPE) store.close();
    else if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === "ArrowRight" && !(inSearch && query !== "")) step(1);
    else if (e.key === "ArrowLeft" && !(inSearch && query !== "")) step(-1);
    else if (e.key === ENTER && inSearch && row !== undefined) add(row, cursor.amount);
    else {
      if (!inSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey) search.current?.focus();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  let index = 0;
  return (
    <div
      className="dp"
      ref={root}
      role="group"
      aria-label={mode === "blockers" ? "Add blockers" : "Add deposits"}
      onKeyDown={onKey}
    >
      <div className="dp-head">
        <input
          ref={search}
          type="search"
          aria-label={mode === "blockers" ? "Search blockers" : "Search deposits"}
          placeholder={
            mode === "blockers" ? "Search name or effect" : "Search name, resource or category"
          }
          value={query}
          onChange={(e) => {
            store.setQuery(e.target.value);
            setCursor({ row: 0, amount: 0 });
          }}
        />
        <button type="button" className="dp-done" onClick={() => store.close()}>
          Done
        </button>
      </div>
      {chips.length > 0 && (
        <div
          className="dp-chips"
          role="group"
          aria-label={mode === "blockers" ? "Blocker filters" : "Deposit categories"}
        >
          {chips.map(({ chip: each, label }) => (
            <button
              key={each}
              type="button"
              className="dp-chip"
              aria-pressed={chip === each}
              onClick={() => {
                store.setChip(each);
                setCursor({ row: 0, amount: 0 });
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {added !== null && (
        <div className="dp-added" role="status">
          ✓ {added}
        </div>
      )}
      <div className="dp-list">
        {rows === null && <div className="dp-empty muted">{READING_CHOICES}</div>}
        {rows !== null && flat.length === 0 && <div className="dp-empty muted">{NONE_MATCH}</div>}
        {sections.map((section) => (
          <div key={section.title}>
            {section.title !== "" && (
              <div className="dp-group">
                {section.title} · {section.rows.length}
              </div>
            )}
            {section.rows.map((row) => {
              const i = index++;
              return (
                <PickerRow
                  key={row.family}
                  row={row}
                  id={rowId(i)}
                  cursor={i === at ? Math.min(cursor.amount, row.amounts.length - 1) : null}
                  onAdd={(amount) => {
                    setCursor({ row: i, amount });
                    add(row, amount);
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A picker's button, and the picker below it while open: `deposits` adds any deposit but a
 * blocker, `blockers` adds a blocker.
 */
export function DepositPicker({
  page,
  moon,
  mode,
}: {
  page: PlanetPage;
  moon: boolean;
  mode: PickerMode;
}) {
  const open = useDepositPickerStore((s) => s.planet === page.id && s.mode === mode);
  const ready = useGameDataStore((s) => s.status === "ready");
  if (open) return <DepositPopover page={page} moon={moon} mode={mode} />;
  const opener = OPENERS[mode];
  return (
    <div className="pl-dep-add">
      <button
        type="button"
        className="edit-field dp-open"
        disabled={!ready}
        title={ready ? opener.title : PICKER_NEEDS_GAME_DATA}
        onClick={() => useDepositPickerStore.getState().open(page, moon, mode)}
      >
        {opener.label}
      </button>
    </div>
  );
}
