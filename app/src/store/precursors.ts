import { useSyncExternalStore } from "react";
import type { PrecursorView } from "../generated/PrecursorView";
import type { SystemNode } from "../generated/SystemNode";
import { composePrecursors, NO_PRECURSORS, type PrecursorRegions } from "../lib/precursors";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";

interface PrecursorsInput {
  readonly systems: ReadonlyMap<number, SystemNode>;
  readonly precursors: readonly PrecursorView[];
}

let composedFrom: PrecursorsInput | null = null;
let composed: PrecursorRegions = NO_PRECURSORS;

function inputNow(): PrecursorsInput {
  const galaxy = useGalaxyStore.getState();
  const data = useGameDataStore.getState();
  return { systems: galaxy.systems, precursors: data.precursors };
}

function sameInput(a: PrecursorsInput, b: PrecursorsInput): boolean {
  return a.systems === b.systems && a.precursors === b.precursors;
}

/**
 * Each system's precursors, as the stores stand: composed once per change to what it reads and
 * kept by identity while an edit leaves it as it was.
 */
export function currentPrecursors(): PrecursorRegions {
  const input = inputNow();
  if (composedFrom === null || !sameInput(composedFrom, input)) {
    composedFrom = input;
    composed = composePrecursors(input.systems, input.precursors);
  }
  return composed;
}

/** Calls `listener` whenever anything `currentPrecursors` is composed from changes. */
export function subscribePrecursors(listener: () => void): () => void {
  const offs = [
    useGalaxyStore.subscribe((s, prev) => {
      if (s.systems !== prev.systems) listener();
    }),
    useGameDataStore.subscribe((s, prev) => {
      if (s.precursors !== prev.precursors) listener();
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}

/** The same, re-rendered when anything it is composed from changes. */
export function usePrecursors(): PrecursorRegions {
  return useSyncExternalStore(subscribePrecursors, currentPrecursors, currentPrecursors);
}
