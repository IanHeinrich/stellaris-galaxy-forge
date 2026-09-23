import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { openRoute } from "./openRoute";
import { useLayoutStore } from "../../store/layoutStore";
import {
  OPEN_TABS,
  navigableRows,
  openSections,
  openTabs,
  pressRow,
  selectedRow,
  steppedKey,
  type Row,
  type Tab,
} from "../../lib/openRows";
import { useOpenScreenStore, type OpenScreenState } from "../../store/openScreenStore";
import { useRecentsStore } from "../../store/recentsStore";
import { Dialog } from "../overlays/Dialog";
import { OpenDetails } from "./OpenDetails";
import { OpenFooter } from "./OpenFooter";
import { OpenAsDialog } from "./OpenModeDialog";
import { SectionRows } from "./OpenRows";
import { TabPanel, TabRail } from "./OpenTabs";
import { useDetailsFor } from "./useDetailsFor";
import "./open.css";

export { CLOUD_TITLE } from "../../lib/sessionCopy";

/** What the screen lists and whether it is opening one: everything but the details pane's reads. */
function screenLists(s: OpenScreenState) {
  return {
    filter: s.filter,
    tab: s.tab,
    campaigns: s.campaigns,
    campaignsError: s.campaignsError,
    scenarios: s.scenarios,
    scenariosError: s.scenariosError,
    scenarioNotices: s.scenarioNotices,
    files: s.files,
    fileErrors: s.fileErrors,
    expanded: s.expanded,
    loadingDir: s.loadingDir,
    missing: s.missing,
    busy: s.busy,
    rowError: s.rowError,
  };
}

/**
 * Everything on this machine worth opening: inline while nothing is open, a dialog over the map.
 * `footnote` goes under the buttons.
 */
export function OpenSave({ modal = false, footnote }: { modal?: boolean; footnote?: ReactNode }) {
  const token = useFileSessionStore((s) => s.lastSave ?? s.path);
  const pickAndOpen = useFileSessionStore((s) => s.pickAndOpen);
  const requestOpen = useFileSessionStore((s) => s.requestOpen);
  const hide = useLayoutStore((s) => s.hideOpenDialog);
  const showScenarioDialog = useLayoutStore((s) => s.showScenarioDialog);
  const recents = useRecentsStore((s) => s.recents);
  const lists = useOpenScreenStore(useShallow(screenLists));
  const actions = useOpenScreenStore.getState();
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

  const sections = openSections(lists, recents);
  const tabs = openTabs(lists, recents);
  const walk = navigableRows(sections);
  const current = selectedRow(walk, selected);
  const activeKey = current?.key;
  useDetailsFor(current, lists);

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
    void actions.open(path, route);
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
    actions.setTab(tab);
    setSelected(null);
  };

  const activate = (row: Row | undefined, shift: boolean) => {
    if (!row || lists.busy !== null) return;
    switch (row.kind) {
      case "recent":
        open(row.doc.path, shift && row.doc.kind === "save");
        break;
      case "campaign":
        void actions.toggle(row.campaign.dir);
        break;
      case "save":
        open(row.file.path, shift);
        break;
      case "scenario":
        if (!row.disabled) open(row.listing.path, false);
        break;
    }
  };

  const idle = lists.busy === null;

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
      if (e.key === "ArrowLeft" && current.expanded) actions.collapse();
      if (e.key === "ArrowRight" && !current.expanded) void actions.expand(current.campaign.dir);
    }
  };

  const press = (row: Row, e: MouseEvent) => {
    const result = pressRow(walk, row, e.detail, firstPress.current);
    if (result.select !== null) {
      firstPress.current = result.select;
      setSelected(result.select);
    }
    if (result.toggle !== null && idle) void actions.toggle(result.toggle);
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
          value={lists.filter}
          autoComplete="off"
          role="combobox"
          aria-expanded="true"
          aria-controls="open-list"
          aria-activedescendant={current ? `open-row-${current.key}` : undefined}
          onChange={(e) => {
            actions.setFilter(e.currentTarget.value);
            setSelected(null);
          }}
        />
      </div>
      <div className="open-body">
        <TabRail tabs={tabs} onPick={pickTab} />
        <TabPanel tab={lists.tab}>
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
                busy={lists.busy}
                rowError={lists.rowError}
                rows={rows}
                onPress={press}
                onForget={(path) => actions.forget(path)}
              />
            ))}
          </div>
        </TabPanel>
        <OpenDetails row={current} />
      </div>
      <OpenFooter
        row={current}
        lists={lists}
        idle={idle}
        onNewScenario={newScenario}
        onBrowse={browse}
        onAsScenario={setScenarioFor}
      >
        {footnote}
      </OpenFooter>
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
    <OpenAsDialog
      path={scenarioFor}
      onCancel={() => setScenarioFor(null)}
      onScenario={() => {
        setScenarioFor(null);
        void actions.open(scenarioFor, "scenario");
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
