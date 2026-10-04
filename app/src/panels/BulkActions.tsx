import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  CONNECT_ALL_MAX,
  deletableSystems,
  useEditorStore,
  type HeightChange,
} from "../store/editorStore";
import { deleteAddedLabel } from "../lib/addSystem";
import { documentCapabilities } from "../lib/capabilities";
import { heightTint, isFlat, relativeHeight } from "../lib/height";
import { clanMenuItem, nextFreeClan } from "../lib/marauder";
import { sharedWormholePair } from "../lib/paint";
import { wormholePairAction, type WormholePairAction } from "../lib/wormholes";
import { useCanEdit, useFileSessionStore, usePaintLayer } from "../store/fileSessionStore";
import { useMapChromeStore } from "../store/mapChromeStore";
import {
  linkedSystems,
  meshLanes,
  selectionLanes,
  staleLaneCount,
  useGalaxyStore,
} from "../store/galaxyStore";
import { toCss } from "../lib/visual/ownerColors";
import { TextField } from "./EditField";
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
  const wormholePairs = useCanEdit("wormhole_pairs");
  const heights = useCanEdit("system_heights");

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
      {(paint || wormholePairs) && selection.length === 2 && (
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
      {heights && itemRole === undefined && <BulkHeight ids={selection} />}
    </>
  );
}

const HEIGHT_CHANGES: ReadonlyArray<{ change: HeightChange; label: string }> = [
  { change: "set", label: "Set to" },
  { change: "raise", label: "Raise by" },
  { change: "lower", label: "Lower by" },
];

const STRIP_WIDTH = 300;
const STRIP_HEIGHT = 34;
const STRIP_PAD = 8;
const STRIP_AXIS_Y = 13;
/** How close an end's label may come to the 0 label before it is left out. */
const STRIP_LABEL_GAP = 20;

/** Where each shown height sits on a strip from the lowest to the highest, 0 always on it. */
function stripScale(heights: readonly number[]): {
  lo: number;
  hi: number;
  x: (h: number) => number;
} {
  const lo = heights.reduce((m, h) => Math.min(m, h), 0);
  const hi = heights.reduce((m, h) => Math.max(m, h), 0);
  const x = (h: number) =>
    STRIP_PAD + (hi === lo ? 0.5 : (h - lo) / (hi - lo)) * (STRIP_WIDTH - 2 * STRIP_PAD);
  return { lo, hi, x };
}

function heightLabel(h: number): string {
  return String(Math.round(h));
}

/** The selected systems' shown heights as dots on one axis, coloured as the map tints them. */
function HeightStrip({ heights }: { heights: readonly number[] }) {
  const { lo, hi, x } = stripScale(heights);
  const zero = x(0);
  return (
    <svg
      className="height-strip"
      viewBox={`0 0 ${STRIP_WIDTH} ${STRIP_HEIGHT}`}
      role="img"
      aria-label="Heights of the selected systems"
    >
      <line
        className="height-strip-axis"
        x1={STRIP_PAD}
        x2={STRIP_WIDTH - STRIP_PAD}
        y1={STRIP_AXIS_Y}
        y2={STRIP_AXIS_Y}
      />
      <line className="height-strip-zero" x1={zero} x2={zero} y1={4} y2={STRIP_AXIS_Y + 9} />
      {heights.map((h, i) => (
        <circle
          key={i}
          className="height-dot"
          cx={x(h)}
          cy={STRIP_AXIS_Y}
          r={3}
          fill={toCss(heightTint(h))}
        />
      ))}
      {zero - x(lo) > STRIP_LABEL_GAP && (
        <text x={STRIP_PAD} y={STRIP_HEIGHT - 2} textAnchor="start">
          {heightLabel(lo)}
        </text>
      )}
      <text x={zero} y={STRIP_HEIGHT - 2} textAnchor="middle">
        0
      </text>
      {x(hi) - zero > STRIP_LABEL_GAP && (
        <text x={STRIP_WIDTH - STRIP_PAD} y={STRIP_HEIGHT - 2} textAnchor="end">
          {heightLabel(hi)}
        </text>
      )}
    </svg>
  );
}

/**
 * Several save systems selected: where their heights stand, and one edit that sets, raises or
 * lowers them all, or puts them back on the plane.
 */
function BulkHeight({ ids }: { ids: readonly number[] }) {
  const systems = useGalaxyStore((s) => s.systems);
  const setSelectedHeights = useEditorStore((s) => s.setSelectedHeights);
  const flattenSelected = useEditorStore((s) => s.flattenSelected);
  const [change, setChange] = useState<HeightChange>("set");
  const [value, setValue] = useState(0);
  const heights = useMemo(
    () =>
      ids.flatMap((id) => {
        const system = systems.get(id);
        return system ? [relativeHeight(system.height)] : [];
      }),
    [ids, systems],
  );
  const raised = heights.filter((h) => !isFlat(h)).length;
  return (
    <div className="height-group" role="group" aria-label="Height">
      <div className="edit-block-title">Height</div>
      <HeightStrip heights={heights} />
      <div className="segmented" role="group" aria-label="Height change">
        {HEIGHT_CHANGES.map(({ change: c, label }) => (
          <button key={c} type="button" aria-pressed={change === c} onClick={() => setChange(c)}>
            {label}
          </button>
        ))}
      </div>
      <div className="height-apply">
        <TextField
          kind="number"
          className="coord"
          label="Height value"
          value={value}
          onCommit={setValue}
        />
        <button type="button" onClick={() => void setSelectedHeights(change, value)}>
          Apply
        </button>
      </div>
      <button type="button" disabled={raised === 0} onClick={() => void flattenSelected()}>
        Flatten ({raised})
      </button>
      <div className="muted height-hint">Back to the game&apos;s default height</div>
    </div>
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

/**
 * Two selected systems under the Paint a Galaxy layer, or in a save that takes wormhole pairs:
 * made a wormhole pair, or parted again. In a save it is hidden when either system holds a
 * natural wormhole or shroud tunnel that does not join the two.
 */
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
  const bypasses = useGalaxyStore((s) => s.bypasses);
  const save = useCanEdit("wormhole_pairs");
  const action: WormholePairAction = save
    ? wormholePairAction(bypasses, a, b)
    : sharedWormholePair(systems, a, b) === null
      ? "link"
      : "unlink";
  if (action === null) return null;
  const run = action === "link" ? linkWormholePair : unlinkWormholePair;
  return (
    <button
      type="button"
      role={itemRole}
      onClick={() => {
        dismiss?.();
        void run(a, b);
      }}
    >
      {action === "link" ? "Link as wormhole pair" : "Unlink wormhole pair"}
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
