import { vi } from "vitest";
import { stubPrefs } from "../test/prefs";
import type { GameDataChanged } from "../generated/GameDataChanged";
import type { GameDataSummary } from "../generated/GameDataSummary";
import type { Progress } from "../generated/Progress";
import type { SpecialSystems } from "../generated/SpecialSystems";

import { bindStores } from "./bindStores";
import { useFileSessionStore } from "./fileSessionStore";
import { gameDataSummary, OPEN_RESULT } from "./fixture";
import { useGameDataStore } from "./gameDataStore";
import { resetStores } from "./storeFixture";
import { mockedIpc } from "../test/ipc";

/** Lets every pending answer land before a test asks what was written. */
export const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
      label_is_generated_name: false,
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
  use_map_color: false,
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
  resetStores();
  listeners.storage = stubPrefs();
  listeners.unlisten = vi.fn<() => void>();
  listeners.unlistenChanges = vi.fn<() => void>();
  listeners.progress = null;
  listeners.changed = null;
  armGameDataCommands();
}

/** Game data loaded the way the app loads it, over the commands `armGameData` arms. */
export async function loadGameData(summary: GameDataSummary = SUMMARY): Promise<void> {
  armGameDataCommands();
  mockedIpc.loadGameData.mockResolvedValue(summary);
  await useGameDataStore.getState().load();
}

function armGameDataCommands(): void {
  mockedIpc.onProgress.mockImplementation(async (h) => {
    listeners.progress = h;
    return listeners.unlisten;
  });
  mockedIpc.onGameDataChanged.mockImplementation(async (h) => {
    listeners.changed = h;
    return listeners.unlistenChanges;
  });
  mockedIpc.loadGameData.mockResolvedValue(SUMMARY);
  mockedIpc.unloadGameData.mockResolvedValue();
  mockedIpc.getSpecialSystems.mockResolvedValue(SPECIAL);
  mockedIpc.getScenarioOwners.mockResolvedValue(null);
  mockedIpc.getScenarioBypasses.mockResolvedValue(null);
  mockedIpc.getNames.mockImplementation(async (keys) =>
    Object.fromEntries(keys.map((k) => [k, k.replace(/^NAME_/, "")])),
  );
  mockedIpc.resolveNames.mockImplementation(async (names) =>
    names.map((name) => name.variables.map((v) => v.value.key).join(" ") || name.key),
  );
  mockedIpc.getStarClasses.mockResolvedValue([
    {
      key: "sc_g",
      texture_key: "star_class:g",
      icon_scale: 1,
      planet_keys: ["pc_g_star"],
      crisis_star_class: null,
      spawn_odds: 1,
      localised: true,
    },
  ]);
  mockedIpc.getMapColors.mockResolvedValue([
    { name: "red", map: "#ff0000", flag: "#ff0000", ship: "#ff0000" },
  ]);
  mockedIpc.getMapColorSource.mockResolvedValue(null);
  mockedIpc.getPlanetClasses.mockResolvedValue([
    { key: "pc_continental", icon_sprite: null, habitable: true, star: false },
  ]);
  mockedIpc.getDeposits.mockResolvedValue([
    {
      key: "d_minerals_5",
      icon: "GFX_deposit_minerals",
      category: "deposit_cat_minerals",
      produces: [["minerals", 5]],
      is_for_colonizable: true,
      station: null,
    },
  ]);
  mockedIpc.getBypasses.mockResolvedValue([
    { key: "gateway", icon_frame: 25 },
    { key: "relay_bypass", icon_frame: null },
  ]);
  mockedIpc.getStarbaseLevels.mockResolvedValue([
    { key: "starbase_outpost", icon_frame: 1, empire_shield: false },
  ]);
  mockedIpc.getShipSizes.mockResolvedValue([{ key: "corvette", icon: "ship_size_military_1" }]);
  mockedIpc.getResourceIcons.mockResolvedValue([
    { resource: "energy", sprite: "GFX_resource_energy" },
  ]);
  mockedIpc.getCountryTypes.mockResolvedValue([
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
  mockedIpc.getLgateOutcomeMods.mockResolvedValue([]);
}

/** Puts back the real `localStorage` and the document the save hooks watch. */
export function releaseGameData(): void {
  vi.unstubAllGlobals();
  useFileSessionStore.setState({ kind: null });
}
