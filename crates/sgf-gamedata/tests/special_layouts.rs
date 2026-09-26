//! The special layouts the generator builds by name: which of an install's layouts count,
//! what a hand-written layout with every feature gives, the Special menu's entries, and the
//! real install's layouts added to the 4.5 sample save.

use crate::common;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use sgf_core::ops::{BeltSpec, BodySpec, Op, SystemSpec};
use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::generate::{
    GenerateError, generate, generate_layout_for, settle_name, star_classes,
};
use sgf_gamedata::layouts::{
    CONVERTED_LAYOUTS, DlcNeed, Eligibility, SaveFacts, Unsupported, eligibility, odds,
    special_initializers,
};
use sgf_gamedata::menu::special_layouts;
use sgf_gamedata::special::classify_session;
use sgf_gamedata::summary::{
    Feature, Presence, Span, add_system_picks, layout_summary, random_summary, star_pick_summary,
};

/// Free ground beside the player's home system 169.
const SPOT: (f64, f64) = (-292.23404, -137.62265);
const ABUNDANCE: f64 = 2.0;

use common::INSTALL;

/// The 4.5 sample's DLC, which the `if`s of a layout's bodies read.
static SAMPLE: LazyLock<SaveFacts> = LazyLock::new(|| SaveFacts::read(&common::open_4_5()));

/// A system of the layout `key`, added to the 4.5 sample.
fn by_name(
    gd: &GameData,
    seed: u64,
    name: &str,
    at: (f64, f64),
    key: &str,
) -> Result<SystemSpec, GenerateError> {
    generate_layout_for(gd, &SAMPLE, seed, name, at, key, ABUNDANCE)
}

const FILES: [(&str, &str); 9] = [
    (
        "common/deposit_categories/00_fx.txt",
        "fx_blockers = {\n\tblocker = yes\n}\nfx_features = {\n}\n",
    ),
    (
        "common/deposits/00_fx.txt",
        "d_fx_block = {\n\tcategory = fx_blockers\n\tpotential = { always = no }\n}\n\
         d_fx_gem = {\n\tcategory = fx_features\n\tpotential = { always = no }\n}\n",
    ),
    (
        "common/star_classes/00_stars.txt",
        "sc_sun = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 30\n}\n\
         sc_hole = {\n\tclass = hole_star\n\tplanet = { key = pc_hole }\n\tspawn_odds = 5\n}\n\
         sc_pole = {\n\tclass = pole_star\n\tplanet = { key = pc_pole }\n\tspawn_odds = 1\n}\n",
    ),
    (
        "common/star_classes/randomizers/00_lists.txt",
        "rl_single = {\n\tstars = { sc_sun }\n}\nrl_both = {\n\tstars = { sc_sun sc_hole }\n}\n",
    ),
    (
        "common/planet_classes/00_planets.txt",
        "pc_sun_star = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 30 }\n}\n\
         pc_hole = {\n\tstar = yes\n\tplanet_size = { min = 30 max = 40 }\n}\n\
         pc_pole = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 20 }\n}\n\
         pc_lone = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 20 }\n}\n\
         pc_rock = {\n\tmin_distance_from_sun = 0\n\tmax_distance_from_sun = 1000\n\tspawn_odds = 10\n\tplanet_size = { min = 10 max = 20 }\n\tmoon_size = { min = 5 max = 8 }\n}\n\
         pc_meadow = {\n\tmin_distance_from_sun = 60\n\tmax_distance_from_sun = 100\n\tspawn_odds = 1\n\tchance_of_ring = 0.5\n\tcolonizable = yes\n\tplanet_size = { min = 12 max = 20 }\n\tmoon_size = { min = 8 max = 10 }\n}\n\
         pc_husk = {\n\tplanet_size = { min = 10 max = 12 }\n\tmoon_size = { min = 4 max = 6 }\n}\n\
         random_list = {\n\tname = \"rl_rocky\"\n\tplanets = {\n\t\t\"pc_rock\"\n\t\t\"pc_meadow\"\n\t}\n}\n\
         random_list = {\n\tname = \"rl_husks\"\n\tplanets = { pc_husk }\n}\n",
    ),
    (
        "common/scripted_triggers/00_fx.txt",
        "has_fx_pack = {\n\toptimize_memory\n\thost_has_dlc = \"Fx Pack\"\n}\n",
    ),
    (
        "common/solar_system_initializers/00_fx.txt",
        "fx_plain = {\n\tclass = rl_single\n\tusage = misc_system_init\n\tusage_odds = 5\n\
         \tplanet = { class = star orbit_distance = 0 }\n\tchange_orbit = 60\n\
         \tplanet = { count = 2 orbit_distance = 20 }\n}\n\
         fx_haven = {\n\tname = \"NAME_Fx_Haven\"\n\tclass = sc_sun\n\tusage = misc_system_init\n\
         \tusage_odds = {\n\t\tbase = 3\n\t\tmodifier = { factor = 0 has_fx_pack = no }\n\t}\n\
         \tmax_instances = 1\n\tflags = { fx_haven unique_system }\n\
         \tasteroid_belt = { type = rocky_asteroid_belt radius = 50 }\n\
         \tplanet = { class = pc_sun_star orbit_distance = 0 size = 25 }\n\
         \tplanet = {\n\t\tname = \"NAME_Husk\"\n\t\tclass = pc_husk\n\t\torbit_distance = 70\n\t\thas_ring = yes\n\t\thome_planet = yes\n\t\tentity = \"husk_entity\"\n\
         \t\tinit_effect = {\n\t\t\tadd_modifier = { modifier = fx_mod days = -1 }\n\t\t\tset_deposit = d_fx_gem\n\t\t\tprevent_anomaly = yes\n\t\t}\n\
         \t\tmoon = { name = \"NAME_Husk_Moon\" class = rl_husks orbit_distance = 5 }\n\t}\n\
         \tplanet = { class = rl_rocky orbit_distance = 10 has_ring = no }\n\
         \tplanet = { class = random_colonizable orbit_distance = 10 }\n\
         \tplanet = {\n\t\tclass = random_non_colonizable orbit_distance = 100\n\t\tmoon = { class = random_non_colonizable orbit_distance = 5 }\n\t}\n\
         \tplanet = { class = pc_hole orbit_distance = 20 }\n\
         \tinit_effect = {\n\t\tset_star_flag = fx\n\t\tsave_global_event_target_as = fx_haven\n\t\tevery_system_planet = { limit = { is_star = no } set_planet_flag = fx }\n\t}\n}\n\
         fx_offcentre = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 2\n\
         \tplanet = { class = star count = { min = 1 max = 2 } orbit_distance = 40 }\n\
         \tchange_orbit = 60\n\tplanet = { class = pc_rock orbit_distance = 60 }\n}\n\
         fx_hole = {\n\tclass = sc_hole\n\tusage = misc_system_init\n\tusage_odds = 2\n\
         \tplanet = { class = star orbit_distance = 0 }\n\tplanet = { class = pc_husk orbit_distance = 60 }\n}\n\
         fx_fleet = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 4\n\
         \tplanet = { class = star orbit_distance = 0 }\n\tinit_effect = { create_fleet = { name = fx } }\n}\n\
         fx_event = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 0\n\
         \tplanet = { class = star orbit_distance = 0 }\n}\n\
         fx_guardian = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 4\n\tflags = { guardian }\n\
         \tplanet = { class = star orbit_distance = 0 }\n}\n\
         fx_inherit = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 4\n\
         \tplanet = { class = star orbit_distance = 0 }\n\
         \tplanet = { class = pc_rock orbit_distance = 60 init_effect = { change_pc = { class = pc_meadow inherit_entity = yes } } }\n}\n\
         fx_works = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 4\n\tmax_instances = 1\n\
         \tplanet = { class = star orbit_distance = 0 }\n\
         \tplanet = {\n\t\tclass = pc_rock orbit_distance = 60\n\t\tinit_effect = {\n\
         \t\t\tadd_deposit = d_fx_block\n\t\t\tadd_deposit = d_fx_gem\n\t\t\tclear_blockers = yes\n\
         \t\t\tadd_blocker = { type = d_fx_block }\n\t\t\twhile = { count = 3 add_deposit = d_fx_gem }\n\
         \t\t\tif = { limit = { has_fx_pack = yes } change_pc = pc_meadow set_planet_entity = { entity = fx_meadow_entity } }\n\
         \t\t\telse = { add_modifier = { modifier = fx_mod days = -1 } }\n\
         \t\t\tif = { limit = { always = yes } set_planet_flag = fx }\n\t\t}\n\
         \t\tplanet = { class = pc_rock orbit_distance = 10 }\n\t}\n}\n\
         fx_empire = {\n\tclass = sc_sun\n\tusage = empire_init\n\tusage_odds = 4\n\
         \tplanet = { class = star orbit_distance = 0 }\n}\n\
         fx_named_hole = {\n\tname = \"NAME_Fx_Named_Hole\"\n\tclass = sc_hole\n\tusage = misc_system_init\n\tusage_odds = 50\n\
         \tplanet = { class = star orbit_distance = 0 }\n}\n\
         fx_pole = {\n\tclass = sc_pole\n\tusage = misc_system_init\n\
         \tusage_odds = {\n\t\tbase = 0\n\t\tmodifier = { add = 3 has_fx_pack = yes }\n\t\tmodifier = { factor = 0 is_in_cluster = fx_cluster }\n\t}\n\
         \tmax_instances = 1\n\tplanet = { class = star orbit_distance = 0 }\n\tplanet = { class = pc_husk orbit_distance = 60 }\n}\n\
         fx_cluster = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\
         \tusage_odds = {\n\t\tbase = 0\n\t\tmodifier = { add = 2000000 is_in_cluster = fx_cluster }\n\t}\n\
         \tplanet = { class = star orbit_distance = 0 }\n}\n\
         fx_nested = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 4\n\
         \tplanet = { class = star orbit_distance = 0 }\n\
         \tplanet = { class = pc_rock orbit_distance = 60 init_effect = { if = { limit = { has_global_flag = fx_flag } add_deposit = d_fx_gem } } }\n}\n\
         fx_system_modifier = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 4\n\
         \tplanet = { class = star orbit_distance = 0 }\n\tinit_effect = { add_modifier = { modifier = fx_mod days = -1 } }\n}\n\
         fx_forced = {\n\tclass = rl_both\n\tusage = misc_system_init\n\tusage_odds = 4\n\tmax_instances = 1\n\
         \tplanet = { class = pc_hole orbit_distance = 0 }\n\tplanet = { class = pc_rock orbit_distance = 60 }\n}\n\
         fx_mismatch = {\n\tclass = sc_sun\n\tusage = misc_system_init\n\tusage_odds = 4\n\
         \tplanet = { class = pc_lone orbit_distance = 0 }\n}\n",
    ),
    (
        "localisation/english/fx_l_english.yml",
        "l_english:\n NAME_Fx_Haven:0 \"Fx Haven\"\n sc_sun:0 \"Sun\"\n sc_pole:0 \"Pole\"\n sc_hole:0 \"Hole\"\n pc_hole:0 \"Hole\"\n pc_husk:0 \"Husk World\"\n fx_mod:0 \"Fx Blessing\"\n",
    ),
    (
        "common/random_names/base/00_names.txt",
        "star_names = {\n\tFx_Alpha\n\tFx_Beta\n}\n",
    ),
];

fn hand_written() -> (tempfile::TempDir, GameData) {
    common::hand_written(&FILES)
}

fn of(gd: &GameData, layout: &str) -> Eligibility {
    eligibility(gd, gd.initializers.get(layout).expect(layout))
}

#[test]
fn a_hand_written_install_sorts_its_layouts_by_what_they_are_made_of() {
    let (_dir, gd) = hand_written();
    assert_eq!(of(&gd, "fx_plain"), Eligibility::Plain);
    assert_eq!(
        of(&gd, "fx_haven"),
        Eligibility::Special,
        "dropped flags, event targets and anomalies, and a home planet no one owns"
    );
    assert_eq!(of(&gd, "fx_offcentre"), Eligibility::Special);
    assert_eq!(of(&gd, "fx_hole"), Eligibility::Special);
    let unsupported = |why| Eligibility::Unsupported(why);
    assert_eq!(
        of(&gd, "fx_fleet"),
        unsupported(Unsupported::Effect("create_fleet".to_owned()))
    );
    assert_eq!(of(&gd, "fx_event"), unsupported(Unsupported::EventOnly));
    assert_eq!(of(&gd, "fx_guardian"), unsupported(Unsupported::Guardian));
    assert_eq!(
        of(&gd, "fx_inherit"),
        unsupported(Unsupported::Effect("change_pc".to_owned())),
        "keeping the old model needs entity_planet_class, which the spec lacks"
    );
    assert_eq!(
        of(&gd, "fx_works"),
        Eligibility::Special,
        "blockers, a class change, a model, a loop and a DLC if, and an if that sets a flag"
    );
    assert_eq!(of(&gd, "fx_empire"), unsupported(Unsupported::Usage));
    assert_eq!(
        of(&gd, "fx_cluster"),
        unsupported(Unsupported::EventOnly),
        "odds added only in a cluster, which a new system is not taken to be in"
    );
    assert_eq!(
        of(&gd, "fx_nested"),
        unsupported(Unsupported::Effect("if".to_owned())),
        "a deposit effect under a condition other than a DLC"
    );
    assert_eq!(
        of(&gd, "fx_system_modifier"),
        unsupported(Unsupported::Effect("add_modifier".to_owned())),
        "a modifier on the system, not a body"
    );
    assert_eq!(
        of(&gd, "fx_mismatch"),
        unsupported(Unsupported::StarMismatch("pc_lone".to_owned())),
        "no star class has that star"
    );
    let special: Vec<&str> = special_initializers(&gd)
        .iter()
        .map(|i| i.name.as_str())
        .collect();
    assert_eq!(
        special,
        [
            "fx_forced",
            "fx_haven",
            "fx_hole",
            "fx_named_hole",
            "fx_offcentre",
            "fx_pole",
            "fx_works"
        ]
    );
    assert_eq!(
        by_name(&gd, 1, "Fx", (0.0, 0.0), "fx_fleet"),
        Err(GenerateError::Unsupported(
            "fx_fleet".to_owned(),
            Unsupported::Effect("create_fleet".to_owned())
        ))
    );
    assert_eq!(
        by_name(&gd, 1, "Fx", (0.0, 0.0), "fx_nowhere"),
        Err(GenerateError::UnknownLayout("fx_nowhere".to_owned()))
    );
}

#[test]
fn a_special_layout_gives_its_bodies_names_models_modifiers_rings_and_deposits() {
    let (_dir, gd) = hand_written();
    let mut listed = BTreeSet::new();
    for seed in 0..60 {
        let spec = by_name(&gd, seed, "Fx", (1.0, 2.0), "fx_haven").expect("a system");
        assert_eq!(
            by_name(&gd, seed, "Fx", (1.0, 2.0), "fx_haven"),
            Ok(spec.clone()),
            "seed {seed}: the same seed gives the same system"
        );
        assert_eq!(spec.name, "NAME_Fx_Haven", "the layout's fixed name");
        assert_eq!(spec.initializer, "fx_haven");
        assert!(spec.capped, "max_instances");
        assert_eq!(
            spec.flags,
            ["fx_haven", "unique_system"],
            "the layout's star flags"
        );
        assert!(spec.star_named_by_class, "a star written as a class");
        assert_eq!(spec.star_class, "sc_sun");
        assert_eq!(
            (spec.star.class.as_str(), spec.star.size),
            ("pc_sun_star", 25)
        );
        assert_eq!(spec.star.name, None);
        assert_eq!(spec.belts.len(), 1);

        let [husk, rocky, colonizable, barren, hole] = &spec.planets[..] else {
            panic!("seed {seed}: five planets, {:?}", spec.planets);
        };
        assert_eq!(husk.class, "pc_husk");
        assert_eq!(husk.name.as_deref(), Some("NAME_Husk"));
        assert_eq!(husk.entity_name.as_deref(), Some("husk_entity"));
        assert_eq!(husk.modifiers, ["fx_mod"]);
        assert_eq!(husk.deposits, ["d_fx_gem"], "set_deposit after the roll");
        assert!(husk.ring, "has_ring = yes");
        assert!(!husk.asteroid);
        assert_eq!(husk.moons.len(), 1);
        let moon = &husk.moons[0];
        assert_eq!(
            (moon.class.as_str(), moon.name.as_deref(), moon.ring),
            ("pc_husk", Some("NAME_Husk_Moon"), false),
            "a list of one"
        );

        assert!(["pc_rock", "pc_meadow"].contains(&rocky.class.as_str()));
        listed.insert(rocky.class.clone());
        assert!(!rocky.ring, "has_ring = no");
        assert_eq!(rocky.name, None);
        assert_eq!(colonizable.class, "pc_meadow", "the one colonizable class");
        assert_eq!(barren.class, "pc_rock", "the one class that is not");
        assert!(barren.moons.iter().all(|m| m.class == "pc_rock" && !m.ring));
        assert_eq!(hole.class, "pc_hole", "a star class as a body");
        assert!((30..=40).contains(&hole.size));
        assert_eq!(
            spec.planets.iter().map(|p| p.orbit).collect::<Vec<_>>(),
            [70.0, 80.0, 90.0, 190.0, 210.0]
        );
    }
    assert_eq!(listed.len(), 2, "both classes of the list come up");
}

#[test]
fn an_off_centre_star_stands_at_its_orbit_once_and_the_planets_count_from_the_centre() {
    let (_dir, gd) = hand_written();
    for seed in 0..30 {
        let spec = by_name(&gd, seed, "Fx", (0.0, 0.0), "fx_offcentre").expect("a system");
        assert_eq!(spec.name, "Fx", "no fixed name");
        assert!(!spec.capped, "no max_instances");
        assert!(!spec.star_named_by_class);
        assert_eq!(spec.star.orbit, 40.0);
        assert_eq!(
            spec.planets.len(),
            1,
            "seed {seed}: one star however many it counts"
        );
        assert_eq!(spec.planets[0].orbit, 160.0);
    }
}

#[test]
fn a_star_only_generic_special_layouts_make_is_listed_and_drawn_from_them() {
    let (_dir, gd) = hand_written();
    assert_eq!(
        star_classes(&gd),
        ["sc_sun", "sc_hole"],
        "sc_pole comes only from a capped layout"
    );
    for seed in 0..40 {
        let hole = generate(&gd, seed, "Fx", (0.0, 0.0), Some("sc_hole"), ABUNDANCE).unwrap();
        assert_eq!(
            (hole.initializer.as_str(), hole.star.class.as_str()),
            ("fx_hole", "pc_hole"),
            "seed {seed}: never the named fx_named_hole, whatever its odds"
        );
        let sun = generate(&gd, seed, "Fx", (0.0, 0.0), Some("sc_sun"), ABUNDANCE).unwrap();
        assert_eq!(sun.initializer, "fx_plain", "a plain layout makes it");
        let random = generate(&gd, seed, "Fx", (0.0, 0.0), None, ABUNDANCE).unwrap();
        assert_eq!(
            random.initializer, "fx_plain",
            "Random draws only plain layouts"
        );
    }
    assert_eq!(
        generate(&gd, 1, "Fx", (0.0, 0.0), Some("sc_pole"), ABUNDANCE),
        Err(GenerateError::NoLayoutFor("sc_pole".to_owned()))
    );
    let pole = by_name(&gd, 1, "Fx", (0.0, 0.0), "fx_pole").unwrap();
    assert_eq!(pole.star_class, "sc_pole", "by name it is placed");
}

#[test]
fn a_system_of_a_layout_the_generator_draws_is_no_unique_system() {
    let (_dir, gd) = hand_written();
    let mut session = common::open_4_5();
    let mut spec = generate(&gd, 1, "Fx", SPOT, Some("sc_hole"), ABUNDANCE).unwrap();
    assert_eq!(spec.initializer, "fx_hole");
    spec.lanes = vec![169];
    session
        .apply(Op::AddSaveSystem { spec })
        .expect("add the system");
    let special = |gd: Option<&GameData>| {
        classify_session(&session, gd)
            .systems
            .iter()
            .any(|s| s.id == 601)
    };
    assert!(
        special(None),
        "without game data only the game's own layouts are known"
    );
    assert!(!special(Some(&gd)), "a star pick draws it");
}

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
fn a_star_written_as_a_class_takes_the_class_of_the_list_that_has_it() {
    let (_dir, gd) = hand_written();
    for seed in 0..30 {
        let spec = by_name(&gd, seed, "Fx", (0.0, 0.0), "fx_forced").unwrap();
        assert_eq!(
            (spec.star_class.as_str(), spec.star.class.as_str()),
            ("sc_hole", "pc_hole"),
            "seed {seed}: rl_both's other class has another star"
        );
        assert!(spec.star_named_by_class);
    }
}

#[test]
fn a_layouts_odds_add_and_multiply_what_the_save_decides_and_nothing_else() {
    let (_dir, gd) = hand_written();
    let layout = |key: &str| gd.initializers.get(key).unwrap();
    let with = |dlcs: &[&str]| SaveFacts {
        dlcs: dlcs.iter().map(|&d| d.to_owned()).collect(),
        ..SaveFacts::default()
    };
    assert_eq!(
        odds(&gd, layout("fx_pole"), None),
        3.0,
        "the DLC taken as there"
    );
    assert_eq!(odds(&gd, layout("fx_pole"), Some(&with(&["Fx Pack"]))), 3.0);
    assert_eq!(odds(&gd, layout("fx_pole"), Some(&with(&[]))), 0.0);
    assert_eq!(odds(&gd, layout("fx_haven"), Some(&with(&[]))), 0.0);
    assert_eq!(
        odds(&gd, layout("fx_haven"), Some(&with(&["Fx Pack"]))),
        3.0
    );
    assert_eq!(
        odds(&gd, layout("fx_cluster"), None),
        0.0,
        "a cluster condition is unmet"
    );
    assert_eq!(odds(&gd, layout("fx_plain"), None), 5.0);
}

#[test]
fn the_add_system_menu_labels_groups_counts_and_marks_each_pick() {
    let (_dir, gd) = hand_written();
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

/// `None`, and the test returns, when this machine has no Stellaris install.
fn install() -> Option<&'static GameData> {
    INSTALL.as_ref()
}

#[test]
fn the_real_install_has_the_special_layouts_the_research_found() {
    let Some(gd) = install() else {
        return;
    };
    let special: BTreeSet<&str> = special_initializers(gd)
        .iter()
        .map(|i| i.name.as_str())
        .collect();
    let group_a = [
        "crystal_manufactory_system",
        "ice_system",
        "oasis_system",
        "old_foes_system",
        "parvus_system",
        "special_init_01",
        "special_init_08",
        "special_init_09",
    ];
    let group_b = [
        "asteroid_system",
        "big_rip_system",
        "collided_planet_system_initializer",
        "debris_belt_initializer",
        "distar_crystal_system",
        "high_energy_system",
        "metal_planet_system_initializer",
        "previously_terraformed_planet_system_initializer",
        "primitive_robot_system",
        "shattered_world_system",
        "star_lifting_system",
        "the_star_mall_initializer",
        "toxic_planet_toxic_moon",
        "superflare_system",
        "trappist_initializer",
        "unique_system_initializer_02",
        "unique_system_initializer_03",
        "unique_system_initializer_04",
        "unique_system_initializer_05",
        "unique_system_initializer_06",
        "unique_system_initializer_07",
        "unique_system_initializer_08",
        "unique_system_initializer_09",
        "wenkwort_initializer",
        "wooden_planet_system_initializer",
    ];
    let converted: Vec<&str> = CONVERTED.iter().map(|(key, ..)| *key).collect();
    assert_eq!(
        special,
        group_a
            .iter()
            .chain(&group_b)
            .chain(&converted)
            .copied()
            .collect(),
        "A and B with odds, less the layouts whose point is their spawn, time loop's shield \
         and relic_system_4's scripted deposits, and the converted layouts"
    );
    let why = |layout: &str| match of(gd, layout) {
        Eligibility::Unsupported(why) => why,
        other => panic!("{layout} is {other:?}"),
    };
    assert_eq!(
        why("fumongus_init_01"),
        Unsupported::Effect("create_tiyanki_country".to_owned())
    );
    assert_eq!(why("binary_init_01"), Unsupported::MultiStar);
    assert_eq!(
        why("time_loop_world_system"),
        Unsupported::Effect("change_pc".to_owned())
    );
    assert_eq!(why("red_giant_lusus"), Unsupported::EventOnly);
    assert_eq!(
        why("ai_system_01"),
        Unsupported::EventOnly,
        "its odds come only from a cluster"
    );
    assert_eq!(
        odds(gd, gd.initializers.get("oasis_system").unwrap(), None),
        15.0
    );
    let oasis = by_name(gd, 1, "Gen", SPOT, "oasis_system").unwrap();
    assert_eq!(
        (oasis.star_class.as_str(), oasis.star.class.as_str()),
        ("sc_m_giant", "pc_m_giant_star"),
        "sc_m in the layout, with a red giant written as its star"
    );
    assert_eq!(why("guardians_init_hatchling"), Unsupported::Guardian);
    assert_eq!(why("dyson_sphere_init_01"), Unsupported::Megastructure);

    let mut session = common::open_4_5();
    for layout in &special {
        for seed in 0..20 {
            let spec = by_name(gd, seed, "Gen", SPOT, layout)
                .unwrap_or_else(|e| panic!("{layout} seed {seed}: {e}"));
            assert_eq!(
                by_name(gd, seed, "Gen", SPOT, layout),
                Ok(spec.clone()),
                "{layout} seed {seed}"
            );
            let init = gd.initializers.get(layout).unwrap();
            assert_eq!(spec.capped, init.max_instances.is_some(), "{layout}");
        }
        let mut spec = by_name(gd, 1, "Gen", SPOT, layout).unwrap();
        spec.lanes = vec![169];
        session
            .apply(Op::AddSaveSystem { spec })
            .unwrap_or_else(|e| panic!("{layout}: {e}"));
        session.undo().expect("undo the add");
    }
    let capped = |layout: &str| by_name(gd, 1, "Gen", SPOT, layout).unwrap().capped;
    assert!(!capped("special_init_01"));
    let zevox = by_name(gd, 1, "Gen", SPOT, "unique_system_initializer_03");
    assert_eq!(zevox.unwrap().flags, ["unique_system"]);
    assert!(capped("trappist_initializer"));
}

#[test]
fn the_real_install_lists_its_special_stars_and_labels_its_menu() {
    let Some(gd) = install() else {
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

/// The point nearest [`SPOT`], on a grid, that stands 10 from every system of `session`.
fn free_ground(session: &Session) -> (f64, f64) {
    let clear = |(x, y): (f64, f64)| {
        session
            .graph
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

/// The layouts the Special menu offers converted to an unowned system, each with its label,
/// whether the menu lists it with the unique systems, and the star flags it keeps.
const CONVERTED: [(&str, &str, bool, &[&str]); 14] = [
    (
        "sol_system_initializer",
        "Sol",
        true,
        &["sol_system", "sol", "galactic_landmark_system"],
    ),
    ("new_bratulla_initializer", "New Bratulla", false, &[]),
    ("special_init_06", "Zanaam", false, &[]),
    ("great_wound_system", "Great Wound", false, &[]),
    ("breachsealer_system", "Seddom", false, &[]),
    ("vultaumar_system", "Vultaumar", false, &[]),
    ("fen_habbanis_system", "Fen Habbanis", false, &[]),
    ("irass_system", "Irass", false, &[]),
    ("last_baol_system", "Grunur", false, &[]),
    ("sol_neighbor_t1", "Barnard's Star", false, &[]),
    ("hostile_init_16", "Tiyana Vek", false, &[]),
    ("hostile_init_21", "Tiyun Ort", false, &[]),
    ("holibrae_initializer", "Holibrae", false, &[]),
    ("the_chosen_escapee_initializer", "Ophala", false, &[]),
];

#[test]
fn converted_layouts_come_without_their_empires_civilisations_and_story_flags() {
    let Some(gd) = install() else {
        return;
    };
    let keys: BTreeSet<&str> = CONVERTED.iter().map(|(key, ..)| *key).collect();
    assert_eq!(
        keys,
        CONVERTED_LAYOUTS.iter().map(|layout| layout.key).collect(),
        "the whitelist"
    );
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
    let mut expected: Vec<(&str, &str, bool)> = CONVERTED
        .iter()
        .map(|&(key, label, unique, _)| (key, label, unique))
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
    let known: BTreeSet<u32> = session.graph.systems.keys().copied().collect();
    for &(key, _, _, flags) in &CONVERTED {
        let mut spec = by_name(gd, 1, "Gen", free_ground(&session), key).unwrap();
        let unique = gd
            .initializers
            .get(key)
            .unwrap()
            .flags
            .iter()
            .any(|f| f == "unique_system");
        let kept: Vec<&str> = flags
            .iter()
            .copied()
            .chain(unique.then_some("unique_system"))
            .collect();
        assert_eq!(spec.flags, kept, "{key}: no story flags");
        spec.lanes = vec![169];
        session
            .apply(Op::AddSaveSystem { spec })
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
        .graph
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

#[test]
fn rings_come_up_about_as_often_as_their_class_allows() {
    let Some(gd) = install() else {
        return;
    };
    let seeds = 2000;
    let mut tally: BTreeMap<String, (f64, f64)> = BTreeMap::new();
    for seed in 0..seeds {
        let spec = generate(gd, seed, "Gen", SPOT, None, ABUNDANCE).unwrap();
        assert!(!spec.star.ring);
        for planet in &spec.planets {
            let seen = tally.entry(planet.class.clone()).or_default();
            seen.0 += 1.0;
            seen.1 += f64::from(u8::from(planet.ring));
            assert!(planet.moons.iter().all(|m| !m.ring), "seed {seed}");
        }
    }
    let mut ringed = 0.0;
    for (class, (count, rings)) in &tally {
        let chance = gd.planet_classes.get(class).unwrap().chance_of_ring;
        ringed += rings;
        if *count < 200.0 {
            continue;
        }
        let share = rings / count;
        assert!(
            (share - chance).abs() < 0.06,
            "{class}: {share:.3} ringed of {count}, chance {chance}"
        );
    }
    assert!(ringed > 0.0, "plain systems get rings");
}

#[test]
fn a_fixed_name_a_system_already_holds_gives_way_to_a_pool_name() {
    let (_dir, gd) = hand_written();
    let gd = &gd;
    let session = common::open_4_5();
    let settled = |session: &Session, layout: &str| {
        let mut spec = by_name(gd, 2, "Gen", (0.0, 0.0), layout).unwrap();
        settle_name(session, gd, &mut spec, "Pooled", 2);
        spec.name
    };
    assert_eq!(settled(&session, "fx_haven"), "NAME_Fx_Haven");
    assert_eq!(settled(&session, "fx_offcentre"), "Gen", "no fixed name");
    let mut session = common::open_4_5();
    let mut haven = by_name(gd, 1, "Gen", SPOT, "fx_haven").unwrap();
    haven.lanes = vec![169];
    session
        .apply(Op::AddSaveSystem { spec: haven })
        .expect("add Fx Haven");
    assert_eq!(settled(&session, "fx_haven"), "Pooled");
}

/// `spec` as the snapshot `name` under `snapshots/generate`: the system on the first line,
/// then its belts, then one line per body, each moon under its planet. Every field is
/// named, so a new one fails to compile until it is rendered. A snapshot of the real
/// install changes when a game update changes the layouts, classes or deposits it reads.
fn pinned(name: &str, spec: &SystemSpec) {
    let SystemSpec {
        name: system,
        x,
        y,
        star_class,
        initializer,
        capped,
        star_named_by_class,
        star,
        planets,
        belts,
        flags,
        lanes,
    } = spec;
    let mut out = format!("{system} at {x} {y} {star_class} {initializer}");
    if *capped {
        out.push_str(" capped");
    }
    if *star_named_by_class {
        out.push_str(" star_named_by_class");
    }
    if !flags.is_empty() {
        out.push_str(&format!(" flags {flags:?}"));
    }
    if !lanes.is_empty() {
        out.push_str(&format!(" lanes {lanes:?}"));
    }
    out.push('\n');
    for BeltSpec { kind, inner_radius } in belts {
        out.push_str(&format!("belt {kind} {inner_radius}\n"));
    }
    body_line(&mut out, "", star);
    for planet in planets {
        body_line(&mut out, "  ", planet);
    }
    insta::with_settings!({snapshot_path => "snapshots/generate", prepend_module_to_snapshot => false}, {
        insta::assert_snapshot!(name, out);
    });
}

/// `body` on a line of its own below `indent`, then its moons one level further in.
fn body_line(out: &mut String, indent: &str, body: &BodySpec) {
    let BodySpec {
        class,
        size,
        orbit,
        angle,
        entity,
        deposits,
        moons,
        asteroid,
        name,
        entity_name,
        modifiers,
        ring,
        star,
    } = body;
    let mut line = format!("{indent}{class} {size} orbit {orbit} angle {angle}");
    if *entity != 0 {
        line.push_str(&format!(" entity {entity}"));
    }
    if !deposits.is_empty() {
        line.push_str(&format!(" deposits {deposits:?}"));
    }
    for (set, word) in [(star, "star"), (asteroid, "asteroid"), (ring, "ring")] {
        if *set {
            line.push(' ');
            line.push_str(word);
        }
    }
    if let Some(name) = name {
        line.push_str(&format!(" name {name}"));
    }
    if let Some(entity) = entity_name {
        line.push_str(&format!(" entity_name {entity}"));
    }
    if !modifiers.is_empty() {
        line.push_str(&format!(" modifiers {modifiers:?}"));
    }
    out.push_str(&line);
    out.push('\n');
    for moon in moons {
        body_line(out, &format!("{indent}  "), moon);
    }
}

#[test]
fn a_hand_written_install_rolls_the_same_bodies_for_a_seed_as_before() {
    let (_dir, gd) = hand_written();
    for seed in [1, 2] {
        let spec = generate(&gd, seed, "Fx", (1.0, 2.0), None, ABUNDANCE).unwrap();
        pinned(&format!("fx_random_{seed}"), &spec);
    }
    let spec = by_name(&gd, 1, "Fx", (1.0, 2.0), "fx_haven").unwrap();
    pinned("fx_haven_1", &spec);
    let spec = generate(&gd, 3, "Fx", (1.0, 2.0), Some("sc_hole"), ABUNDANCE).unwrap();
    pinned("fx_hole_3", &spec);
}

/// A body whose class the install makes a star is marked a star, as the system's own star
/// is, so the core writes it with a star's carrier flags whatever the class is called.
#[test]
fn a_body_of_a_star_class_is_marked_a_star() {
    let (_dir, gd) = hand_written();
    let spec = by_name(&gd, 1, "Fx", (1.0, 2.0), "fx_haven").unwrap();
    assert!(spec.star.star, "the system's own star");
    let marked: Vec<(&str, bool)> = spec
        .planets
        .iter()
        .flat_map(|planet| std::iter::once(planet).chain(&planet.moons))
        .map(|body| (body.class.as_str(), body.star))
        .collect();
    assert!(marked.contains(&("pc_hole", true)), "{marked:?}");
    assert!(
        marked
            .iter()
            .all(|&(class, star)| star == (class == "pc_hole")),
        "{marked:?}"
    );
}

#[test]
fn the_real_install_rolls_the_same_bodies_for_a_seed_as_before() {
    let Some(gd) = install() else {
        return;
    };
    for seed in [1, 5] {
        let spec = generate(gd, seed, "Gen", SPOT, None, ABUNDANCE).unwrap();
        pinned(&format!("random_{seed}"), &spec);
    }
    let spec = generate(gd, 1, "Gen", SPOT, Some("sc_pulsar"), ABUNDANCE).unwrap();
    pinned("pulsar_1", &spec);
    for (layout, seed) in [
        ("trappist_initializer", 1),
        ("previously_terraformed_planet_system_initializer", 1),
        ("wenkwort_initializer", 3),
        ("debris_belt_initializer", 3),
    ] {
        let spec = by_name(gd, seed, "Gen", SPOT, layout).unwrap();
        pinned(&format!("{layout}_{seed}"), &spec);
    }
}

#[test]
fn a_special_star_pick_gives_only_a_generic_layout() {
    let Some(gd) = install() else {
        return;
    };
    for (class, layout) in [
        ("sc_pulsar", "special_init_09"),
        ("sc_black_hole", "special_init_01"),
        ("sc_neutron_star", "special_init_08"),
    ] {
        for seed in 0..300 {
            let spec = generate(gd, seed, "Gen", SPOT, Some(class), ABUNDANCE).unwrap();
            assert_eq!(
                spec.initializer, layout,
                "seed {seed}: never star_lifting_system or another named or capped layout"
            );
        }
    }
}

#[test]
fn a_bodys_blockers_class_model_and_dlc_branches_run_in_order() {
    let (_dir, gd) = hand_written();
    let gem = || "d_fx_gem".to_owned();
    let block = || "d_fx_block".to_owned();
    let pack = SaveFacts {
        dlcs: ["Fx Pack".to_owned()].into(),
        ..SaveFacts::default()
    };
    let with_pack =
        generate_layout_for(&gd, &pack, 1, "Fx", (0.0, 0.0), "fx_works", ABUNDANCE).unwrap();
    let rock = &with_pack.planets[0];
    assert_eq!(
        rock.deposits,
        [gem(), block(), gem(), gem(), gem()],
        "clear_blockers took the first blocker, add_blocker put one back, the loop ran three times"
    );
    assert_eq!(rock.class, "pc_meadow", "with the DLC");
    assert_eq!(rock.entity_name.as_deref(), Some("fx_meadow_entity"));
    assert!(rock.modifiers.is_empty());
    assert_eq!(
        rock.moons.len(),
        1,
        "a planet written inside a planet is its moon"
    );
    let without = SaveFacts::default();
    let bare =
        generate_layout_for(&gd, &without, 1, "Fx", (0.0, 0.0), "fx_works", ABUNDANCE).unwrap();
    let rock = &bare.planets[0];
    assert_eq!(
        (rock.class.as_str(), rock.entity_name.as_deref()),
        ("pc_rock", None)
    );
    assert_eq!(rock.modifiers, ["fx_mod"], "the else arm");
}

#[test]
fn the_real_installs_effect_layouts_come_out_as_their_scripts_say() {
    let Some(gd) = install() else {
        return;
    };
    let layout = |key: &str| by_name(gd, 1, "Gen", SPOT, key).unwrap();
    let relic = |spec: &SystemSpec| {
        spec.planets
            .iter()
            .find(|p| p.name.as_deref() == Some("NAME_Unique_System_2_Planet"))
            .cloned()
            .expect("Larionessi's world")
    };
    let refuge = relic(&layout("unique_system_initializer_02"));
    assert_eq!(refuge.class, "pc_relic", "with Ancient Relics");
    assert!(refuge.deposits.contains(&"d_rich_mountain".to_owned()));
    let without = SaveFacts::default();
    let bare = generate_layout_for(
        gd,
        &without,
        1,
        "Gen",
        SPOT,
        "unique_system_initializer_02",
        ABUNDANCE,
    )
    .unwrap();
    let refuge = relic(&bare);
    assert_eq!(refuge.class, "pc_tropical", "without it");
    assert!(refuge.deposits.contains(&"d_green_hills".to_owned()));

    let mall = layout("the_star_mall_initializer");
    let habitat = mall
        .planets
        .iter()
        .flat_map(|p| &p.moons)
        .find(|m| m.class == "pc_habitat")
        .expect("the mall");
    assert_eq!(
        habitat.entity_name.as_deref(),
        Some("habitat_phase_03_entity")
    );
    let stalls = habitat
        .deposits
        .iter()
        .filter(|d| *d == "d_star_mall_blocker")
        .count();
    assert_eq!(stalls, 8, "the while loop");

    let collided = layout("collided_planet_system_initializer");
    let planet = collided
        .planets
        .iter()
        .find(|p| p.modifiers.contains(&"collided_planet".to_owned()))
        .expect("the collided planet");
    for blocker in ["d_former_battlefield", "d_crater", "d_ruined_district"] {
        assert!(planet.deposits.contains(&blocker.to_owned()), "{blocker}");
    }
    assert!(
        planet.moons.iter().all(|m| !m.asteroid),
        "asteroid moons are lettered, not pool-named"
    );

    let flare = layout("superflare_system");
    let nuked = flare
        .planets
        .iter()
        .flat_map(|p| &p.moons)
        .find(|m| m.class == "pc_nuked")
        .expect("the nuked moon");
    let blockers: Vec<&String> = nuked.deposits.iter().filter(|d| gd.is_blocker(d)).collect();
    assert!(
        blockers
            .iter()
            .all(|d| ["d_radioactive_wasteland", "d_irradiated_valley"].contains(&d.as_str())),
        "only the ones added after clear_blockers: {blockers:?}"
    );
}

#[test]
fn a_black_hole_is_named_from_the_black_hole_names() {
    let files: Vec<(&str, &str)> = FILES
        .iter()
        .map(|&(rel, text)| match rel {
            "common/star_classes/00_stars.txt" => (
                rel,
                "sc_sun = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 30\n}\n\
                 sc_hole = {\n\tclass = black_hole\n\tplanet = { key = pc_hole }\n\tspawn_odds = 5\n}\n",
            ),
            "common/random_names/base/00_names.txt" => (
                rel,
                "star_names = {\n\tFx_Alpha\n}\nblack_hole_names = {\n\tFx_Void\n\tFx_Maw\n\tDristmak\n}\n",
            ),
            _ => (rel, text),
        })
        .collect();
    let (_dir, gd) = common::hand_written(&files);
    let gd = &gd;
    let session = common::open_4_5();
    let used: BTreeSet<&str> = session
        .graph
        .systems
        .values()
        .map(|s| s.name.key.as_str())
        .collect();
    assert_eq!(*gd.black_hole_names, ["Fx_Void", "Fx_Maw", "Dristmak"]);
    for seed in 0..20 {
        let mut spec = generate(gd, seed, "Pooled", SPOT, Some("sc_hole"), ABUNDANCE).unwrap();
        settle_name(&session, gd, &mut spec, "Pooled", seed);
        assert!(gd.black_hole_names.contains(&spec.name), "{}", spec.name);
        assert!(!used.contains(spec.name.as_str()), "{}", spec.name);
    }
    let mut sun = generate(gd, 1, "Pooled", SPOT, Some("sc_sun"), ABUNDANCE).unwrap();
    settle_name(&session, gd, &mut sun, "Pooled", 1);
    assert_eq!(sun.name, "Pooled", "only black holes");
}

fn keys(features: &[Feature]) -> Vec<(&str, bool)> {
    features.iter().map(|f| (f.key.as_str(), f.every)).collect()
}

#[test]
fn a_hand_written_install_summarises_each_pick_from_its_layouts() {
    let (_dir, gd) = hand_written();
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
    let Some(gd) = install() else {
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
