import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api/errors";
import type { SearchHit } from "../../generated/SearchHit";
import { planetClassLabel } from "../../lib/details/labels";
import { displayName, displayTemplate, templateName } from "../../lib/names";
import { sameQuery } from "../../lib/watchlist";
import { useEditorStore } from "../../store/editorStore";
import type { DocumentKind } from "../../generated/DocumentKind";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { systemNameOf, useGalaxyStore, type Systems } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useWatchlistStore } from "../../store/watchlistStore";
import { useOutsidePress } from "../useOutsidePress";
import { RowIcon, type RowKind } from "./icons";
import { GROUP_LABELS, KIND_ORDER, nextPrefix, parseQuery, prefixLabel, type Query } from "./query";
import "./search.css";

export const SEARCH_INPUT_ID = "system-search";
const DEBOUNCE_MS = 120;
const LIMIT = 20;

/** One line of the palette: a hit, under the heading of its group. */
interface Row {
  key: string;
  group: string;
  icon: RowKind;
  /** Resolved at render so a row picks up localisation as it arrives. */
  name(): string;
  subline: string;
  /** Jump to the hit, or add it to the selection instead. */
  /** `add` is Shift+Enter: take the row without closing the palette. */
  activate(add: boolean): void;
}

/** The hits of one query; the text they were found for goes stale as soon as the field changes. */
interface Hits {
  text: string;
  items: SearchHit[];
}

/** Why the search for `text` failed, so a backend failure is not read as no results. */
interface Failure {
  text: string;
  message: string;
}

/** The fields the core fills in, joined the way every other row in the app joins them. */
function parts(fields: Array<string | null>): string {
  return fields.filter((field): field is string => field !== null && field !== "").join(" · ");
}

function systemCount(n: number | null): string | null {
  return n === null ? null : `${n} ${n === 1 ? "system" : "systems"}`;
}

/** The galaxy and the localisation a row's subline is read through, as the panel has them. */
interface Lookups {
  systems: Systems;
  names: ReadonlyMap<string, string>;
}

function systemName(look: Lookups, id: number | null): string | null {
  return id === null ? null : systemNameOf(look.systems, look.names, id);
}

function classLabel(look: Lookups, key: string | null): string | null {
  if (key === null) return null;
  return look.names.get(key) ?? planetClassLabel(key);
}

/** What a system found by its contents matched on: a planet class, or a key or label. */
function matchedLabel(look: Lookups, matched: string | null): string | null {
  if (matched === null) return null;
  return matched.startsWith("pc_") ? classLabel(look, matched) : displayName(matched);
}

/** What each kind of hit says under its name. */
function subline(hit: SearchHit, look: Lookups): string {
  const owner = hit.owner === null ? null : displayTemplate(hit.owner);
  switch (hit.kind) {
    case "system":
      return parts([owner ?? "unclaimed", matchedLabel(look, hit.matched_on)]);
    case "country":
      return parts([hit.country_type, systemCount(hit.system_count)]);
    case "planet":
      return parts([classLabel(look, hit.planet_class), systemName(look, hit.system_id)]);
    case "fleet":
      return parts([owner, systemName(look, hit.system_id)]);
    case "nebula":
      return systemCount(hit.system_count) ?? "";
  }
}

function hitRow(hit: SearchHit, group: string, look: Lookups): Row {
  const editor = useEditorStore.getState();
  return {
    key: `${hit.kind}.${hit.id}`,
    group,
    icon: hit.kind,
    name: () => templateName(hit),
    subline: subline(hit, look),
    activate: (add) => {
      editor.noteSearchHit(hit);
      if (hit.system_id === null) {
        if (hit.position) editor.panTo(hit.position[0], hit.position[1]);
      } else if (add) {
        void editor.setSelection([hit.system_id], "add");
        if (hit.position) editor.panTo(hit.position[0], hit.position[1]);
      } else {
        void editor.jumpTo(hit.system_id);
      }
    },
  };
}

/** The palette's lines: the hits of the wanted kind, or the recent hits. */
function buildRows({ kind, text }: Query, hits: Hits, recent: SearchHit[], look: Lookups): Row[] {
  if (text === "") {
    return recent
      .filter((hit) => hit.system_id === null || look.systems.has(hit.system_id))
      .map((hit) => hitRow(hit, "Recent", look));
  }
  if (hits.text !== text) return [];
  return hits.items
    .filter((hit) => kind === null || hit.kind === kind)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
    .map((hit) => hitRow(hit, GROUP_LABELS[hit.kind], look));
}

/** Find anything the document names; nothing to search without one. */
export function Search() {
  const ready = useFileSessionStore((s) => s.status === "ready");
  return ready ? <SearchPanel /> : null;
}

function SearchGlyph() {
  return (
    <svg
      className="search-glyph"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.4 10.4 14 14" />
    </svg>
  );
}

/** What the field can find, in the words of each document kind. */
const PLACEHOLDER: Record<DocumentKind, string> = {
  save: "Search systems, empires, planets, fleets…",
  scenario: "Search systems and nebulae…",
};

function SearchPanel() {
  const kind = useFileSessionStore((s) => s.kind);
  const recent = useEditorStore((s) => s.recentHits);
  const ringed = useEditorStore((s) => s.searchRings.length);
  const systems = useGalaxyStore((s) => s.systems);
  const names = useGameDataStore((s) => s.names);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hits>({ text: "", items: [] });
  const [failed, setFailed] = useState<Failure | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(0);

  const parsed = parseQuery(query);
  const { text } = parsed;
  const pinned = useWatchlistStore(
    (s) => text !== "" && s.entries.some((entry) => sameQuery(entry.query, text)),
  );

  useOutsidePress(open, () => setOpen(false), box);

  useEffect(() => {
    const seq = ++latest.current;
    if (text === "" || !open) {
      useEditorStore.getState().clearSearch();
      return;
    }
    const timer = setTimeout(() => {
      useEditorStore
        .getState()
        .runSearch(text, LIMIT)
        .then((result) => {
          if (result === null || seq !== latest.current) return;
          setHits({ text, items: result.hits });
          setFailed(null);
          setActive(0);
          void useGameDataStore
            .getState()
            .resolveNames(
              result.hits.flatMap((h) => (h.owner === null ? [h.name] : [h.name, h.owner])),
            );
        })
        .catch((e: unknown) => {
          if (seq !== latest.current) return;
          setHits({ text, items: [] });
          setFailed({ text, message: errorMessage(e) });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, open]);

  const rows = buildRows(parsed, hits, recent, { systems, names });
  const failure = failed !== null && failed.text === text ? failed.message : null;

  const shown = open && (rows.length > 0 || failure !== null);
  const current = rows[Math.min(active, rows.length - 1)];

  const close = () => {
    useEditorStore.getState().clearSearch();
    setQuery("");
    setHits({ text: "", items: [] });
    setOpen(false);
    input.current?.blur();
  };

  const take = (row: Row | undefined, add: boolean) => {
    if (!row) return;
    useEditorStore.getState().clearSearch();
    row.activate(add);
    if (!add) close();
  };

  const wide = open || query !== "";
  const placeholder = kind === null ? "Search…" : PLACEHOLDER[kind];

  return (
    <div className={wide ? "search wide" : "search"} ref={box}>
      <SearchGlyph />
      {!wide && (
        <kbd className="search-key" aria-hidden="true">
          F
        </kbd>
      )}
      <input
        id={SEARCH_INPUT_ID}
        ref={input}
        type="search"
        className="palette-field"
        placeholder={wide ? placeholder : ""}
        aria-label="Search"
        title={wide ? undefined : "Search (F)"}
        value={query}
        autoComplete="off"
        role="combobox"
        aria-expanded={shown}
        aria-controls="search-palette"
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!box.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
        onChange={(e) => {
          setQuery(e.currentTarget.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            useWatchlistStore.getState().pin(text);
          } else if (e.key === "Enter") {
            e.preventDefault();
            take(current, e.shiftKey);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, rows.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Tab" && !e.shiftKey && query !== "") {
            e.preventDefault();
            setQuery(nextPrefix(query));
            setActive(0);
          } else if (e.key === "Escape") {
            close();
          }
        }}
      />
      {shown && (
        <div className="palette" id="search-palette">
          {failure !== null && (
            <div className="palette-error warn" role="alert">
              Search failed · {failure}
            </div>
          )}
          <ul className="palette-rows" role="listbox" aria-label={prefixLabel(parsed)}>
            {rows.map((row, i) => (
              <li key={row.key}>
                {row.group !== rows[i - 1]?.group && (
                  <div className="palette-group">{row.group}</div>
                )}
                <div
                  role="option"
                  aria-selected={row === current}
                  className={row === current ? "palette-row active" : "palette-row"}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    take(row, e.shiftKey);
                  }}
                >
                  <RowIcon kind={row.icon} />
                  <span className="palette-name">{row.name()}</span>
                  <span className="palette-sub">{row.subline}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="palette-foot">
            <span>Up/Down move</span>
            <span>Enter go</span>
            <span>Shift+Enter add to selection</span>
            <span>{pinned ? "Pinned to the watchlist" : "Ctrl+Enter pin"}</span>
            <span>Tab {prefixLabel(parsed).toLowerCase()}</span>
            <span>Esc close</span>
            {ringed > 0 && <span>{systemCount(ringed)} ringed</span>}
          </div>
        </div>
      )}
    </div>
  );
}
