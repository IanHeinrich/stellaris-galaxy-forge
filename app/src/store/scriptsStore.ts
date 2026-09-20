import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { SystemScripts } from "../generated/SystemScripts";

export interface ScriptsState {
  /** What the loaded scripts say about each system asked for so far. */
  scripts: Map<number, SystemScripts>;
  /** Asked for and not yet answered. */
  pending: Set<number>;
  /** Systems the backend has no scripts for; there is nothing to ask again for. */
  missing: Set<number>;
  /** Systems whose reading failed, by the message to show; asking again waits for an edit or a reload. */
  failed: Map<number, string>;
  /** Bumped whenever an answer lands or the cache is dropped. */
  version: number;
  /** Reads one system's scripts once; a second ask waits for the first. */
  request(id: number): void;
  /** Drops what an edit may have changed, so the next ask reads it again. */
  invalidate(ids: Iterable<number>): void;
  /** Drops everything the game data that is going away answered. */
  clear(): void;
}

/** Bumped by `clear`, so an answer from the game data that is gone is thrown away. */
let generation = 0;

export const useScriptsStore = create<ScriptsState>((set, get) => ({
  scripts: new Map(),
  pending: new Set(),
  missing: new Set(),
  failed: new Map(),
  version: 0,

  request(id) {
    const { scripts, pending, missing, failed } = get();
    // A failure is not retried on its own: its own version bump would ask again forever.
    if (scripts.has(id) || pending.has(id) || missing.has(id) || failed.has(id)) return;
    set({ pending: new Set(pending).add(id) });
    void fetchScripts(id, generation);
  },

  invalidate(ids) {
    const scripts = new Map(get().scripts);
    const missing = new Set(get().missing);
    const failed = new Map(get().failed);
    let dropped = false;
    for (const id of ids) {
      if (scripts.delete(id) || missing.delete(id) || failed.delete(id)) dropped = true;
    }
    if (dropped) set({ scripts, missing, failed, version: get().version + 1 });
  },

  clear() {
    generation++;
    set({
      scripts: new Map(),
      pending: new Set(),
      missing: new Set(),
      failed: new Map(),
      version: get().version + 1,
    });
  },
}));

async function fetchScripts(id: number, gen: number): Promise<void> {
  let result: SystemScripts | null;
  try {
    result = await ipc.getSystemScripts(id);
  } catch (e) {
    if (gen === generation) settle(id, { failed: ipc.errorMessage(e) });
    return;
  }
  if (gen === generation) settle(id, result ? { scripts: result } : {});
}

/** Takes one system out of `pending` and records whatever came back for it. */
function settle(id: number, outcome: { scripts?: SystemScripts; failed?: string }): void {
  const state = useScriptsStore.getState();
  const pending = new Set(state.pending);
  pending.delete(id);
  const scripts = new Map(state.scripts);
  const missing = new Set(state.missing);
  const failed = new Map(state.failed);
  if (outcome.scripts !== undefined) scripts.set(id, outcome.scripts);
  else if (outcome.failed !== undefined) failed.set(id, outcome.failed);
  else missing.add(id);
  useScriptsStore.setState({ scripts, pending, missing, failed, version: state.version + 1 });
}
