import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { CONNECT_ALL_MAX, deletableSystems, useEditorStore } from "../store/editorStore";
import { deleteAddedLabel } from "../lib/addSystem";
import { documentCapabilities } from "../lib/capabilities";
import { clanMenuItem, nextFreeClan } from "../lib/marauder";
import { sharedWormholePair } from "../lib/paint";
import { useCanEdit, useFileSessionStore, usePaintLayer } from "../store/fileSessionStore";
import { useMapChromeStore } from "../store/mapChromeStore";
import {
  linkedSystems,
  meshLanes,
  selectionLanes,
  staleLaneCount,
  useGalaxyStore,
} from "../store/galaxyStore";
import { LaneDensitySlider } from "./LaneDensitySlider";
import "./panels.css";

/** Above this many selected systems the mesh is worked out only while its row is previewed. */
const MESH_COUNT_MAX = 1000;

/**
 * The bulk lane buttons and the mesh row for the current selection. `dismiss` closes a hosting
 * menu before the action runs.
 */
export function BulkActions({
  dismiss,
  itemRole,
}: {
  dismiss?: () => void;
  itemRole?: "menuitem";
}) {
  const selection = useEditorStore((s) => s.selection);
  const connectSelected = useEditorStore((s) => s.connectSelected);
  const cutLanesBetweenSelected = useEditorStore((s) => s.cutLanesBetweenSelected);
  const isolateSelected = useEditorStore((s) => s.isolateSelected);
  const resetSelectedLaneLengths = useEditorStore((s) => s.resetSelectedLaneLengths);
  const removeSystems = useEditorStore((s) => s.removeSystems);
  const systems = useGalaxyStore((s) => s.systems);
  const capabilities = useFileSessionStore(documentCapabilities);
  const laneLengths = useCanEdit("lane_lengths");
  const canCreate = useCanEdit("create_systems");
  const paint = usePaintLayer();

  const counts = useMemo(
    () => ({
      lanes: selectionLanes(systems, selection),
      laned: linkedSystems(systems, selection).length,
      stale: laneLengths ? staleLaneCount(systems, selection) : 0,
    }),
    [systems, selection, laneLengths],
  );
  const deletable = useMemo(
    () => deletableSystems(selection, capabilities, systems),
    [selection, capabilities, systems],
  );
  const deleteAdded =
    deletable?.kind === "added" && selection.length > 1
      ? deleteAddedLabel(deletable.ids.length, selection.length - deletable.ids.length)
      : null;

  const tooMany = selection.length > CONNECT_ALL_MAX;
  const actions = [
    {
      label: "Connect to each other",
      count: counts.lanes.unlinked,
      run: connectSelected,
      disabled: tooMany,
      title: tooMany ? `Limited to ${CONNECT_ALL_MAX} systems — use Connect as mesh` : undefined,
    },
    {
      label: "Cut hyperlanes between",
      count: counts.lanes.linked.length,
      run: cutLanesBetweenSelected,
    },
    { label: "Isolate", count: counts.laned, run: isolateSelected },
    ...(laneLengths
      ? [{ label: "Reset lane lengths", count: counts.stale, run: resetSelectedLaneLengths }]
      : []),
  ];
  const [connectAll, ...rest] = actions.map(({ label, count, run, disabled, title }) => (
    <button
      key={label}
      type="button"
      role={itemRole}
      disabled={count === 0 || disabled}
      title={title}
      onClick={() => {
        dismiss?.();
        void run();
      }}
    >
      {label} ({count})
    </button>
  ));
  return (
    <>
      {connectAll}
      <MeshRow dismiss={dismiss} itemRole={itemRole} />
      {rest}
      {paint && selection.length === 2 && (
        <WormholePairButton
          a={selection[0]}
          b={selection[1]}
          dismiss={dismiss}
          itemRole={itemRole}
        />
      )}
      {canCreate && selection.length === 3 && (
        <MarauderClanButton ids={selection} dismiss={dismiss} itemRole={itemRole} />
      )}
      {deletable?.kind === "systems" && selection.length > 1 && (
        <button
          type="button"
          role={itemRole}
          onClick={() => {
            dismiss?.();
            void removeSystems(selection);
          }}
        >
          Delete systems ({selection.length})
        </button>
      )}
      {deleteAdded !== null && (
        <button
          type="button"
          role={itemRole}
          onClick={() => {
            dismiss?.();
            void removeSystems(selection);
          }}
        >
          {deleteAdded}
        </button>
      )}
    </>
  );
}

/** Three selected systems on a scenario: made the next free marauder clan, the middle one its home. */
export function MarauderClanButton({
  ids,
  dismiss,
  itemRole,
}: {
  ids: readonly number[];
  dismiss?: () => void;
  itemRole?: "menuitem";
}) {
  const makeMarauderClan = useEditorStore((s) => s.makeMarauderClan);
  const systems = useGalaxyStore((s) => s.systems);
  const item = clanMenuItem(ids, systems, nextFreeClan(systems));
  return (
    <button
      type="button"
      role={itemRole}
      className="hinted"
      disabled={item.clan === null}
      title={item.hint}
      onClick={() => {
        dismiss?.();
        if (item.clan !== null) void makeMarauderClan(item.clan.home, item.clan.bases);
      }}
    >
      {item.label}
      <span className="muted">{item.hint}</span>
    </button>
  );
}

/** Two selected systems under the Paint a Galaxy layer: made a wormhole pair, or parted again. */
export function WormholePairButton({
  a,
  b,
  dismiss,
  itemRole,
}: {
  a: number;
  b: number;
  dismiss?: () => void;
  itemRole?: "menuitem";
}) {
  const linkWormholePair = useEditorStore((s) => s.linkWormholePair);
  const unlinkWormholePair = useEditorStore((s) => s.unlinkWormholePair);
  const systems = useGalaxyStore((s) => s.systems);
  const shared = sharedWormholePair(systems, a, b);
  const run = shared === null ? linkWormholePair : unlinkWormholePair;
  return (
    <button
      type="button"
      role={itemRole}
      onClick={() => {
        dismiss?.();
        void run(a, b);
      }}
    >
      {shared === null ? "Link as wormhole pair" : "Unlink wormhole pair"}
    </button>
  );
}

function MeshRow({ dismiss, itemRole }: { dismiss?: () => void; itemRole?: "menuitem" }) {
  const selection = useEditorStore((s) => s.selection);
  const meshBeta = useMapChromeStore((s) => s.meshBeta);
  const setLanePreview = useMapChromeStore((s) => s.setLanePreview);
  const connectSelectedMesh = useEditorStore((s) => s.connectSelectedMesh);
  const galaxy = useGalaxyStore(useShallow((s) => ({ systems: s.systems, version: s.version })));
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const previewing = hovered || focused;
  const counted = previewing || selection.length <= MESH_COUNT_MAX;
  const pairs = useMemo(
    () => (counted ? meshLanes(galaxy.systems, selection, meshBeta) : null),
    [counted, galaxy, selection, meshBeta],
  );
  useEffect(() => {
    if (!previewing || pairs === null) return;
    setLanePreview(pairs);
    return () => setLanePreview(null);
  }, [previewing, pairs, setLanePreview]);

  return (
    <div
      className="mesh-row"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <label className="mesh-slider">
        <span className="muted">sparse</span>
        <LaneDensitySlider
          label="Mesh density"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <span className="muted">dense</span>
      </label>
      <button
        type="button"
        role={itemRole}
        disabled={pairs?.length === 0}
        onClick={() => {
          dismiss?.();
          void connectSelectedMesh();
        }}
      >
        Connect as mesh{pairs === null ? "" : ` (${pairs.length})`}
      </button>
    </div>
  );
}
