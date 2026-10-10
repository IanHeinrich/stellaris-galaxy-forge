//! Which class a star body of a system's details is: the planet key of its star class, on
//! the fixture install, hand-written ones, the real install and a save.

use crate::common;

use common::{INSTALL, range};

/// A save writes each star body as a planet class, so a scenario's details do too: the bare
/// `star` takes the system's star class's planet key for the nth star in source order.
#[test]
fn a_scenario_star_body_is_the_planet_class_its_star_class_spawns() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let stars = |initializer: &str, n: usize| -> Vec<String> {
        gd.initializer_details(1, initializer, None)
            .unwrap_or_else(|| panic!("{initializer}'s details"))
            .planets
            .iter()
            .take(n)
            .map(|p| p.class.clone())
            .collect()
    };
    assert_eq!(stars("star_lifting_system", 1), ["pc_pulsar"], "sc_pulsar");
    assert_eq!(
        stars("living_planet_system", 2),
        ["pc_m_giant_star", "pc_b_star"],
        "sc_binary_3's two stars, in order"
    );
    assert_eq!(
        stars("hostile_init_void_cloud", 1),
        ["pc_black_hole"],
        "sc_black_hole"
    );
    assert_eq!(
        stars("relic_system_1", 2),
        ["pc_g_star", "pc_g_star"],
        "a random star list stands in as a G star until the game draws one"
    );
    let pulsar = gd
        .initializer_details(1, "star_lifting_system", None)
        .expect("the pulsar's details");
    assert_eq!(pulsar.planets[0].habitable, Some(false));
}

/// No vanilla initializer writes a brown dwarf's star as the bare `star`, and none writes a
/// star class as a body's class, so both are asked of the resolution directly.
#[test]
fn a_star_body_takes_the_planet_key_of_the_class_it_names_or_its_systems() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    assert_eq!(gd.star_body_classes("sc_t", ["star"]), ["pc_t_star"]);
    assert_eq!(
        gd.star_body_classes("sc_g", ["sc_t", "pc_barren", "star"]),
        ["pc_t_star", "pc_barren", "pc_g_star"],
        "a named star class is the brown dwarf's; the bare star is the second star of sc_g"
    );
    assert_eq!(
        gd.star_body_classes("sc_binary_3", ["star", "pc_barren", "star", "star"]),
        [
            "pc_m_giant_star",
            "pc_barren",
            "pc_b_star",
            "pc_m_giant_star"
        ],
        "a star past the class's planets takes its first"
    );
    assert_eq!(
        gd.star_body_classes("sc_no_such_class", ["star"]),
        ["star"],
        "a class the install does not define leaves the star as written"
    );
    assert_eq!(gd.scenario_star_class("star_lifting_system"), "sc_pulsar");
    assert_eq!(gd.scenario_star_class("relic_system_1"), "sc_g");
    assert_eq!(gd.scenario_star_class("no_such_initializer"), "sc_g");
}

/// A star body takes the nth planet key of its system's class, and a star class written as a
/// body takes that class's.
#[test]
fn a_fixture_binarys_star_bodies_take_its_classes_planet_keys_in_turn() {
    let gd = common::cached_fixture();
    assert_eq!(
        gd.star_body_classes("sc_pair", ["star", "star", "star", "pc_meadow", "sc_ember"]),
        [
            "pc_sun_star",
            "pc_ember_star",
            "pc_sun_star",
            "pc_meadow",
            "pc_ember_star"
        ],
        "the third star takes the first key once they run out"
    );
    assert_eq!(gd.star_body_classes("sc_nowhere", ["star"]), ["star"]);
}

const FACT_FILES: [(&str, &str); 4] = [
    (
        "common/star_classes/00_stars.txt",
        "sc_a_sun = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n}\n\
         sc_sun = {\n\tclass = sun_star\n\tplanet = { key = pc_sun_star }\n\tspawn_odds = 30\n}\n",
    ),
    (
        "common/planet_classes/00_planets.txt",
        "pc_sun_star = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 30 }\n}\n\
         pc_rock = {\n\tplanet_size = { min = 10 max = 20 }\n\tmoon_size = { min = 5 max = 8 }\n}\n\
         random_list = {\n\tname = \"rl_rocks\"\n\tplanets = { pc_rock }\n}\n",
    ),
    (
        "common/solar_system_initializers/00_fx.txt",
        "fx_facts = {\n\tclass = sc_sun\n\
         \tplanet = {\n\t\tclass = star orbit_distance = 0\n\t\tplanet = { class = pc_rock orbit_distance = 30 }\n\t}\n\
         \tplanet = {\n\t\tclass = pc_rock orbit_distance = 60\n\
         \t\tmoon = { class = pc_rock orbit_distance = 5 }\n\t\tmoon = { class = rl_rocks orbit_distance = 5 }\n\t}\n\
         \tplanet = { class = random orbit_distance = 20 }\n\
         \tplanet = { class = ideal_planet_class orbit_distance = 10 }\n}\n\
         fx_scripted = {\n\tclass = sc_sun\n\tplanet = { class = star orbit_distance = 0 }\n\
         \tinline_script = { script = fx_bodies }\n}\n\
         fx_body_scripted = {\n\tclass = sc_sun\n\
         \tplanet = { class = star orbit_distance = 0 inline_script = { script = fx_moons } }\n}\n\
         fx_worms = {\n\tclass = sc_sun\n\tinline_script = { script = fx_bodies }\n}\n",
    ),
    ("localisation/english/fx_l_english.yml", "l_english:\n"),
];

/// Each body's facts as the install decides them: the star class a star is drawn as, whether
/// its class is a draw, whether it orbits a planet, and a size from its class when its block
/// gives none: a body written inside another block takes the class's `moon_size`.
#[test]
fn a_scenario_bodys_star_class_draw_moon_and_size_come_from_the_install() {
    let (_dir, gd) = common::hand_written(&FACT_FILES);
    let details = gd
        .initializer_details(1, "fx_facts", None)
        .expect("fx_facts");
    let facts: Vec<_> = details
        .planets
        .iter()
        .map(|p| {
            let size = p.layout.as_ref().and_then(|l| l.size);
            (
                p.class.as_str(),
                p.star_class.as_deref(),
                p.drawn,
                p.moon,
                size,
            )
        })
        .collect();
    assert_eq!(
        facts,
        [
            (
                "pc_sun_star",
                Some("sc_sun"),
                Some(false),
                false,
                Some(range(20.0, 30.0))
            ),
            ("pc_rock", None, Some(false), false, Some(range(5.0, 8.0))),
            ("pc_rock", None, Some(false), false, Some(range(10.0, 20.0))),
            ("pc_rock", None, Some(false), true, Some(range(5.0, 8.0))),
            ("rl_rocks", None, Some(true), true, None),
            ("random", None, Some(true), false, None),
            ("ideal_planet_class", None, Some(true), false, None),
        ],
        "sc_sun over the odds-less sc_a_sun; a body nested in the star block is no moon, \
         but takes a moon's size as the block it is written in gives it"
    );
}

/// An initializer that places its bodies only through an `inline_script` lists none, so the
/// game's roll stands in for them. One that lists bodies beside a script is drawn as it lists them.
#[test]
fn an_initializer_placing_its_bodies_only_through_an_inline_script_rolls_its_planets() {
    let (_dir, gd) = common::hand_written(&FACT_FILES);
    let worms = gd.system_roll(1, "fx_worms", "sc_sun", 0, 150.0);
    assert!(worms.rolls_planets && worms.bodies.is_empty());
    let spawn = gd
        .initializer_details(1, "fx_worms", None)
        .and_then(|d| d.spawn)
        .expect("fx_worms' spawn");
    assert_eq!(
        (spawn.planets, spawn.moons, spawn.asteroids),
        (None, None, None),
        "the script's bodies cannot be counted"
    );
    for key in ["fx_scripted", "fx_body_scripted", "fx_facts"] {
        let roll = gd.system_roll(1, key, "sc_sun", 0, 150.0);
        assert!(!roll.rolls_planets && roll.placeholders.is_empty(), "{key}");
    }
}

/// A save's star bodies are drawn as the star class whose only star they are. Which bodies
/// are moons stays as the save says.
#[test]
fn a_save_bodys_star_class_comes_from_the_install_and_its_moons_from_the_save() {
    let (_dir, gd) = common::hand_written(&[
        (
            "common/star_classes/00_stars.txt",
            "sc_a_g = {\n\tclass = g_star\n\tplanet = { key = pc_g_star }\n}\n\
             sc_g = {\n\tclass = g_star\n\tplanet = { key = pc_g_star }\n\tspawn_odds = 10\n}\n",
        ),
        (
            "common/planet_classes/00_planets.txt",
            "pc_g_star = {\n\tstar = yes\n\tplanet_size = { min = 20 max = 30 }\n}\n\
             pc_continental = {\n\tcolonizable = yes\n\tplanet_size = { min = 12 max = 25 }\n}\n",
        ),
        ("localisation/english/fx_l_english.yml", "l_english:\n"),
    ]);
    let session = common::open_4_4();
    let projection = session.details().expect("the sample's details");
    let system = session.system(217).expect("Sol");
    let mut sol = projection
        .resolve(217, &gd, true)
        .expect("system 217's details");
    let moons: Vec<u32> = sol
        .planets
        .iter()
        .filter(|p| p.moon)
        .map(|p| p.id)
        .collect();
    assert!(!moons.is_empty(), "Sol has moons");
    gd.resolve_save_bodies(&mut sol, &system.star_class);

    assert_eq!(sol.planets[0].class, "pc_g_star");
    assert_eq!(
        sol.planets[0].star_class.as_deref(),
        Some("sc_g"),
        "the class a new galaxy rolls over the odds-less sc_a_g"
    );
    assert!(sol.planets[1..].iter().all(|p| p.star_class.is_none()));
    assert!(sol.planets.iter().all(|p| p.drawn == Some(false)));
    let now: Vec<u32> = sol
        .planets
        .iter()
        .filter(|p| p.moon)
        .map(|p| p.id)
        .collect();
    assert_eq!(now, moons, "Sol's moons are the save's");
}
