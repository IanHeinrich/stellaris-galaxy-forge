import { useState } from "react";
import { toCss } from "../../lib/visual/ownerColors";
import { shownLabel, unpinLabel, type WatchEntry } from "../../lib/watchlist";
import { useEditorStore } from "../../store/editorStore";
import { systemNameOf, useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useWatchlistStore } from "../../store/watchlistStore";
import { PALETTE_KEYS } from "../paletteKeys";
import { useCollapse, type Collapse } from "./collapse";
import { Action, Eye, Group, Row } from "./rows";
import { counted } from "../../lib/text";

/** What the tab says before anything is pinned. */
export const WATCHLIST_EMPTY =
  'No pinned searches yet. Pin a search such as "salvager", "alpha refuge" or "gaia" and its ' +
  "systems are ringed in their own colour on every save you open. The Pin button in the " +
  `search field (or ${PALETTE_KEYS.pin.label}) pins what it holds.`;

interface WatchRow {
  id: number;
  name: string;
}

function WatchLine({ row }: { row: WatchRow }) {
  const setSelection = useEditorStore((s) => s.setSelection);
  const jumpTo = useEditorStore((s) => s.jumpTo);
  return (
    <Row
      name={row.name}
      title={`Go to ${row.name}`}
      onName={() => void jumpTo(row.id)}
      actions={
        <Action
          glyph="⊙"
          label={`Select ${row.name}`}
          onClick={() => void setSelection([row.id], "replace")}
        />
      }
    />
  );
}

function WatchSection({
  entry,
  rows,
  collapse,
}: {
  entry: WatchEntry;
  rows: WatchRow[];
  collapse: Collapse;
}) {
  const toggleShown = useWatchlistStore((s) => s.toggleShown);
  const unpin = useWatchlistStore((s) => s.unpin);
  const key = entry.query.toLowerCase();
  return (
    <Group
      label={entry.query}
      title={`The systems a search for "${entry.query}" finds`}
      count={rows.length}
      open={!collapse.collapsed(key)}
      lead={
        <>
          <Eye
            on={entry.shown}
            label={shownLabel(entry)}
            onToggle={() => toggleShown(entry.query)}
          />
          <span className="browser-swatch" style={{ background: toCss(entry.colour) }} />
        </>
      }
      actions={
        <Action glyph="×" label={unpinLabel(entry.query)} onClick={() => unpin(entry.query)} />
      }
      onToggle={() => collapse.toggle(key)}
    >
      {rows.map((row) => (
        <WatchLine key={row.id} row={row} />
      ))}
    </Group>
  );
}

function PinField() {
  const pin = useWatchlistStore((s) => s.pin);
  const [text, setText] = useState("");
  return (
    <input
      type="search"
      className="filter-input watch-add"
      placeholder="Pin a search…"
      aria-label="Pin a search"
      autoComplete="off"
      value={text}
      onChange={(e) => setText(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        pin(text);
        setText("");
      }}
    />
  );
}

/** Searches kept across saves, each ringing what it finds on the map in its own colour. */
export function Watchlist() {
  const entries = useWatchlistStore((s) => s.entries);
  const results = useWatchlistStore((s) => s.results);
  const systems = useGalaxyStore((s) => s.systems);
  const names = useGameDataStore((s) => s.names);
  const collapse = useCollapse("watchlist");
  const rowsOf = (entry: WatchEntry): WatchRow[] =>
    (results.get(entry.query) ?? [])
      .map((id) => ({ id, name: systemNameOf(systems, names, id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  const clear = useWatchlistStore((s) => s.clear);
  return (
    <div className="browser watchlist">
      <PinField />
      {entries.length > 0 && (
        <div className="watch-bar muted">
          <span>{counted(entries.length, "search", "searches")} pinned</span>
          <button type="button" className="link" onClick={() => clear()}>
            Clear all
          </button>
        </div>
      )}
      {entries.length === 0 ? (
        <div className="muted">{WATCHLIST_EMPTY}</div>
      ) : (
        entries.map((entry) => (
          <WatchSection key={entry.query} entry={entry} rows={rowsOf(entry)} collapse={collapse} />
        ))
      )}
    </div>
  );
}
