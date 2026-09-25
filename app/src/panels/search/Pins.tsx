import type { MouseEvent, ReactNode } from "react";
import { counted } from "../../lib/text";
import { toCss } from "../../lib/visual/ownerColors";
import { pinnedEntry, shownLabel, unpinLabel, type WatchEntry } from "../../lib/watchlist";
import { useWatchlistStore } from "../../store/watchlistStore";
import { PinGlyph } from "./icons";

export const PINNED_GROUP = "Pinned · ringed on the map";

/** Keeps the press from taking focus from the field, or reaching the row it sits on. */
function keepFocus(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

function Dot({ colour }: { colour: number }) {
  return <span className="palette-dot" style={{ background: toCss(colour) }} />;
}

function RowButton({
  label,
  pressed,
  onPress,
  children,
}: {
  label: string;
  pressed?: boolean;
  onPress(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="palette-row-button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      tabIndex={-1}
      onMouseDown={keepFocus}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

/**
 * The empty palette's first group: each pinned search with its colour, what it locates in the
 * open document, and its eye and unpin buttons. `active` is the highlighted row, or -1.
 */
export function PinnedRows({
  active,
  onHover,
  onRun,
}: {
  active: number;
  onHover(index: number): void;
  onRun(entry: WatchEntry): void;
}) {
  const entries = useWatchlistStore((s) => s.entries);
  const results = useWatchlistStore((s) => s.results);
  const toggleShown = useWatchlistStore((s) => s.toggleShown);
  const unpin = useWatchlistStore((s) => s.unpin);
  return (
    <>
      {entries.map((entry, i) => {
        const found = results.get(entry.query);
        const classes = ["palette-row", "pinned"];
        if (i === active) classes.push("active");
        if (!entry.shown) classes.push("off");
        return (
          <li key={entry.query}>
            {i === 0 && <div className="palette-group">{PINNED_GROUP}</div>}
            <div
              role="option"
              aria-selected={i === active}
              className={classes.join(" ")}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onRun(entry);
              }}
            >
              <Dot colour={entry.colour} />
              <span className="palette-name">{entry.query}</span>
              <span className="palette-sub">
                {found === undefined ? "" : counted(found.length, "system")}
              </span>
              <RowButton
                label={shownLabel(entry)}
                pressed={entry.shown}
                onPress={() => toggleShown(entry.query)}
              >
                {entry.shown ? "◉" : "○"}
              </RowButton>
              <RowButton label={unpinLabel(entry.query)} onPress={() => unpin(entry.query)}>
                ×
              </RowButton>
            </div>
          </li>
        );
      })}
    </>
  );
}

const PIN_TITLE = "Pin this search: its systems stay ringed on every save";
const UNPIN_TITLE = "Unpin this search";

/** The button inside the field that pins what it holds, or unpins it. */
export function PinToggle({ text }: { text: string }) {
  const entry = useWatchlistStore((s) => pinnedEntry(s.entries, text));
  const togglePin = useWatchlistStore((s) => s.togglePin);
  return (
    <button
      type="button"
      className={entry === undefined ? "pin-toggle" : "pin-toggle on"}
      title={entry === undefined ? PIN_TITLE : UNPIN_TITLE}
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => togglePin(text)}
    >
      {entry === undefined ? <PinGlyph /> : <Dot colour={entry.colour} />}
      {entry === undefined ? "Pin" : "Pinned"}
    </button>
  );
}
