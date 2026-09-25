//! Every save key the crate reads or writes, named once.
//!
//! A reader is `find(key)` over the parsed bytes and a missing key is an empty result,
//! so a mistyped literal fails silently; a mistyped constant does not compile.

pub(crate) const ACTIVE: &str = "active";
pub(crate) const AMBIENT_OBJECT: &str = "ambient_object";
pub(crate) const APPEAR_STATE: &str = "appear_state";
pub(crate) const ARCHAEOLOGICAL_SITES: &str = "archaeological_sites";
pub(crate) const ASTEROID_BELTS: &str = "asteroid_belts";
pub(crate) const ASTEROID_POSTFIX: &str = "asteroid_postfix";
pub(crate) const ASTEROID_PREFIX: &str = "asteroid_prefix";
pub(crate) const ATTACH: &str = "attach";
pub(crate) const BACKGROUND: &str = "background";
pub(crate) const BINARY_FLAGS: &str = "binary_flags";
pub(crate) const BLACK_HOLE_NAMES: &str = "black_hole_names";
pub(crate) const BOMBARDMENT_DAMAGE: &str = "bombardment_damage";
pub(crate) const BRIDGE: &str = "bridge";
pub(crate) const BUILDINGS: &str = "buildings";
pub(crate) const BUILD_QUEUE: &str = "build_queue";
pub(crate) const BYPASS: &str = "bypass";
pub(crate) const BYPASSES: &str = "bypasses";
pub(crate) const CACHED_DISABLED_SHIPS: &str = "cached_disabled_ships";
pub(crate) const CAPITAL: &str = "capital";
pub(crate) const CARRIER_BINARY_FLAGS: &str = "carrier_binary_flags";
pub(crate) const CATEGORY: &str = "category";
pub(crate) const COLONIZE_DATE: &str = "colonize_date";
pub(crate) const COLONY: &str = "colony";
pub(crate) const COLORS: &str = "colors";
pub(crate) const COMBAT: &str = "combat";
pub(crate) const CONSTRUCTION_TYPE: &str = "construction_type";
pub(crate) const CONTROLLER: &str = "controller";
pub(crate) const COORDINATE: &str = "coordinate";
pub(crate) const CORE_RADIUS: &str = "core_radius";
pub(crate) const COUNT: &str = "count";
pub(crate) const COUNTRY: &str = "country";
pub(crate) const CRISES: &str = "crises";
pub(crate) const CRISIS_TYPE: &str = "crisis_type";
pub(crate) const CURRENT_ORDER: &str = "current_order";
pub(crate) const DATA: &str = "data";
pub(crate) const DAYS: &str = "days";
pub(crate) const DEPOSIT: &str = "deposit";
pub(crate) const DEPOSITS: &str = "deposits";
pub(crate) const DEPOSIT_HOLDER: &str = "deposit_holder";
pub(crate) const DESIGN: &str = "design";
pub(crate) const DESIGNATION: &str = "designation";
pub(crate) const DIFFICULTY: &str = "difficulty";
pub(crate) const DISMANTLE_FINISH_DATE: &str = "dismantle_finish_date";
pub(crate) const DISMANTLE_PROGRESS: &str = "dismantle_progress";
pub(crate) const END_GAME_START: &str = "end_game_start";
pub(crate) const ENTITY: &str = "entity";
pub(crate) const ENTITY_FACE_OBJECT: &str = "entity_face_object";
pub(crate) const ENTITY_NAME: &str = "entity_name";
pub(crate) const FILE: &str = "file";
pub(crate) const FINAL_DESIGNATION: &str = "final_designation";
pub(crate) const FLAG: &str = "flag";
pub(crate) const FLAGS: &str = "flags";
pub(crate) const FLEET: &str = "fleet";
pub(crate) const FLEETS_MANAGER: &str = "fleets_manager";
pub(crate) const FLEET_PRESENCE: &str = "fleet_presence";
pub(crate) const FLEET_STANCE: &str = "fleet_stance";
pub(crate) const GALACTIC_OBJECT: &str = "galactic_object";
pub(crate) const GALAXY: &str = "galaxy";
pub(crate) const GALAXY_RADIUS: &str = "galaxy_radius";
/// The global flag dated with the save's day one.
pub(crate) const GAME_STARTED: &str = "game_started";
pub(crate) const GROUND_SUPPORT_STANCE: &str = "ground_support_stance";
pub(crate) const GROWTH_STAGE: &str = "growth_stage";
pub(crate) const GROWTH_STAGES: &str = "growth_stages";
pub(crate) const HABITABILITY: &str = "habitability";
pub(crate) const HITPOINTS: &str = "hitpoints";
pub(crate) const HIT_POINTS: &str = "hit_points";
pub(crate) const HYPERLANE: &str = "hyperlane";
pub(crate) const ICON: &str = "icon";
pub(crate) const ID: &str = "id";
pub(crate) const INDEX: &str = "index";
pub(crate) const INITIALIZER: &str = "initializer";
pub(crate) const INIT_PARENT: &str = "init_parent";
pub(crate) const INNER_RADIUS: &str = "inner_radius";
pub(crate) const IRONMAN: &str = "ironman";
pub(crate) const ITEMS: &str = "items";
pub(crate) const KEY: &str = "key";
pub(crate) const LAST_BOMBARDMENT: &str = "last_bombardment";
pub(crate) const LAST_CREATED_AMBIENT_OBJECT: &str = "last_created_ambient_object";
pub(crate) const LAST_CREATED_SYSTEM: &str = "last_created_system";
pub(crate) const LENGTH: &str = "length";
pub(crate) const LEVEL: &str = "level";
pub(crate) const LINKED_TO: &str = "linked_to";
pub(crate) const LITERAL: &str = "literal";
pub(crate) const LOCATION: &str = "location";
pub(crate) const MAX_HITPOINTS: &str = "max_hitpoints";
pub(crate) const MEGASTRUCTURES: &str = "megastructures";
pub(crate) const MIA_FROM: &str = "mia_from";
pub(crate) const MID_GAME_START: &str = "mid_game_start";
pub(crate) const MILITARY_POWER: &str = "military_power";
pub(crate) const MODIFIER: &str = "modifier";
pub(crate) const MODULES: &str = "modules";
pub(crate) const MOONS: &str = "moons";
pub(crate) const MOON_OF: &str = "moon_of";
pub(crate) const MOVEMENT_MANAGER: &str = "movement_manager";
pub(crate) const NAME: &str = "name";
pub(crate) const NATURAL_WORMHOLES: &str = "natural_wormholes";
pub(crate) const NEBULA: &str = "nebula";
pub(crate) const NEBULA_NAMES: &str = "nebula_names";
pub(crate) const NUM_ADVANCED_EMPIRES: &str = "num_advanced_empires";
pub(crate) const NUM_EMPIRES: &str = "num_empires";
pub(crate) const NUM_FALLEN_EMPIRES: &str = "num_fallen_empires";
pub(crate) const NUM_GATEWAYS: &str = "num_gateways";
pub(crate) const NUM_HYPERLANES: &str = "num_hyperlanes";
pub(crate) const NUM_MARAUDER_EMPIRES: &str = "num_marauder_empires";
pub(crate) const NUM_NOMAD_EMPIRES: &str = "num_nomad_empires";
pub(crate) const NUM_POPS: &str = "num_pops";
pub(crate) const NUM_SAPIENT_POPS: &str = "num_sapient_pops";
pub(crate) const NUM_WORMHOLE_PAIRS: &str = "num_wormhole_pairs";
pub(crate) const OFFSET: &str = "offset";
pub(crate) const ORBIT: &str = "orbit";
pub(crate) const ORBITALS: &str = "orbitals";
pub(crate) const ORIGIN: &str = "origin";
pub(crate) const OUTER_RADIUS: &str = "outer_radius";
pub(crate) const OWNED_FLEETS: &str = "owned_fleets";
pub(crate) const OWNER: &str = "owner";
pub(crate) const PLANET: &str = "planet";
pub(crate) const PLANETS: &str = "planets";
pub(crate) const PLANET_CLASS: &str = "planet_class";
pub(crate) const PLANET_MODIFIER: &str = "planet_modifier";
pub(crate) const PLANET_ORBITALS: &str = "planet_orbitals";
pub(crate) const PLANET_SIZE: &str = "planet_size";
pub(crate) const PLAYER: &str = "player";
pub(crate) const POP_GROUPS: &str = "pop_groups";
pub(crate) const PRIMITIVE: &str = "primitive";
pub(crate) const PROPERTIES: &str = "properties";
pub(crate) const RADIUS: &str = "radius";
pub(crate) const RANDOMIZED: &str = "randomized";
pub(crate) const RANDOM_NAME_DATABASE: &str = "random_name_database";
pub(crate) const REQUIRED_DLCS: &str = "required_dlcs";
pub(crate) const RESOURCE_ABUNDANCE: &str = "resource_abundance";
pub(crate) const SCALE: &str = "scale";
pub(crate) const SCALING: &str = "scaling";
pub(crate) const SECTOR: &str = "sector";
pub(crate) const SECTORS: &str = "sectors";
pub(crate) const SHAPE: &str = "shape";
pub(crate) const SHIPCLASS_ORBITAL_STATION: &str = "shipclass_orbital_station";
pub(crate) const SHIPS: &str = "ships";
pub(crate) const SHIPYARD_BUILD_QUEUE: &str = "shipyard_build_queue";
pub(crate) const SHIP_CLASS: &str = "ship_class";
pub(crate) const SHIP_DESIGN: &str = "ship_design";
pub(crate) const SHIP_DESIGN_IMPLEMENTATION: &str = "ship_design_implementation";
pub(crate) const SHIP_NAMES: &str = "ship_names";
pub(crate) const SHIP_SIZE: &str = "ship_size";
pub(crate) const SITES: &str = "sites";
pub(crate) const SPECIES_DB: &str = "species_db";
pub(crate) const SPECIES_INFORMATION: &str = "species_information";
pub(crate) const STARBASES: &str = "starbases";
pub(crate) const STARBASE_MGR: &str = "starbase_mgr";
pub(crate) const STAR_CLASS: &str = "star_class";
pub(crate) const STAR_NAMES: &str = "star_names";
pub(crate) const STATION: &str = "station";
pub(crate) const STORM: &str = "storm";
pub(crate) const SURVEYED_BY: &str = "surveyed_by";
pub(crate) const SWAP_TYPE: &str = "swap_type";
pub(crate) const SYSTEM_INITIALIZER_COUNTER: &str = "system_initializer_counter";
pub(crate) const TEMPLATE: &str = "template";
pub(crate) const TIMED_MODIFIER: &str = "timed_modifier";
pub(crate) const TO: &str = "to";
pub(crate) const TYPE: &str = "type";
pub(crate) const USE_MAP_COLOR: &str = "use_map_color";
pub(crate) const VALUE: &str = "value";
pub(crate) const VARIABLES: &str = "variables";
pub(crate) const VERSION_CONTROL_REVISION: &str = "version_control_revision";
pub(crate) const VISUAL_HEIGHT: &str = "visual_height";
pub(crate) const WAYSTATIONS: &str = "waystations";
pub(crate) const WAYSTATION_NETWORKS: &str = "waystation_networks";
pub(crate) const X: &str = "x";
pub(crate) const Y: &str = "y";

/// Every save key above, so a test can check each against the sample saves. A new key
/// is added here as well as above.
#[cfg(test)]
pub(crate) const ALL: &[&str] = &[
    ACTIVE,
    AMBIENT_OBJECT,
    APPEAR_STATE,
    ARCHAEOLOGICAL_SITES,
    ASTEROID_BELTS,
    ASTEROID_POSTFIX,
    ASTEROID_PREFIX,
    ATTACH,
    BACKGROUND,
    BINARY_FLAGS,
    BLACK_HOLE_NAMES,
    BOMBARDMENT_DAMAGE,
    BRIDGE,
    BUILDINGS,
    BUILD_QUEUE,
    BYPASS,
    BYPASSES,
    CACHED_DISABLED_SHIPS,
    CAPITAL,
    CARRIER_BINARY_FLAGS,
    CATEGORY,
    COLONIZE_DATE,
    COLONY,
    COLORS,
    COMBAT,
    CONSTRUCTION_TYPE,
    CONTROLLER,
    COORDINATE,
    CORE_RADIUS,
    COUNT,
    COUNTRY,
    CRISES,
    CRISIS_TYPE,
    CURRENT_ORDER,
    DATA,
    DAYS,
    DEPOSIT,
    DEPOSITS,
    DEPOSIT_HOLDER,
    DESIGN,
    DESIGNATION,
    DIFFICULTY,
    DISMANTLE_FINISH_DATE,
    DISMANTLE_PROGRESS,
    END_GAME_START,
    ENTITY,
    ENTITY_FACE_OBJECT,
    ENTITY_NAME,
    FILE,
    FINAL_DESIGNATION,
    FLAG,
    FLAGS,
    FLEET,
    FLEETS_MANAGER,
    FLEET_PRESENCE,
    FLEET_STANCE,
    GALACTIC_OBJECT,
    GALAXY,
    GALAXY_RADIUS,
    GAME_STARTED,
    GROUND_SUPPORT_STANCE,
    GROWTH_STAGE,
    GROWTH_STAGES,
    HABITABILITY,
    HITPOINTS,
    HIT_POINTS,
    HYPERLANE,
    ICON,
    ID,
    INDEX,
    INITIALIZER,
    INIT_PARENT,
    INNER_RADIUS,
    IRONMAN,
    ITEMS,
    KEY,
    LAST_BOMBARDMENT,
    LAST_CREATED_AMBIENT_OBJECT,
    LAST_CREATED_SYSTEM,
    LENGTH,
    LEVEL,
    LINKED_TO,
    LITERAL,
    LOCATION,
    MAX_HITPOINTS,
    MEGASTRUCTURES,
    MIA_FROM,
    MID_GAME_START,
    MILITARY_POWER,
    MODIFIER,
    MODULES,
    MOONS,
    MOON_OF,
    MOVEMENT_MANAGER,
    NAME,
    NATURAL_WORMHOLES,
    NEBULA,
    NEBULA_NAMES,
    NUM_ADVANCED_EMPIRES,
    NUM_EMPIRES,
    NUM_FALLEN_EMPIRES,
    NUM_GATEWAYS,
    NUM_HYPERLANES,
    NUM_MARAUDER_EMPIRES,
    NUM_NOMAD_EMPIRES,
    NUM_POPS,
    NUM_SAPIENT_POPS,
    NUM_WORMHOLE_PAIRS,
    OFFSET,
    ORBIT,
    ORBITALS,
    ORIGIN,
    OUTER_RADIUS,
    OWNED_FLEETS,
    OWNER,
    PLANET,
    PLANETS,
    PLANET_CLASS,
    PLANET_MODIFIER,
    PLANET_ORBITALS,
    PLANET_SIZE,
    PLAYER,
    POP_GROUPS,
    PRIMITIVE,
    PROPERTIES,
    RADIUS,
    RANDOMIZED,
    RANDOM_NAME_DATABASE,
    REQUIRED_DLCS,
    RESOURCE_ABUNDANCE,
    SCALE,
    SCALING,
    SECTOR,
    SECTORS,
    SHAPE,
    SHIPCLASS_ORBITAL_STATION,
    SHIPS,
    SHIPYARD_BUILD_QUEUE,
    SHIP_CLASS,
    SHIP_DESIGN,
    SHIP_DESIGN_IMPLEMENTATION,
    SHIP_NAMES,
    SHIP_SIZE,
    SITES,
    SPECIES_DB,
    SPECIES_INFORMATION,
    STARBASES,
    STARBASE_MGR,
    STAR_CLASS,
    STAR_NAMES,
    STATION,
    STORM,
    SURVEYED_BY,
    SWAP_TYPE,
    SYSTEM_INITIALIZER_COUNTER,
    TEMPLATE,
    TIMED_MODIFIER,
    TO,
    TYPE,
    USE_MAP_COLOR,
    VALUE,
    VARIABLES,
    VERSION_CONTROL_REVISION,
    VISUAL_HEIGHT,
    WAYSTATIONS,
    WAYSTATION_NETWORKS,
    X,
    Y,
];

/// Save keys a save may lack. The test asks only that some sample save writes each.
#[cfg(test)]
pub(crate) const OPTIONAL: &[&str] = &[
    // Written from 4.5, and only for an empire created with Independent Map Color on.
    USE_MAP_COLOR,
    // Written once a waystation network has a station; the 4.4 sample's table is empty.
    WAYSTATIONS,
];

/// The keys only the `meta` member writes, which the save-key test does not look for.
pub(crate) mod meta {
    pub(crate) const DATE: &str = "date";
    pub(crate) const IRONMAN: &str = "ironman";
    pub(crate) const META_FLEETS: &str = "meta_fleets";
    pub(crate) const META_PLANETS: &str = "meta_planets";
    pub(crate) const NAME: &str = "name";
    pub(crate) const PLAYER_PORTRAIT: &str = "player_portrait";
    pub(crate) const VERSION: &str = "version";
}

/// The keys of a static galaxy scenario script, which shares only a few names with a save.
pub(crate) mod scenario {
    pub(crate) const ADD: &str = "add";
    pub(crate) const ADD_HYPERLANE: &str = "add_hyperlane";
    pub(crate) const ADVANCED_EMPIRE_DEFAULT: &str = "advanced_empire_default";
    pub(crate) const BASE: &str = "base";
    pub(crate) const COLONIZABLE_PLANET_ODDS: &str = "colonizable_planet_odds";
    pub(crate) const COORDINATE_TRANSFORM: &str = "coordinate_transform";
    pub(crate) const CORE_RADIUS: &str = "core_radius";
    pub(crate) const CRISIS_STRENGTH: &str = "crisis_strength";
    pub(crate) const EFFECT: &str = "effect";
    pub(crate) const EXTRA_CRISIS_STRENGTH: &str = "extra_crisis_strength";
    pub(crate) const FACTOR: &str = "factor";
    pub(crate) const FALLEN_EMPIRE_DEFAULT: &str = "fallen_empire_default";
    pub(crate) const FALLEN_EMPIRE_MAX: &str = "fallen_empire_max";
    pub(crate) const FROM: &str = "from";
    pub(crate) const HAS_COUNTRY_FLAG: &str = "has_country_flag";
    pub(crate) const HAS_TRAIT: &str = "has_trait";
    pub(crate) const ID: &str = "id";
    pub(crate) const INITIALIZER: &str = "initializer";
    pub(crate) const MARAUDER_EMPIRE_DEFAULT: &str = "marauder_empire_default";
    pub(crate) const MARAUDER_EMPIRE_MAX: &str = "marauder_empire_max";
    pub(crate) const MAX: &str = "max";
    pub(crate) const MIN: &str = "min";
    pub(crate) const MODIFIER: &str = "modifier";
    pub(crate) const NAME: &str = "name";
    pub(crate) const NEBULA: &str = "nebula";
    pub(crate) const NOMAD_EMPIRE_DEFAULT: &str = "nomad_empire_default";
    pub(crate) const NOMAD_EMPIRE_MAX: &str = "nomad_empire_max";
    pub(crate) const NUM_EMPIRES: &str = "num_empires";
    pub(crate) const NUM_EMPIRE_DEFAULT: &str = "num_empire_default";
    pub(crate) const NUM_GATEWAYS: &str = "num_gateways";
    pub(crate) const NUM_GATEWAYS_DEFAULT: &str = "num_gateways_default";
    pub(crate) const NUM_HYPERLANES: &str = "num_hyperlanes";
    pub(crate) const NUM_HYPERLANES_DEFAULT: &str = "num_hyperlanes_default";
    pub(crate) const NUM_NEBULAS: &str = "num_nebulas";
    pub(crate) const NUM_WORMHOLE_PAIRS: &str = "num_wormhole_pairs";
    pub(crate) const NUM_WORMHOLE_PAIRS_DEFAULT: &str = "num_wormhole_pairs_default";
    pub(crate) const POSITION: &str = "position";
    pub(crate) const PREVENT_HYPERLANE: &str = "prevent_hyperlane";
    pub(crate) const PRIMITIVE_ODDS: &str = "primitive_odds";
    pub(crate) const PRIORITY: &str = "priority";
    pub(crate) const RADIUS: &str = "radius";
    pub(crate) const SETUP_SCENARIO: &str = "setup_scenario";
    pub(crate) const SPAWN_DESIGN: &str = "spawn_design";
    pub(crate) const SPAWN_WEIGHT: &str = "spawn_weight";
    pub(crate) const STATIC_GALAXY_SCENARIO: &str = "static_galaxy_scenario";
    pub(crate) const SUPPORTS_SHAPE: &str = "supports_shape";
    pub(crate) const SYSTEM: &str = "system";
    pub(crate) const TO: &str = "to";
    pub(crate) const VALUE_PREFIX: &str = "value:";
    pub(crate) const X: &str = "x";
    pub(crate) const Y: &str = "y";
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use std::path::PathBuf;

    use super::*;
    use crate::document::Document;

    const TESTDATA: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata");

    fn sample_saves() -> Vec<PathBuf> {
        let mut saves: Vec<PathBuf> = std::fs::read_dir(TESTDATA)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|ext| ext == "sav"))
            .collect();
        saves.sort();
        assert!(!saves.is_empty(), "no .sav in {TESTDATA}");
        saves
    }

    /// The keys the save writes: `<key>=` at a line start after any tabs.
    fn keys_written(gamestate: &[u8]) -> HashSet<&[u8]> {
        gamestate
            .split(|&b| b == b'\n')
            .filter_map(|line| {
                let line = &line[line.iter().take_while(|&&b| b == b'\t').count()..];
                let eq = memchr::memchr(b'=', line)?;
                Some(&line[..eq])
            })
            .collect()
    }

    fn name(path: &std::path::Path) -> String {
        path.file_name().unwrap().to_string_lossy().into_owned()
    }

    #[test]
    fn every_save_key_is_written_by_each_sample_save() {
        let mut missing = Vec::new();
        for path in sample_saves() {
            let doc = Document::load(&path).unwrap();
            // The 3.x sample is there for lane edits; it predates keys the core reads.
            let version = crate::archive::parse_meta(doc.meta()).unwrap().version;
            if !version.contains(" v4.") {
                continue;
            }
            let written = keys_written(doc.original());
            for key in ALL {
                if !OPTIONAL.contains(key) && !written.contains(key.as_bytes()) {
                    missing.push(format!("{key} is not written by {}", name(&path)));
                }
            }
        }
        assert!(
            missing.is_empty(),
            "the game no longer writes these keys, or a sample save lacks them and they belong in OPTIONAL:\n{}",
            missing.join("\n")
        );
    }

    #[test]
    fn every_optional_key_is_written_by_some_sample_save() {
        let mut written = HashSet::new();
        for path in sample_saves() {
            let doc = Document::load(&path).unwrap();
            written.extend(keys_written(doc.original()).into_iter().map(<[u8]>::to_vec));
        }
        for key in OPTIONAL {
            assert!(ALL.contains(key), "{key} is in OPTIONAL but not in ALL");
            assert!(
                written.contains(key.as_bytes()),
                "{key} is in OPTIONAL but no sample save writes it"
            );
        }
    }
}
