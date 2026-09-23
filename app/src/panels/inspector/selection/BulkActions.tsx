import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { CONNECT_ALL_MAX, useEditorStore } from "../../../store/editorStore";
import { documentCapabilities, supports } from "../../../lib/capabilities";
import {
  bulkStarClassChoices,
  planStarClass,
  skippedNote,
  starBodies,
  type StarClassTarget,
} from "../../../lib/details/starClass";
import { clanMenuItem, nextFreeClan } from "../../../lib/marauder";
import { sharedWormholePair } from "../../../lib/paint";
import { counted } from "../../../lib/text";
import { useDetailsStore } from "../../../store/detailsStore";
import { useFileSessionStore, usePaintLayer } from "../../../store/fileSessionStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useMapChromeStore } from "../../../store/mapChromeStore";
import {
  linkedSystems,
  meshLanes,
  selectionLanes,
  staleLaneCount,
  useGalaxyStore,
} from "../../../store/galaxyStore";
import { IconPicker } from "../../IconPicker";
import { NEEDS_GAME_DATA } from "../../initializers/entry";
import { LaneDensitySlider } from "../../LaneDensitySlider";
import { useApplyOp } from "../../useApplyOp";
import { useStarClassItems } from "../useStarClassItems";

/** Above this many selected systems the mesh is worked out only while its row is previewed. */
const MESH_COUNT_MAX = 1000;

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
  const removeSystems = useEditorStore((s) => s.removeSystems);
  const systems = useGalaxyStore((s) => s.systems);
  const capabilities = useFileSessionStore(documentCapabilities);
  const paint = usePaintLayer();

  const laneLengths = supports(capabilities, "lane_lengths");
  const counts = useMemo(
    () => ({
      lanes: selectionLanes(systems, selection),
      laned: linkedSystems(systems, selection).length,
      stale: laneLengths ? staleLaneCount(systems, selection) : 0,
    }),
    [systems, selection, laneLengths],
  );

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
      {supports(capabilities, "create_systems") && selection.length > 1 && (
        <button
          type="button"
          role={itemRole}
          onClick={() => {
            void removeSystems(selection);
            afterRun?.();
          }}
        >
          Delete systems ({selection.length})
        </button>
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

/**
 * Several save systems selected: one star class for every one with as many stars, as one edit,
 * and a note of the systems it left alone. Their details are read first, for their star bodies.
 */
export function BulkStarClass({ ids }: { ids: readonly number[] }) {
  const applyOp = useApplyOp();
  const request = useDetailsStore((s) => s.request);
  const version = useDetailsStore((s) => s.version);
  const details = useDetailsStore((s) => s.details);
  const pending = useDetailsStore((s) => s.pending);
  const failed = useDetailsStore((s) => s.failed);
  const systems = useGalaxyStore((s) => s.systems);
  const gameData = useGameDataStore((s) => s.status === "ready");
  const names = useGameDataStore((s) => s.names);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const [note, setNote] = useState<{ ids: readonly number[]; text: string | null } | null>(null);

  useEffect(() => {
    if (gameData) request(ids);
  }, [gameData, ids, request, version]);

  const targets = useMemo(
    () =>
      ids.flatMap((id): StarClassTarget[] => {
        const system = systems.get(id);
        if (!system) return [];
        const read = details.get(id);
        const bodies = read ? starBodies(read.planets, planetClasses, starClasses) : null;
        return [{ system, bodies }];
      }),
    [ids, systems, details, planetClasses, starClasses],
  );
  const choices = bulkStarClassChoices(targets, starClasses);
  const items = useStarClassItems(choices);

  const label = `Star class… (${counted(targets.length, "system")})`;
  if (!gameData) {
    return (
      <button type="button" disabled title={NEEDS_GAME_DATA}>
        {label}
      </button>
    );
  }
  const waiting = targets.filter((t) => t.bodies === null && !failed.has(t.system.id));
  const loading =
    waiting.some((t) => pending.has(t.system.id)) ||
    (waiting.length > 0 && waiting.length === targets.length);
  if (loading || choices.length === 0) {
    return (
      <button type="button" disabled>
        {loading ? "Star class… (loading…)" : label}
      </button>
    );
  }

  const pick = (key: string) => {
    const target = starClasses.get(key);
    if (!target) return;
    const name = names.get(key) ?? key;
    const plan = planStarClass(targets, target, name, starClasses);
    if (plan.op) applyOp(plan.op);
    setNote({ ids, text: skippedNote(plan.skipped, name) });
  };
  return (
    <>
      <IconPicker
        label="Star class"
        title="Change the star class of the selected systems with as many stars"
        current={{ key: "", label }}
        items={items}
        onPick={pick}
      />
      {note?.ids === ids && note.text !== null && <div className="muted ins-hint">{note.text}</div>}
    </>
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
          void connectSelectedMesh();
          afterRun?.();
        }}
      >
        Connect as mesh{pairs === null ? "" : ` (${pairs.length})`}
      </button>
    </div>
  );
}
