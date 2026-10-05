//! The Special menu and the cards of the add-system picks: each pick's label, group and
//! summary, on a hand-written install and on the real one.

use crate::common;

use std::collections::BTreeSet;

use sgf_gamedata::generate::{GenerateError, generate};
use sgf_gamedata::layouts::{DlcNeed, special_initializers};
use sgf_gamedata::menu::special_layouts;
use sgf_gamedata::summary::{
    Feature, Presence, Span, add_system_picks, layout_summary, random_summary, star_pick_summary,
};

use common::layouts::{self, FILES};
use common::{ABUNDANCE, INSTALL};

#[test]
fn a_star_pick_card_shows_only_the_layouts_the_pick_rolls() {
    let files: Vec<(&str, &str)> = FILES
        .iter()
        .map(|&(rel, text)| match rel {
            "common/star_classes/00_stars.txt" => (
                rel,
                "sc_sun = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 30\n}\n\
                 sc_cold = {\n\tclass = cold_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 0\n}\n",
            ),
            "common/star_classes/randomizers/00_lists.txt" => {
                (rel, "rl_single = {\n\tstars = { sc_sun sc_cold }\n}\n")
            }
            _ => (rel, text),
        })
        .collect();
    let (_dir, gd) = common::hand_written(&files);
    let session = common::open_4_5();
    assert_eq!(
        generate(&gd, 1, "Fx", (0.0, 0.0), Some("sc_cold"), ABUNDANCE),
        Err(GenerateError::NoLayoutFor("sc_cold".to_owned())),
        "rl_single lists it at odds 0"
    );
    assert_eq!(
        star_pick_summary(&gd, "sc_cold", &session),
        Err(GenerateError::NoLayoutFor("sc_cold".to_owned())),
        "so its card has no layout either"
    );
}

#[test]
fn the_add_system_menu_labels_groups_counts_and_marks_each_pick() {
    let (_dir, gd) = layouts::hand_written();
    let session = common::open_4_5();
    let picks = add_system_picks(&gd, &session);
    /// Key, label, unique, capped, in the galaxy and DLC.
    type Row<'a> = (&'a str, &'a str, bool, bool, u32, Option<&'a DlcNeed>);
    let rows: Vec<Row> = picks
        .special
        .iter()
        .map(|pick| {
            let e = &pick.layout;
            (
                e.key.as_str(),
                e.label.as_str(),
                e.unique,
                e.capped,
                e.in_galaxy,
                e.dlc.as_ref(),
            )
        })
        .collect();
    let pack = DlcNeed {
        name: "Fx Pack".to_owned(),
        met: false,
    };
    assert_eq!(
        rows,
        [
            ("fx_works", "Fx Blessing", false, true, 0, None),
            ("fx_forced", "Fx Forced", false, true, 0, None),
            ("fx_haven", "Fx Haven", true, true, 0, Some(&pack)),
            ("fx_named_hole", "Fx Named Hole", false, false, 0, None),
            ("fx_offcentre", "Fx Offcentre", false, false, 0, None),
            ("fx_pole", "Husk World", false, true, 0, Some(&pack)),
        ],
        "by label: the fixed name, else the notable bodies and modifiers without the star, \
         else the key made readable, as is a name with no localisation; a DLC gate as a \
         factor or an add; unique by the unique_system flag, not the fixed name; fx_hole \
         left to the star pick that draws it"
    );
    let haven = &picks.special[2];
    assert_eq!(haven.summary.max_instances, Some(1));
    assert_eq!(haven.summary.in_galaxy, Some(0));
    assert_eq!(haven.summary.dlc, Some(pack));
    let stars: Vec<(&str, &str)> = picks
        .star_classes
        .iter()
        .map(|pick| (pick.key.as_str(), pick.name.as_str()))
        .collect();
    assert_eq!(stars, [("sc_sun", "Sun"), ("sc_hole", "Hole")]);
    assert_eq!(
        picks.star_classes[1].summary,
        star_pick_summary(&gd, "sc_hole", &session).unwrap()
    );
    assert_eq!(picks.random, random_summary(&gd));
}

#[test]
fn the_real_install_lists_its_special_stars_and_labels_its_menu() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let session = common::open_4_5();
    let entries = special_layouts(gd, &session);
    let keys: BTreeSet<&str> = entries.iter().map(|e| e.key.as_str()).collect();
    for generic in ["special_init_01", "special_init_08", "special_init_09"] {
        assert!(
            !keys.contains(generic),
            "{generic} is left to the star pick that draws it"
        );
    }
    assert_eq!(entries.len(), special_initializers(gd).len() - 3);
    let entry = |key: &str| entries.iter().find(|e| e.key == key).expect(key);
    assert_eq!(entry("trappist_initializer").label, "Trappist");
    for unique in ["unique_system_initializer_03", "oasis_system"] {
        assert!(entry(unique).unique, "{unique} is flagged unique_system");
    }
    for named in [
        "trappist_initializer",
        "wenkwort_initializer",
        "parvus_system",
    ] {
        assert!(
            !entry(named).unique,
            "{named} has a fixed name and no unique_system flag"
        );
    }
    assert_eq!(entry("trappist_initializer").in_galaxy, 0);
    assert_eq!(entry("wenkwort_initializer").in_galaxy, 1);
    let labels: BTreeSet<&str> = entries.iter().map(|e| e.label.as_str()).collect();
    assert_eq!(labels.len(), entries.len(), "no two alike: {labels:?}");
    assert!(
        labels
            .iter()
            .all(|label| !label.contains('_') && !label.starts_with("Class ")),
        "{labels:?}"
    );
    assert_eq!(
        entry("star_lifting_system").label,
        "Star Lifting System",
        "a pulsar with nothing notable"
    );
    assert_eq!(entry("big_rip_system").label, "Big Rip System");
    assert_eq!(entry("ice_system").label, "Icy Asteroid Belt");
    assert!(!entry("ice_system").unique);
    assert_eq!(
        entry("wooden_planet_system_initializer").label,
        "Arboreal World"
    );
    assert_eq!(entry("oasis_system").label, "Kira");
    assert_eq!(
        entry("oasis_system").dlc,
        Some(DlcNeed {
            name: "Infernals Species Pack".to_owned(),
            met: true
        }),
        "odds added with the DLC"
    );
    assert_eq!(
        entry("metal_planet_system_initializer").dlc,
        Some(DlcNeed {
            name: "Cosmic Storms".to_owned(),
            met: true
        })
    );
}

fn keys(features: &[Feature]) -> Vec<(&str, bool)> {
    features.iter().map(|f| (f.key.as_str(), f.every)).collect()
}

/// A layout with no `usage` from the install and one from a mod, the mod's with odds and a
/// star only special layouts make.
fn with_unplaced_layouts() -> (tempfile::TempDir, sgf_gamedata::GameData) {
    let dir = tempfile::tempdir().expect("temp dir");
    let install = dir.path().join("install");
    let user_dir = dir.path().join("user");
    let mut files: Vec<(&str, &str)> = FILES.to_vec();
    files.push(("localisation/english/fx_l_english.yml", "l_english:\n"));
    files.push((
        "common/solar_system_initializers/zz_events.txt",
        "fx_story = {\n\tclass = sc_sun\n\tplanet = { class = star orbit_distance = 0 }\n\
         \tplanet = { class = pc_husk orbit_distance = 40 }\n}\n",
    ));
    for (rel, text) in files {
        let file = install.join(rel);
        std::fs::create_dir_all(file.parent().expect("a directory")).expect("the install tree");
        std::fs::write(file, text).expect("an install file");
    }
    common::add_mod(
        &user_dir,
        "fx_mod",
        &[(
            "common/solar_system_initializers/fx_mod.txt",
            "fx_mod_hole = {\n\tclass = sc_hole\n\tusage_odds = 100\n\
             \tplanet = { class = star orbit_distance = 0 }\n\
             \tplanet = { class = pc_rock orbit_distance = 50 }\n}\n",
        )],
    );
    common::enable(&user_dir, &["fx_mod"]);
    let gd = common::load_tree(&install, Some(&user_dir), true);
    (dir, gd)
}

#[test]
fn a_mods_layouts_with_no_usage_are_listed_by_the_mod_and_never_drawn() {
    let (_dir, gd) = with_unplaced_layouts();
    let session = common::open_4_5();
    let entries = special_layouts(&gd, &session);
    let groups: Vec<(&str, Option<&str>)> = entries
        .iter()
        .filter(|e| ["fx_story", "fx_mod_hole", "fx_haven"].contains(&e.key.as_str()))
        .map(|e| (e.key.as_str(), e.group.as_deref()))
        .collect();
    assert_eq!(
        groups,
        [("fx_haven", None), ("fx_mod_hole", Some("fx_mod"))],
        "the game's own fx_story is left out"
    );
    for seed in 0..40 {
        for star in [None, Some("sc_hole")] {
            let spec = generate(&gd, seed, "Fx", (0.0, 0.0), star, ABUNDANCE).expect("a system");
            assert!(
                !["fx_story", "fx_mod_hole"].contains(&spec.initializer.as_str()),
                "seed {seed}, {star:?} drew {}",
                spec.initializer
            );
        }
    }
}

#[test]
fn a_hand_written_install_summarises_each_pick_from_its_layouts() {
    let (_dir, gd) = layouts::hand_written();
    let session = common::open_4_5();
    let haven = layout_summary(&gd, "fx_haven", &session).expect("a special layout");
    assert_eq!(haven.star_classes[0].name, "Sun");
    assert_eq!(
        haven.planets,
        Span { min: 5, max: 5 },
        "the black hole body counts"
    );
    assert_eq!((haven.max_moons, haven.moons), (1, Presence::Every));
    assert_eq!(haven.belts, Span { min: 1, max: 1 });
    assert_eq!(keys(&haven.belt_kinds), [("rocky_asteroid_belt", true)]);
    assert_eq!(haven.belt_kinds[0].name, "Rocky Asteroid Belt");
    assert_eq!(haven.asteroids, Span { min: 0, max: 0 });
    assert_eq!(
        keys(&haven.named_bodies),
        [("NAME_Husk", true), ("NAME_Husk_Moon", true)]
    );
    assert_eq!(
        keys(&haven.notable_classes),
        [("pc_husk", true), ("pc_hole", true)]
    );
    assert_eq!(haven.modifiers[0].name, "Fx Blessing");
    assert_eq!(haven.rings, Presence::Every, "has_ring = yes");
    assert_eq!(
        haven.dlc,
        Some(DlcNeed {
            name: "Fx Pack".to_owned(),
            met: false
        })
    );
    assert_eq!((haven.max_instances, haven.in_galaxy), (Some(1), Some(0)));

    let hole = star_pick_summary(&gd, "sc_hole", &session).expect("a star pick");
    assert_eq!(hole.star_classes[0].name, "Hole");
    assert_eq!(hole.planets, Span { min: 1, max: 1 });
    assert_eq!(hole.rings, Presence::Never, "a husk has no chance of one");
    assert_eq!((hole.dlc.clone(), hole.max_instances), (None, None));
    assert!(
        star_pick_summary(&gd, "sc_pole", &session).is_err(),
        "no generic layout"
    );

    let random = random_summary(&gd);
    assert_eq!(random.planets, Span { min: 2, max: 2 });
    assert_eq!(random.moons, Presence::Never);
    assert_eq!(random.rings, Presence::Every, "a meadow can have one");
    assert_eq!(random.star_description, None);
}

#[test]
fn the_real_install_summarises_pulsar_black_hole_trappist_and_random() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let session = common::open_4_5();
    let pulsar = star_pick_summary(gd, "sc_pulsar", &session).unwrap();
    let hole = star_pick_summary(gd, "sc_black_hole", &session).unwrap();
    let trappist = layout_summary(gd, "trappist_initializer", &session).unwrap();
    let random = random_summary(gd);
    for (pick, summary) in [
        ("pulsar", &pulsar),
        ("black hole", &hole),
        ("Trappist", &trappist),
        ("Random", &random),
    ] {
        println!("{pick}: {}", serde_json::to_string(summary).unwrap());
    }
    assert!(pulsar.star_description.is_some());
    assert_eq!(pulsar.in_galaxy, Some(12), "the sample's pulsars");
    assert_eq!(keys(&hole.notable_classes), [("pc_broken", true)]);
    assert_eq!(trappist.planets, Span { min: 7, max: 7 });
    assert_eq!(
        trappist.rings,
        Presence::Never,
        "has_ring = no on every planet"
    );
    assert_eq!(
        keys(&trappist.modifiers),
        [("terraforming_candidate", true)]
    );
    assert_eq!(trappist.max_instances, Some(1));
    assert_eq!(random.star_classes.len(), 7);
    assert_eq!(random.star_description, None);
    assert_eq!(random.rings, Presence::SomeLayouts);
    assert!(random.belt_kinds.iter().all(|kind| !kind.every));
}
