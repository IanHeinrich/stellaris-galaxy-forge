import { useRef, type CSSProperties } from "react";
import { documentCapabilities } from "../../lib/capabilities";
import { shortcutLabel } from "../../lib/keys";
import { useEmpireCount, usePointCount } from "../../store/browserRows";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useLayoutStore, type DockTab } from "../../store/layoutStore";
import { useFreshIssues } from "../../store/issuesStore";
import { useWatchlistStore } from "../../store/watchlistStore";
import { DOCK_TAB_REGISTRY, dockTabsFor } from "./dockTabs";

const PANEL_ID = "dock-panel";

const DOCK_KEY = shortcutLabel("toggleDock");

function tabId(tab: DockTab): string {
  return `dock-tab-${tab}`;
}

/** The chosen tab, or the first one listed when the open document cannot answer for it. */
function useShownTab(): DockTab {
  const tab = useLayoutStore((s) => s.tab);
  const tabs = dockTabsFor(useFileSessionStore(documentCapabilities));
  return tabs.includes(tab) ? tab : tabs[0];
}

function Body({ tab }: { tab: DockTab }) {
  const Panel = DOCK_TAB_REGISTRY[tab].component;
  return <Panel />;
}

function Resizer() {
  const setWidth = useLayoutStore((s) => s.setWidth);
  const dragging = useRef(false);
  return (
    <div
      className="dock-resizer"
      role="separator"
      aria-label="Resize the dock"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragging.current = true;
      }}
      onPointerMove={(e) => {
        if (dragging.current) setWidth(window.innerWidth - e.clientX);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
    />
  );
}

function TabStrip({ tab }: { tab: DockTab }) {
  const setTab = useLayoutStore((s) => s.setTab);
  const toggleDock = useLayoutStore((s) => s.toggleDock);
  const { fresh, errors } = useFreshIssues();
  const changes = useEditorStore((s) => s.history.undo.length);
  const capabilities = useFileSessionStore(documentCapabilities);
  const empires = useEmpireCount();
  const points = usePointCount();
  const watched = useWatchlistStore((s) => s.entries.length);
  const counts: Record<DockTab, number | null> = {
    inspector: null,
    empires,
    poi: points,
    watchlist: watched,
    issues: fresh.length,
    changes,
  };
  const tabs = dockTabsFor(capabilities);
  return (
    <div className="dock-tabs">
      <div
        className="dock-tablist"
        role="tablist"
        aria-label="Dock"
        data-tabs={tabs.length}
        style={{ "--dock-cols": Math.ceil(tabs.length / 2) } as CSSProperties}
      >
        {tabs.map((id) => {
          const count = counts[id];
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={tabId(id)}
              aria-controls={PANEL_ID}
              aria-selected={tab === id}
              className={tab === id ? "dock-tab on" : "dock-tab"}
              title={DOCK_TAB_REGISTRY[id].label}
              onClick={() => setTab(id)}
            >
              <span className="label">{DOCK_TAB_REGISTRY[id].short}</span>
              {count !== null && count > 0 && (
                <span className={id === "issues" && errors > 0 ? "count warn" : "count"}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="dock-collapse icon"
        title={`Collapse the dock (${DOCK_KEY})`}
        aria-label="Collapse the dock"
        onClick={toggleDock}
      >
        ⇥
      </button>
    </div>
  );
}

/** The full-height right dock: one tab strip over the panel the tab selects. */
export function Dock() {
  const tab = useShownTab();
  const width = useLayoutStore((s) => s.width);
  const collapsed = useLayoutStore((s) => s.collapsed);
  const toggleDock = useLayoutStore((s) => s.toggleDock);

  if (collapsed) {
    return (
      <aside className="dock collapsed">
        <button
          type="button"
          className="dock-collapse icon"
          title={`Show the dock (${DOCK_KEY})`}
          aria-label="Show the dock"
          onClick={toggleDock}
        >
          ⇤
        </button>
      </aside>
    );
  }
  return (
    <aside className="dock" style={{ width }}>
      <Resizer />
      <TabStrip tab={tab} />
      <div className="dock-body" role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(tab)}>
        <Body tab={tab} />
      </div>
    </aside>
  );
}
