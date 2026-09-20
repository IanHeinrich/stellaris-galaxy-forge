import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { MESH_BETA } from "../../../lib/geometry/mesh";
import { CONNECT_ALL_MAX, useEditorStore } from "../../../store/editorStore";
import { documentCapabilities, supports } from "../../../lib/capabilities";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useMapChromeStore } from "../../../store/mapChromeStore";
import {
  linkedPairs,
  linkedSystems,
  meshLanes,
  staleLaneCount,
  unlinkedPairs,
  useGalaxyStore,
} from "../../../store/galaxyStore";

const LOG_SPARSE = Math.log(MESH_BETA.sparse);
const LOG_SPAN = Math.log(MESH_BETA.dense) - LOG_SPARSE;

/** Slider position in [0, 1] to β, linear in log β so the Gabriel graph sits mid-slider. */
function sliderToBeta(v: number): number {
  if (v <= 0) return MESH_BETA.sparse;
  if (v >= 1) return MESH_BETA.dense;
  return Math.exp(LOG_SPARSE + v * LOG_SPAN);
}

function betaToSlider(beta: number): number {
  return (Math.log(beta) - LOG_SPARSE) / LOG_SPAN;
}

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
    </>
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
          value={betaToSlider(meshBeta)}
          onChange={(e) => setMeshBeta(sliderToBeta(Number(e.target.value)))}
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
