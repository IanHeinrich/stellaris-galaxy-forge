import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { PlanetPage } from "../../../generated/PlanetPage";
import {
  MODIFIER_CHIPS,
  modifierPickRows,
  modifierSections,
  parseDays,
  type ModifierPickRow,
} from "../../../lib/details/modifierPicker";
import { terraformCandidateTitle } from "../../../lib/details/terraform";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useModifierPickerStore } from "../../../store/modifierPickerStore";
import { ENTER, ESCAPE } from "../../keys";
import { Icon } from "../../parts";
import { useOutsidePress } from "../../useOutsidePress";

export const MODIFIER_PICKER_NEEDS_GAME_DATA = "Adding a modifier needs the game data";
export const READING_MODIFIERS = "Reading the modifiers…";
export const NO_MODIFIER_MATCHES = "No modifier matches";
const DEFAULT_DAYS = 360;

function PickerRow({
  row,
  id,
  active,
  onAdd,
}: {
  row: ModifierPickRow;
  id: string;
  active: boolean;
  onAdd: () => void;
}) {
  const view = row.choice.view;
  return (
    <div
      id={id}
      className={`dp-row${active ? " active" : ""}`}
      title={row.description ?? undefined}
    >
      <span className="dp-art pl-mod-icon">
        <Icon keys={view.icon === null ? [] : [view.icon]} glyph="◆" />
        {view.icon_frame !== null && <Icon className="pl-mod-frame" keys={[view.icon_frame]} />}
      </span>
      <span className="dp-text">
        <span className="l1">{row.label}</span>
        <span className="l2">
          {row.gives === "" ? <span className="muted">No effect</span> : row.gives}
        </span>
      </span>
      <span className="dp-amounts">
        <button
          type="button"
          className={`dp-amount${active ? " active" : ""}`}
          aria-label={`Add ${row.label}`}
          disabled={row.held}
          title={row.held ? "This planet already has it" : `Add ${row.label}`}
          onClick={onAdd}
        >
          {row.held ? "Has it" : "Add"}
        </button>
      </span>
    </div>
  );
}

/** How long the next add lasts: for ever, or a number of days. */
function Duration() {
  const days = useModifierPickerStore((s) => s.days);
  const [text, setText] = useState(String(days ?? DEFAULT_DAYS));
  const setDays = useModifierPickerStore.getState().setDays;
  return (
    <div className="mp-duration" role="group" aria-label="How long it lasts">
      <label>
        <input
          type="radio"
          name="mp-duration"
          checked={days === null}
          onChange={() => setDays(null)}
        />
        Permanent
      </label>
      <label>
        <input
          type="radio"
          name="mp-duration"
          checked={days !== null}
          onChange={() => setDays(parseDays(text) ?? DEFAULT_DAYS)}
        />
        For
      </label>
      <input
        type="number"
        min={1}
        aria-label="Days"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = parseDays(e.target.value);
          if (parsed !== null) setDays(parsed);
        }}
        onFocus={() => {
          if (days === null) setDays(parseDays(text) ?? DEFAULT_DAYS);
        }}
      />
      days
    </div>
  );
}

/**
 * The open picker: a search, the category chips, how long the next add lasts, a line saying what
 * was added, and one row per modifier. It stays open after an add; Escape, Done or a press outside
 * closes it. Typing goes to the search, the arrows move between rows and Enter adds the row they
 * stand on.
 */
function ModifierPopover({ page }: { page: PlanetPage }) {
  const store = useModifierPickerStore.getState();
  const query = useModifierPickerStore((s) => s.query);
  const chip = useModifierPickerStore((s) => s.chip);
  const added = useModifierPickerStore((s) => s.added);
  const choices = useModifierPickerStore((s) => s.choices);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const candidates = useGameDataStore((s) => s.terraformCandidates);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [cursor, setCursor] = useState(0);
  useOutsidePress(true, () => useModifierPickerStore.getState().close(), root);
  useEffect(() => search.current?.focus(), []);
  useEffect(() => useModifierPickerStore.getState().open(page.id), [page.id]);

  const usual = planetClasses.get(page.class)?.terraform_candidate ?? null;
  const rows = useMemo(
    () =>
      choices === null
        ? null
        : modifierPickRows(choices, page, usual, (m) => terraformCandidateTitle(m, candidates)),
    [choices, page, usual, candidates],
  );
  const sections = rows === null ? [] : modifierSections(rows, chip, query);
  const flat = sections.flatMap((s) => s.rows);
  const at = Math.min(cursor, flat.length - 1);
  const rowId = (i: number) => `mp-row-${page.id}-${i}`;
  useEffect(() => {
    document.getElementById(rowId(at))?.scrollIntoView?.({ block: "nearest" });
  });

  const add = (row: ModifierPickRow) => {
    if (!row.held) void store.add(row);
  };
  const onKey = (e: KeyboardEvent) => {
    const inSearch = e.target === search.current;
    const row = flat[at];
    const move = (to: number) => setCursor(Math.max(0, Math.min(to, flat.length - 1)));
    if (e.key === ESCAPE) store.close();
    else if (e.key === "ArrowDown") move(at + 1);
    else if (e.key === "ArrowUp") move(at - 1);
    else if (e.key === ENTER && inSearch && row !== undefined) add(row);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  let index = 0;
  return (
    <div className="dp" ref={root} role="group" aria-label="Add modifiers" onKeyDown={onKey}>
      <div className="dp-head">
        <input
          ref={search}
          type="search"
          aria-label="Search modifiers"
          placeholder="Search name or effect"
          value={query}
          onChange={(e) => {
            store.setQuery(e.target.value);
            setCursor(0);
          }}
        />
        <button type="button" className="dp-done" onClick={() => store.close()}>
          Done
        </button>
      </div>
      <div className="dp-chips" role="group" aria-label="Modifier categories">
        {MODIFIER_CHIPS.map(({ chip: each, label }) => (
          <button
            key={each}
            type="button"
            className="dp-chip"
            aria-pressed={chip === each}
            onClick={() => {
              store.setChip(each);
              setCursor(0);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <Duration />
      {added !== null && (
        <div className="dp-added" role="status">
          ✓ {added}
        </div>
      )}
      <div className="dp-list">
        {rows === null && <div className="dp-empty muted">{READING_MODIFIERS}</div>}
        {rows !== null && flat.length === 0 && (
          <div className="dp-empty muted">{NO_MODIFIER_MATCHES}</div>
        )}
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
                  key={row.key}
                  row={row}
                  id={rowId(i)}
                  active={i === at}
                  onAdd={() => {
                    setCursor(i);
                    add(row);
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

/** The picker's button, and the picker below it while open. */
export function ModifierPicker({ page }: { page: PlanetPage }) {
  const open = useModifierPickerStore((s) => s.planet === page.id);
  const ready = useGameDataStore((s) => s.status === "ready");
  if (open) return <ModifierPopover page={page} />;
  return (
    <div className="pl-dep-add">
      <button
        type="button"
        className="edit-field dp-open"
        disabled={!ready}
        title={
          ready
            ? "Add a modifier, for good or for some days. A planet feature adds as a feature."
            : MODIFIER_PICKER_NEEDS_GAME_DATA
        }
        onClick={() => useModifierPickerStore.getState().open(page.id)}
      >
        + Add modifier…
      </button>
    </div>
  );
}
