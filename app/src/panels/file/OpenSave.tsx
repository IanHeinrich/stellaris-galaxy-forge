import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { SaveMeta } from "../../generated/SaveMeta";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { openRoute } from "./openRoute";
import { useGameDataStore } from "../../store/gameDataStore";
import { useLayoutStore } from "../../store/layoutStore";
import {
  navigableRows,
  openSections,
  type CampaignRow,
  type RecentRow,
  type Row,
  type SaveRow,
  type ScenarioRow,
  type Section,
} from "../../lib/openRows";
import { useOpenScreenStore } from "../../store/openScreenStore";
import { useRecentsStore } from "../../store/recentsStore";
import { Twisty } from "../Twisty";
import { Dialog } from "../overlays/Dialog";
import { formatSize, formatWhen, phaseLabel, versionShort } from "./launchData";
import "./open.css";

export const CLOUD_TITLE =
  "In Steam's cloud folder: Steam can overwrite an edited file with its cloud copy. " +
  "Close Steam or disable Steam Cloud for Stellaris before playing it.";

const IRONMAN_TITLE = "Ironman save: the game only loads it in ironman mode.";

/** "4 planets · 7 fleets", as far as the header says. */
function counts(meta: SaveMeta | null): string {
  if (!meta) return "";
  const parts: string[] = [];
  if (meta.planets !== null) parts.push(`${meta.planets} planets`);
  if (meta.fleets !== null) parts.push(`${meta.fleets} fleets`);
  return parts.join(" · ");
}

function metaLine(meta: SaveMeta | null): string {
  return meta ? `${meta.date} · ${versionShort(meta.version)}` : "unreadable header";
}

/** The empire's own colour, when game data knows the key the header names. */
function useEmpireColor(meta: SaveMeta | null): string | undefined {
  const mapColors = useGameDataStore((s) => s.mapColors);
  return meta?.color ? mapColors.get(meta.color)?.flag : undefined;
}

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
        <span className="open-sub muted">{row.doc.subtitle || row.doc.path}</span>
      </span>
      <span className="open-side muted">
        {row.missing ? (
          <span className="warn">not found</span>
        ) : (
          formatWhen(row.doc.openedAt / 1000)
        )}
      </span>
      {row.missing && (
        <button
          type="button"
          className="ghost shown"
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
  const color = useEmpireColor(row.campaign.meta);
  return (
    <>
      <span className="open-main">
        <span className="open-title">
          <Twisty open={row.expanded} />
          {color && <span className="dot" style={{ background: color }} />}
          {row.empire}
          <CloudFlag cloud={row.campaign.cloud} />
        </span>
        <span className="open-sub muted">
          {row.campaign.name}
          {row.error && <span className="warn"> · {row.error}</span>}
        </span>
      </span>
      <span className="open-side muted">
        {row.loading ? "reading…" : `${row.campaign.files} saves`}
        <span>{formatWhen(row.campaign.newest)}</span>
      </span>
    </>
  );
}

function SaveBody({ row, onScenario }: { row: SaveRow; onScenario: () => void }) {
  const meta = row.file.meta;
  return (
    <>
      <span className="open-main">
        <span className="open-title">
          {row.empire ?? row.file.file_name}
          <CloudFlag cloud={row.file.cloud} />
          {meta?.ironman && (
            <span className="flag" title={IRONMAN_TITLE}>
              ⚿
            </span>
          )}
        </span>
        <span className="open-sub muted">
          {counts(meta)}
          {counts(meta) && " · "}
          {row.file.file_name}
        </span>
      </span>
      <span className="open-side muted">
        {metaLine(meta)}
        <span>
          {formatSize(row.file.size)} · {formatWhen(row.file.modified)}
        </span>
      </span>
      <button
        type="button"
        className="ghost scenario-action"
        tabIndex={-1}
        title="Take its galaxy into a new scenario (⇧↵)"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onScenario();
        }}
      >
        as scenario
      </button>
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
        <span className="open-sub muted">
          {listing.systems} systems · {listing.mod_name ?? "Stellaris"}
          {listing.shadowed_by && (
            <span className="warn"> · overridden by {listing.shadowed_by}</span>
          )}
          {listing.error && <span className="warn"> · {listing.error}</span>}
        </span>
      </span>
      <span className="open-side muted">
        {formatSize(listing.size)}
        <span>{formatWhen(listing.modified)}</span>
      </span>
    </>
  );
}

export function RowBody({
  row,
  onForget,
  onScenario,
}: {
  row: Row;
  onForget: (path: string) => void;
  onScenario: (path: string) => void;
}) {
  switch (row.kind) {
    case "recent":
      return <RecentBody row={row} onForget={() => onForget(row.doc.path)} />;
    case "campaign":
      return <CampaignBody row={row} />;
    case "save":
      return <SaveBody row={row} onScenario={() => onScenario(row.file.path)} />;
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
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const headings = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    void useOpenScreenStore.getState().load(token);
  }, [token]);

  useEffect(() => {
    field.current?.focus();
  }, []);

  const sections = openSections(screen, recents);
  const walk = navigableRows(sections);
  const at = Math.min(active, Math.max(0, walk.length - 1));
  const current = walk[at];
  const activeKey = current?.key;

  useEffect(() => {
    if (activeKey !== undefined) rows.current.get(activeKey)?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  const open = (path: string, asScenario: boolean) => {
    const route = openRoute(path, asScenario);
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

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(at + 1, walk.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(at - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(current, e.shiftKey);
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && current?.kind === "campaign") {
      e.preventDefault();
      if (e.key === "ArrowLeft" && current.expanded) screen.collapse();
      if (e.key === "ArrowRight" && !current.expanded) void screen.expand(current.campaign.dir);
    }
  };

  const jumpTo = (id: string) => headings.current.get(id)?.scrollIntoView({ block: "start" });

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
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="open-body">
        <nav className="open-rail" aria-label="Sections">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              className="open-rail-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => jumpTo(s.id)}
            >
              <span>{s.label}</span>
              <span className="muted">{s.rows.length}</span>
            </button>
          ))}
        </nav>
        <div
          className={screen.busy === null ? "open-list" : "open-list busy"}
          id="open-list"
          role="listbox"
          aria-label="Documents to open"
          aria-busy={screen.busy !== null}
        >
          {sections.map((s) => (
            <SectionRows
              key={s.id}
              section={s}
              current={current}
              busy={screen.busy}
              rowError={screen.rowError}
              headings={headings}
              rows={rows}
              onActivate={activate}
              onForget={(path) => screen.forget(path)}
              onScenario={(path) => open(path, true)}
              onHover={(row) => {
                const i = walk.indexOf(row);
                if (i >= 0) setActive(i);
              }}
            />
          ))}
        </div>
      </div>
      <div className="open-dialog-foot">
        <div className="setup-actions">
          <span className="hint">
            A save opens as a save, or as a scenario to start a new campaign from.
          </span>
          <button type="button" onClick={newScenario}>
            New scenario…
          </button>
          <button type="button" onClick={browse}>
            Browse…
          </button>
        </div>
        {!modal && gameData !== "ready" && <GameDataLine />}
      </div>
    </>
  );

  if (modal) {
    return (
      <Dialog className="open-dialog open-screen" label="Open" onClose={hide} onDismiss={hide}>
        {body}
      </Dialog>
    );
  }
  return (
    <div className="launch">
      <div className="open-dialog open-screen">{body}</div>
    </div>
  );
}

function SectionRows({
  section,
  current,
  busy,
  rowError,
  headings,
  rows,
  onActivate,
  onForget,
  onScenario,
  onHover,
}: {
  section: Section;
  current: Row | undefined;
  busy: string | null;
  rowError: { path: string; message: string } | null;
  headings: RefObject<Map<string, HTMLDivElement>>;
  rows: RefObject<Map<string, HTMLDivElement>>;
  onActivate: (row: Row, shift: boolean) => void;
  onForget: (path: string) => void;
  onScenario: (path: string) => void;
  onHover: (row: Row) => void;
}) {
  return (
    <section className="open-section">
      <div
        className="open-heading"
        ref={(el) => {
          if (el) headings.current.set(section.id, el);
          return () => {
            headings.current.delete(section.id);
          };
        }}
      >
        {section.label}
      </div>
      {section.note && <div className="open-note muted">{section.note}</div>}
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
          <div key={row.key}>
            {shownGroup && <div className="open-group muted">{group}</div>}
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
              onMouseEnter={() => onHover(row)}
              onMouseDown={(e) => {
                e.preventDefault();
                onActivate(row, e.shiftKey);
              }}
            >
              <RowBody row={row} onForget={onForget} onScenario={onScenario} />
              {error && <div className="open-row-error">{error}</div>}
            </div>
          </div>
        );
      })}
    </section>
  );
}
