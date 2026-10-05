//! Which row of "Prepare for a new game" each system of an open scenario stands in, read
//! from what its initializer is in the install: its `usage`, its odds, its flags, the
//! initializers that place it, and what [`crate::special`] makes of it.
//!
//! A system on a Sol layout stands in Sol, seat or not. Any other seat's system is a home
//! start, or in no initializer row when its start is generic. A fallen empire's system is
//! in no initializer row. Every other system stands in the first of these it fits: Home
//! neighbours, Marauder clans, Guardians and leviathans, Enclaves, Primitives, Origin and
//! event, Ordinary systems, else Special systems. Ordinary systems are the layouts
//! [`layouts::ordinary`] calls ordinary, the rule the generator's plain layouts are built
//! on.

use std::collections::HashMap;

use sgf_core::export::policy::is_generic_home;
use sgf_core::format::scenario::header_counts::is_seat;
use sgf_core::format::scenario::marauder;
use sgf_core::format::scenario::paint::is_random_list;
use sgf_core::prepare::{PlainDraw, PrepareRow, RowSystems, WeightedLayout};
use sgf_core::projections::galaxy::SystemNode;
use sgf_core::session::Session;

use crate::GameData;
use crate::initializers::{InitPlanet, Initializer};
use crate::layouts::{self, odds, plain_initializers};
use crate::special::{SpecialKind, classify_session};

/// The `usage` of the initializers an empire starts on: the game's random starts, the
/// prescripted empires' and the origins'.
const HOME_START_USAGES: [&str; 3] = ["empire_init", "custom_empire", "origin"];
/// The `usage` of a nomad empire's home.
const NOMAD_USAGE: &str = "nomad_init";
/// The `usage` of the game's random empire starts.
const RANDOM_START_USAGE: &str = "empire_init";
/// The star flag a prescripted empire's start carries.
const HOME_FLAG: &str = "empire_home_system";
/// The star flag every Sol layout sets.
const SOL_FLAG: &str = "sol";
/// What a layout whose odds follow the primitives setting states.
const PRIMITIVE_KEY: &str = "primitive_system";

/// Every row with the systems standing in it, in [`PrepareRow::ALL`] order, each row's
/// systems in file order.
pub fn classify(session: &Session, gd: &GameData) -> Vec<RowSystems> {
    let special = classify_session(session, Some(gd));
    let kinds: HashMap<u32, &[SpecialKind]> = special
        .systems
        .iter()
        .map(|system| (system.id, system.kinds.as_slice()))
        .collect();
    let mut rows: HashMap<PrepareRow, Vec<u32>> = HashMap::new();
    let graph = session.graph();
    for node in graph.order.iter().filter_map(|id| graph.systems.get(id)) {
        let kinds = kinds.get(&node.id).copied().unwrap_or_default();
        let seat = is_seat(node);
        let fallen = kinds
            .iter()
            .any(|kind| matches!(kind, SpecialKind::FallenEmpire | SpecialKind::HolyWorld));
        let mut push = |row: PrepareRow| rows.entry(row).or_default().push(node.id);
        if seat {
            push(PrepareRow::EmpireSeats);
        }
        if fallen || node.fe_zone.is_some() {
            push(PrepareRow::FallenEmpires);
        }
        if node.wormhole_pair.is_some() {
            push(PrepareRow::WormholePairs);
        }
        push(PrepareRow::SystemNames);
        let row = if fallen {
            None
        } else if sol(gd, &node.initializer) {
            Some(PrepareRow::Sol)
        } else if seat {
            let home = !node.initializer.is_empty() && !generic_start(gd, &node.initializer);
            home.then_some(PrepareRow::HomeStarts)
        } else {
            Some(initializer_row(gd, node, kinds))
        };
        if let Some(row) = row {
            push(row);
        }
    }
    PrepareRow::ALL
        .into_iter()
        .map(|row| RowSystems {
            row,
            systems: rows.remove(&row).unwrap_or_default(),
        })
        .collect()
}

/// The layouts Plain system draws from on a plain scenario: the ordinary ones the generator
/// rolls at random, each weighted by its odds.
pub fn plain_draw(gd: &GameData, seed: u64) -> PlainDraw {
    PlainDraw {
        layouts: plain_initializers(gd)
            .into_iter()
            .map(|init| WeightedLayout {
                key: init.name.clone(),
                weight: odds(gd, init, None),
            })
            .filter(|layout| layout.weight > 0.0)
            .collect(),
        seed,
    }
}

/// One of the game's Sol layouts, by the star flag they all set: the empire starts, the
/// origins' variants, the primitive, tomb world and geocentric Sols.
fn sol(gd: &GameData, initializer: &str) -> bool {
    gd.initializers
        .get(initializer)
        .is_some_and(|init| init.flags.iter().any(|f| f == SOL_FLAG))
}

/// A start the game seats any empire on.
fn generic_start(gd: &GameData, initializer: &str) -> bool {
    is_generic_home(initializer)
        || gd
            .initializers
            .get(initializer)
            .is_some_and(|init| init.usage.as_deref() == Some(RANDOM_START_USAGE))
}

fn initializer_row(gd: &GameData, node: &SystemNode, kinds: &[SpecialKind]) -> PrepareRow {
    let key = node.initializer.as_str();
    if key.is_empty() || is_random_list(key) {
        return PrepareRow::OrdinarySystems;
    }
    let Some(init) = gd.initializers.get(key) else {
        return match node.marauder {
            Some(_) => PrepareRow::MarauderClans,
            None => PrepareRow::SpecialSystems,
        };
    };
    let placed_by = gd.initializers.ancestors(key);
    let flagged = |flag: &str| init.flags.iter().chain(&node.flags).any(|f| f == flag);
    if placed_by.iter().any(|by| home_start(by)) {
        PrepareRow::HomeNeighbours
    } else if node.marauder.is_some()
        || kinds.contains(&SpecialKind::Marauder)
        || flagged("marauder_system")
        || placed_by
            .iter()
            .any(|by| marauder::role(&by.name).is_some())
    {
        PrepareRow::MarauderClans
    } else if kinds.contains(&SpecialKind::Leviathan) || flagged("guardian") {
        PrepareRow::Guardians
    } else if kinds.contains(&SpecialKind::Enclave) || flagged("enclave") {
        PrepareRow::Enclaves
    } else if primitive(gd, init) {
        PrepareRow::Primitives
    } else if home_start(init)
        || used_as(init, &[NOMAD_USAGE])
        || placed_by.iter().any(|by| used_as(by, &[NOMAD_USAGE]))
        || (placed_by.is_empty() && event_only(init))
    {
        PrepareRow::OriginAndEvent
    } else if layouts::ordinary(init) {
        PrepareRow::OrdinarySystems
    } else {
        PrepareRow::SpecialSystems
    }
}

/// An initializer an empire starts on: by its `usage`, or by the home flag a prescripted
/// empire's start carries under the ordinary usage.
fn home_start(init: &Initializer) -> bool {
    used_as(init, &HOME_START_USAGES) || init.flags.iter().any(|f| f == HOME_FLAG)
}

/// An initializer galaxy generation never draws: no `usage`, or odds written as a fixed
/// 0. Odds under conditions are generation's, however they come out here.
fn event_only(init: &Initializer) -> bool {
    init.usage.is_none() || (init.usage_weight.is_none() && init.usage_odds.unwrap_or(0.0) <= 0.0)
}

fn used_as(init: &Initializer, usages: &[&str]) -> bool {
    init.usage
        .as_deref()
        .is_some_and(|usage| usages.contains(&usage))
}

/// A layout whose odds the primitives setting scales, or one that places a pre-FTL
/// civilisation on a body.
fn primitive(gd: &GameData, init: &Initializer) -> bool {
    let scaled = gd
        .initializers
        .def(&init.name)
        .is_some_and(|def| def.scalar(PRIMITIVE_KEY) == Some("yes"));
    scaled || init.flags.iter().any(|f| f == PRIMITIVE_KEY) || init.planets.iter().any(pre_ftl)
}

fn pre_ftl(body: &InitPlanet) -> bool {
    body.pre_ftl || body.moons.iter().any(pre_ftl)
}
