import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { SystemDetails } from "../generated/SystemDetails";
import { DETAILS_BATCH, DETAILS_DEBOUNCE_MS } from "./batching";

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
  /** Resource key → `GFX_` sprite name from the game's resource definitions. */
  resourceIcons: Map<string, string>;
  /** Why the sprite names could not be read, `null` while they still can be. */
  resourceIconsError: string | null;
  /** Queues the ids not yet known; the queue goes out in batches after a short quiet period. */
  request(ids: Iterable<number>): void;
  /** Fetches the resource sprite names once game data is loaded; a failure is recorded and asking again retries. */
  loadResourceIcons(): Promise<void>;
  /** Marks `ids` stale so the next request fetches them again; the cached details stay until it answers. */
  invalidate(ids: number[]): void;
  clear(): void;
}

let queue: number[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let issued = 0;
/** Id → the last batch an edit staled; an answer no newer than it is dropped. */
const staled = new Map<number, number>();
let iconsInFlight: Promise<void> | null = null;

export const useDetailsStore = create<DetailsState>((set, get) => ({
  details: new Map(),
  pending: new Set(),
  failed: new Map(),
  stale: new Set(),
  missing: new Set(),
  version: 0,
  resourceIcons: new Map(),
  resourceIconsError: null,

  request(ids) {
    const { details, pending, failed, stale, missing } = get();
    const asked = new Set(pending);
    for (const id of ids) {
      // A failure is not retried on its own: its own version bump would ask again forever.
      if (
        (details.has(id) && !stale.has(id)) ||
        asked.has(id) ||
        missing.has(id) ||
        failed.has(id)
      ) {
        continue;
      }
      asked.add(id);
      queue.push(id);
    }
    if (asked.size === pending.size) return;
    set({ pending: asked });
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flushQueue, DETAILS_DEBOUNCE_MS);
  },

  async loadResourceIcons() {
    iconsInFlight ??= fetchResourceIcons();
    await iconsInFlight;
  },

  invalidate(ids) {
    const { version, details } = get();
    const pending = new Set(get().pending);
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
      if (pending.delete(id)) {
        staled.set(id, issued);
        dropped = true;
      }
    }
    if (dropped) set({ pending, failed, stale, version: version + 1, ...(found && { missing }) });
    else if (found) set({ missing });
  },

  clear() {
    generation++;
    staled.clear();
    if (timer !== null) clearTimeout(timer);
    timer = null;
    queue = [];
    set({
      details: new Map(),
      pending: new Set(),
      failed: new Map(),
      stale: new Set(),
      missing: new Set(),
      version: get().version + 1,
    });
  },
}));

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

function flushQueue(): void {
  timer = null;
  const ids = queue;
  queue = [];
  for (let i = 0; i < ids.length; i += DETAILS_BATCH) {
    void fetchBatch(ids.slice(i, i + DETAILS_BATCH), generation, ++issued);
  }
}

async function fetchBatch(ids: number[], gen: number, serial: number): Promise<void> {
  let results: SystemDetails[];
  try {
    results = await ipc.getSystemDetails(ids);
  } catch (e) {
    if (gen === generation) settle(ids, { failed: ipc.errorMessage(e) });
    return;
  }
  if (gen !== generation) return;
  const answered = new Set(results.map((d) => d.id));
  const unanswered = ids.filter((id) => !answered.has(id) && (staled.get(id) ?? -1) < serial);
  const fresh = results.filter((d) => (staled.get(d.id) ?? -1) < serial);
  settle(ids, { fresh, unanswered });
}

/** Takes `ids` out of `pending` and records what the batch came back with. */
function settle(
  ids: number[],
  outcome: { fresh?: SystemDetails[]; unanswered?: number[]; failed?: string },
): void {
  const state = useDetailsStore.getState();
  const pending = new Set(state.pending);
  for (const id of ids) pending.delete(id);
  const details = new Map(state.details);
  const failed = new Map(state.failed);
  const stale = new Set(state.stale);
  for (const d of outcome.fresh ?? []) {
    details.set(d.id, d);
    failed.delete(d.id);
    stale.delete(d.id);
  }
  if (outcome.failed !== undefined) for (const id of ids) failed.set(id, outcome.failed);
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
