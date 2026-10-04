//! What a solar system initializer spawns, read from the real install.

use crate::common;

use sgf_core::session::Session;
use sgf_gamedata::initializers::Initializer;
use sgf_gamedata::special::classify_session;
use sgf_gamedata::views::InitializerView;

const SCENARIO: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/scenario_grammar.txt"
);

use common::INSTALL;

/// `None`, and the test returns, when this machine has no Stellaris install.
fn initializer(name: &str) -> Option<&'static Initializer> {
    let gd = INSTALL.as_ref()?;
    Some(
        gd.initializers
            .get(name)
            .unwrap_or_else(|| panic!("{name} is not in the install")),
    )
}

/// `init` as the browser lists it, through the real install's classes.
fn view(init: &Initializer) -> InitializerView {
    InitializerView::new(init, INSTALL.as_ref().expect("an install"))
}

#[test]
fn sol_spawns_its_star_its_planets_and_their_moons() {
    let Some(sol) = initializer("sol_system_initializer") else {
        return;
    };
    assert_eq!(sol.class.as_deref(), Some("sc_g"));

    let names: Vec<&str> = sol
        .planets
        .iter()
        .map(|p| p.name.as_deref().unwrap_or(""))
        .collect();
    assert_eq!(
        names,
        [
            "NAME_Sol",
            "NAME_Mercury",
            "NAME_Venus",
            "NAME_Earth",
            "NAME_Mars",
            "NAME_1_Ceres",
            "NAME_2_Pallas",
            "NAME_3_Juno",
            "NAME_4_Vesta",
            "NAME_Jupiter",
            "NAME_Saturn",
            "NAME_Uranus",
            "NAME_Neptune",
            "NAME_134340_Pluto",
            "NAME_136472_Makemake",
            "NAME_136108_Haumea",
            "NAME_20000_Varuna",
        ]
    );

    let star = &sol.planets[0];
    assert_eq!(star.class, "pc_g_star");
    assert_eq!(star.size, Some((30, 30)));
    assert_eq!(star.orbit(), Some(0.0));

    let earth = &sol.planets[3];
    assert_eq!(earth.class, "pc_continental");
    assert_eq!(earth.size, Some((18, 18)));
    assert_eq!(earth.orbit(), Some(25.0));
    assert_eq!(earth.instances(), 1);
    assert!(earth.home_planet, "starting_planet = yes");
    assert_ne!(earth.has_ring, Some(true));
    assert_eq!(earth.moons.len(), 1);
    assert_eq!(earth.moons[0].name.as_deref(), Some("NAME_Luna"));
    assert_eq!(earth.moons[0].class, "pc_barren_cold");
    assert_eq!(earth.moons[0].size, Some((5, 5)));
    assert_eq!(earth.moons[0].orbit(), Some(12.0));
    assert!(earth.moons[0].moons.is_empty());

    let jupiter = &sol.planets[9];
    assert_eq!(jupiter.class, "pc_gas_giant");
    assert_eq!(jupiter.size, Some((35, 35)));
    let moons: Vec<&str> = jupiter
        .moons
        .iter()
        .map(|m| m.name.as_deref().unwrap_or(""))
        .collect();
    assert_eq!(
        moons,
        ["NAME_Io", "NAME_Europa", "NAME_Ganymede", "NAME_Callisto"]
    );
    assert_eq!(jupiter.moons[1].orbit(), Some(2.5));

    assert_eq!(sol.planets[10].has_ring, Some(true), "Saturn");
    assert_ne!(sol.planets[12].has_ring, Some(true), "Neptune");
    assert_eq!(sol.planets[12].moons.len(), 1, "Triton");

    assert!(sol.planets.iter().all(|p| p.deposits.is_empty()));

    let view = view(sol);
    assert_eq!(view.planets.len(), 17);
    assert_eq!(view.planet_count, 24, "17 planets and 7 moons");
    assert_eq!(view.planets[3].moons[0].name.as_deref(), Some("NAME_Luna"));
}

#[test]
fn the_view_gives_a_body_its_classs_size_and_leaves_a_ring_to_the_roll() {
    let Some(init) = initializer("adSalivul_system") else {
        return;
    };
    let view = view(init);
    let broken = &view.planets[1];
    assert_eq!(broken.class, "pc_broken");
    assert_eq!(broken.size, Some((12, 30)), "pc_broken's planet_size");
    assert_eq!(broken.has_ring, Some(false), "pc_broken rolls no ring");

    let gd = INSTALL.as_ref().expect("an install");
    let rolled: Vec<_> = gd
        .initializers
        .iter()
        .flat_map(|init| {
            init.planets
                .iter()
                .zip(InitializerView::new(init, gd).planets)
        })
        .filter(|(p, _)| p.class.written() == "pc_continental" && p.has_ring.is_none())
        .map(|(_, shown)| shown.has_ring)
        .collect();
    assert!(!rolled.is_empty());
    assert!(
        rolled.iter().all(Option::is_none),
        "a continental body that names no ring leaves it to the roll"
    );
}

#[test]
fn the_view_says_which_initializers_a_country_starts_in() {
    let gd = common::cached_fixture();
    let spawns = |key: &str| {
        InitializerView::new(
            gd.initializers.get(key).unwrap_or_else(|| panic!("{key}")),
            gd,
        )
        .empire_spawn
    };
    assert!(spawns("home_init"), "usage = empire_init");
    assert!(spawns("custom_capital_init"), "usage = custom_empire");
    assert!(!spawns("basic_init_01"), "usage = misc_system_init");
}

/// The class a scenario system is drawn as until the game generates the galaxy: its
/// initializer's star class, and a G star for one that draws from a random list.
#[test]
fn the_view_gives_the_star_class_a_scenario_system_is_drawn_as() {
    let (Some(lifting), Some(relic)) = (
        initializer("star_lifting_system"),
        initializer("relic_system_1"),
    ) else {
        return;
    };
    let lifting = view(lifting);
    assert_eq!(
        (lifting.class.as_deref(), lifting.star_class.as_str()),
        (Some("sc_pulsar"), "sc_pulsar")
    );
    let relic = view(relic);
    assert_eq!(
        (relic.class.as_deref(), relic.star_class.as_str()),
        (Some("rl_binary_stars"), "sc_g"),
        "the raw class stays for the initializer browser"
    );
}

#[test]
fn an_initializer_that_names_itself_carries_the_localisation_key() {
    let gd = common::cached_fixture();
    let home = gd.initializers.get("home_init").expect("home_init");
    assert_eq!(home.display_name.as_deref(), Some("NAME_Fixture"));
    assert_eq!(
        InitializerView::new(home, gd).display_name.as_deref(),
        Some("NAME_Fixture")
    );
    let bare = gd.initializers.get("basic_init_01").expect("basic_init_01");
    assert_eq!(bare.display_name, None, "most initializers name none");

    let Some(sol) = initializer("sol_system_initializer") else {
        return;
    };
    assert_eq!(sol.display_name.as_deref(), Some("NAME_Sol"));
}

#[test]
fn the_valley_of_zanaam_lands_on_the_gaia_world() {
    let Some(zanaam) = initializer("special_init_06") else {
        return;
    };
    let gaia = zanaam
        .planets
        .iter()
        .find(|p| p.class == "pc_gaia")
        .expect("the gaia world");
    assert_eq!(gaia.name.as_deref(), Some("NAME_Zanaam"));
    assert_eq!(gaia.size, Some((25, 25)));
    assert_eq!(gaia.orbit(), Some(30.0));
    assert_eq!(gaia.deposits, ["d_valley_of_zanaam"]);
    for other in zanaam.planets.iter().filter(|p| p.class != "pc_gaia") {
        assert!(other.deposits.is_empty(), "{:?}", other.name);
    }
}

#[test]
fn ranges_and_file_variables_resolve() {
    let Some(black_hole) = initializer("special_init_01") else {
        return;
    };
    assert_eq!(black_hole.planets[0].class, "star");
    let broken = &black_hole.planets[1];
    assert_eq!(broken.class, "pc_broken");
    assert_eq!(broken.size, Some((10, 15)), "a min/max size range");
    assert_eq!(broken.instances(), 1, "the midpoint of a 0-to-1 count");

    let Some(hauer) = initializer("hauer_system_initializer") else {
        return;
    };
    let bhete = hauer
        .planets
        .iter()
        .find(|p| p.name.as_deref() == Some("NAME_Bhete"))
        .expect("NAME_Bhete");
    let moon = &bhete.moons[0];
    assert_eq!(
        moon.orbit(),
        Some(10.0),
        "@base_moon_distance, defined at the top of the same file"
    );
    assert_eq!(moon.class, "random", "a moon that names no class");
    assert_eq!(moon.instances(), 1, "the midpoint of a 0-to-2 count");
}

#[test]
fn the_grammar_documentation_file_is_a_definition_like_any_other() {
    let Some(example) = initializer("example_initializer") else {
        return;
    };
    assert_eq!(example.planets.len(), 2, "orbital_line is not a planet");
    let planet = &example.planets[1];
    assert!(planet.home_planet, "home_planet = yes");
    assert_eq!(planet.orbit(), Some(45.0), "the midpoint of 40 to 50");
    assert_eq!(planet.moons.len(), 2);
    assert_eq!(
        planet.moons[1].instances(),
        2,
        "the midpoint of a 1-to-3 count"
    );
    assert_eq!(view(example).planet_count, 5);
}

#[test]
fn a_scenario_system_is_a_point_of_interest_only_when_it_matches_a_kind() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let session = Session::open(SCENARIO).expect("the scenario fixture");
    let result = classify_session(&session, Some(gd));
    let system = |id: u32| {
        result
            .systems
            .iter()
            .find(|s| s.id == id)
            .unwrap_or_else(|| panic!("system {id}"))
    };
    let unknown = system(1);
    assert!(
        !unknown.initializer_known,
        "misc_system_init_01 is not vanilla"
    );

    for id in [2u32, 16, 3018] {
        assert!(
            result.systems.iter().all(|s| s.id != id),
            "system {id} matches no kind"
        );
    }
}
