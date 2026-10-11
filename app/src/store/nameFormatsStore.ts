import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { NameTemplate } from "../generated/NameTemplate";
import type { PlanetSummary } from "../generated/PlanetSummary";
import { givenNamesFrom, nameFormats, type GivenName } from "../lib/details/spawnNames";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";

/**
 * The name formats a scenario body's given name is filled in from, as the install's localisation
 * writes them: `$NAME$ A` for `STAR_NAME_1_OF_2`. The display names in the game data store have
 * their `$KEY$` references resolved, which would fill `$NAME$` with the text of the key `NAME`.
 */
interface NameFormatsState {
  /** The game data the formats were read from, as `status/version`. */
  loaded: string;
  formats: ReadonlyMap<string, string>;
  /** The keys asked for from that game data, so each is asked for once. */
  asked: ReadonlySet<string>;
  /** Reads the formats of `keys` not read yet, on the next tick, so a render may ask. */
  request(keys: readonly string[]): void;
}

/** The keys asked for since the last read, read together on the next tick. */
let pending: string[] = [];
let flushing: ReturnType<typeof setTimeout> | null = null;

function read(keys: readonly string[]): void {
  const data = useGameDataStore.getState();
  if (data.status !== "ready") return;
  const store = useNameFormatsStore;
  const loaded = `${data.status}/${data.version}`;
  if (store.getState().loaded !== loaded) {
    store.setState({ loaded, formats: new Map(), asked: new Set() });
  }
  const wanted = [...new Set(keys)].filter((key) => !store.getState().asked.has(key));
  if (wanted.length === 0) return;
  store.setState({ asked: new Set([...store.getState().asked, ...wanted]) });
  void ipc
    .getRawNames(wanted)
    .then((raw) => {
      if (store.getState().loaded !== loaded) return;
      store.setState({ formats: new Map([...store.getState().formats, ...Object.entries(raw)]) });
    })
    .catch(() => undefined);
}

export const useNameFormatsStore = create<NameFormatsState>((_set, get) => ({
  loaded: "",
  formats: new Map(),
  asked: new Set(),
  request(keys) {
    const data = useGameDataStore.getState();
    const stale = get().loaded !== `${data.status}/${data.version}`;
    const fresh = stale ? keys : keys.filter((key) => !get().asked.has(key));
    if (fresh.length === 0) return;
    pending.push(...fresh);
    flushing ??= setTimeout(() => {
      flushing = null;
      const wanted = pending;
      pending = [];
      read(wanted);
    }, 0);
  },
}));

/** The last answer of `givenNamesNow` and what it was made from, so an unchanged system gives the same map. */
let lastGiven: {
  planets: readonly PlanetSummary[] | undefined;
  systemName: NameTemplate | undefined;
  names: ReadonlyMap<string, string>;
  formats: ReadonlyMap<string, string>;
  given: ReadonlyMap<number, GivenName>;
} | null = null;

/**
 * The given names of system `system`'s bodies from the stores as they stand, for code outside a
 * render; asks for the name formats not read yet.
 */
export function givenNamesNow(
  system: number | null,
  planets: readonly PlanetSummary[] | undefined,
): ReadonlyMap<number, GivenName> {
  const { formats, request } = useNameFormatsStore.getState();
  if (planets !== undefined) {
    const wanted = nameFormats(planets).filter((key) => !formats.has(key));
    if (wanted.length > 0) request(wanted);
  }
  const systemName =
    system === null ? undefined : useGalaxyStore.getState().systems.get(system)?.name;
  const names = useGameDataStore.getState().names;
  const last = lastGiven;
  if (
    last !== null &&
    last.planets === planets &&
    last.systemName === systemName &&
    last.names === names &&
    last.formats === formats
  ) {
    return last.given;
  }
  const given = givenNamesFrom(planets, systemName, names, formats);
  lastGiven = { planets, systemName, names, formats, given };
  return given;
}
