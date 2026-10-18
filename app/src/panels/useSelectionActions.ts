import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  CONNECT_ALL_MAX,
  deletableSystems,
  useEditorStore,
  type EditorState,
} from "../store/editorStore";
import { deleteAddedLabel } from "../lib/addSystem";
import { documentCapabilities } from "../lib/capabilities";
import { everyPairLimit, type LinkChoice } from "../lib/selectionCopy";
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
  /** Lanes touching a selected system whose length is not the game's; null where lengths are not edited. */
  stale: number | null;
  /** Why every pair cannot be linked, past `CONNECT_ALL_MAX` systems. */
  everyPairRefusal: string | null;
}

/** Why `count` selected systems are too many to link every pair of, or null. */
export function everyPairRefusal(count: number): string | null {
  return count > CONNECT_ALL_MAX ? everyPairLimit(CONNECT_ALL_MAX) : null;
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
      everyPairRefusal: everyPairRefusal(selection.length),
    };
  }, [systems, selection, laneLengths]);
}

/** The way Add lanes links: the player's pick, unless the limit rules Every pair out. */
export function linkChoice(picked: LinkChoice, refusal: string | null): LinkChoice {
  return refusal === null ? picked : "nearby";
}

/** The store action Add lanes runs for each way of linking. */
const ADD_LANES_ACTION = {
  every: "connectSelected",
  nearby: "connectSelectedMesh",
} as const satisfies Record<LinkChoice, keyof EditorState>;

/** Adds the lanes `link` says among the selected systems, as one edit. */
export function addLanes(link: LinkChoice): Promise<void> {
  return useEditorStore.getState()[ADD_LANES_ACTION[link]]();
}

/** The lanes the map previews: an action's lanes while it is pointed at or focused, else none. */
export function previewedLanes(
  previewing: boolean,
  pairs: Array<[number, number]> | null,
): Array<[number, number]> | null {
  return previewing ? pairs : null;
}

/** Shows `pairs` as the lanes an action would add, and returns what takes them off again. */
export function showLanePreview(
  pairs: Array<[number, number]> | null,
  setLanePreview: (pairs: Array<[number, number]> | null) => void,
): (() => void) | undefined {
  if (pairs === null) return undefined;
  setLanePreview(pairs);
  return () => setLanePreview(null);
}

/** Shows `pairs` on the map as the lanes an action would add, until they change or go. */
export function useLanePreview(pairs: Array<[number, number]> | null): void {
  const setLanePreview = useMapChromeStore((s) => s.setLanePreview);
  useEffect(() => showLanePreview(pairs, setLanePreview), [pairs, setLanePreview]);
}

/**
 * The lanes linking the selection to its neighbours would add, at the Lane density and island
 * setting. Null when `enabled` is off, and for a selection over `MESH_COUNT_MAX` unless `previewing`.
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
  return useMemo(
    () => (counted ? meshLanes(galaxy.systems, selection, laneDensity, laneIslands) : null),
    [counted, galaxy, selection, laneDensity, laneIslands],
  );
}

/** The lanes linking every pair of selected systems would add; null when `enabled` is off or past the limit. */
export function useEveryPairLanes(enabled: boolean): Array<[number, number]> | null {
  const selection = useEditorStore((s) => s.selection);
  const systems = useGalaxyStore((s) => s.systems);
  return useMemo(
    () =>
      enabled && everyPairRefusal(selection.length) === null
        ? unlinkedPairs(systems, selection)
        : null,
    [enabled, systems, selection],
  );
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
