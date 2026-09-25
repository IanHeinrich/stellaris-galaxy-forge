//! Every save key the crate reads or writes, named once.
//!
//! A reader is `find(key)` over the parsed bytes and a missing key is an empty result,
//! so a mistyped literal fails silently; a mistyped constant does not compile.

/// Declares each save key as a constant and lists them all in `ALL`, which the key-presence
/// test checks against the sample saves.
macro_rules! save_keys {
    ($($(#[$doc:meta])* $name:ident = $text:literal,)*) => {
        $($(#[$doc])* pub(crate) const $name: &str = $text;)*

        #[cfg(test)]
        pub(crate) const ALL: &[&str] = &[$($name),*];
    };
}

save_keys! {
    ACTIVE = "active",
    AMBIENT_OBJECT = "ambient_object",
    APPEAR_STATE = "appear_state",
    ARCHAEOLOGICAL_SITES = "archaeological_sites",
    ASTEROID_BELTS = "asteroid_belts",
    ASTEROID_POSTFIX = "asteroid_postfix",
    ASTEROID_PREFIX = "asteroid_prefix",
    ATTACH = "attach",
    BACKGROUND = "background",
    BINARY_FLAGS = "binary_flags",
    BLACK_HOLE_NAMES = "black_hole_names",
    BOMBARDMENT_DAMAGE = "bombardment_damage",
    BRIDGE = "bridge",
    BUILDINGS = "buildings",
    BUILD_QUEUE = "build_queue",
    BYPASS = "bypass",
    BYPASSES = "bypasses",
    CACHED_DISABLED_SHIPS = "cached_disabled_ships",
    CAPITAL = "capital",
    CARRIER_BINARY_FLAGS = "carrier_binary_flags",
    CATEGORY = "category",
    COLONIZE_DATE = "colonize_date",
    COLONY = "colony",
    COLORS = "colors",
    COMBAT = "combat",
    CONSTRUCTION_TYPE = "construction_type",
    CONTROLLER = "controller",
    COORDINATE = "coordinate",
    CORE_RADIUS = "core_radius",
    COUNT = "count",
    COUNTRY = "country",
    CRISES = "crises",
    CRISIS_TYPE = "crisis_type",
    CURRENT_ORDER = "current_order",
    DATA = "data",
    DAYS = "days",
    DEPOSIT = "deposit",
    DEPOSITS = "deposits",
    DEPOSIT_HOLDER = "deposit_holder",
    DESIGN = "design",
    DESIGNATION = "designation",
    DIFFICULTY = "difficulty",
    DISMANTLE_FINISH_DATE = "dismantle_finish_date",
    DISMANTLE_PROGRESS = "dismantle_progress",
    END_GAME_START = "end_game_start",
    ENTITY = "entity",
    ENTITY_FACE_OBJECT = "entity_face_object",
    ENTITY_NAME = "entity_name",
    FILE = "file",
    FINAL_DESIGNATION = "final_designation",
    FLAG = "flag",
    FLAGS = "flags",
    FLEET = "fleet",
    FLEETS_MANAGER = "fleets_manager",
    FLEET_PRESENCE = "fleet_presence",
    FLEET_STANCE = "fleet_stance",
    GALACTIC_OBJECT = "galactic_object",
    GALAXY = "galaxy",
    GALAXY_RADIUS = "galaxy_radius",
    /// The global flag dated with the save's day one.
    GAME_STARTED = "game_started",
    GROUND_SUPPORT_STANCE = "ground_support_stance",
    GROWTH_STAGE = "growth_stage",
    GROWTH_STAGES = "growth_stages",
    HABITABILITY = "habitability",
    HITPOINTS = "hitpoints",
    HIT_POINTS = "hit_points",
    HYPERLANE = "hyperlane",
    ICON = "icon",
    ID = "id",
    INDEX = "index",
    INITIALIZER = "initializer",
    INIT_PARENT = "init_parent",
    INNER_RADIUS = "inner_radius",
    IRONMAN = "ironman",
    ITEMS = "items",
    KEY = "key",
    LAST_BOMBARDMENT = "last_bombardment",
    LAST_CREATED_AMBIENT_OBJECT = "last_created_ambient_object",
    LAST_CREATED_SYSTEM = "last_created_system",
    LENGTH = "length",
    LEVEL = "level",
    LINKED_TO = "linked_to",
    LITERAL = "literal",
    LOCATION = "location",
    MAX_HITPOINTS = "max_hitpoints",
    MEGASTRUCTURES = "megastructures",
    MIA_FROM = "mia_from",
    MID_GAME_START = "mid_game_start",
    MILITARY_POWER = "military_power",
    MODIFIER = "modifier",
    MODULES = "modules",
    MOONS = "moons",
    MOON_OF = "moon_of",
    MOVEMENT_MANAGER = "movement_manager",
    NAME = "name",
    NATURAL_WORMHOLES = "natural_wormholes",
    NEBULA = "nebula",
    NEBULA_NAMES = "nebula_names",
    NUM_ADVANCED_EMPIRES = "num_advanced_empires",
    NUM_EMPIRES = "num_empires",
    NUM_FALLEN_EMPIRES = "num_fallen_empires",
    NUM_GATEWAYS = "num_gateways",
    NUM_HYPERLANES = "num_hyperlanes",
    NUM_MARAUDER_EMPIRES = "num_marauder_empires",
    NUM_NOMAD_EMPIRES = "num_nomad_empires",
    NUM_POPS = "num_pops",
    NUM_SAPIENT_POPS = "num_sapient_pops",
    NUM_WORMHOLE_PAIRS = "num_wormhole_pairs",
    OFFSET = "offset",
    ORBIT = "orbit",
    ORBITALS = "orbitals",
    ORIGIN = "origin",
    OUTER_RADIUS = "outer_radius",
    OWNED_FLEETS = "owned_fleets",
    OWNER = "owner",
    PLANET = "planet",
    PLANETS = "planets",
    PLANET_CLASS = "planet_class",
    PLANET_MODIFIER = "planet_modifier",
    PLANET_ORBITALS = "planet_orbitals",
    PLANET_SIZE = "planet_size",
    PLAYER = "player",
    POP_GROUPS = "pop_groups",
    PRIMITIVE = "primitive",
    PROPERTIES = "properties",
    RADIUS = "radius",
    RANDOMIZED = "randomized",
    RANDOM_NAME_DATABASE = "random_name_database",
    REQUIRED_DLCS = "required_dlcs",
    RESOURCE_ABUNDANCE = "resource_abundance",
    SCALE = "scale",
    SCALING = "scaling",
    SECTOR = "sector",
    SECTORS = "sectors",
    SHAPE = "shape",
    SHIPCLASS_ORBITAL_STATION = "shipclass_orbital_station",
    SHIPS = "ships",
    SHIPYARD_BUILD_QUEUE = "shipyard_build_queue",
    SHIP_CLASS = "ship_class",
    SHIP_DESIGN = "ship_design",
    SHIP_DESIGN_IMPLEMENTATION = "ship_design_implementation",
    SHIP_NAMES = "ship_names",
    SHIP_SIZE = "ship_size",
    SITES = "sites",
    SPECIES_DB = "species_db",
    SPECIES_INFORMATION = "species_information",
    STARBASES = "starbases",
    STARBASE_MGR = "starbase_mgr",
    STAR_CLASS = "star_class",
    STAR_NAMES = "star_names",
    STATION = "station",
    STORM = "storm",
    SURVEYED_BY = "surveyed_by",
    SWAP_TYPE = "swap_type",
    SYSTEM_INITIALIZER_COUNTER = "system_initializer_counter",
    TEMPLATE = "template",
    TIMED_MODIFIER = "timed_modifier",
    TO = "to",
    TYPE = "type",
    USE_MAP_COLOR = "use_map_color",
    VALUE = "value",
    VARIABLES = "variables",
    VERSION_CONTROL_REVISION = "version_control_revision",
    VISUAL_HEIGHT = "visual_height",
    WAYSTATIONS = "waystations",
    WAYSTATION_NETWORKS = "waystation_networks",
    X = "x",
    Y = "y",
}

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
