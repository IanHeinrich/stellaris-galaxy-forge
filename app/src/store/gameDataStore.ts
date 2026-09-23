import { create } from "zustand";
import { onGameDataChanged, onProgress } from "../api/events";
import * as ipc from "../api/ipc";
import type { GalaxyShapeView } from "../generated/GalaxyShapeView";
import type { GameDataChanged } from "../generated/GameDataChanged";
import type { GameDataSummary } from "../generated/GameDataSummary";
import type { InitializerView } from "../generated/InitializerView";
import type { KindCount } from "../generated/KindCount";
import type { LGateModTouch } from "../generated/LGateModTouch";
import type { MapColor } from "../generated/MapColor";
import type { NameTemplate } from "../generated/NameTemplate";
import type { PlanetClassView } from "../generated/PlanetClassView";
import type { Progress } from "../generated/Progress";
import type { ScenarioBypasses } from "../generated/ScenarioBypasses";
import type { ScenarioOwners } from "../generated/ScenarioOwners";
import type { SpecialSystem } from "../generated/SpecialSystem";
import type { StarClassView } from "../generated/StarClassView";
import type { BypassView } from "../generated/BypassView";
import type { CountryTypeView } from "../generated/CountryTypeView";
import type { DepositView } from "../generated/DepositView";
import type { ShipSizeView } from "../generated/ShipSizeView";
import type { StarbaseLevelView } from "../generated/StarbaseLevelView";
import { templateKey } from "../lib/names";
import { clearTextures } from "../lib/visual/textures";
import { useDetailsStore } from "./detailsStore";
import { useScriptsStore } from "./scriptsStore";
import { NAMES_BATCH } from "./batching";
import { useGalaxyStore } from "./galaxyStore";
import { PREF_KEYS } from "./prefKeys";
import { prefField } from "./prefs";

export type GameDataStatus = "idle" | "loading" | "ready" | "error";

/** Whether game data is read at start: `ask` until the setup card is answered. */
export type AutoLoad = "ask" | "on" | "off";

/** What the launch screen shows: nothing yet, the setup card, or the app. */
export type Startup = "pending" | "setup" | "ready";

export interface GameDataState {
  status: GameDataStatus;
  summary: GameDataSummary | null;
  error: string | null;
  progress: Progress | null;
  /** The open save's special systems by id, classified with game data when it is loaded. */
  special: Map<number, SpecialSystem>;
  /** True while the classification of the open save is being fetched. */
  specialPending: boolean;
  counts: KindCount[];
  specialWithGameData: boolean;
  /** Who owns each scenario system at generation; null on a save or without game data. */
  scenarioOwners: ScenarioOwners | null;
  /** True while that reading is in flight. */
  scenarioOwnersPending: boolean;
  /** The bypasses a scenario's game data places; null on a save or without game data. */
  scenarioBypasses: ScenarioBypasses | null;
  /** What the UI shows a name as, by localisation key or by [`templateKey`]. */
  names: Map<string, string>;
  starClasses: Map<string, StarClassView>;
  mapColors: Map<string, MapColor>;
  /** The mod whose `flags/colors.txt` `mapColors` comes from; null for the game's own. */
  mapColorSource: string | null;
  planetClasses: Map<string, PlanetClassView>;
  deposits: Map<string, DepositView>;
  /** Bypass kind → its map icon frame, for the badge a bypass wears. */
  bypasses: Map<string, BypassView>;
  starbaseLevels: Map<string, StarbaseLevelView>;
  /** Ship size key → its `common/ship_sizes` icon, for the badge a fleet wears. */
  shipSizes: Map<string, ShipSizeView>;
  countryTypes: Map<string, CountryTypeView>;
  /** Every loaded mod file that could change the L-Cluster outcome. */
  lgateMods: LGateModTouch[];
  /** Every solar system initializer, read on first use; `null` until then. */
  initializers: InitializerView[] | null;
  /** Each initializer's own star class, drawn for a scenario system until the game rolls one. */
  initializerClasses: ReadonlyMap<string, string>;
  /** True while that first read is in flight, so it happens once. */
  initializersPending: boolean;
  /** Every galaxy shape a scenario can list itself under, read on first use; `null` until then. */
  galaxyShapes: GalaxyShapeView[] | null;
  galaxyShapesPending: boolean;
  autoLoad: AutoLoad;
  startup: Startup;
  /** The load `start` kicked off, the one the start screen covers. */
  startupLoad: boolean;
  /** The install the user chose, remembered across launches; `null` to discover one. */
  installPath: string | null;
  /** The backend's generation: one per load, unload and accepted rebuild. */
  version: number;
  /** Roots the auto-reload watcher holds; `0` when it is not running. */
  watching: number;
  /** True while the breaker holds auto-reload off. */
  autoReloadPaused: boolean;
  /** Why auto-reload is doing less than its whole job; `null` when it is doing all of it. */
  watchReason: string | null;
  /** The file that tripped the breaker. */
  hotFile: string | null;
  /** How often that file changed inside the breaker's window; `0` when nothing tripped it. */
  hotCount: number;

  /** Reads the preference and, with it on, the game data; decides the launch screen. */
  start(): Promise<void>;
  /** Answers the setup card: stores the preference and starts the load it asks for. */
  continueSetup(autoLoad: boolean): Promise<void>;
  setAutoLoad(autoLoad: AutoLoad): void;
  setInstallPath(path: string): void;
  /** Loads from `installPath`, the remembered one, or the discovered install. */
  load(installPath?: string): Promise<void>;
  /** Adopts game data the backend already holds, as after a page reload. */
  sync(): Promise<void>;
  unload(): Promise<void>;
  /** Starts the watcher again after the breaker paused it. */
  resumeAutoReload(): Promise<void>;
  /** Reads the initializers once per loaded game data; a no-op without it. */
  loadInitializers(): Promise<void>;
  /** Reads the galaxy shapes once per loaded game data; a no-op without it. */
  loadGalaxyShapes(): Promise<void>;
  /** Re-classifies the open save's systems; a no-op without an open save, or once `alive` says no. */
  refreshSpecial(alive?: () => boolean): Promise<void>;
  /** Re-reads the scenario's scripted ownership and bypasses; a no-op without a document. */
  refreshScenarioOwners(alive?: () => boolean): Promise<void>;
  /** Resolves the keys not yet known, in batches; a no-op without game data, or once `alive` says no. */
  fetchNames(keys: string[], alive?: () => boolean): Promise<void>;
  /** Resolves the templates not yet known, in batches; stops once `alive` says no. */
  resolveNames(names: NameTemplate[], alive?: () => boolean): Promise<void>;
  /** Asks for one template's text, with every other asked for on the same tick. */
  requestName(name: NameTemplate): void;
  /** Resolves once the initial scenario owners pass has settled; special and names stay fire-and-forget. */
  onSaveOpened(): Promise<void>;
  onSaveClosed(): void;
  displayNameOf(key: string): string | undefined;
}

/** The templates a render asked for, resolved together on the next tick. */
let queued: NameTemplate[] = [];
let flushing: ReturnType<typeof setTimeout> | null = null;
/** Every name already asked for, so a miss is asked for once however often it is shown. */
const requested = new Set<string>();

const NO_CLASSES: ReadonlyMap<string, string> = new Map<string, string>();

const UNLOADED = {
  status: "idle" as GameDataStatus,
  summary: null,
  error: null,
  progress: null,
  names: new Map<string, string>(),
  starClasses: new Map<string, StarClassView>(),
  mapColors: new Map<string, MapColor>(),
  mapColorSource: null as string | null,
  planetClasses: new Map<string, PlanetClassView>(),
  deposits: new Map<string, DepositView>(),
  bypasses: new Map<string, BypassView>(),
  starbaseLevels: new Map<string, StarbaseLevelView>(),
  shipSizes: new Map<string, ShipSizeView>(),
  countryTypes: new Map<string, CountryTypeView>(),
  lgateMods: [] as LGateModTouch[],
  initializers: null as InitializerView[] | null,
  initializerClasses: NO_CLASSES,
  initializersPending: false,
  galaxyShapes: null as GalaxyShapeView[] | null,
  galaxyShapesPending: false,
  scenarioOwners: null as ScenarioOwners | null,
  scenarioOwnersPending: false,
  scenarioBypasses: null as ScenarioBypasses | null,
  version: 0,
  watching: 0,
  autoReloadPaused: false,
  watchReason: null as string | null,
  hotFile: null as string | null,
  hotCount: 0,
};

function starClassesOf(initializers: readonly InitializerView[]): ReadonlyMap<string, string> {
  const classes = new Map<string, string>();
  for (const init of initializers) {
    if (init.class !== null) classes.set(init.name, init.class);
  }
  return classes;
}

const NO_SAVE = {
  special: new Map<number, SpecialSystem>(),
  specialPending: false,
  counts: [] as KindCount[],
  specialWithGameData: false,
  scenarioOwners: null as ScenarioOwners | null,
  scenarioOwnersPending: false,
  scenarioBypasses: null as ScenarioBypasses | null,
};

/** Drops what was resolved from the game data that is going away, and what was asked for. */
function forgetNames(): Map<string, string> {
  requested.clear();
  queued = [];
  return new Map();
}

function unloaded(): typeof UNLOADED {
  return { ...UNLOADED, names: forgetNames() };
}

function isAutoLoad(value: unknown): value is AutoLoad {
  return value === "ask" || value === "on" || value === "off";
}

const AUTO_LOAD = prefField<AutoLoad>(PREF_KEYS.autoLoad, "ask", isAutoLoad);

export const useGameDataStore = create<GameDataState>((set, get) => ({
  ...UNLOADED,
  ...NO_SAVE,
  autoLoad: "ask",
  startup: "pending",
  startupLoad: false,
  installPath: rememberedInstallPath() ?? null,

  async start() {
    const autoLoad = AUTO_LOAD.read();
    set({ autoLoad });
    await get().sync();
    if (autoLoad === "ask") {
      set({ startup: "setup" });
      return;
    }
    const startupLoad = autoLoad === "on" && get().status === "idle";
    set({ startup: "ready", startupLoad });
    if (startupLoad) {
      await get().load();
      set({ startupLoad: false });
    }
  },

  async continueSetup(autoLoad) {
    get().setAutoLoad(autoLoad ? "on" : "off");
    set({ startup: "ready" });
    if (autoLoad && get().status !== "ready") await get().load();
  },

  setAutoLoad(autoLoad) {
    AUTO_LOAD.save(autoLoad);
    set({ autoLoad });
  },

  setInstallPath(path) {
    rememberInstallPath(path);
    set({ installPath: path });
  },

  async load(installPath) {
    if (get().status === "loading") return;
    abandonTail();
    set({ status: "loading", error: null, progress: null });
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await onProgress((progress) => {
        if (get().status === "loading") set({ progress });
      });
      const summary = await ipc.loadGameData(installPath ?? rememberedInstallPath());
      if (installPath !== undefined) get().setInstallPath(installPath);
      set({
        status: "ready",
        summary,
        progress: null,
        names: forgetNames(),
        initializers: null,
        initializerClasses: NO_CLASSES,
        initializersPending: false,
        galaxyShapes: null,
        galaxyShapesPending: false,
        version: summary.generation,
        watching: summary.watch.watching,
        autoReloadPaused: summary.watch.paused,
        watchReason: summary.watch.reason,
        hotFile: null,
        hotCount: 0,
      });
      watchChanges();
      clearTextures();
      useDetailsStore.getState().clear();
      useScriptsStore.getState().clear();
      const alive = claimTail();
      await loadRegistries(alive);
      await get().refreshSpecial(alive);
      await get().refreshScenarioOwners(alive);
      await get().fetchNames(nameKeys(), alive);
      await get().resolveNames(countryNames(), alive);
    } catch (e) {
      set({ ...unloaded(), status: "error", error: ipc.errorMessage(e) });
    } finally {
      unlisten?.();
    }
  },

  async sync() {
    if (get().status !== "idle") return;
    abandonTail();
    try {
      const summary = await ipc.gameDataSummary();
      if (summary === null || get().status !== "idle") return;
      set({
        status: "ready",
        summary,
        version: summary.generation,
        watching: summary.watch.watching,
        autoReloadPaused: summary.watch.paused,
        watchReason: summary.watch.reason,
      });
      watchChanges();
      clearTextures();
      useScriptsStore.getState().clear();
      const alive = claimTail();
      await loadRegistries(alive);
      await get().refreshSpecial(alive);
      await get().refreshScenarioOwners(alive);
      await get().fetchNames(nameKeys(), alive);
      await get().resolveNames(countryNames(), alive);
    } catch (e) {
      set({ ...unloaded(), status: "error", error: ipc.errorMessage(e) });
    }
  },

  async unload() {
    abandonTail();
    await dropChanges();
    try {
      await ipc.unloadGameData();
      set({ ...unloaded() });
    } catch (e) {
      set({ ...unloaded(), error: ipc.errorMessage(e) });
    }
    clearTextures();
    useDetailsStore.getState().clear();
    useScriptsStore.getState().clear();
    await get().refreshSpecial();
    await get().refreshScenarioOwners();
  },

  async resumeAutoReload() {
    try {
      await ipc.resumeAutoReload();
    } catch (e) {
      set({ error: ipc.errorMessage(e) });
    }
  },

  async loadInitializers() {
    if (get().status !== "ready" || get().initializers !== null || get().initializersPending)
      return;
    set({ initializersPending: true });
    try {
      const initializers = await ipc.getInitializers();
      set({ initializersPending: false });
      if (get().status === "ready") {
        set({ initializers, initializerClasses: starClassesOf(initializers) });
      }
    } catch (e) {
      set({ error: ipc.errorMessage(e), initializersPending: false });
    }
  },

  async loadGalaxyShapes() {
    if (get().status !== "ready" || get().galaxyShapes !== null || get().galaxyShapesPending)
      return;
    set({ galaxyShapesPending: true });
    try {
      const galaxyShapes = await ipc.getGalaxyShapes();
      set({ galaxyShapesPending: false });
      if (get().status === "ready") set({ galaxyShapes });
    } catch (e) {
      set({ error: ipc.errorMessage(e), galaxyShapesPending: false });
    }
  },

  async refreshSpecial(alive) {
    if (useGalaxyStore.getState().galaxy === null) return;
    set({ specialPending: true });
    try {
      const result = await ipc.getSpecialSystems();
      if (alive?.() === false) {
        set({ specialPending: false });
        return;
      }
      set({
        special: new Map(result.systems.map((s) => [s.id, s])),
        counts: result.counts,
        specialWithGameData: result.with_game_data,
        specialPending: false,
      });
    } catch (e) {
      set({ error: ipc.errorMessage(e), specialPending: false });
    }
  },

  async refreshScenarioOwners(alive) {
    if (useGalaxyStore.getState().galaxy === null) return;
    set({ scenarioOwnersPending: true });
    try {
      const owners = await ipc.getScenarioOwners();
      if (alive?.() === false) {
        set({ scenarioOwnersPending: false });
        return;
      }
      set({ scenarioOwners: owners, scenarioOwnersPending: false });
      const galaxy = useGalaxyStore.getState();
      // A document with no scripted owners, before or now, leaves the galaxy as it found it.
      if (owners !== null || galaxy.scriptedOwners.size > 0) {
        galaxy.setScriptedOwners(ownerMap(owners), owners?.territories.map((t) => t.country) ?? []);
      }
      const bypasses = await ipc.getScenarioBypasses();
      if (alive?.() === false) return;
      set({ scenarioBypasses: bypasses ?? null });
    } catch (e) {
      set({ error: ipc.errorMessage(e), scenarioOwnersPending: false });
    }
  },

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

  async onSaveOpened() {
    useDetailsStore.getState().clear();
    useScriptsStore.getState().clear();
    void get().refreshSpecial();
    const owners = get().refreshScenarioOwners();
    if (get().status === "ready") {
      void get().fetchNames(nameKeys());
      void get().resolveNames(countryNames());
    }
    await owners.catch(() => undefined);
  },

  onSaveClosed() {
    useDetailsStore.getState().clear();
    useScriptsStore.getState().clear();
    set({ ...NO_SAVE });
  },

  displayNameOf(key) {
    return get().names.get(key);
  },
}));

/** The one subscription to the watcher's events, held while game data is loaded. */
let changes: Promise<() => void> | null = null;

function watchChanges(): void {
  changes ??= onGameDataChanged((changed) => void gameDataChanged(changed)).catch((e: unknown) => {
    changes = null;
    useGameDataStore.setState({ error: ipc.errorMessage(e) });
    return () => undefined;
  });
}

async function dropChanges(): Promise<void> {
  const held = changes;
  changes = null;
  try {
    (await held)?.();
  } catch {
    return;
  }
}

/** The guard a batch loop takes when its caller holds none: the game data must not change hands. */
function sameGameData(): () => boolean {
  const { status, version } = useGameDataStore.getState();
  return () => {
    const now = useGameDataStore.getState();
    return now.status === status && now.version === version;
  };
}

/** The refetch that may still write. A newer one, or the game data changing hands, abandons it. */
let tail = 0;

/** Claims the tail for this refetch; its answer asks whether it is still the one that counts. */
function claimTail(): () => boolean {
  const mine = ++tail;
  return () => mine === tail && useGameDataStore.getState().status === "ready";
}

function abandonTail(): void {
  tail += 1;
}

/**
 * A rebuilt registry, or the watcher pausing or resuming. A rebuild makes stale everything a
 * fresh load reads except the textures: `gfx/` is not watched, so the map does not flash.
 */
async function gameDataChanged(changed: GameDataChanged): Promise<void> {
  const seen = useGameDataStore.getState().version;
  useGameDataStore.setState({
    version: Math.max(seen, changed.version),
    watching: changed.watch.watching,
    autoReloadPaused: changed.watch.paused,
    watchReason: changed.watch.reason,
    hotFile: changed.hot_file,
    hotCount: changed.hot_count,
  });
  if (changed.registries.length === 0 || changed.version <= seen) return;
  const alive = claimTail();
  const state = () => useGameDataStore.getState();
  if (!alive()) return;
  try {
    const summary = await ipc.gameDataSummary();
    if (!alive()) return;
    if (summary !== null) {
      useGameDataStore.setState({
        summary,
        names: forgetNames(),
        initializers: null,
        initializerClasses: NO_CLASSES,
        initializersPending: false,
        galaxyShapes: null,
        galaxyShapesPending: false,
      });
    }
    useDetailsStore.getState().clear();
    useScriptsStore.getState().clear();
    await loadRegistries(alive);
    if (!alive()) return;
    await state().refreshSpecial(alive);
    if (!alive()) return;
    await state().refreshScenarioOwners(alive);
    if (!alive()) return;
    await state().fetchNames(nameKeys(), alive);
    if (!alive()) return;
    await state().resolveNames(countryNames(), alive);
  } catch (e) {
    if (alive()) useGameDataStore.setState({ error: ipc.errorMessage(e) });
  }
}

async function loadRegistries(alive?: () => boolean): Promise<void> {
  const [
    starClasses,
    mapColors,
    mapColorSource,
    planetClasses,
    deposits,
    bypasses,
    starbaseLevels,
    shipSizes,
    countryTypes,
    lgateMods,
  ] = await Promise.all([
    ipc.getStarClasses(),
    ipc.getMapColors(),
    ipc.getMapColorSource(),
    ipc.getPlanetClasses(),
    ipc.getDeposits(),
    ipc.getBypasses(),
    ipc.getStarbaseLevels(),
    ipc.getShipSizes(),
    ipc.getCountryTypes(),
    ipc.getLgateOutcomeMods(),
  ]);
  if (alive?.() === false) return;
  useGameDataStore.setState({
    starClasses: new Map(starClasses.map((c) => [c.key, c])),
    mapColors: new Map(mapColors.map((c) => [c.name, c])),
    mapColorSource,
    planetClasses: new Map(planetClasses.map((c) => [c.key, c])),
    deposits: new Map(deposits.map((d) => [d.key, d])),
    bypasses: new Map(bypasses.map((b) => [b.key, b])),
    starbaseLevels: new Map(starbaseLevels.map((l) => [l.key, l])),
    shipSizes: new Map(shipSizes.map((s) => [s.key, s])),
    countryTypes: new Map(countryTypes.map((t) => [t.name, t])),
    lgateMods,
  });
  await useDetailsStore.getState().loadResourceIcons();
}

/** Each scenario system mapped to the territory country that owns it; empty without scripted owners. */
function ownerMap(owners: ScenarioOwners | null): Map<number, number> {
  return new Map(owners?.owners.map((o) => [o.system, o.territory]) ?? []);
}

/** Every localisation key the open galaxy shows: the names of its systems and nebulae. */
function nameKeys(): string[] {
  const { galaxy } = useGalaxyStore.getState();
  if (galaxy === null) return [];
  return [...galaxy.systems, ...galaxy.nebulae]
    .map((node) => node.name)
    .filter((name) => !name.literal)
    .map((name) => name.key);
}

/** The name template of every country in the open galaxy. */
function countryNames(): NameTemplate[] {
  return useGalaxyStore.getState().galaxy?.countries.map((c) => c.name) ?? [];
}

function rememberedInstallPath(): string | undefined {
  try {
    return localStorage.getItem(PREF_KEYS.installPath) ?? undefined;
  } catch {
    return undefined;
  }
}

function rememberInstallPath(path: string): void {
  try {
    localStorage.setItem(PREF_KEYS.installPath, path);
  } catch {
    return;
  }
}
