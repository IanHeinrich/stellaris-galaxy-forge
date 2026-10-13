import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { PlanetSummary } from "../generated/PlanetSummary";
import { givenNamesFrom, nameFormats, type GivenName } from "../lib/details/spawnNames";
import { lastOf } from "../lib/memo";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { keyedReads } from "./reads";

/**
 * The name formats a scenario body's given name is filled in from, as the install's localisation
 * writes them: `$NAME$ A` for `STAR_NAME_1_OF_2`. The display names in the game data store have
 * their `$KEY$` references resolved, which would fill `$NAME$` with the text of the key `NAME`.
 */
interface NameFormatsState {
  /** The game data the formats were read from, as `status/version`. */
  loaded: string;
  formats: ReadonlyMap<string, string>;
  /** The keys that game data has answered for, with a format or without, so each is read once. */
  answered: ReadonlySet<string>;
  /** Reads the formats of `keys` not read yet, on the next tick, so a render may ask. */
  request(keys: readonly string[]): void;
}

function loadedNow(): string {
  const data = useGameDataStore.getState();
  return `${data.status}/${data.version}`;
}

const formatReads = keyedReads((keys: string[]) => ipc.getRawNames(keys), {
  scope: loadedNow,
  wait: 0,
  answered(keys, raw) {
    const { formats, answered } = useNameFormatsStore.getState();
    useNameFormatsStore.setState({
      formats: new Map([...formats, ...Object.entries(raw)]),
      answered: new Set([...answered, ...keys]),
    });
  },
  failed: () => undefined,
});

export const useNameFormatsStore = create<NameFormatsState>((set, get) => ({
  loaded: "",
  formats: new Map(),
  answered: new Set(),
  request(keys) {
    if (useGameDataStore.getState().status !== "ready") return;
    const loaded = loadedNow();
    if (get().loaded !== loaded) set({ loaded, formats: new Map(), answered: new Set() });
    const { answered } = get();
    void formatReads.read(keys.filter((key) => !answered.has(key)));
  },
}));

/** The last answer of `givenNamesNow`, so an unchanged system gives the same map. */
const lastGiven = lastOf<ReadonlyMap<number, GivenName>>();

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
  return lastGiven([planets, systemName, names, formats], () =>
    givenNamesFrom(planets, systemName, names, formats),
  );
}
