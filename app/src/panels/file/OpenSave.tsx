import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { openRoute } from "./openRoute";
import { useGameDataStore } from "../../store/gameDataStore";
import { useLayoutStore } from "../../store/layoutStore";
import {
  OPEN_TABS,
  detailsSave,
  footerOpens,
  navigableRows,
  openSections,
  openTabs,
  pressRow,
  selectedRow,
  steppedKey,
  type CampaignRow,
  type FooterOpen,
  type OpenLists,
  type RecentRow,
  type Row,
  type SaveRow,
  type ScenarioRow,
  type Section,
  type Tab,
} from "../../lib/openRows";
import { useOpenScreenStore } from "../../store/openScreenStore";
import { useRecentsStore } from "../../store/recentsStore";
import { Twisty } from "../Twisty";
import { Dialog } from "../overlays/Dialog";
import { OpenAsScenarioDialog } from "./OpenAsScenarioDialog";
import { CLOUD_TITLE, EmpireMark, IRONMAN_TITLE, OpenDetails } from "./OpenDetails";
import { formatSize, formatWhen, phaseLabel } from "./launchData";
import "./open.css";

export { CLOUD_TITLE } from "./OpenDetails";

/** How long the selection rests on a save before its galaxy settings are read. */
const DETAILS_DELAY_MS = 150;

function CloudFlag({ cloud }: { cloud: boolean }) {
  if (!cloud) return null;
  return (
    <span className="flag" title={CLOUD_TITLE}>
      ☁
    </span>
  );
}

function RecentBody({ row, onForget }: { row: RecentRow; onForget: () => void }) {
  return (
    <>
      <span className="open-main">
        <span className={row.missing ? "open-title gone" : "open-title"}>
          <span className="flag kind">{row.doc.kind === "save" ? "SAVE" : "SCENARIO"}</span>
          {row.doc.title}
        </span>
        <span className="open-sub">{row.doc.subtitle || row.doc.path}</span>
      </span>
      <span className="open-side">
        {row.missing ? (
          <span className="warn">not found</span>
        ) : (
          formatWhen(row.doc.openedAt / 1000)
        )}
      </span>
      {row.missing && (
        <button
          type="button"
          className="ghost"
          tabIndex={-1}
          title="Remove it from the list"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onForget();
          }}
        >
          forget
        </button>
      )}
    </>
  );
}

function CampaignBody({ row }: { row: CampaignRow }) {
  return (
    <>
      <span className="open-main">
        <span className="open-title">
          <Twisty open={row.expanded} />
          <EmpireMark meta={row.campaign.meta} size="row" />
          {row.empire}
          <CloudFlag cloud={row.campaign.cloud} />
        </span>
        <span className="open-sub">
          {row.subtitle}
          {row.error && <span className="warn"> · {row.error}</span>}
        </span>
      </span>
      <span className="open-side">
        {row.loading ? "reading…" : row.count}
        <span>{formatWhen(row.campaign.newest)}</span>
      </span>
    </>
  );
}

function SaveBody({ row }: { row: SaveRow }) {
  return (
    <>
      <span className="open-main">
        <span className="open-title">
          <span className="open-date">{row.title}</span>
          {row.autosave && <span className="flag">autosave</span>}
          <CloudFlag cloud={row.file.cloud} />
          {row.file.meta?.ironman && (
            <span className="flag" title={IRONMAN_TITLE}>
              ⚿
            </span>
          )}
        </span>
      </span>
      <span className="open-side">{formatWhen(row.file.modified)}</span>
    </>
  );
}

function ScenarioBody({ row }: { row: ScenarioRow }) {
  const { listing } = row;
  return (
    <>
      <span className="open-main">
        <span className="open-title">
          {listing.name}
          {!listing.enabled && listing.source === "mod" && (
            <span className="flag" title="The playset does not carry this mod">
              not in playset
            </span>
          )}
        </span>
        <span className="open-sub">
          {row.subtitle}
          {listing.shadowed_by && (
            <span className="warn"> · overridden by {listing.shadowed_by}</span>
          )}
          {listing.error && <span className="warn"> · {listing.error}</span>}
        </span>
      </span>
      <span className="open-side">
        {formatSize(listing.size)}
        <span>{formatWhen(listing.modified)}</span>
      </span>
    </>
  );
}

export function RowBody({ row, onForget }: { row: Row; onForget: (path: string) => void }) {
  switch (row.kind) {
    case "recent":
      return <RecentBody row={row} onForget={() => onForget(row.doc.path)} />;
    case "campaign":
      return <CampaignBody row={row} />;
    case "save":
      return <SaveBody row={row} />;
    case "scenario":
      return <ScenarioBody row={row} />;
  }
}

/** The path a row opens, for the busy state and any error it reports. */
function rowPath(row: Row): string | null {
  switch (row.kind) {
    case "recent":
      return row.doc.path;
    case "save":
      return row.file.path;
    case "scenario":
      return row.listing.path;
    default:
      return null;
  }
}

function rowTitle(row: Row): string | undefined {
  if (row.kind === "scenario" && row.listing.error) return row.listing.error;
  return rowPath(row) ?? undefined;
}

/** The line the welcome screen carries whenever game data is not loaded. */
function GameDataLine() {
  const status = useGameDataStore((s) => s.status);
  const autoLoad = useGameDataStore((s) => s.autoLoad);
  const progress = useGameDataStore((s) => s.progress);
  const error = useGameDataStore((s) => s.error);
  const setAutoLoad = useGameDataStore((s) => s.setAutoLoad);
  const load = useGameDataStore((s) => s.load);

  if (status === "loading") {
    return <div className="welcome-gamedata muted">Loading game data · {phaseLabel(progress)}</div>;
  }

  const atStart = (on: boolean) => {
    setAutoLoad(on ? "on" : "off");
    if (on) void load();
  };

  return (
    <div className="welcome-gamedata muted">
      {status === "error" ? (
        <span className="warn" title={error ?? undefined}>
          Game data unavailable
        </span>
      ) : (
        <span>Game data is off</span>
      )}
      <label>
        <input
          type="checkbox"
          checked={autoLoad === "on"}
          onChange={(e) => atStart(e.currentTarget.checked)}
        />
        <span>Load at start</span>
      </label>
      <button type="button" className="link" onClick={() => void load()}>
        Load now
      </button>
    </div>
  );
}

const PANEL_ID = "open-panel";

function tabId(tab: Tab["id"]): string {
  return `open-tab-${tab}`;
}

/** The tab an arrow, Home or End press on the tab at `at` moves to, wrapping round. */
function tabStep(key: string, at: number, count: number): number | null {
  if (key === "ArrowDown") return (at + 1) % count;
  if (key === "ArrowUp") return (at - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

function TabRail({ tabs, onPick }: { tabs: Tab[]; onPick: (tab: Tab["id"]) => void }) {
  const chosen = useOpenScreenStore((s) => s.tab);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent, at: number) => {
    const next = tabStep(e.key, at, tabs.length);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    onPick(tabs[next].id);
    buttons.current[next]?.focus();
  };
  return (
    <div className="open-rail" role="tablist" aria-label="Show" aria-orientation="vertical">
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          id={tabId(tab.id)}
          type="button"
          role="tab"
          aria-selected={tab.id === chosen}
          aria-controls={PANEL_ID}
          tabIndex={tab.id === chosen ? 0 : -1}
          className="open-rail-item"
          title={`Ctrl+${i + 1}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(tab.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          <span>{tab.label}</span>
          <span className="open-rail-count">{tab.count}</span>
        </button>
      ))}
    </div>
  );
}

/** Reads the galaxy settings of the save the selection rests on, once it has rested a moment. */
function useDetailsFor(row: Row | undefined, lists: OpenLists): void {
  const save = detailsSave(row, lists);
  const path = save?.meta ? save.path : null;
  const modified = save?.modified ?? 0;
  useEffect(() => {
    if (path === null) return;
    const timer = setTimeout(() => {
      void useOpenScreenStore.getState().loadDetails(path, modified);
    }, DETAILS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [path, modified]);
}

/** Everything on this machine worth opening: inline while nothing is open, a dialog over the map. */
export function OpenSave({ modal = false }: { modal?: boolean }) {
  const token = useFileSessionStore((s) => s.lastSave ?? s.path);
  const pickAndOpen = useFileSessionStore((s) => s.pickAndOpen);
  const requestOpen = useFileSessionStore((s) => s.requestOpen);
  const gameData = useGameDataStore((s) => s.status);
  const hide = useLayoutStore((s) => s.hideOpenDialog);
  const showScenarioDialog = useLayoutStore((s) => s.showScenarioDialog);
  const recents = useRecentsStore((s) => s.recents);
  const screen = useOpenScreenStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [scenarioFor, setScenarioFor] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const firstPress = useRef<string | null>(null);
  const focusWithin = useRef(false);

  useEffect(() => {
    void useOpenScreenStore.getState().load(token);
  }, [token]);

  useEffect(() => {
    field.current?.focus();
  }, []);

  useEffect(() => {
    if (focusWithin.current && document.activeElement === document.body) field.current?.focus();
  });

  const sections = openSections(screen, recents);
  const tabs = openTabs(screen, recents);
  const walk = navigableRows(sections);
  const current = selectedRow(walk, selected);
  const activeKey = current?.key;
  useDetailsFor(current, screen);

  useEffect(() => {
    if (activeKey !== undefined) rows.current.get(activeKey)?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  const open = (path: string, asScenario: boolean) => {
    const route = openRoute(path, asScenario);
    if (route === "scenario") {
      setScenarioFor(path);
      return;
    }
    if (route === "ask") {
      if (modal) hide();
      void requestOpen(path);
      return;
    }
    void screen.open(path, route);
  };

  const browse = () => {
    if (modal) hide();
    void pickAndOpen();
  };

  const newScenario = () => {
    if (modal) hide();
    showScenarioDialog();
  };

  const pickTab = (tab: Tab["id"]) => {
    screen.setTab(tab);
    setSelected(null);
  };

  const activate = (row: Row | undefined, shift: boolean) => {
    if (!row || screen.busy !== null) return;
    switch (row.kind) {
      case "recent":
        open(row.doc.path, shift && row.doc.kind === "save");
        break;
      case "campaign":
        void screen.toggle(row.campaign.dir);
        break;
      case "save":
        open(row.file.path, shift);
        break;
      case "scenario":
        if (!row.disabled) open(row.listing.path, false);
        break;
    }
  };

  const footer = footerOpens(current, screen);
  const openFooter = (target: FooterOpen | null) => {
    if (target?.mode === "scenario") setScenarioFor(target.path);
    else if (target) void screen.open(target.path, target.mode);
  };
  const idle = screen.busy === null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const mod = (e.ctrlKey || e.metaKey) && !e.altKey;
    const tab = mod ? Number(e.key) : NaN;
    const onControl = e.target !== field.current && e.target !== e.currentTarget;
    if (tab >= 1 && tab <= OPEN_TABS.length) {
      e.preventDefault();
      pickTab(OPEN_TABS[tab - 1]);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSelected(steppedKey(walk, current?.key ?? null, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Enter" && !onControl) {
      e.preventDefault();
      activate(current, e.shiftKey);
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && current?.kind === "campaign") {
      e.preventDefault();
      if (e.key === "ArrowLeft" && current.expanded) screen.collapse();
      if (e.key === "ArrowRight" && !current.expanded) void screen.expand(current.campaign.dir);
    }
  };

  const press = (row: Row, e: MouseEvent) => {
    const result = pressRow(walk, row, e.detail, firstPress.current);
    if (result.select !== null) {
      firstPress.current = result.select;
      setSelected(result.select);
    }
    if (result.toggle !== null && idle) void screen.toggle(result.toggle);
    if (result.activate) activate(result.activate, e.shiftKey);
  };

  const body = (
    <>
      <div className="open-dialog-head">
        <h1>Open</h1>
        {modal && (
          <button type="button" className="link" title="Close (Esc)" onClick={hide}>
            ✕
          </button>
        )}
      </div>
      <div className="open-filter">
        <input
          ref={field}
          type="search"
          className="open-field"
          placeholder="Filter by empire, campaign, file, scenario or mod"
          value={screen.filter}
          autoComplete="off"
          role="combobox"
          aria-expanded="true"
          aria-controls="open-list"
          aria-activedescendant={current ? `open-row-${current.key}` : undefined}
          onChange={(e) => {
            screen.setFilter(e.currentTarget.value);
            setSelected(null);
          }}
        />
      </div>
      <div className="open-body">
        <TabRail tabs={tabs} onPick={pickTab} />
        <div
          className="open-panel"
          id={PANEL_ID}
          role="tabpanel"
          aria-labelledby={tabId(screen.tab)}
        >
          <div
            className={idle ? "open-list" : "open-list busy"}
            id="open-list"
            role="listbox"
            aria-label="Documents to open"
            aria-busy={!idle}
          >
            {sections.map((s) => (
              <SectionRows
                key={s.id}
                section={s}
                current={current}
                busy={screen.busy}
                rowError={screen.rowError}
                rows={rows}
                onPress={press}
                onForget={(path) => screen.forget(path)}
              />
            ))}
          </div>
        </div>
        <OpenDetails row={current} />
      </div>
      <div className="open-dialog-foot">
        <div className="open-actions">
          <button type="button" onClick={newScenario}>
            New scenario…
          </button>
          <button type="button" onClick={browse}>
            Browse…
          </button>
          <span className="spacer" />
          {footer.asScenario && (
            <button
              type="button"
              title="Take its galaxy into a new scenario (Shift+Enter)"
              aria-disabled={!idle}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => openFooter(footer.asScenario)}
            >
              Open as scenario
            </button>
          )}
          <button
            type="button"
            className="open-primary"
            title="Open it as it is (Enter asks first for a save)"
            aria-disabled={footer.open === null || !idle}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => openFooter(footer.open)}
          >
            Open
          </button>
        </div>
        {!modal && gameData !== "ready" && <GameDataLine />}
      </div>
    </>
  );

  const frame = (
    <div
      className="open-frame"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onFocus={() => (focusWithin.current = true)}
      onBlur={(e) => {
        if (e.relatedTarget !== null && !e.currentTarget.contains(e.relatedTarget)) {
          focusWithin.current = false;
        }
      }}
    >
      {body}
    </div>
  );

  const asScenario = scenarioFor !== null && (
    <OpenAsScenarioDialog
      path={scenarioFor}
      onCancel={() => setScenarioFor(null)}
      onContinue={() => {
        setScenarioFor(null);
        void screen.open(scenarioFor, "scenario");
      }}
    />
  );

  if (modal) {
    return (
      <>
        <Dialog className="open-dialog open-screen" label="Open" onClose={hide} onDismiss={hide}>
          {frame}
        </Dialog>
        {asScenario}
      </>
    );
  }
  return (
    <>
      <div className="launch">
        <div className="open-dialog open-screen">{frame}</div>
      </div>
      {asScenario}
    </>
  );
}

function SectionRows({
  section,
  current,
  busy,
  rowError,
  rows,
  onPress,
  onForget,
}: {
  section: Section;
  current: Row | undefined;
  busy: string | null;
  rowError: { path: string; message: string } | null;
  rows: RefObject<Map<string, HTMLDivElement>>;
  onPress: (row: Row, e: MouseEvent) => void;
  onForget: (path: string) => void;
}) {
  return (
    <section className="open-section">
      <div className="open-heading">{section.label}</div>
      {section.note && <div className="open-note">{section.note}</div>}
      {section.notices.map((notice, i) => (
        <div key={`${i}:${notice}`} className="open-note warn">
          {notice}
        </div>
      ))}
      {section.rows.map((row, i) => {
        const path = rowPath(row);
        const opening = path !== null && path === busy;
        const error = path !== null && rowError?.path === path ? rowError.message : null;
        const group = row.kind === "scenario" ? row.group : null;
        const before = section.rows[i - 1];
        const shownGroup =
          group !== null && group !== (before?.kind === "scenario" ? before.group : null);
        const classes = ["open-row", `open-${row.kind}`];
        if (row === current) classes.push("active");
        if (opening) classes.push("busy");
        if (row.kind === "scenario" && row.disabled) classes.push("disabled");
        if (row.kind === "scenario" && row.listing.shadowed_by) classes.push("shadowed");
        return (
          <div key={row.key} className={row.kind === "save" ? "open-nested" : undefined}>
            {shownGroup && <div className="open-group">{group}</div>}
            <div
              id={`open-row-${row.key}`}
              ref={(el) => {
                if (el) rows.current.set(row.key, el);
                return () => {
                  rows.current.delete(row.key);
                };
              }}
              role="option"
              aria-selected={row === current}
              aria-disabled={row.kind === "scenario" && row.disabled}
              className={classes.join(" ")}
              title={rowTitle(row)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPress(row, e);
              }}
            >
              <RowBody row={row} onForget={onForget} />
              {error && <div className="open-row-error">{error}</div>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
