import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { ColonyTypeView } from "../generated/ColonyTypeView";
import type { DepositTypeView } from "../generated/DepositTypeView";
import type { ModifierView } from "../generated/ModifierView";
import { useGameDataStore } from "./gameDataStore";

/** The game data keys one planet page shows, each read once per loaded game data. */
export interface PlanetDataKeys {
  deposits: readonly string[];
  modifiers: readonly string[];
  colonyTypes: readonly string[];
}

export interface PlanetDataState {
  depositTypes: Map<string, DepositTypeView>;
  modifiers: Map<string, ModifierView>;
  colonyTypes: Map<string, ColonyTypeView>;
  /** Bumped by `clear`, so a page asks again for what the new game data defines. */
  generation: number;
  /** Reads the keys not yet asked for; a no-op without game data. */
  request(keys: PlanetDataKeys): void;
  clear(): void;
}

/** Every key already asked for, so one the game data does not define is asked for once. */
const requested = {
  deposits: new Set<string>(),
  modifiers: new Set<string>(),
  colonyTypes: new Set<string>(),
};

function unasked(kind: keyof PlanetDataKeys, keys: readonly string[]): string[] {
  const asked = requested[kind];
  const wanted = [...new Set(keys)].filter((key) => !asked.has(key));
  for (const key of wanted) asked.add(key);
  return wanted;
}

/** A read that failed leaves its keys unasked, so the next render asks again. */
function failed(kind: keyof PlanetDataKeys, keys: readonly string[]): (e: unknown) => void {
  return (e) => {
    for (const key of keys) requested[kind].delete(key);
    console.warn("planet page", kind, ipc.errorMessage(e));
  };
}

/** Reads the keys of `kind` not asked for yet and hands their views to `land`, while `alive`. */
function read<T>(
  kind: keyof PlanetDataKeys,
  keys: readonly string[],
  fetch: (keys: string[]) => Promise<T[]>,
  alive: () => boolean,
  land: (views: T[]) => void,
): void {
  const wanted = unasked(kind, keys);
  if (wanted.length === 0) return;
  fetch(wanted).then(
    (views) => {
      if (alive()) land(views);
    },
    failed(kind, wanted),
  );
}

/** Views by their key, laid over what was already read. */
function merged<T extends { key: string }>(
  known: Map<string, T>,
  views: readonly T[],
): Map<string, T> {
  const next = new Map(known);
  for (const view of views) next.set(view.key, view);
  return next;
}

export const usePlanetDataStore = create<PlanetDataState>((set, get) => ({
  depositTypes: new Map(),
  modifiers: new Map(),
  colonyTypes: new Map(),
  generation: 0,

  request(keys) {
    if (useGameDataStore.getState().status !== "ready") return;
    const generation = get().generation;
    const alive = () => get().generation === generation;
    read("deposits", keys.deposits, ipc.getDepositTypes, alive, (views) =>
      set({ depositTypes: merged(get().depositTypes, views) }),
    );
    read("modifiers", keys.modifiers, ipc.getModifiers, alive, (views) =>
      set({ modifiers: merged(get().modifiers, views) }),
    );
    read("colonyTypes", keys.colonyTypes, ipc.getColonyTypes, alive, (views) =>
      set({ colonyTypes: merged(get().colonyTypes, views) }),
    );
  },

  clear() {
    for (const asked of Object.values(requested)) asked.clear();
    set({
      depositTypes: new Map(),
      modifiers: new Map(),
      colonyTypes: new Map(),
      generation: get().generation + 1,
    });
  },
}));
