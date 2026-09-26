import type { ReactNode } from "react";
import type { SpecialKind } from "../../generated/SpecialKind";
import { kindTitle } from "../../lib/special";
import { barShows, layerKey, type BarMode } from "../../lib/visual/barMode";
import {
  LAYER_LABELS,
  PRIMARY_KINDS,
  PRIMARY_LAYERS,
  type LayerId,
} from "../../lib/visual/layerIds";
import {
  frameIcons,
  groupsFor,
  kindVisible,
  sourceOf,
  type Group,
  type Source,
} from "../../lib/visual/layerGroups";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { useBarMode } from "../../store/sceneStore";
import "./chrome.css";
import { KindIcon, LayerIcon } from "./LayerIcons";
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
} from "./layerState";

function withKey(label: string, key: number): string {
  return key > 0 ? `${label} (${key})` : label;
}

function KindToggle({ kind, source, dead }: { kind: SpecialKind; source?: Source; dead?: string }) {
  const on = useMapChromeStore((s) => kindVisible(s, kind));
  const toggleKind = useMapChromeStore((s) => s.toggleKind);
  return (
    <button
      type="button"
      className={sourced("icon", source ?? null)}
      aria-label={kindsLabel(kind)}
      aria-pressed={on}
      disabled={dead !== undefined}
      title={dead ?? kindTitle(kind)}
      onClick={() => toggleKind(kind)}
    >
      <KindIcon kind={kind} />
    </button>
  );
}

function LayerToggle({
  id,
  mode,
  split,
  dead,
}: {
  id: LayerId;
  mode: BarMode;
  split?: boolean;
  dead?: string;
}) {
  const { on, toggle } = useLayerSwitch(id);
  const kind = useKind();
  return (
    <button
      type="button"
      className={split ? sourced("icon", sourceOf(id, kind)) : "icon"}
      aria-label={LAYER_LABELS[id]}
      aria-pressed={on}
      disabled={dead !== undefined}
      title={dead ?? withKey(LAYER_LABELS[id], layerKey(id, mode))}
      onClick={toggle}
    >
      <LayerIcon id={id} />
    </button>
  );
}

/** The one switch for everything a source decides; it heads the group it switches. */
function MasterToggle({ group }: { group: Group }) {
  const pressed = useGroupPressed(group);
  const toggleGroup = useMapChromeStore((s) => s.toggleGroup);
  const ready = useScriptsReady();
  const why = ready ? undefined : group.deadTitle;
  return (
    <button
      type="button"
      className={sourced("master", group.source)}
      aria-label={group.label}
      aria-pressed={pressed}
      disabled={why !== undefined}
      title={why ?? `${group.label} (${MASTER_KEYS[group.source]})`}
      onClick={() => toggleGroup(group.source)}
    >
      {MASTER_PILL}
    </button>
  );
}

/** One framed group of the split bar: its icons behind a label sitting on the frame. */
function LayerGroup({ group, children }: { group: Group; children: ReactNode }) {
  return (
    <div className={sourced("layer-group", group.source)} role="group" aria-label={group.label}>
      <span className="layer-group-label">{group.label}</span>
      {children}
    </div>
  );
}

/**
 * The primary layers the bar shown lists, as icon toggles keyed 1–6, with the two
 * point-of-interest kinds after them. A scenario frames them by source, each group that has a
 * master headed by it. A group whose master would stand over a single icon carries the master
 * alone; the menu keeps the rest.
 */
export function LayerToggles() {
  const document = useDocument();
  const mode = useBarMode();
  const registered = useShownLayers();
  const kind = useKind();
  const split = useSplit();
  const ready = useScriptsReady();
  const dead = split && !ready;
  if (!document) return null;
  const withKinds = barShows(mode, "kinds");
  const kinds = (source?: Source, dead?: string) =>
    withKinds &&
    PRIMARY_KINDS.map((k) => <KindToggle key={k} kind={k} source={source} dead={dead} />);
  if (!split) {
    return (
      <div className="layer-toggles">
        {PRIMARY_LAYERS.filter((id) => registered.has(id)).map((id) => (
          <LayerToggle key={id} id={id} mode={mode} />
        ))}
        {kinds()}
      </div>
    );
  }
  return (
    <div className="layer-toggles">
      {groupsFor(kind).map((group) => {
        const { lead, trail } = frameIcons(group, registered);
        const groupKinds = withKinds && group.layers.includes("special");
        const icons = lead.length + trail.length + (groupKinds ? PRIMARY_KINDS.length : 0);
        const master = group.master && barShows(mode, "masters");
        if (icons === 0 && !master) return null;
        const masterOnly = master && icons === 1;
        const groupOff = dead && group.needsGameData ? group.deadTitle : undefined;
        const toggles = (ids: LayerId[]) =>
          ids.map((id) => <LayerToggle key={id} id={id} mode={mode} split dead={groupOff} />);
        return (
          <LayerGroup key={group.source} group={group}>
            {master && <MasterToggle group={group} />}
            {!masterOnly && toggles(lead)}
            {!masterOnly && groupKinds && kinds(group.source, groupOff)}
            {!masterOnly && toggles(trail)}
          </LayerGroup>
        );
      })}
    </div>
  );
}
