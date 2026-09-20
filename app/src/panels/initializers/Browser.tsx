import { useEffect, useMemo, useRef } from "react";
import { isEditableTarget } from "../../lib/keys";
import { initializerCounts } from "../../lib/initializer/initializerLabels";
import { useSystemNames } from "../../store/browserRows";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import {
  RANDOM_KEY,
  useBrowserGroups,
  useHighlightedEntry,
  useInitializerBrowserStore,
  useVisibleEntries,
} from "../../store/initializerBrowserStore";
import { ENTER } from "../keys";
import { Dialog } from "../overlays/Dialog";
import "./browser.css";
import { Detail } from "./Detail";
import { GroupTree } from "./GroupTree";
import { List } from "./List";
import { currentKeys } from "./rows";

/** How many rows are drawn before the list asks for a narrower search. */
const MAX_ROWS = 300;

/** How far PgUp and PgDn move. */
const PAGE = 10;

const PREFIX_HINT = "usage: · mod: · class: · flag: · planets:>5";

function Browsing() {
  const close = useInitializerBrowserStore((s) => s.close);
  const query = useInitializerBrowserStore((s) => s.query);
  const setQuery = useInitializerBrowserStore((s) => s.setQuery);
  const group = useInitializerBrowserStore((s) => s.group);
  const setGroup = useInitializerBrowserStore((s) => s.setGroup);
  const highlighted = useInitializerBrowserStore((s) => s.highlighted);
  const highlight = useInitializerBrowserStore((s) => s.highlight);
  const togglePin = useInitializerBrowserStore((s) => s.togglePin);
  const assign = useInitializerBrowserStore((s) => s.assign);
  const targets = useInitializerBrowserStore((s) => s.targets);
  const mode = useInitializerBrowserStore((s) => s.mode);
  const pending = useInitializerBrowserStore((s) => s.pending);
  const defaultKey = useInitializerBrowserStore((s) => s.defaultKey);
  const setDefault = useInitializerBrowserStore((s) => s.setDefault);
  const pinnedKeys = useInitializerBrowserStore((s) => s.pinned);
  const pinnedNow = highlighted !== null && pinnedKeys.includes(highlighted);
  const isDefault = highlighted === RANDOM_KEY ? defaultKey === null : highlighted === defaultKey;
  const clearsDefault = highlighted === RANDOM_KEY || isDefault;

  const initializers = useGameDataStore((s) => s.initializers);
  const systems = useGalaxyStore((s) => s.systems);
  const targetNames = useSystemNames(targets);

  const search = useRef<HTMLInputElement>(null);
  const first = useRef(true);

  const tree = useBrowserGroups();
  const entries = useVisibleEntries(tree);
  const byKey = useMemo(() => new Map(entries.map((entry) => [entry.name, entry])), [entries]);
  const keys = useMemo(() => {
    const listed = entries.map((entry) => entry.name);
    return (group === null ? [RANDOM_KEY, ...listed] : listed).slice(0, MAX_ROWS);
  }, [entries, group]);
  const more = (group === null ? entries.length + 1 : entries.length) - keys.length;

  const uses = useMemo(
    () => new Map(initializerCounts(systems.values()).map((c) => [c.key, c.count])),
    [systems],
  );
  const current = useMemo(() => currentKeys(targets, systems), [targets, systems]);
  const entry = useHighlightedEntry();

  useEffect(() => {
    if (keys.length === 0) return;
    if (first.current) {
      first.current = false;
      const shared = current.size === 1 ? [...current][0] : null;
      if (shared !== null && keys.includes(shared)) {
        highlight(shared);
        return;
      }
    }
    if (highlighted === null || !keys.includes(highlighted)) highlight(keys[0]);
  }, [keys, current, highlighted, highlight]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const fromSearch = e.target === search.current;
    if (!fromSearch && isEditableTarget(e.target)) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() !== "d") return;
      e.preventDefault();
      if (highlighted !== null && highlighted !== RANDOM_KEY) togglePin(highlighted);
      return;
    }
    if (e.key === ENTER) {
      e.preventDefault();
      void assign(e.shiftKey);
      return;
    }
    const last = keys.length - 1;
    const to =
      e.key === "ArrowDown"
        ? keys.indexOf(highlighted ?? "") + 1
        : e.key === "ArrowUp"
          ? keys.indexOf(highlighted ?? "") - 1
          : e.key === "PageDown"
            ? keys.indexOf(highlighted ?? "") + PAGE
            : e.key === "PageUp"
              ? keys.indexOf(highlighted ?? "") - PAGE
              : e.key === "Home" && !fromSearch
                ? 0
                : e.key === "End" && !fromSearch
                  ? last
                  : null;
    if (to === null || last < 0) return;
    e.preventDefault();
    highlight(keys[Math.min(Math.max(to, 0), last)]);
  };

  const creating = mode === "create";
  const verb = creating ? "create" : "assign";
  const at = pending === null ? "" : `${pending.x.toFixed(2)}, ${pending.y.toFixed(2)}`;
  const summary = creating
    ? `New system at ${at}`
    : targets.length === 1
      ? `Assign to ${targetNames[0]}`
      : `Assign to ${targets.length} systems`;

  return (
    <Dialog
      className="ib"
      scrim="ib-scrim"
      label="Choose an initializer"
      onClose={close}
      onDismiss={close}
    >
      <div className="ib-inner" onKeyDown={onKeyDown}>
        <div className="ib-head">
          <button
            type="button"
            className="link ib-close"
            onClick={close}
            title="Close (Esc)"
            aria-label="Close"
          >
            ×
          </button>
          <input
            ref={search}
            type="search"
            className="ib-search"
            aria-label="Search initializers"
            placeholder="Search initializers"
            autoComplete="off"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          <div className="muted ib-hint">{PREFIX_HINT}</div>
        </div>
        <div className="ib-cols">
          <GroupTree
            groups={tree}
            total={initializers?.length ?? 0}
            selected={group}
            onSelect={setGroup}
          />
          {initializers === null ? (
            <div className="muted ib-empty">Reading the initializers…</div>
          ) : (
            <List
              keys={keys}
              byKey={byKey}
              uses={uses}
              current={current}
              more={more}
              onAssign={() => void assign()}
            />
          )}
          <Detail entry={entry} uses={entry === null ? 0 : (uses.get(entry.name) ?? 0)} />
        </div>
        <div className="ib-foot">
          <span className="ib-summary">{summary}</span>
          <span className="muted ib-hints">
            ↑↓ move · ↵ {verb} · ⇧↵ {verb} and keep open · Ctrl+D pin · Esc close
          </span>
          <button
            type="button"
            className={`ib-default-button${isDefault ? " on" : ""}`}
            disabled={highlighted === null || (clearsDefault && defaultKey === null)}
            title="The initializer a new system spawns from without being asked"
            onClick={() => setDefault(clearsDefault ? null : highlighted)}
          >
            {clearsDefault ? "Clear default" : "Set as default"}
          </button>
          <button
            type="button"
            className={`ib-pin-button${pinnedNow ? " on" : ""}`}
            disabled={highlighted === null || highlighted === RANDOM_KEY}
            title="Ctrl+D"
            onClick={() => {
              if (highlighted !== null && highlighted !== RANDOM_KEY) togglePin(highlighted);
            }}
          >
            {pinnedNow ? "★ Unpin" : "☆ Pin"}
          </button>
          <button
            type="button"
            className="ib-assign"
            disabled={highlighted === null}
            onClick={() => void assign()}
          >
            {creating ? "Create" : "Assign"}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

/** The initializer browser: a large overlay for choosing what a scenario's systems spawn. */
export function InitializerBrowser() {
  const open = useInitializerBrowserStore((s) => s.open);
  return open ? <Browsing /> : null;
}
