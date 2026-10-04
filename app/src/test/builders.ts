import type { CampaignListing } from "../generated/CampaignListing";
import type { SaveFile } from "../generated/SaveFile";
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { CampaignRow, SaveRow, ScenarioRow } from "../lib/openRows";
import type { BeltKindView } from "../generated/BeltKindView";
import type { BodyLayout } from "../generated/BodyLayout";
import type { BodyRole } from "../generated/BodyRole";
import type { CountryNode } from "../generated/CountryNode";
import type { ExportReport } from "../generated/ExportReport";
import type { FleetSummary } from "../generated/FleetSummary";
import type { GameDataSummary } from "../generated/GameDataSummary";
import type { HistoryEntry } from "../generated/HistoryEntry";
import type { InitPlanetView } from "../generated/InitPlanetView";
import type { Issue } from "../generated/Issue";
import type { InitializerView } from "../generated/InitializerView";
import type { NameTemplate } from "../generated/NameTemplate";
import type { PaintModView } from "../generated/PaintModView";
import type { PlanetClassView } from "../generated/PlanetClassView";
import type { PlanetPage } from "../generated/PlanetPage";
import type { PlanetSummary } from "../generated/PlanetSummary";
import type { SaveMeta } from "../generated/SaveMeta";
import type { ScenarioSummary } from "../generated/ScenarioSummary";
import type { StarClassView } from "../generated/StarClassView";
import type { SystemDetails } from "../generated/SystemDetails";
import type { SystemNode } from "../generated/SystemNode";
import type { WorkshopLinks } from "../generated/WorkshopLinks";
import { isStarBody } from "../lib/details/starBody";
import { newFeZone } from "../lib/feZone";

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
    added: false,
    ...over,
  };
}

/** Lanes from a system to each of `ids`, of no stated length. */
export function lanesTo(...ids: number[]): SystemNode["lanes"] {
  return ids.map((to) => ({ to, length: 0, bridge: false, stale: false }));
}

/** A system named `S<id>` at (x, y), laned to each of `to`. */
export function placedNode(id: number, x: number, y: number, to: number[] = []): SystemNode {
  return systemNode({ id, name: name(`S${id}`), x, y, lanes: lanesTo(...to) });
}

/** An anchor at (x, y) whose ring lies east at 40, taking custom connections under `linkId`. */
export function zoneAnchor(id: number, x: number, y: number, linkId: number): SystemNode {
  return {
    ...placedNode(id, x, y),
    fe_zone: newFeZone("e"),
    fe_link: { custom: true, id: linkId, to: [] },
  };
}

/** A system at (x, y) linked to the zones taking each of `ids`. */
export function feLinkedNode(id: number, x: number, y: number, ...ids: number[]): SystemNode {
  return { ...placedNode(id, x, y), fe_link: { custom: false, id: null, to: ids } };
}

/** Systems keyed by id, as the galaxy store holds them. */
export function byId(...nodes: SystemNode[]): Map<number, SystemNode> {
  return new Map(nodes.map((s) => [s.id, s]));
}

/** The one `Issue` builder: a warning on no system, a finding the validator would make again. */
export function appIssue(over: Partial<Issue> = {}): Issue {
  return {
    severity: "warning",
    code: "system_isolated",
    message: "",
    systems: [],
    note: false,
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
    belts: [],
    inner_radius: null,
    wormholes: [],
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
    orbit: null,
    deposits: [],
    deposit_keys: [],
    pops: 0,
    colonised: false,
    capital: false,
    habitable: null,
    owner: null,
    moon: false,
    role: over.moon ? "moon" : "planet",
    parent: null,
    layout: null,
    ring: null,
    ...over,
  };
}

/** The one `BodyLayout` builder: nothing placed, sized or stepped. */
export function bodyLayout(over: Partial<BodyLayout> = {}): BodyLayout {
  return {
    orbit: null,
    at: null,
    size: null,
    orbit_step: null,
    angle_step: null,
    turns_from: null,
    ...over,
  };
}

/**
 * A save body as the core describes it: at `at`, `orbit` from its parent, of `size`. A star
 * with no parent at the centre is the primary and any other star is a star. A body about a
 * planet, given by id or by the planet itself, is a moon. A planet about a star is a planet
 * with a `parent`, whose `moon` bit stays off.
 */
export function saveBody(
  id: number,
  planetClass: string,
  at: [number, number],
  orbit: number,
  size: number,
  parent: PlanetSummary | number | null = null,
): PlanetSummary {
  const layout = bodyLayout({
    orbit: { min: orbit, max: orbit },
    at,
    size: { min: size, max: size },
  });
  const parentId = typeof parent === "object" && parent !== null ? parent.id : parent;
  const aboutAStar =
    typeof parent === "object" &&
    parent !== null &&
    (parent.role === "primary" || parent.role === "star");
  const star = isStarBody(planetClass, new Map(), new Map());
  const moon = !star && parentId !== null && !aboutAStar;
  const role: BodyRole = star
    ? parentId === null && orbit === 0
      ? "primary"
      : "star"
    : moon
      ? "moon"
      : "planet";
  return planetSummary({ id, class: planetClass, parent: parentId, moon, role, orbit, layout });
}

/** Where a body `orbit` out at `angle` degrees from `from` stands, as the save writes its point. */
function about(from: [number, number], orbit: number, angle: number): [number, number] {
  const a = (angle * Math.PI) / 180;
  return [from[0] + orbit * Math.cos(a), from[1] + orbit * Math.sin(a)];
}

/** Where the bodies of `orbitSystem` stand, in save units about its centre. */
export const ORBIT_SYSTEM_AT = (() => {
  const planet = about([0, 0], 60, 30);
  return {
    planet,
    firstMoon: about(planet, 15, 90),
    secondMoon: about(planet, 20, 200),
    lonePlanet: about([0, 0], 100, 120),
    asteroid: about([0, 0], 124, 300),
  };
})();

/**
 * A save system with moons and belts: star 1 at the centre; planet 2 at 60 and 30° with moons 3
 * (15 at 90°) and 4 (20 at 200°); planet 5 at 100 and 120°; asteroid 6 at 124 and 300°, on the
 * rocky belt at 120; an icy belt at 170; inner radius 200. `orbitClasses` gives their classes.
 */
export function orbitSystem(over: Partial<SystemDetails> = {}): SystemDetails {
  const at = ORBIT_SYSTEM_AT;
  return systemDetails({
    id: 140,
    planets: [
      saveBody(1, "pc_g_star", [0, 0], 0, 30),
      saveBody(2, "pc_continental", at.planet, 60, 16),
      saveBody(3, "pc_barren", at.firstMoon, 15, 5, 2),
      saveBody(4, "pc_barren_cold", at.secondMoon, 20, 6, 2),
      saveBody(5, "pc_arid", at.lonePlanet, 100, 12),
      saveBody(6, "pc_asteroid", at.asteroid, 124, 3),
    ],
    belts: [
      { kind: "rocky_asteroid_belt", inner_radius: 120 },
      { kind: "icy_asteroid_belt", inner_radius: 170 },
    ],
    inner_radius: 200,
    ...over,
  });
}

/** The planet classes of `orbitSystem`'s bodies: a star, four worlds and an asteroid. */
export function orbitClasses(): Map<string, PlanetClassView> {
  const worlds = ["pc_continental", "pc_barren", "pc_barren_cold", "pc_arid"];
  return new Map([
    ["pc_g_star", planetClassView("pc_g_star")],
    ...worlds.map((key): [string, PlanetClassView] => [key, planetClassView(key, false)]),
    ["pc_asteroid", { ...planetClassView("pc_asteroid", false), asteroid: true }],
  ]);
}

/** Every planet named `P<id>`, so a menu or a lock label can say which one it means. */
export function namedPlanets(planets: PlanetSummary[]): PlanetSummary[] {
  return planets.map((p) => ({ ...p, name: name(`P${p.id}`), name_key: `P${p.id}` }));
}

/** System 0, Sol, with one icy belt at 80 and nothing else. */
export function solWithBelt(): SystemDetails {
  return systemDetails({ id: 0, belts: [{ kind: "icy_asteroid_belt", inner_radius: 80 }] });
}

/**
 * The star classes the game rolls, as `class key -> its star bodies`, and the planet classes of
 * those bodies and of any `worlds` beside them: what the game data store holds for a star class
 * picker.
 */
export function starClassesOf(
  stars: Record<string, string[]>,
  worlds: string[] = [],
): { starClasses: Map<string, StarClassView>; planetClasses: Map<string, PlanetClassView> } {
  const bodies = [...new Set(Object.values(stars).flat())];
  return {
    starClasses: new Map(
      Object.entries(stars).map(([key, keys]) => [key, starClassView(key, ...keys)]),
    ),
    planetClasses: new Map([
      ...bodies.map((key): [string, PlanetClassView] => [key, planetClassView(key)]),
      ...worlds.map((key): [string, PlanetClassView] => [key, planetClassView(key, false)]),
    ]),
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
    star_class: "sc_g",
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

/** A belt kind as the game data lists it: a plain rocky belt unless `over` says otherwise. */
export function beltKind(
  key: string,
  name: string,
  over: Partial<BeltKindView> = {},
): BeltKindView {
  return { key, name, look: "rocky", emissive: false, width: 1, density: 1, ...over };
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
    border: {
      system_radius: 5,
      hyperlane_thickness: 1,
      influence_max_distance_factor: 1.88,
      ownerless_system_radius: 30,
      ownerless_hyperlane_thickness: 20,
      ownerless_influence_max_distance_factor: 1.88,
      moon_scale: 0.7,
      name_min_width: 100,
    },
    system_radii: { min_inner: 150, inner_offset: 30, outer_offset: 100 },
    belt_kinds: [],
    localisation_keys: 1000,
    diagnostics: [],
    largest_galaxy: { name: "huge", label: "Huge", num_stars: 1000 },
    generation: 0,
    watch: { watching: 0, paused: false, reason: null },
    ...over,
  };
}

/** The Workshop pages as the shell answers them. */
export function workshopLinks(): WorkshopLinks {
  const page = (id: string) => `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`;
  return {
    paint_a_galaxy: page("3532904115"),
    reserved_spawns: page("3762808682"),
    local_cluster: page("3634498401"),
  };
}

/** One step of the change log. */
export function historyEntry(seq = 1, description = `Change ${seq}`): HistoryEntry {
  return { seq, description };
}

/** A star class the game rolls, localised, whose stars are `planetKeys` in that order. */
export function starClassView(key: string, ...planetKeys: string[]): StarClassView {
  return {
    key,
    texture_key: `star_class:${key}`,
    icon_scale: 1,
    planet_keys: planetKeys,
    crisis_star_class: null,
    spawn_odds: 1,
    localised: true,
  };
}

/** A planet class with no art of its own: a star body when `star`, else a habitable world. */
export function planetClassView(
  key: string,
  star = true,
  terraformCandidate: string | null = null,
  over: Partial<PlanetClassView> = {},
): PlanetClassView {
  return {
    key,
    icon_sprite: null,
    habitable: !star,
    star,
    terraform_candidate: terraformCandidate,
    icon_large_sprite: null,
    atmosphere_color: null,
    atmosphere_intensity: null,
    atmosphere_width: null,
    change: star ? "never" : "uncolonised",
    models: 1,
    ...over,
  };
}

/** The one `CountryNode` builder: an empire of a 4.4 save, with no map colours. */
export function countryNode(over: Partial<CountryNode> = {}): CountryNode {
  return {
    id: 7,
    name: name("NAME_Test_Empire"),
    name_key: "NAME_Test_Empire",
    country_type: "default",
    capital_system: 1,
    system_count: 2,
    colors: ["fixture_blue", "fixture_blue"],
    border_color: null,
    fill_color: null,
    use_map_color: false,
    painted_border: "fixture_blue",
    painted_fill: "fixture_blue",
    has_map_colors: false,
    flag_icon: null,
    flag_background: null,
    ...over,
  };
}

/** The one `PlanetPage` builder: an unowned, unsurveyed world with nothing on or around it. */
export function planetPage(over: Partial<PlanetPage> = {}): PlanetPage {
  return {
    id: 1207,
    name: name("NAME_Planet"),
    name_key: "NAME_Planet",
    label: "NAME_Planet",
    class: "pc_continental",
    size: 16,
    entity_name: null,
    orbit: null,
    system: 1,
    parent: null,
    moons: [],
    deposits: [],
    planet_modifiers: [],
    timed_modifiers: [],
    surveyed_by: null,
    station: null,
    owner: null,
    controller: null,
    colony: null,
    flags: 0,
    anomaly: null,
    terraforming: false,
    clearing: [],
    dig_site: null,
    ...over,
  };
}

/** The campaign folder every Open screen test lists. */
export const DIR = "C:/saves/terran";

export function saveFile(over: Partial<SaveFile> = {}): SaveFile {
  return {
    path: `${DIR}/2206.11.16.sav`,
    campaign: "terran_1",
    file_name: "2206.11.16.sav",
    meta: saveMeta({ name: "Terran Federation", planets: 1, fleets: 7 }),
    modified: 200,
    size: 4096,
    cloud: false,
    ...over,
  };
}

export function saveRow(over: Partial<SaveRow> = {}): SaveRow {
  return {
    kind: "save",
    key: "save:1",
    file: saveFile(),
    empire: "Terran Federation",
    title: "2206.11.16",
    sub: null,
    autosave: false,
    ...over,
  };
}

export function scenarioListing(over: Partial<ScenarioListing> = {}): ScenarioListing {
  return {
    path: "C:/mods/a/map/setup_scenarios/a.txt",
    name: "a_galaxy",
    systems: 100,
    source: "install",
    mod_name: null,
    enabled: true,
    shadowed_by: null,
    modified: 10,
    size: 1024,
    error: null,
    summary: scenarioSummary(),
    painted: false,
    ...over,
  };
}

export function scenarioRow(over: Partial<ScenarioRow> = {}): ScenarioRow {
  return {
    kind: "scenario",
    key: "scenario:1",
    listing: scenarioListing(),
    group: "Install",
    subtitle: "100 systems · Stellaris",
    disabled: false,
    ...over,
  };
}

export const CAMPAIGN: CampaignListing = {
  dir: DIR,
  name: "terran_1",
  empire: "Terran Federation",
  files: 3,
  newest: 200,
  meta: saveMeta({ name: "Terran Federation", date: "2206.11.16" }),
  cloud: false,
};

export function campaignRow(): CampaignRow {
  return {
    kind: "campaign",
    key: `campaign:${DIR}`,
    campaign: CAMPAIGN,
    empire: "Terran Federation",
    subtitle: "v4.4.6 · 2206.11.16",
    count: "3 saves",
    expanded: true,
    loading: false,
    error: null,
  };
}

/** The terran campaign as the lists show it: two files and no header of its own. */
export function campaignListing(over: Partial<CampaignListing> = {}): CampaignListing {
  return { ...CAMPAIGN, files: 2, meta: null, ...over };
}

export const TERRAN = campaignListing();
export const VOID = campaignListing({
  dir: "C:/saves/void",
  name: "void_2",
  empire: "Void Compact",
  newest: 100,
});

/** A terran save whose header says four planets and a blue empire. */
export function campaignSave(over: Partial<SaveFile> = {}): SaveFile {
  const meta = saveMeta({ name: "Terran Federation", planets: 4, fleets: 7, color: "blue" });
  return saveFile({ meta, ...over });
}

/** A scenario a mod lists. */
export function modScenario(over: Partial<ScenarioListing> = {}): ScenarioListing {
  return scenarioListing({ source: "mod", mod_name: "A Mod", ...over });
}
