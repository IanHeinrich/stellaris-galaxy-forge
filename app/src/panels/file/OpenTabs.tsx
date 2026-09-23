import { useRef, type KeyboardEvent, type ReactNode } from "react";
import type { Tab } from "../../lib/openRows";
import { useOpenScreenStore } from "../../store/openScreenStore";

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

export function TabRail({ tabs, onPick }: { tabs: Tab[]; onPick: (tab: Tab["id"]) => void }) {
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

/** The list the chosen tab shows, labelled by that tab. */
export function TabPanel({ tab, children }: { tab: Tab["id"]; children: ReactNode }) {
  return (
    <div className="open-panel" id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(tab)}>
      {children}
    </div>
  );
}
