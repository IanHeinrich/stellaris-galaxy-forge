import type { FleetSummary } from "../generated/FleetSummary";
import type { GameDataSummary } from "../generated/GameDataSummary";
import type { InitPlanetView } from "../generated/InitPlanetView";
import type { InitializerView } from "../generated/InitializerView";
import type { NameTemplate } from "../generated/NameTemplate";
import type { PlanetSummary } from "../generated/PlanetSummary";
import type { SystemDetails } from "../generated/SystemDetails";
import type { SystemNode } from "../generated/SystemNode";

/** A plain localisation key as a name template, which is what the save writes for most nodes. */
export function name(key: string): NameTemplate {
  return { key, literal: false, variables: [] };
}

/** The one `SystemNode` builder: every test that needs one starts from these defaults. */
export function systemNode(over: Partial<SystemNode> = {}): SystemNode {
  return {
    id: 0,
    name: name("NAME_System"),
    x: 0,
    y: 0,
    star_class: "sc_g",
    lanes: [],
    nebula: null,
    bypass_ids: [],
    planet_count: 0,
    initializer: "",
    spawn_weight: null,
    spawn_modifiers: [],
    spawn_script: null,
    spawn_design: null,
    prevented: [],
    position_range: false,
    flags: [],
    owner: null,
    ...over,
  };
}

/** Empty details for one system; a test fills in what it asserts on. */
export function systemDetails(over: Partial<SystemDetails> = {}): SystemDetails {
  return {
    id: 1,
    resources: [],
    planets: [],
    starbase: null,
    fleets: { fleet_count: 0, military_count: 0, ship_count: 0, military_power: 0 },
    fleets_present: [],
    megastructures: [],
    sites: [],
    with_game_data: false,
    ...over,
  };
}

/** The one `PlanetSummary` builder: an uncolonised world of unstated size. */
export function planetSummary(over: Partial<PlanetSummary> = {}): PlanetSummary {
  return {
    id: 1,
    class: "pc_continental",
    name: name("NAME_Planet"),
    name_key: "NAME_Planet",
    pre_ftl: false,
    size: null,
    deposits: [],
    deposit_keys: [],
    pops: 0,
    colonised: false,
    capital: false,
    habitable: null,
    owner: null,
    moon: false,
    ...over,
  };
}

/** The one `FleetSummary` builder: one ownerless military ship with no power. */
export function fleetSummary(over: Partial<FleetSummary> = {}): FleetSummary {
  return {
    id: 1,
    name: name("NAME_Fleet"),
    name_key: "NAME_Fleet",
    owner: null,
    military: true,
    military_power: 0,
    ships: 1,
    order: null,
    planet_killer: false,
    disabled_ships: 0,
    ship_sizes: [],
    ...over,
  };
}

/** The one `InitializerView` builder: a nameless key that places nothing. */
export function initializerView(over: Partial<InitializerView> = {}): InitializerView {
  return {
    name: "init_01",
    source: "C:/Stellaris/common/solar_system_initializers/00_initializers.txt",
    display_name: null,
    class: null,
    usage: null,
    empire_spawn: false,
    max_instances: null,
    flags: [],
    countries: [],
    spawns: [],
    planets: [],
    planet_count: 0,
    ...over,
  };
}

/** One body an initializer places, of the class it names. */
export function initPlanetView(over: Partial<InitPlanetView> & { class: string }): InitPlanetView {
  return {
    name: null,
    size: null,
    orbit_distance: null,
    has_ring: false,
    count: 1,
    home_planet: false,
    deposits: [],
    moons: [],
    ...over,
  };
}

/** What a finished load reports: one install, one mod, and a registry count for every kind. */
export function gameDataSummary(over: Partial<GameDataSummary> = {}): GameDataSummary {
  return {
    install: "C:/Stellaris",
    version: "4.4.6",
    language: "l_english",
    language_fell_back: false,
    mods: [{ id: "1", name: "A mod", dir: "C:/mods/1", status: "loaded" }],
    initializers: 10,
    country_types: 3,
    star_classes: 2,
    sprites: 5,
    colors: 4,
    deposits: 6,
    planet_classes: 7,
    starbase_levels: 5,
    border: { system_radius: 5, hyperlane_thickness: 1 },
    localisation_keys: 1000,
    diagnostics: [],
    generation: 0,
    watch: { watching: 0, paused: false, reason: null },
    ...over,
  };
}
