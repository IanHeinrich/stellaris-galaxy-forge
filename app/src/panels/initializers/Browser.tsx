import { useMemo } from "react";
import { currentKeys } from "../../lib/initializer/initializerBrowser";
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
import { BrowseDialog } from "../browseDialog/BrowseDialog";
import { HelpLink } from "../HelpLink";
import "./browser.css";
import { Detail } from "./Detail";
import { Row } from "./Row";

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

  const tree = useBrowserGroups();
  const groups = useMemo(
    () => tree.map((g) => ({ id: g.id, label: g.label, count: g.entries.length })),
    [tree],
  );
  const entries = useVisibleEntries(tree);
  const byKey = useMemo(() => new Map(entries.map((entry) => [entry.name, entry])), [entries]);
  const keys = useMemo(() => {
    const listed = entries.map((entry) => entry.name);
    return group === null ? [RANDOM_KEY, ...listed] : listed;
  }, [entries, group]);

  const uses = useMemo(
    () => new Map(initializerCounts(systems.values()).map((c) => [c.key, c.count])),
    [systems],
  );
  const current = useMemo(() => currentKeys(targets, systems), [targets, systems]);
  const entry = useHighlightedEntry();

  const pin = (key: string) => {
    if (key !== RANDOM_KEY) togglePin(key);
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
    <BrowseDialog
      label="Choose an initializer"
      className="ib"
      onClose={close}
      searchLabel="Search initializers"
      query={query}
      onQuery={setQuery}
      hint={
        <>
          {PREFIX_HINT} <HelpLink place="initializers" topic="Initializers" />
        </>
      }
      tree={{
        label: "Initializer groups",
        groups,
        total: initializers?.length ?? 0,
        selected: group,
        onSelect: setGroup,
      }}
      keys={keys}
      rows={{
        label: "Initializers",
        idPrefix: "ib-row-",
        rowClassName: "ib-row",
        renderRow: (key) => (
          <Row
            entry={byKey.get(key) ?? null}
            used={uses.get(key === RANDOM_KEY ? "" : key) ?? 0}
            current={current.has(key)}
          />
        ),
      }}
      waiting={initializers === null ? "Reading the initializers…" : undefined}
      highlighted={highlighted}
      onHighlight={highlight}
      onChoose={(keepOpen) => void assign(keepOpen)}
      onPin={pin}
      detail={<Detail entry={entry} uses={entry === null ? 0 : (uses.get(entry.name) ?? 0)} />}
      foot={
        <>
          <span className="ib-summary">{summary}</span>
          <span className="muted ib-hints">
            Up/Down move · Enter {verb} · Shift+Enter {verb} and keep open · Ctrl+D pin · Esc close
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
              if (highlighted !== null) pin(highlighted);
            }}
          >
            {pinnedNow ? "★ Unpin" : "☆ Pin"}
          </button>
          <button
            type="button"
            className="ib-assign primary"
            disabled={highlighted === null}
            onClick={() => void assign()}
          >
            {creating ? "Create" : "Assign"}
          </button>
        </>
      }
    />
  );
}

/** The initializer browser: a large overlay for choosing what a scenario's systems spawn. */
export function InitializerBrowser() {
  const open = useInitializerBrowserStore((s) => s.open);
  return open ? <Browsing /> : null;
}
