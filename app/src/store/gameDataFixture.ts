import { vi } from "vitest";
import { stubPrefs } from "../test/prefs";
import type { GameDataChanged } from "../generated/GameDataChanged";
import type { GameDataSummary } from "../generated/GameDataSummary";
import type { Progress } from "../generated/Progress";
import type { SpecialSystems } from "../generated/SpecialSystems";

import { onGameDataChanged, onProgress } from "../api/events";
import * as ipc from "../api/ipc";
import { clearTextures } from "../lib/visual/textures";
import { bindStores } from "./bindStores";
import { useDetailsStore } from "./detailsStore";
import { useFileSessionStore } from "./fileSessionStore";
import { useGalaxyStore } from "./galaxyStore";
import { useGameDataStore } from "./gameDataStore";
import { gameDataSummary, OPEN_RESULT } from "./fixture";

/** Lets every pending answer land before a test asks what was written. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

export const mocked = {
  loadGameData: vi.mocked(ipc.loadGameData),
  unloadGameData: vi.mocked(ipc.unloadGameData),
  getSpecialSystems: vi.mocked(ipc.getSpecialSystems),
  getNames: vi.mocked(ipc.getNames),
  resolveNames: vi.mocked(ipc.resolveNames),
  getStarClasses: vi.mocked(ipc.getStarClasses),
  getMapColors: vi.mocked(ipc.getMapColors),
  getPlanetClasses: vi.mocked(ipc.getPlanetClasses),
  getDeposits: vi.mocked(ipc.getDeposits),
  getBypasses: vi.mocked(ipc.getBypasses),
  getStarbaseLevels: vi.mocked(ipc.getStarbaseLevels),
  getShipSizes: vi.mocked(ipc.getShipSizes),
  getCountryTypes: vi.mocked(ipc.getCountryTypes),
  getInitializers: vi.mocked(ipc.getInitializers),
  getScenarioOwners: vi.mocked(ipc.getScenarioOwners),
  getScenarioBypasses: vi.mocked(ipc.getScenarioBypasses),
  onProgress: vi.mocked(onProgress),
  onGameDataChanged: vi.mocked(onGameDataChanged),
  clearTextures: vi.mocked(clearTextures),
};

export const SUMMARY: GameDataSummary = gameDataSummary();

export const SPECIAL: SpecialSystems = {
  systems: [
    {
      id: 4,
      primary: "landmark",
      kinds: ["landmark"],
      initializer: "special_init_01",
      initializer_known: true,
      source_file: null,
      flags: [],
      countries: [],
      label: "Landmark",
    },
  ],
  counts: [{ kind: "landmark", count: 1, primary_count: 1 }],
  with_game_data: true,
};

/** The galaxy fixture's system and nebula name keys; it has no countries. */
export const GALAXY_KEYS = [
  ...OPEN_RESULT.galaxy.systems.map((s) => s.name.key),
  ...OPEN_RESULT.galaxy.nebulae.map((n) => n.name.key),
];

/** A country whose name the save writes as a template. */
export const RIHINAR = {
  id: 1,
  name: {
    key: "%ADJECTIVE%",
    literal: false,
    variables: [
      { name: "adjective", value: { key: "SPEC_RihiNar", literal: false, variables: [] } },
      { name: "1", value: { key: "Sovereignty", literal: true, variables: [] } },
    ],
  },
  name_key: "SPEC_RihiNar Sovereignty",
  country_type: "default",
  capital_system: null,
  system_count: 0,
  colors: [],
  border_color: null,
  fill_color: null,
  flag_icon: null,
  flag_background: null,
};

/** What the armed commands hand back, refreshed by `armGameData` before every test. */
export const listeners = {
  progress: null as ((p: Progress) => void) | null,
  changed: null as ((c: GameDataChanged) => void) | null,
  unlisten: vi.fn<() => void>(),
  unlistenChanges: vi.fn<() => void>(),
  storage: new Map<string, string>(),
};

bindStores();

/** The state every game data test starts from: cleared stores and every command armed. */
export function armGameData(): void {
  vi.clearAllMocks();
  useGalaxyStore.getState().clear();
  useDetailsStore.getState().clear();
  useGameDataStore.setState({ ...useGameDataStore.getInitialState() });
  listeners.storage = stubPrefs();
  listeners.unlisten = vi.fn<() => void>();
  listeners.unlistenChanges = vi.fn<() => void>();
  listeners.progress = null;
  listeners.changed = null;
  mocked.onProgress.mockImplementation(async (h) => {
    listeners.progress = h;
    return listeners.unlisten;
  });
  mocked.onGameDataChanged.mockImplementation(async (h) => {
    listeners.changed = h;
    return listeners.unlistenChanges;
  });
  mocked.loadGameData.mockResolvedValue(SUMMARY);
  mocked.unloadGameData.mockResolvedValue();
  mocked.getSpecialSystems.mockResolvedValue(SPECIAL);
  mocked.getScenarioOwners.mockResolvedValue(null);
  mocked.getScenarioBypasses.mockResolvedValue(null);
  mocked.getNames.mockImplementation(async (keys) =>
    Object.fromEntries(keys.map((k) => [k, k.replace(/^NAME_/, "")])),
  );
  mocked.resolveNames.mockImplementation(async (names) =>
    names.map((name) => name.variables.map((v) => v.value.key).join(" ") || name.key),
  );
  mocked.getStarClasses.mockResolvedValue([
    { key: "sc_g", texture_key: "star_class:g", icon_scale: 1 },
  ]);
  mocked.getMapColors.mockResolvedValue([
    { name: "red", map: "#ff0000", flag: "#ff0000", ship: "#ff0000" },
  ]);
  mocked.getPlanetClasses.mockResolvedValue([
    { key: "pc_continental", icon_sprite: null, habitable: true, star: false },
  ]);
  mocked.getDeposits.mockResolvedValue([
    {
      key: "d_minerals_5",
      icon: "GFX_deposit_minerals",
      category: "deposit_cat_minerals",
      produces: [["minerals", 5]],
      is_for_colonizable: true,
      station: null,
    },
  ]);
  mocked.getBypasses.mockResolvedValue([
    { key: "gateway", icon_frame: 25 },
    { key: "relay_bypass", icon_frame: null },
  ]);
  mocked.getStarbaseLevels.mockResolvedValue([
    { key: "starbase_outpost", icon_frame: 1, empire_shield: false },
  ]);
  mocked.getShipSizes.mockResolvedValue([{ key: "corvette", icon: "ship_size_military_1" }]);
  vi.mocked(ipc.getResourceIcons).mockResolvedValue([
    { resource: "energy", sprite: "GFX_resource_energy" },
  ]);
  mocked.getCountryTypes.mockResolvedValue([
    {
      name: "amoeba",
      is_space_critter: true,
      space_creatures: true,
      generate_borders: false,
      is_enclave: false,
      fallen_empire: false,
      playable: false,
      leviathan: false,
    },
  ]);
}

/** Puts back the real `localStorage` and the document the save hooks watch. */
export function releaseGameData(): void {
  vi.unstubAllGlobals();
  useFileSessionStore.setState({ kind: null });
}
