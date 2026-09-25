//! What a save's system is to the generator, read from its initializer and flags: an
//! empire's home, a fallen empire's seat, a marauder camp, the L-Cluster … The plain
//! profile seats an empire on every `Home` and counts the rest for the export report.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::format::scenario::marauder::MARAUDER_PREFIX;
use crate::format::scenario::paint::SOL_INITIALIZER;

/// Initializer prefixes of the game's standard generated systems.
const GENERIC_INITIALIZER_PREFIXES: [&str; 16] = [
    "basic_init",
    "binary_init",
    "trinary_init",
    "asteroid_init",
    "neighbor_",
    "sol_neighbor",
    "deneb_neighbor",
    "random_empire_init",
    "custom_starting_init",
    "hostile_init",
    "special_init",
    "distantstars_init",
    "prescripted_",
    SOL_INITIALIZER,
    "une_",
    "empire_init",
];

/// Initializers the generator seats any empire on.
const GENERIC_HOME_PREFIXES: [&str; 2] = ["random_empire_init_", SOL_INITIALIZER];
const FALLEN_EMPIRE_PREFIXES: [&str; 2] = ["fallen_", "ai_system_"];
/// Vanilla initializers that `spawn_megastructure` an `lgate_base` besides those named
/// after it (`distant_stars_initializers.txt`).
const LGATE_INITIALIZERS: [&str; 3] = [
    "distantstars_init_00",
    "distantstars_init_01",
    "distantstars_init_06",
];
const GUARANTEED_COLONY_SUFFIXES: [&str; 2] = ["_first_colony", "_second_colony"];
const SPECIAL_FLAGS: [&str; 3] = ["guardian", "enclave", "galactic_landmark_system"];
/// What an L-Cluster system's initializer, or one of its star flags, starts with.
pub const LCLUSTER_PREFIX: &str = "lcluster";

/// What a system is to the generator, in the order the export report lists them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Home,
    FallenEmpire,
    Marauder,
    Ratling,
    LCluster,
    GuaranteedColony,
    Special,
    Generic,
}

impl Category {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Home => "home",
            Self::FallenEmpire => "fallen_empire",
            Self::Marauder => "marauder",
            Self::Ratling => "ratling",
            Self::LCluster => "l_cluster",
            Self::GuaranteedColony => "guaranteed_colony",
            Self::Special => "special",
            Self::Generic => "generic",
        }
    }

    /// The category as a report line names it.
    pub const fn label(self) -> &'static str {
        match self {
            Self::Home => "home",
            Self::FallenEmpire => "fallen empire",
            Self::Marauder => "marauder",
            Self::Ratling => "ratling",
            Self::LCluster => "L-Cluster",
            Self::GuaranteedColony => "guaranteed colony",
            Self::Special => "special",
            Self::Generic => "generic",
        }
    }
}

impl std::fmt::Display for Category {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// The first category the system matches; `is_capital` says a playable country's
/// capital stands in it.
pub fn classify(initializer: &str, flags: &[String], is_capital: bool) -> Category {
    let has = |flag: &str| flags.iter().any(|f| f == flag);
    let starts = |prefixes: &[&str]| prefixes.iter().any(|p| initializer.starts_with(p));
    if is_capital || has("empire_home_system") {
        Category::Home
    } else if starts(&FALLEN_EMPIRE_PREFIXES) {
        Category::FallenEmpire
    } else if initializer.starts_with(MARAUDER_PREFIX) || has("marauder_system") {
        Category::Marauder
    } else if initializer.starts_with("ratling_") {
        Category::Ratling
    } else if initializer.starts_with(LCLUSTER_PREFIX)
        || flags.iter().any(|f| f.starts_with(LCLUSTER_PREFIX))
    {
        Category::LCluster
    } else if GUARANTEED_COLONY_SUFFIXES
        .iter()
        .any(|s| initializer.ends_with(s))
    {
        Category::GuaranteedColony
    } else if SPECIAL_FLAGS.iter().any(|f| has(f))
        || (!initializer.is_empty() && !is_generic_initializer(initializer))
    {
        Category::Special
    } else {
        Category::Generic
    }
}

/// One of the game's standard generated systems (see [`GENERIC_INITIALIZER_PREFIXES`]).
pub fn is_generic_initializer(initializer: &str) -> bool {
    GENERIC_INITIALIZER_PREFIXES
        .iter()
        .any(|p| initializer.starts_with(p))
}

/// An initializer that builds the L-Gate the save had in its system, so a scenario
/// keeps it without stating it.
pub fn builds_lgate(initializer: &str) -> bool {
    initializer.starts_with("lgate") || LGATE_INITIALIZERS.contains(&initializer)
}

/// An initializer that builds the gateway the save had in its system.
pub fn builds_gateway(initializer: &str) -> bool {
    initializer.starts_with("abandoned_gateways")
}

/// A home the generator can seat any empire on; another home initializer is worth a
/// look, since it may only fit the empire that started there.
pub fn is_generic_home(initializer: &str) -> bool {
    GENERIC_HOME_PREFIXES
        .iter()
        .any(|p| initializer.starts_with(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flags(names: &[&str]) -> Vec<String> {
        names.iter().map(|f| (*f).to_owned()).collect()
    }

    #[test]
    fn a_capital_or_home_flag_is_a_home_before_anything_else() {
        assert_eq!(classify("fallen_machine_3", &[], true), Category::Home);
        assert_eq!(
            classify(
                "sol_system_initializer",
                &flags(&["empire_home_system", "galactic_landmark_system"]),
                false
            ),
            Category::Home
        );
        assert_eq!(
            classify(
                "shattered_ring_start",
                &flags(&["empire_home_system"]),
                false
            ),
            Category::Home
        );
    }

    #[test]
    fn initializer_names_and_flags_pick_the_category() {
        for (initializer, flags, expected) in [
            ("fallen_machine_3", vec![], Category::FallenEmpire),
            ("ai_system_04", vec![], Category::FallenEmpire),
            ("marauder_1", vec![], Category::Marauder),
            ("basic_init_01", vec!["marauder_system"], Category::Marauder),
            ("ratling_home", vec![], Category::Ratling),
            ("basic_init_02", vec!["lcluster1"], Category::LCluster),
            ("lcluster_01", vec![], Category::LCluster),
            ("distantstars_init_00", vec!["lgate"], Category::Generic),
            ("lgate_base_init", vec!["lgate"], Category::Special),
            (
                "neighbor_t1_first_colony",
                vec![],
                Category::GuaranteedColony,
            ),
            (
                "neighbor_t2_second_colony",
                vec![],
                Category::GuaranteedColony,
            ),
            ("basic_init_03", vec!["guardian"], Category::Special),
            ("basic_init_03", vec!["enclave"], Category::Special),
            (
                "basic_init_03",
                vec!["galactic_landmark_system"],
                Category::Special,
            ),
            ("guardians_init_dragon", vec![], Category::Special),
            ("basic_init_01", vec!["hostile_system"], Category::Generic),
            ("", vec![], Category::Generic),
        ] {
            assert_eq!(
                classify(initializer, &self::flags(&flags), false),
                expected,
                "{initializer} {flags:?}"
            );
        }
    }

    #[test]
    fn generic_initializers_and_generic_homes_are_told_by_prefix() {
        assert!(is_generic_initializer("basic_init_01"));
        assert!(is_generic_initializer("custom_starting_init_02"));
        assert!(!is_generic_initializer("shattered_ring_start"));
        assert!(!is_generic_initializer(""));

        assert!(is_generic_home("random_empire_init_06"));
        assert!(is_generic_home("sol_system_initializer"));
        assert!(!is_generic_home("custom_starting_init_02"));
        assert!(!is_generic_home("une_deneb_system"));
        assert!(!is_generic_home("shattered_ring_start"));
    }

    #[test]
    fn bypass_builders_are_told_by_name() {
        assert!(builds_lgate("lgate_base_init"));
        assert!(builds_lgate("distantstars_init_06"));
        assert!(!builds_lgate("distantstars_init_02"));
        assert!(builds_gateway("abandoned_gateways_01"));
        assert!(!builds_gateway("basic_init_01"));
    }
}
