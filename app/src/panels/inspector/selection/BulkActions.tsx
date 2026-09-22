import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { betaOfSlider, sliderOfBeta } from "../../../lib/geometry/mesh";
import { CONNECT_ALL_MAX, useEditorStore } from "../../../store/editorStore";
import { documentCapabilities, supports } from "../../../lib/capabilities";
import { clanMenuItem, nextFreeClan } from "../../../lib/marauder";
import { sharedWormholePair } from "../../../lib/paint";
import { useFileSessionStore, usePaintLayer } from "../../../store/fileSessionStore";
import { useMapChromeStore } from "../../../store/mapChromeStore";
import {
  linkedPairs,
  linkedSystems,
  meshLanes,
  staleLaneCount,
  unlinkedPairs,
  useGalaxyStore,
} from "../../../store/galaxyStore";

/** The bulk lane buttons and the mesh row for the current selection; `afterRun` closes a hosting menu. */
export function BulkActions({
  afterRun,
  itemRole,
}: {
  afterRun?: () => void;
  itemRole?: "menuitem";
}) {
  const selection = useEditorStore((s) => s.selection);
  const connectSelected = useEditorStore((s) => s.connectSelected);
  const cutLanesBetweenSelected = useEditorStore((s) => s.cutLanesBetweenSelected);
  const isolateSelected = useEditorStore((s) => s.isolateSelected);
  const resetSelectedLaneLengths = useEditorStore((s) => s.resetSelectedLaneLengths);
  const systems = useGalaxyStore((s) => s.systems);
  const capabilities = useFileSessionStore(documentCapabilities);
  const paint = usePaintLayer();

  const tooMany = selection.length > CONNECT_ALL_MAX;
  const actions = [
    {
      label: "Connect to each other",
      count: unlinkedPairs(systems, selection).length,
      run: connectSelected,
      disabled: tooMany,
      title: tooMany ? `Limited to ${CONNECT_ALL_MAX} systems — use Connect as mesh` : undefined,
    },
    {
      label: "Cut hyperlanes between",
      count: linkedPairs(systems, selection).length,
      run: cutLanesBetweenSelected,
    },
    { label: "Isolate", count: linkedSystems(systems, selection).length, run: isolateSelected },
    ...(supports(capabilities, "lane_lengths")
      ? [
          {
            label: "Reset lane lengths",
            count: staleLaneCount(systems, selection),
            run: resetSelectedLaneLengths,
          },
        ]
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
        void run();
        afterRun?.();
      }}
    >
      {label} ({count})
    </button>
  ));
  return (
    <>
      {connectAll}
      <MeshRow afterRun={afterRun} itemRole={itemRole} />
      {rest}
      {paint && selection.length === 2 && (
        <WormholePairButton
          a={selection[0]}
          b={selection[1]}
          afterRun={afterRun}
          itemRole={itemRole}
        />
      )}
      {supports(capabilities, "create_systems") && selection.length === 3 && (
        <MarauderClanButton ids={selection} afterRun={afterRun} itemRole={itemRole} />
      )}
    </>
  );
}

/** Three selected systems on a scenario: made the next free marauder clan, the middle one its home. */
export function MarauderClanButton({
  ids,
  afterRun,
  itemRole,
}: {
  ids: readonly number[];
  afterRun?: () => void;
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
        if (item.clan !== null) void makeMarauderClan(item.clan.home, item.clan.bases);
        afterRun?.();
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
  afterRun,
  itemRole,
}: {
  a: number;
  b: number;
  afterRun?: () => void;
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
        void run(a, b);
        afterRun?.();
      }}
    >
      {shared === null ? "Link as wormhole pair" : "Unlink wormhole pair"}
    </button>
  );
}

function MeshRow({ afterRun, itemRole }: { afterRun?: () => void; itemRole?: "menuitem" }) {
  const selection = useEditorStore((s) => s.selection);
  const meshBeta = useMapChromeStore((s) => s.meshBeta);
  const setMeshBeta = useMapChromeStore((s) => s.setMeshBeta);
  const setLanePreview = useMapChromeStore((s) => s.setLanePreview);
  const connectSelectedMesh = useEditorStore((s) => s.connectSelectedMesh);
  const galaxy = useGalaxyStore(useShallow((s) => ({ systems: s.systems, version: s.version })));
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const pairs = useMemo(
    () => meshLanes(galaxy.systems, selection, meshBeta),
    [galaxy, selection, meshBeta],
  );
  const previewing = hovered || focused;
  useEffect(() => {
    if (!previewing) return;
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
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={sliderOfBeta(meshBeta)}
          onChange={(e) => setMeshBeta(betaOfSlider(Number(e.target.value)))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label="Mesh density"
        />
        <span className="muted">dense</span>
      </label>
      <button
        type="button"
        role={itemRole}
        disabled={pairs.length === 0}
        onClick={() => {
          void connectSelectedMesh();
          afterRun?.();
        }}
      >
        Connect as mesh ({pairs.length})
      </button>
    </div>
  );
}
