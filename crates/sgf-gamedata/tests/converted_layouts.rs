//! The layouts the generator builds by converting them, such as Sol and Barnard's Star: which
//! the real install offers, their labels in the Special menu, and each added to the 4.5
//! sample save without its empires, civilisations and story flags.

use crate::common;

use std::collections::BTreeSet;

use sgf_core::ops::Op;
use sgf_core::session::Session;
use sgf_gamedata::layouts::{CONVERTED_LAYOUTS, Eligibility};
use sgf_gamedata::menu::special_layouts;

use common::layouts::{by_name, of};
use common::{INSTALL, SPOT};

/// The point nearest [`SPOT`], on a grid, that stands 10 from every system of `session`.
fn free_ground(session: &Session) -> (f64, f64) {
    let clear = |(x, y): (f64, f64)| {
        session
            .graph()
            .systems
            .values()
            .all(|s| (s.x - x).hypot(s.y - y) >= 10.0)
    };
    let mut grid: Vec<(f64, f64)> = (-8..=8)
        .flat_map(|i| (-8..=8).map(move |j| (f64::from(i) * 11.0, f64::from(j) * 11.0)))
        .collect();
    grid.sort_by(|a, b| a.0.hypot(a.1).total_cmp(&b.0.hypot(b.1)));
    grid.into_iter()
        .map(|(dx, dy)| (SPOT.0 + dx, SPOT.1 + dy))
        .find(|&at| clear(at))
        .expect("free ground near the spot")
}

/// The label the install's own localisation gives each of [`CONVERTED_LAYOUTS`], which only
/// the real install can settle.
const LABELS: [(&str, &str); 14] = [
    ("sol_system_initializer", "Sol"),
    ("new_bratulla_initializer", "New Bratulla"),
    ("special_init_06", "Zanaam"),
    ("great_wound_system", "Great Wound"),
    ("breachsealer_system", "Seddom"),
    ("vultaumar_system", "Vultaumar"),
    ("fen_habbanis_system", "Fen Habbanis"),
    ("irass_system", "Irass"),
    ("last_baol_system", "Grunur"),
    ("sol_neighbor_t1", "Barnard's Star"),
    ("hostile_init_16", "Tiyana Vek"),
    ("hostile_init_21", "Tiyun Ort"),
    ("holibrae_initializer", "Holibrae"),
    ("the_chosen_escapee_initializer", "Ophala"),
];

fn label_of(key: &str) -> &'static str {
    LABELS
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, label)| *label)
        .unwrap_or_else(|| panic!("no label recorded for {key}"))
}

#[test]
fn converted_layouts_come_without_their_empires_civilisations_and_story_flags() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let keys: BTreeSet<&str> = CONVERTED_LAYOUTS.iter().map(|layout| layout.key).collect();
    for key in &keys {
        assert_eq!(of(gd, key), Eligibility::Special, "{key}");
    }
    for other in [
        "sanctuary_system",
        "cybrex_beta",
        "unique_system_initializer_01",
        "pre_ftl_init_sol",
        "com_sol_system",
        "special_init_04",
        "neighbor_t2",
        "ai_system_01",
        "the_chosen_home_initializer",
        "Zrocursor_system",
        "legendary_leader_last_site",
        "chrysanthemum_tomb_system",
    ] {
        assert!(
            matches!(of(gd, other), Eligibility::Unsupported(_)),
            "{other} is {:?}",
            of(gd, other)
        );
    }

    let mut session = common::open_4_5();
    let entries = special_layouts(gd, &session);
    let menu: Vec<(&str, &str, bool)> = entries
        .iter()
        .filter(|e| keys.contains(e.key.as_str()))
        .map(|e| (e.key.as_str(), e.label.as_str(), e.unique))
        .collect();
    let mut expected: Vec<(&str, &str, bool)> = CONVERTED_LAYOUTS
        .iter()
        .map(|layout| (layout.key, label_of(layout.key), layout.unique))
        .collect();
    expected.sort_by_key(|&(key, label, _)| (label, key));
    assert_eq!(
        menu, expected,
        "by label, Sol alone with the unique systems"
    );

    let findings = |session: &Session| -> BTreeSet<(String, Vec<u32>, String)> {
        session
            .validate()
            .into_iter()
            .map(|issue| (issue.code.to_string(), issue.systems, issue.message))
            .collect()
    };
    let before = findings(&session);
    let known: BTreeSet<u32> = session.graph().systems.keys().copied().collect();
    for layout in &CONVERTED_LAYOUTS {
        let key = layout.key;
        let mut spec = by_name(gd, 1, "Gen", free_ground(&session), key).unwrap();
        let unique = gd
            .initializers
            .get(key)
            .unwrap()
            .flags
            .iter()
            .any(|f| f == "unique_system");
        let kept: Vec<&str> = layout
            .flags
            .iter()
            .copied()
            .chain(unique.then_some("unique_system"))
            .collect();
        assert_eq!(spec.flags, kept, "{key}: no story flags");
        spec.lanes = vec![169];
        session
            .apply(Op::AddSystemFromSpec { spec })
            .unwrap_or_else(|e| panic!("{key}: {e}"));
    }

    let spec = by_name(gd, 1, "Gen", SPOT, "sol_system_initializer").unwrap();
    assert_eq!(spec.name, "NAME_Sol");
    let earth = spec
        .planets
        .iter()
        .find(|p| p.name.as_deref() == Some("NAME_Earth"))
        .expect("Earth");
    assert_eq!(earth.class, "pc_continental");
    assert_eq!(
        earth.entity_name.as_deref(),
        Some("continental_planet_earth_entity")
    );
    let moons: Vec<Option<&str>> = earth.moons.iter().map(|m| m.name.as_deref()).collect();
    assert_eq!(moons, [Some("NAME_Luna")]);
    for seed in 0..20 {
        let spec = by_name(gd, seed, "Gen", SPOT, "sol_system_initializer").unwrap();
        let earth = spec
            .planets
            .iter()
            .find(|p| p.name.as_deref() == Some("NAME_Earth"))
            .expect("Earth");
        assert!(
            !earth.deposits.is_empty(),
            "seed {seed}: Earth rolls deposits"
        );
        assert!(
            earth.deposits.iter().all(|d| !gd.is_blocker(d)),
            "seed {seed}: deposit_blockers = none: {:?}",
            earth.deposits
        );
    }

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("converted.sav");
    session.save_as(&path).expect("save");
    let reopened = Session::open(&path).expect("reopen");
    assert_eq!(findings(&reopened), before);
    let details = reopened.details().expect("details");
    let added: Vec<u32> = reopened
        .graph()
        .systems
        .keys()
        .copied()
        .filter(|id| !known.contains(id))
        .collect();
    let layouts: BTreeSet<&str> = added
        .iter()
        .map(|&id| reopened.system(id).unwrap().initializer.as_str())
        .collect();
    assert_eq!(layouts, keys);
    for id in added {
        let initializer = &reopened.system(id).unwrap().initializer;
        let system = details.raw(id).expect("details");
        assert!(system.starbases.is_empty(), "{initializer}: a starbase");
        assert!(system.fleets.is_empty(), "{initializer}: a fleet");
        for planet in &system.planets {
            assert!(
                !planet.colonised && !planet.pre_ftl && planet.owner.is_none() && planet.pops == 0,
                "{initializer}: {} is owned or lived on",
                planet.name_key
            );
        }
    }
}
