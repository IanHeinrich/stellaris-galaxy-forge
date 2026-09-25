import type { StoreApi } from "zustand";
import * as ipc from "../api/ipc";
import type { NameTemplate } from "../generated/NameTemplate";
import { templateKey } from "../lib/names";
import { NAMES_BATCH } from "./batching";
import type { GameDataState } from "./gameDataStore";
import { useGalaxyStore } from "./galaxyStore";

/** The templates a render asked for, resolved together on the next tick. */
let queued: NameTemplate[] = [];
let flushing: ReturnType<typeof setTimeout> | null = null;
/** Every name already asked for, so a miss is asked for once however often it is shown. */
const requested = new Set<string>();

/** Drops what was resolved from the game data that is going away, and what was asked for. */
export function forgetNames(): Map<string, string> {
  requested.clear();
  queued = [];
  return new Map();
}

type NameActions = Pick<
  GameDataState,
  "fetchNames" | "resolveNames" | "requestName" | "displayNameOf"
>;

/** Name resolution: localisation keys and name templates, each asked for once per game data. */
export function nameActions(
  set: StoreApi<GameDataState>["setState"],
  get: StoreApi<GameDataState>["getState"],
): NameActions {
  /** The guard a batch loop takes when its caller holds none: the game data must not change hands. */
  function sameGameData(): () => boolean {
    const { status, version } = get();
    return () => {
      const now = get();
      return now.status === status && now.version === version;
    };
  }

  return {
    async fetchNames(keys, alive) {
      if (get().status !== "ready") return;
      const known = get().names;
      const wanted = [...new Set(keys)].filter((key) => !known.has(key));
      const still = alive ?? sameGameData();
      for (let i = 0; i < wanted.length; i += NAMES_BATCH) {
        try {
          const resolved = await ipc.getNames(wanted.slice(i, i + NAMES_BATCH));
          if (!still()) return;
          const names = new Map(get().names);
          for (const [key, name] of Object.entries(resolved)) names.set(key, name);
          set({ names });
        } catch (e) {
          if (still()) set({ error: ipc.errorMessage(e) });
          return;
        }
      }
    },

    async resolveNames(names, alive) {
      const wanted = names.filter((name) => {
        const key = templateKey(name);
        if (get().names.has(key) || requested.has(key)) return false;
        requested.add(key);
        return true;
      });
      const still = alive ?? sameGameData();
      for (let i = 0; i < wanted.length; i += NAMES_BATCH) {
        const batch = wanted.slice(i, i + NAMES_BATCH);
        try {
          const resolved = await ipc.resolveNames(batch);
          if (!still()) return;
          const names = new Map(get().names);
          batch.forEach((name, n) => names.set(templateKey(name), resolved[n] ?? ""));
          set({ names });
        } catch (e) {
          for (const name of batch) requested.delete(templateKey(name));
          if (still()) set({ error: ipc.errorMessage(e) });
          return;
        }
      }
    },

    requestName(name) {
      const key = templateKey(name);
      if (get().names.has(key) || requested.has(key)) return;
      queued.push(name);
      flushing ??= setTimeout(() => {
        flushing = null;
        const batch = queued;
        queued = [];
        void get().resolveNames(batch);
      });
    },

    displayNameOf(key) {
      return get().names.get(key);
    },
  };
}

/** Every localisation key the open galaxy shows: the names of its systems and nebulae. */
export function nameKeys(): string[] {
  const { galaxy } = useGalaxyStore.getState();
  if (galaxy === null) return [];
  return [...galaxy.systems, ...galaxy.nebulae]
    .map((node) => node.name)
    .filter((name) => !name.literal)
    .map((name) => name.key);
}

/** The name template of every country in the open galaxy. */
export function countryNames(): NameTemplate[] {
  return useGalaxyStore.getState().galaxy?.countries.map((c) => c.name) ?? [];
}
