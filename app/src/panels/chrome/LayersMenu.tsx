import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { DocumentKind } from "../../generated/DocumentKind";
import type { SpecialKind } from "../../generated/SpecialKind";
import { KIND_ORDER, kindOrder, kindTitle } from "../../lib/special";
import { barShows, layerKey } from "../../lib/visual/barMode";
import { LAYER_GROUPS, LAYER_LABELS, type LayerId } from "../../lib/visual/layerIds";
import { initializerCounts, type InitializerCount } from "../../lib/initializer/initializerLabels";
import {
  groupsFor,
  kindVisible,
  splitsBySource,
  type Group,
  type Source,
} from "../../lib/visual/layerGroups";
import { toCss } from "../../lib/visual/ownerColors";
import { KIND_STYLE } from "../../lib/visual/specialStyle";
import { useGalaxyStore } from "../../store/galaxyStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useBarMode } from "../../store/sceneStore";
import "./chrome.css";
import { InitializerLegend, LEGEND_LABEL } from "./InitializerLegend";
import { LayerIcon } from "./LayerIcons";
import {
  MASTER_KEYS,
  MASTER_PILL,
  kindsLabel,
  sourced,
  useDocument,
  useGroupPressed,
  useKind,
  useLayerSwitch,
  useScriptsReady,
  useShownLayers,
  useSplit,
  type Pressed,
} from "./layerState";
import { EyeRow, Menu } from "./Menu";

/** How much of the points of interest is drawn: every kind, none, or some. */
function useKindsPressed(): Pressed {
  const on = useMapChromeStore((s) => KIND_ORDER.filter((kind) => kindVisible(s, kind)).length);
  if (on === 0) return "false";
  return on === KIND_ORDER.length ? "true" : "mixed";
}

function LayerRow({ id, source, dead }: { id: LayerId; source?: Source; dead?: string }) {
  const { on, toggle } = useLayerSwitch(id);
  const key = layerKey(id, useBarMode());
  return (
    <EyeRow
      className={sourced("menu-item", source ?? null)}
      pressed={on}
      disabled={dead !== undefined}
      title={dead}
      onClick={toggle}
    >
      <LayerIcon id={id} />
      <span>{LAYER_LABELS[id]}</span>
      {key > 0 && <kbd>{key}</kbd>}
    </EyeRow>
  );
}

/** The points-of-interest row turns every kind on, or every kind off once they all are. */
function AllKindsRow({ source, dead }: { source?: Source; dead?: string }) {
  const toggleAllKinds = useMapChromeStore((s) => s.toggleAllKinds);
  const pressed = useKindsPressed();
  const key = layerKey("special", useBarMode());
  return (
    <EyeRow
      className={sourced("menu-item", source ?? null)}
      pressed={pressed}
      disabled={dead !== undefined}
      title={dead}
      onClick={toggleAllKinds}
    >
      <LayerIcon id="special" />
      <span>{LAYER_LABELS.special}</span>
      {key > 0 && <kbd>{key}</kbd>}
    </EyeRow>
  );
}

/** The master row: one switch for every layer and kind its source decides, on its own key. */
function MasterPill({ group, dead }: { group: Group; dead?: string }) {
  const pressed = useGroupPressed(group);
  const toggleGroup = useMapChromeStore((s) => s.toggleGroup);
  return (
    <button
      type="button"
      role="menuitem"
      className={sourced("master-pill", group.source)}
      aria-pressed={pressed}
      aria-label={`All ${group.label.toLowerCase()} layers in the bar`}
      disabled={dead !== undefined}
      title={
        dead ?? `All ${group.label.toLowerCase()} layers in the bar (${MASTER_KEYS[group.source]})`
      }
      onClick={() => toggleGroup(group.source)}
    >
      <kbd>{MASTER_KEYS[group.source]}</kbd>
      <span>{MASTER_PILL}</span>
    </button>
  );
}

function KindRow({ kind, source, dead }: { kind: SpecialKind; source?: Source; dead?: string }) {
  const on = useMapChromeStore((s) => kindVisible(s, kind));
  const toggleKind = useMapChromeStore((s) => s.toggleKind);
  return (
    <EyeRow
      className={sourced("menu-item sub", source ?? null)}
      pressed={on}
      disabled={dead !== undefined}
      title={dead ?? kindTitle(kind)}
      onClick={() => toggleKind(kind)}
    >
      <span className="muted">{kindsLabel(kind)}</span>
      <span className="swatch" style={{ background: toCss(KIND_STYLE[kind].color) }} />
    </EyeRow>
  );
}

/** Every kind there is, in the order the open document counts them in. */
function useKindOrder(): SpecialKind[] {
  return kindOrder(useGameDataStore((s) => s.counts));
}

function KindRows({ source, dead }: { source?: Source; dead?: string }) {
  return (
    <>
      {useKindOrder().map((kind) => (
        <KindRow key={kind} kind={kind} source={source} dead={dead} />
      ))}
    </>
  );
}

/** The keys the open document carries, with their counts; the row and the legend share them. */
function useInitializerCounts(): InitializerCount[] {
  const systems = useGalaxyStore((s) => s.systems);
  return useMemo(() => initializerCounts(systems.values()), [systems]);
}

/** The Initializer keys row: its own toggle, and the chevron that opens the legend beside it. */
function InitializerKeysRow({
  source,
  dead,
  anchor,
  legend,
  open,
  onToggle,
}: {
  source?: Source;
  dead?: string;
  anchor: RefObject<HTMLDivElement | null>;
  legend: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="menu-row" ref={anchor}>
      <LayerRow id="initializers" source={source} dead={dead} />
      {legend && (
        <button
          type="button"
          role="menuitem"
          className="menu-chevron"
          aria-label={LEGEND_LABEL}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={LEGEND_LABEL}
          onClick={onToggle}
        >
          {open ? "◂" : "▸"}
        </button>
      )}
    </div>
  );
}

interface MenuGroup {
  label: string;
  group?: Group;
  layers: readonly LayerId[];
}

/** The menu's sections: the map's own groups, or the sources once a scenario splits them. */
function menuGroups(registered: ReadonlySet<LayerId>, kind: DocumentKind | null): MenuGroup[] {
  const listed = LAYER_GROUPS.flatMap((group) => group.layers);
  const groups: MenuGroup[] = splitsBySource(kind)
    ? groupsFor(kind).map((group) => ({
        label: group.label,
        group,
        layers: listed.filter((id) => group.layers.includes(id)),
      }))
    : LAYER_GROUPS.map((group) => ({ label: group.label, layers: group.layers }));
  return groups
    .map((group) => ({ ...group, layers: group.layers.filter((id) => registered.has(id)) }))
    .filter((group) => group.layers.length > 0);
}

/** Every layer the map can draw, grouped, scrolling within the window, the reset at its foot. */
export function LayersMenuBody() {
  const resetLayers = useMapChromeStore((s) => s.resetLayers);
  const keysOn = useMapChromeStore((s) => s.layers.initializers);
  const registered = useShownLayers();
  const mode = useBarMode();
  const kind = useKind();
  const split = useSplit();
  const ready = useScriptsReady();
  const counts = useInitializerCounts();
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (keysOn) void useGameDataStore.getState().loadInitializers();
  }, [keysOn]);

  const dead = split && !ready;
  const groups = menuGroups(registered, kind);
  const legend = keysOn && counts.length > 0;
  return (
    <>
      <div className="menu-body">
        {groups.map((group) => {
          const off = dead && group.group?.needsGameData ? group.group.deadTitle : undefined;
          const source = group.group?.source;
          return (
            <div key={group.label}>
              <div className={sourced("menu-section", source ?? null)}>
                {group.label}
                {group.group?.master && barShows(mode, "masters") && (
                  <MasterPill group={group.group} dead={off} />
                )}
              </div>
              {group.layers.map((id) => (
                <div key={id}>
                  {id === "special" ? (
                    <AllKindsRow source={source} dead={off} />
                  ) : id === "initializers" ? (
                    <InitializerKeysRow
                      source={source}
                      dead={off}
                      anchor={anchor}
                      legend={legend}
                      open={open}
                      onToggle={() => setOpen(!open)}
                    />
                  ) : (
                    <LayerRow id={id} source={source} dead={off} />
                  )}
                  {id === "special" && <KindRows source={source} dead={off} />}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {open && legend && (
        <InitializerLegend counts={counts} anchor={anchor} onClose={() => setOpen(false)} />
      )}
      <div className="menu-rule" />
      <button type="button" role="menuitem" className="menu-item" onClick={resetLayers}>
        Reset to defaults
      </button>
    </>
  );
}

/** Every layer the map can draw, behind the "Layers" button after the bar's layer toggles. */
export function LayersMenu() {
  const document = useDocument();
  if (!document) return null;
  return (
    <div className="layers-menu">
      <Menu label="Layers" align="right">
        {() => <LayersMenuBody />}
      </Menu>
    </div>
  );
}
