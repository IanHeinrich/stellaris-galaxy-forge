import { create } from "zustand";
import * as ipc from "../api/ipc";
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
