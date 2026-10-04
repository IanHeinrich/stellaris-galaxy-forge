import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { AnomalyChoice } from "../generated/AnomalyChoice";
import type { ColonyTypeView } from "../generated/ColonyTypeView";
import type { DepositTypeView } from "../generated/DepositTypeView";
import type { DigSiteChoice } from "../generated/DigSiteChoice";
import type { ModifierView } from "../generated/ModifierView";
import { useGameDataStore } from "./gameDataStore";

/** The game data keys one planet page shows, each read once per loaded game data. */
export interface PlanetDataKeys {
  deposits: readonly string[];
  modifiers: readonly string[];
  colonyTypes: readonly string[];
  /** Anomaly categories, described by the game's anomaly list. */
  anomalies: readonly string[];
  /** Dig site types, whose stages and description the game's site list gives. */
  digSites: readonly string[];
}

export interface PlanetDataState {
  depositTypes: Map<string, DepositTypeView>;
  modifiers: Map<string, ModifierView>;
  colonyTypes: Map<string, ColonyTypeView>;
  anomalies: Map<string, AnomalyChoice>;
  digSites: Map<string, DigSiteChoice>;
  /** Bumped by `clear`, so a page asks again for what the new game data defines. */
  generation: number;
  /** Reads the keys not yet asked for; a no-op without game data. */
  request(keys: PlanetDataKeys): void;
  clear(): void;
}

type KeyedKind = "deposits" | "modifiers" | "colonyTypes";
type ListedKind = "anomalies" | "digSites";

/** Every key already asked for, so one the game data does not define is asked for once. */
const requested: Record<KeyedKind, Set<string>> = {
  deposits: new Set<string>(),
  modifiers: new Set<string>(),
  colonyTypes: new Set<string>(),
};

/** The lists read whole on the first key a page shows, since the game data offers no read by key. */
const listed: Record<ListedKind, boolean> = { anomalies: false, digSites: false };

function unasked(kind: KeyedKind, keys: readonly string[]): string[] {
  const asked = requested[kind];
  const wanted = [...new Set(keys)].filter((key) => !asked.has(key));
  for (const key of wanted) asked.add(key);
  return wanted;
}

/** Hands `views` to `land` while `alive`; a read that failed is asked again on the next render. */
function settle<T>(
  kind: string,
  views: Promise<T[]>,
  alive: () => boolean,
  land: (views: T[]) => void,
  retry: () => void,
): void {
  views.then(
    (read) => {
      if (alive()) land(read);
    },
    (e: unknown) => {
      if (alive()) retry();
      console.warn("planet page", kind, ipc.errorMessage(e));
    },
  );
}

/** Reads the keys of `kind` not asked for yet and hands their views to `land`, while `alive`. */
function read<T>(
  kind: KeyedKind,
  keys: readonly string[],
  fetch: (keys: string[]) => Promise<T[]>,
  alive: () => boolean,
  land: (views: T[]) => void,
): void {
  const wanted = unasked(kind, keys);
  if (wanted.length === 0) return;
  settle(kind, fetch(wanted), alive, land, () => {
    for (const key of wanted) requested[kind].delete(key);
  });
}

/** Reads the whole list of `kind` the first time a page shows any of its keys. */
function readList<T>(
  kind: ListedKind,
  keys: readonly string[],
  fetch: () => Promise<T[]>,
  alive: () => boolean,
  land: (views: T[]) => void,
): void {
  if (keys.length === 0 || listed[kind]) return;
  listed[kind] = true;
  settle(kind, fetch(), alive, land, () => {
    listed[kind] = false;
  });
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
  anomalies: new Map(),
  digSites: new Map(),
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
    readList(
      "anomalies",
      keys.anomalies,
      () => ipc.getAnomalyChoices(null, null, false),
      alive,
      (views) => set({ anomalies: merged(new Map(), views) }),
    );
    readList("digSites", keys.digSites, ipc.getDigSiteChoices, alive, (views) =>
      set({ digSites: merged(new Map(), views) }),
    );
  },

  clear() {
    for (const asked of Object.values(requested)) asked.clear();
    listed.anomalies = false;
    listed.digSites = false;
    set({
      depositTypes: new Map(),
      modifiers: new Map(),
      colonyTypes: new Map(),
      anomalies: new Map(),
      digSites: new Map(),
      generation: get().generation + 1,
    });
  },
}));
