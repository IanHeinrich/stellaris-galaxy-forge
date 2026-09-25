import { useEffect, useMemo } from "react";
import { documentCapabilities, supports } from "../../lib/capabilities";
import { shortcutLabel } from "../../lib/keys";
import { laneLabel, nebulaNameIn } from "../../lib/names";
import { useEditorStore } from "../../store/editorStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { systemNameOf, useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useEntityStore, viewKey } from "../../store/entityStore";
import {
  entityAddr,
  GALAXY_ENTRY,
  INSPECTOR_TAB_LABELS,
  systemTabsOf,
  tabsFor,
  useInspectorStore,
  type EntityRef,
  type Entry,
  type InspectorTab,
} from "../../store/inspectorStore";
import "./inspector.css";
import { Empty } from "./parts";
import { ChildView } from "./entity/ChildView";
import { INSPECTOR_VIEWS } from "./entity/views";

function Breadcrumb() {
  const stack = useInspectorStore((s) => s.stack);
  const popTo = useInspectorStore((s) => s.popTo);
  const home = useInspectorStore((s) => s.home);
  const back = useInspectorStore((s) => s.back);
  const select = useEditorStore((s) => s.select);
  if (stack.length === 1 && stack[0].ref.kind === "galaxy") return null;
  return (
    <div className="ins-crumbs">
      {stack.length > 1 && (
        <button
          type="button"
          className="ins-back"
          aria-label="Back"
          title={`Back (${shortcutLabel("inspectorBack")})`}
          onClick={() => back()}
        >
          ‹
        </button>
      )}
      <button type="button" className="link" onClick={() => home() || void select(null)}>
        Galaxy
      </button>
      {stack.map((entry, i) =>
        entry.ref.kind === "galaxy" ? null : (
          <span key={`${entry.label}-${i}`}>
            <span className="sep">›</span>
            {i === stack.length - 1 ? (
              <span className="here">{entry.label}</span>
            ) : (
              <button type="button" className="link" onClick={() => popTo(i)}>
                {entry.label}
              </button>
            )}
          </span>
        ),
      )}
    </div>
  );
}

/**
 * Whether the entity on top lists anything: a kind whose entity comes back with no contents
 * drops the tab. Unknown until the read lands, and a system always has one.
 */
function useHasContents(ref: EntityRef): boolean {
  const addr = entityAddr(ref);
  const view = useEntityStore((s) => (addr === null ? undefined : s.views.get(viewKey(addr))));
  if (addr === null || ref.kind === "system") return true;
  return view === undefined || view.contents.length > 0;
}

function TabStrip({ tabs }: { tabs: InspectorTab[] }) {
  const tab = useInspectorStore((s) => s.tab);
  const setTab = useInspectorStore((s) => s.setTab);
  if (tabs.length < 2) return null;
  return (
    <div className="ins-tabs" role="tablist" aria-label="Inspector">
      {tabs.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          className={tab === id ? "ins-tab on" : "ins-tab"}
          onClick={() => setTab(id)}
        >
          {INSPECTOR_TAB_LABELS[id]}
        </button>
      ))}
    </div>
  );
}

/** The registered body for `entry`, or the placeholder when the document cannot answer for it. */
function Body({ entry }: { entry: Entry }) {
  const capabilities = useFileSessionStore(documentCapabilities);
  const view = INSPECTOR_VIEWS[entry.ref.kind];
  const View = supports(capabilities, view.requires) ? view.component : ChildView;
  return <View entry={entry} />;
}

/**
 * The navigator: one anatomy for every entity, with the map selection deciding the root of the
 * stack and drill-downs pushing onto it.
 */
export function Inspector() {
  const selection = useEditorStore((s) => s.selection);
  const selectedLane = useEditorStore((s) => s.selectedLane);
  const selectedNebula = useEditorStore((s) => s.selectedNebula);
  const status = useFileSessionStore((s) => s.status);
  const systems = useGalaxyStore((s) => s.systems);
  const nebulae = useGalaxyStore((s) => s.nebulae);
  const names = useGameDataStore((s) => s.names);
  const setRoot = useInspectorStore((s) => s.setRoot);
  const stack = useInspectorStore((s) => s.stack);
  const tab = useInspectorStore((s) => s.tab);
  const setTab = useInspectorStore((s) => s.setTab);
  const entry = stack[stack.length - 1];
  const hasContents = useHasContents(entry.ref);
  const kind = useFileSessionStore((s) => s.kind);
  const gameData = useGameDataStore((s) => s.status === "ready");
  const { scripts, data } = systemTabsOf(kind, gameData);
  const tabs = useMemo(
    () => tabsFor(entry.ref, hasContents, { scripts, data }),
    [entry.ref, hasContents, scripts, data],
  );

  const root = useMemo<Entry>(() => {
    const name = (id: number) => systemNameOf(systems, names, id);
    if (selectedNebula !== null) {
      return {
        ref: { kind: "nebula", index: selectedNebula },
        label: nebulaNameIn(names, nebulae[selectedNebula], selectedNebula),
      };
    }
    if (selectedLane) {
      const { a, b } = selectedLane;
      return { ref: { kind: "lane", a, b }, label: laneLabel(name(a), name(b)) };
    }
    if (selection.length > 1) {
      return { ref: { kind: "selection" }, label: `${selection.length} systems` };
    }
    if (selection.length === 1) {
      return { ref: { kind: "system", id: selection[0] }, label: name(selection[0]) };
    }
    return GALAXY_ENTRY;
  }, [selection, selectedLane, selectedNebula, systems, nebulae, names]);

  useEffect(() => setRoot(root), [root, setRoot]);

  // An entity that turns out to list nothing drops its Contents tab from under the reader.
  useEffect(() => {
    if (!tabs.includes(tab)) setTab(tabs[0]);
  }, [tabs, tab, setTab]);

  if (status !== "ready") return <Empty>Open a save to inspect it.</Empty>;
  return (
    <div className="inspector">
      <TabStrip tabs={tabs} />
      <div className="ins-body">
        <Breadcrumb />
        <Body entry={entry} />
      </div>
    </div>
  );
}
