import { useEffect } from "react";
import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { SystemDetails } from "../generated/SystemDetails";
import type { SystemRoll } from "../generated/SystemRoll";
import { DETAILS_BATCH, DETAILS_DEBOUNCE_MS } from "./batching";
import { VANILLA_SYSTEM_RADII } from "../generated/constants";
import { keyedReads } from "./reads";

export interface DetailsState {
  details: Map<number, SystemDetails>;
  /** Requested and not yet answered. */
  pending: Set<number>;
  /** Systems whose reading failed, by the message to show; asking again waits for an edit or a reload. */
  failed: Map<number, string>;
  /** Cached ids an edit staled: still shown, and asked for again, until the fresh answer replaces them. */
  stale: ReadonlySet<number>;
  /** Ids a batch was asked for and did not answer: there is nothing to show until an edit stales them. */
  missing: Set<number>;
  /** Bumped whenever an answer lands or the cache is cleared. */
  version: number;
  /**
   * Each system's last roll to land: where its bodies stand, or the planets the game rolls. It is
   * kept through an edit and a Roll again until the roll asked for replaces it.
   */
  rolls: ReadonlyMap<number, SystemRoll>;
  /** Resource key → `GFX_` sprite name from the game's resource definitions. */
  resourceIcons: Map<string, string>;
  /** Why the sprite names could not be read, `null` while they still can be. */
  resourceIconsError: string | null;
  /** Queues the ids not yet known; the queue goes out in batches after a short quiet period. */
  request(ids: Iterable<number>): void;
  /** Fetches roll `roll` of `system` unless it is in or asked for already. */
  requestRoll(system: number, roll: number): void;
  /** Fetches the resource sprite names once game data is loaded; a failure is recorded and asking again retries. */
  loadResourceIcons(): Promise<void>;
  /** Marks `ids` stale so the next request fetches them again; the cached details stay until it answers. */
  invalidate(ids: number[]): void;
  clear(): void;
}

const detailReads = keyedReads((ids: number[]) => ipc.getSystemDetails(ids), {
  batch: DETAILS_BATCH,
  wait: DETAILS_DEBOUNCE_MS,
  answered(ids, results) {
    const wanted = new Set(ids);
    const fresh = results.filter((d) => wanted.has(d.id));
    const answered = new Set(fresh.map((d) => d.id));
    settle({ fresh, unanswered: ids.filter((id) => !answered.has(id)) });
  },
  failed: (ids, message) => settle({ failed: { ids, message } }),
});

let iconsInFlight: Promise<void> | null = null;
/** System → the roll last asked for; an answer lands only while its ask is still the one here. */
const rollsAsked = new Map<number, { roll: number }>();
/** Systems an edit staled: their roll is still shown, and asked for again. */
const staleRolls = new Set<number>();

export const useDetailsStore = create<DetailsState>((set, get) => ({
  details: new Map(),
  pending: new Set(),
  failed: new Map(),
  stale: new Set(),
  missing: new Set(),
  version: 0,
  rolls: new Map(),
  resourceIcons: new Map(),
  resourceIconsError: null,

  request(ids) {
    const { details, failed, stale, missing } = get();
    const wanted = [...ids].filter(
      // A failure is not retried on its own: its own version bump would ask again forever.
      (id) =>
        !(details.has(id) && !stale.has(id)) &&
        !detailReads.asked(id) &&
        !missing.has(id) &&
        !failed.has(id),
    );
    if (wanted.length === 0) return;
    void detailReads.read(wanted);
    set({ pending: detailReads.pending() });
  },

  requestRoll(system, roll) {
    const fresh = get().rolls.get(system)?.roll === roll && !staleRolls.has(system);
    if (fresh || rollsAsked.get(system)?.roll === roll) return;
    const ask = { roll };
    rollsAsked.set(system, ask);
    void fetchRoll(system, ask);
  },

  async loadResourceIcons() {
    iconsInFlight ??= fetchResourceIcons();
    await iconsInFlight;
  },

  invalidate(ids) {
    const { version, details } = get();
    const failed = new Map(get().failed);
    const stale = new Set(get().stale);
    const missing = new Set(get().missing);
    let dropped = false;
    let found = false;
    for (const id of ids) {
      if (missing.delete(id)) found = true;
      if (details.has(id)) {
        stale.add(id);
        dropped = true;
      }
      if (failed.delete(id)) dropped = true;
      // A read already out would land on the pre-edit bytes: it is dropped and asked again.
      if (detailReads.asked(id)) {
        detailReads.drop([id]);
        dropped = true;
      }
    }
    if (dropped) {
      const pending = detailReads.pending();
      set({ pending, failed, stale, version: version + 1, ...(found && { missing }) });
    } else if (found) set({ missing });
    for (const id of ids) {
      rollsAsked.delete(id);
      if (get().rolls.has(id)) staleRolls.add(id);
    }
  },

  clear() {
    detailReads.clear();
    rollsAsked.clear();
    staleRolls.clear();
    set({
      details: new Map(),
      rolls: new Map(),
      pending: new Set(),
      failed: new Map(),
      stale: new Set(),
      missing: new Set(),
      version: get().version + 1,
    });
  },
}));

/** The roll the scene draws for `system`: the last to land, until the one asked for replaces it. */
export function shownRoll(rolls: DetailsState["rolls"], system: number | null): SystemRoll | null {
  return (system === null ? undefined : rolls.get(system)) ?? null;
}

/** Roll `roll` of `system` as the scene draws it, asked for while it is not in. */
export function useSystemRoll(system: number | null, roll: number): SystemRoll | null {
  const requestRoll = useDetailsStore((s) => s.requestRoll);
  const rolls = useDetailsStore((s) => s.rolls);
  const version = useDetailsStore((s) => s.version);
  useEffect(() => {
    if (system !== null) requestRoll(system, roll);
  }, [system, roll, rolls, version, requestRoll]);
  return shownRoll(rolls, system);
}

/** The least inner radius a roll fits a system's planets within: the loaded game data's. */
let rollWithin: number = VANILLA_SYSTEM_RADII.min_inner;

/** Follows the loaded game data's least inner radius; `bindStores` calls it. */
export function setRollWithin(within: number): void {
  rollWithin = within;
}

async function fetchRoll(system: number, ask: { roll: number }): Promise<void> {
  let answer: SystemRoll | null = null;
  try {
    answer = await ipc.getSystemRoll(system, ask.roll, rollWithin);
  } catch {
    // With no roll the bodies stand where their details alone put them.
  }
  if (rollsAsked.get(system) !== ask) return;
  rollsAsked.delete(system);
  if (answer === null) return;
  staleRolls.delete(system);
  useDetailsStore.setState({
    rolls: new Map(useDetailsStore.getState().rolls).set(system, answer),
  });
}

async function fetchResourceIcons(): Promise<void> {
  try {
    const icons = await ipc.getResourceIcons();
    const { version } = useDetailsStore.getState();
    useDetailsStore.setState({
      resourceIcons: new Map(icons.map((i) => [i.resource, i.sprite])),
      resourceIconsError: null,
      version: version + 1,
    });
  } catch (e) {
    useDetailsStore.setState({ resourceIconsError: ipc.errorMessage(e) });
  } finally {
    iconsInFlight = null;
  }
}

/** Records what a batch still wanted came back with; its ids are no longer pending. */
function settle(outcome: {
  fresh?: SystemDetails[];
  unanswered?: number[];
  failed?: { ids: number[]; message: string };
}): void {
  const state = useDetailsStore.getState();
  const pending = detailReads.pending();
  const details = new Map(state.details);
  const failed = new Map(state.failed);
  const stale = new Set(state.stale);
  for (const d of outcome.fresh ?? []) {
    details.set(d.id, d);
    failed.delete(d.id);
    stale.delete(d.id);
  }
  if (outcome.failed !== undefined) {
    for (const id of outcome.failed.ids) failed.set(id, outcome.failed.message);
  }
  const unanswered = outcome.unanswered ?? [];
  const missing =
    unanswered.length > 0 ? new Set([...state.missing, ...unanswered]) : state.missing;
  useDetailsStore.setState({
    details,
    pending,
    failed,
    stale,
    missing,
    version: state.version + 1,
  });
}
