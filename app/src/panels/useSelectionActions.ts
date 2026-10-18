import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { CONNECT_ALL_MAX, deletableSystems, useEditorStore } from "../store/editorStore";
import { deleteAddedLabel } from "../lib/addSystem";
import { documentCapabilities } from "../lib/capabilities";
import { everyPairLimit } from "../lib/selectionCopy";
import { arrangeRefusal, spreadOf } from "../lib/shapes/arrange";
import { useCanEdit, useFileSessionStore } from "../store/fileSessionStore";
import { useMapChromeStore } from "../store/mapChromeStore";
import { useBarMode } from "../store/sceneStore";
import { toolAllowed, useToolStore } from "../store/toolStore";
import {
  linkedSystems,
  meshLanes,
  selectionLanes,
  staleLaneCount,
  unlinkedPairs,
  useGalaxyStore,
} from "../store/galaxyStore";

/** Above this many selected systems the nearby lanes are worked out only while they are previewed. */
const MESH_COUNT_MAX = 1000;

/** What the selection's lane actions would change, which the Inspector page and the map's menu both count. */
export interface BulkLanes {
  /** Pairs of selected systems with no lane between them. */
  unlinked: number;
  /** Lanes between two selected systems. */
  linked: number;
  /** Selected systems with any lane. */
  laned: number;
  /** Lanes between selected systems whose length is not the game's; null where lengths are not edited. */
  stale: number | null;
  /** Why every pair cannot be linked, past `CONNECT_ALL_MAX` systems. */
  everyPairRefusal: string | null;
}

export function useBulkLanes(): BulkLanes {
  const selection = useEditorStore((s) => s.selection);
  const systems = useGalaxyStore((s) => s.systems);
  const laneLengths = useCanEdit("lane_lengths");
  return useMemo(() => {
    const lanes = selectionLanes(systems, selection);
    return {
      unlinked: lanes.unlinked,
      linked: lanes.linked.length,
      laned: linkedSystems(systems, selection).length,
      stale: laneLengths ? staleLaneCount(systems, selection) : null,
      everyPairRefusal: selection.length > CONNECT_ALL_MAX ? everyPairLimit(CONNECT_ALL_MAX) : null,
    };
  }, [systems, selection, laneLengths]);
}

/** Shows `pairs` on the map as the lanes an action would add, until they change or go. */
export function useLanePreview(pairs: Array<[number, number]> | null): void {
  const setLanePreview = useMapChromeStore((s) => s.setLanePreview);
  useEffect(() => {
    if (pairs === null) return;
    setLanePreview(pairs);
    return () => setLanePreview(null);
  }, [pairs, setLanePreview]);
}

/**
 * The lanes linking the selection to its neighbours would add, at the Lane density and island
 * setting, previewed while `previewing`. Null when `enabled` is off, and for a selection over
 * `MESH_COUNT_MAX` while it is not previewed.
 */
export function useNearbyLanes(
  enabled: boolean,
  previewing: boolean,
): Array<[number, number]> | null {
  const selection = useEditorStore((s) => s.selection);
  const laneDensity = useMapChromeStore((s) => s.laneDensity);
  const laneIslands = useMapChromeStore((s) => s.laneIslands);
  const galaxy = useGalaxyStore(useShallow((s) => ({ systems: s.systems, version: s.version })));
  const counted = enabled && (previewing || selection.length <= MESH_COUNT_MAX);
  const pairs = useMemo(
    () => (counted ? meshLanes(galaxy.systems, selection, laneDensity, laneIslands) : null),
    [counted, galaxy, selection, laneDensity, laneIslands],
  );
  useLanePreview(previewing ? pairs : null);
  return pairs;
}

/** The lanes linking every pair of selected systems would add, previewed while `previewing`; null past the limit. */
export function useEveryPairLanes(
  enabled: boolean,
  previewing: boolean,
): Array<[number, number]> | null {
  const selection = useEditorStore((s) => s.selection);
  const systems = useGalaxyStore((s) => s.systems);
  const pairs = useMemo(
    () =>
      enabled && selection.length <= CONNECT_ALL_MAX ? unlinkedPairs(systems, selection) : null,
    [enabled, systems, selection],
  );
  useLanePreview(previewing ? pairs : null);
  return pairs;
}

/**
 * Opening the Shape tool to move `ids` onto a shape, centred where the menu was opened, or among
 * them from the inspector; off under symmetry, with the reason. Null where the Shape tool is not
 * offered.
 */
export function useArrange(
  ids: readonly number[],
): { refusal: string | null; run: () => void } | null {
  const at = useMapChromeStore((s) => s.contextMenu?.at ?? null);
  const systems = useGalaxyStore((s) => s.systems);
  const symmetry = useToolStore((s) => s.symmetry);
  const startArrange = useToolStore((s) => s.startArrange);
  const barMode = useBarMode();
  if (ids.length < 2 || !toolAllowed("shape", barMode)) return null;
  return {
    refusal: arrangeRefusal(ids.length, symmetry),
    run: () => startArrange(ids, at ?? spreadOf(ids.flatMap((id) => systems.get(id) ?? [])).mid),
  };
}

/**
 * Deleting the selection: every system where the document deletes them, or the added ones of a
 * save, labelled with what it skips. Null for one system or none it can delete.
 */
export function useSelectionDeletion():
  { kind: "systems"; run: () => void } | { kind: "added"; label: string; run: () => void } | null {
  const selection = useEditorStore((s) => s.selection);
  const removeSystems = useEditorStore((s) => s.removeSystems);
  const systems = useGalaxyStore((s) => s.systems);
  const capabilities = useFileSessionStore(documentCapabilities);
  const deletable = useMemo(
    () => deletableSystems(selection, capabilities, systems),
    [selection, capabilities, systems],
  );
  if (deletable === null || selection.length < 2) return null;
  const run = () => void removeSystems(selection);
  if (deletable.kind === "systems") return { kind: "systems", run };
  if (deletable.kind !== "added") return null;
  const label = deleteAddedLabel(deletable.ids.length, selection.length - deletable.ids.length);
  return label === null ? null : { kind: "added", label, run };
}
