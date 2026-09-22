import type { ExportReport } from "../generated/ExportReport";
import type { FleetSummary } from "../generated/FleetSummary";
import type { GameDataSummary } from "../generated/GameDataSummary";
import type { InitPlanetView } from "../generated/InitPlanetView";
import type { InitializerView } from "../generated/InitializerView";
import type { NameTemplate } from "../generated/NameTemplate";
import type { PaintModView } from "../generated/PaintModView";
import type { PlanetSummary } from "../generated/PlanetSummary";
import type { SaveMeta } from "../generated/SaveMeta";
import type { ScenarioSummary } from "../generated/ScenarioSummary";
import type { SystemDetails } from "../generated/SystemDetails";
import type { SystemNode } from "../generated/SystemNode";

/** A plain localisation key as a name template, which is what the save writes for most nodes. */
export function name(key: string): NameTemplate {
  return { key, literal: false, variables: [] };
}

/** The one `SaveMeta` builder: the header of the 4.4 sample save, without the 4.5 extras. */
export function saveMeta(over: Partial<SaveMeta> = {}): SaveMeta {
  return {
    name: "Test Empire",
    date: "2206.11.16",
    version: "Pegasus v4.4.6",
    ironman: false,
    planets: null,
    fleets: null,
    color: null,
    version_revision: null,
    required_dlcs: [],
    portrait: null,
    flag: null,
    ...over,
  };
}

/** The one `ScenarioSummary` builder: a header that states nothing. */
export function scenarioSummary(over: Partial<ScenarioSummary> = {}): ScenarioSummary {
  const none = { default: null, max: null };
  return {
    priority: null,
    radius: null,
    core_radius: null,
    supports_shape: [],
    empires: none,
    advanced_empires: none,
    fallen_empires: none,
    marauder_empires: none,
    nomad_empires: none,
    colonizable_planet_odds: null,
    primitive_odds: null,
    num_gateways: null,
    num_wormhole_pairs: null,
    num_nebulas: null,
    num_hyperlanes: null,
    crisis_strength: null,
    extra_crisis_strength: [],
    ...over,
  };
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
    fe_zone: null,
    fe_link: { custom: false, id: null, to: [] },
    wormhole_pair: null,
    marauder: null,
    spawn_design: null,
    prevented: [],
    position_range: false,
    flags: [],
    owner: null,
    ...over,
  };
}

/** The report of an export that carried everything over; a test adds what it left out. */
export function exportReport(over: Partial<ExportReport> = {}): ExportReport {
  return {
    seats: 17,
    home_initializers: [],
    dropped: { wormhole_pairs: 0, gateways: 0, lgates: 0 },
    by_category: [
      { category: "home", systems: 17 },
      { category: "generic", systems: 774 },
    ],
    sources: [],
    fallen_empire_zones: 0,
    fallen_empires: [],
    player_seat: null,
    player_seat_kind: null,
    omitted: [],
    setup_from_save: false,
    ...over,
  };
}

/** The one `PaintModView` builder: the mod installed, enabled, with its submod beside it. */
export function paintModView(over: Partial<PaintModView> = {}): PaintModView {
  return {
    scenarios_dir: "C:/mods/pag/map/setup_scenarios",
    enabled: true,
    reserved_spawns: true,
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
    largest_galaxy: { name: "huge", label: "Huge", num_stars: 1000 },
    generation: 0,
    watch: { watching: 0, paused: false, reason: null },
    ...over,
  };
}
