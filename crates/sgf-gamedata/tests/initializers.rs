//! What a solar system initializer spawns, read from the real install.

use crate::common;

use sgf_core::format::save::details::ResourceAmount;
use sgf_core::session::Session;
use sgf_gamedata::initializers::{Initializer, PartnerRef};
use sgf_gamedata::special::classify_session;
use sgf_gamedata::views::InitializerView;

use common::scripts::sys;

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

    let view = InitializerView::from(sol);
    assert_eq!(view.planets.len(), 17);
    assert_eq!(view.planet_count, 24, "17 planets and 7 moons");
    assert_eq!(view.planets[3].moons[0].name.as_deref(), Some("NAME_Luna"));
}

#[test]
fn the_view_says_which_initializers_a_country_starts_in() {
    let gd = common::cached_fixture();
    let spawns = |key: &str| {
        InitializerView::from(gd.initializers.get(key).unwrap_or_else(|| panic!("{key}")))
            .empire_spawn
    };
    assert!(spawns("home_init"), "usage = empire_init");
    assert!(spawns("custom_capital_init"), "usage = custom_empire");
    assert!(!spawns("basic_init_01"), "usage = misc_system_init");
}

#[test]
fn an_initializer_that_names_itself_carries_the_localisation_key() {
    let gd = common::cached_fixture();
    let home = gd.initializers.get("home_init").expect("home_init");
    assert_eq!(home.display_name.as_deref(), Some("NAME_Fixture"));
    assert_eq!(
        InitializerView::from(home).display_name.as_deref(),
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
    assert_eq!(InitializerView::from(example).planet_count, 5);
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

/// The fixture install, so this runs where no Stellaris is installed.
#[test]
fn a_fixture_systems_details_are_what_its_initializer_defines() {
    let gd = common::cached_fixture();
    assert!(
        gd.initializer_details(4, "no_such_initializer", None)
            .is_none()
    );

    let details = gd
        .initializer_details(4, "details_init", None)
        .expect("the details fixture");
    assert_eq!(details.id, 4);
    assert!(details.with_game_data);
    assert!(details.fleets_present.is_empty() && details.fleets.fleet_count == 0);

    let bodies: Vec<(&str, bool)> = details
        .planets
        .iter()
        .map(|p| (p.class.as_str(), p.moon))
        .collect();
    assert_eq!(
        bodies,
        [
            ("pc_fixture_star", false),
            ("pc_meadow", false),
            ("pc_meadow", true),
            ("pc_meadow", false),
            ("pc_meadow", true),
        ],
        "count = 2 spawns the world and its moon twice"
    );
    assert_eq!(
        resources(&details.resources),
        [("glow", 10.0)],
        "five bodies of d_glow_2; d_fixture_blocker is a blocker, not an orbital deposit"
    );
    let star = &details.planets[0];
    assert_eq!(star.name_key, "NAME_Fixture_Star");
    assert_eq!(star.name.key, "NAME_Fixture_Star");
    assert_eq!(star.size, Some(20), "the minimum of a size range");
    assert_eq!(star.habitable, Some(false));
    assert!(!star.capital && !star.colonised);

    let world = &details.planets[1];
    assert!(world.capital && world.colonised, "starting_planet = yes");
    assert_eq!(world.habitable, Some(true));
    assert_eq!(world.size, Some(16));
    assert_eq!(resources(&world.deposits), [("glow", 2.0)]);
    assert!(
        details
            .planets
            .iter()
            .all(|p| p.owner.is_none() && p.pops == 0)
    );

    assert_eq!(
        details
            .sites
            .iter()
            .map(|s| (s.kind.as_str(), s.planet))
            .collect::<Vec<_>>(),
        [
            ("fixture_digsite", details.planets[1].id),
            ("fixture_digsite", details.planets[3].id),
        ],
        "one dig site per instance of the world that digs it"
    );
    assert_eq!(
        details
            .megastructures
            .iter()
            .map(|m| (m.kind.as_str(), m.owner))
            .collect::<Vec<_>>(),
        [("fixture_gateway", None)]
    );
    let starbase = details.starbase.expect("create_starbase");
    assert_eq!(starbase.level, "starbase_fixture");
    assert_eq!(starbase.modules, ["shipyard"]);
    assert_eq!(starbase.buildings, ["fixture_building"]);
    assert!(starbase.shipyard && starbase.owner.is_none());

    let plain = gd
        .initializer_details(5, "basic_init_01", None)
        .expect("one bare star");
    assert_eq!(plain.planets.len(), 1);
    assert_eq!(
        plain.planets[0].class, "sc_sun",
        "the body written as `star` wears the initializer's star class"
    );
    assert!(plain.resources.is_empty() && plain.starbase.is_none());
    assert!(plain.sites.is_empty() && plain.megastructures.is_empty());
}

/// Two spawns elsewhere, each linking back to the system the initializer
/// generates: each of its own endpoints takes one of them.
#[test]
fn every_far_end_that_links_back_is_the_far_end_of_one_endpoint() {
    let gd = common::cached_fixture_with_mods();
    let init = gd
        .initializers
        .get("twin_gate_init")
        .expect("twin_gate_init is not in the fixture");
    let partners: Vec<&PartnerRef> = init.bypasses.own.iter().map(|b| &b.partner).collect();
    assert_eq!(
        partners,
        [
            &PartnerRef::Saved("fixture_far_a".to_owned()),
            &PartnerRef::Saved("fixture_far_b".to_owned()),
        ],
        "the second endpoint takes the second far end, not the first again"
    );
    assert_eq!(
        init.bypasses.random_wormhole_pairs, 0,
        "both pairs have an end on this system"
    );
}

/// The mod layer, whose bodies carry every ownership shape the scripts use.
#[test]
fn a_body_is_a_colony_only_when_an_owner_meets_a_colonisation_effect() {
    let gd = common::cached_fixture_with_mods();
    let init = |name: &str| {
        gd.initializers
            .get(name)
            .unwrap_or_else(|| panic!("{name} is not in the fixture"))
    };

    let capital = &init("empire_capital_init").planets[0];
    assert_eq!(capital.colony_owner.as_deref(), Some("fixture_empire"));
    assert!(capital.colonised, "set_owner beside generate_owner_pops");

    let territory = &init("empire_colony_init").planets[0];
    assert_eq!(territory.colony_owner, None, "set_owner and nothing else");
    assert!(!territory.colonised);

    let contested = &init("contested_init").planets[0];
    assert_eq!(contested.colony_owner, None, "a starbase is not a colony");

    let colony_only = init("colony_only_init");
    assert_eq!(colony_only.planets[0].colony_owner, None, "the star");
    assert_eq!(
        colony_only.planets[1].colony_owner, None,
        "the colony is the moon's, not its planet's"
    );
    let moon = &colony_only.planets[1].moons[0];
    assert_eq!(moon.colony_owner.as_deref(), Some("fixture_empire"));
    assert!(moon.colonised, "create_colony needs nothing beside it");
}

/// A colony names a planet index, which must be the row the details list gives that body.
#[test]
fn a_colonised_body_names_its_territory_in_the_systems_details() {
    let gd = common::cached_fixture_with_mods();
    let scenario = [
        sys(1, "empire_capital_init"),
        sys(2, "empire_colony_init"),
        sys(24, "colony_only_init"),
    ];
    let owners = gd.scenario_owners(&scenario);
    let empire = owners
        .territory_of("fixture_empire")
        .expect("the fixture empire");

    let capital = gd
        .initializer_details(1, "empire_capital_init", Some(&owners))
        .expect("the capital's details");
    assert_eq!(capital.planets[0].owner, Some(empire));
    assert!(capital.planets[0].colonised);

    let territory = gd
        .initializer_details(2, "empire_colony_init", Some(&owners))
        .expect("the colony system's details");
    assert_eq!(territory.planets[0].owner, None);
    assert!(
        !territory.planets[0].colonised,
        "set_owner with no colonisation effect is territory only"
    );

    let colony_only = gd
        .initializer_details(24, "colony_only_init", Some(&owners))
        .expect("the moon colony's details");
    let colonised: Vec<(usize, Option<u32>, bool)> = colony_only
        .planets
        .iter()
        .enumerate()
        .map(|(i, p)| (i, p.owner, p.moon))
        .collect();
    assert_eq!(
        colonised,
        [(0, None, false), (1, None, false), (2, Some(empire), true)],
        "the third row is the moon the scripts colonise"
    );

    let alone = gd
        .initializer_details(1, "empire_capital_init", None)
        .expect("the capital's details");
    assert_eq!(
        alone.planets[0].owner, None,
        "no owners, no territory to name"
    );
}

fn resources(rows: &[ResourceAmount]) -> Vec<(&str, f64)> {
    rows.iter()
        .map(|r| (r.resource.as_str(), r.amount))
        .collect()
}

#[test]
fn a_systems_details_are_what_its_initializer_defines() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let details = gd
        .initializer_details(7, "unique_system_initializer_02", None)
        .expect("an initializer that spawns planets");
    assert_eq!(details.id, 7);
    assert!(details.with_game_data);
    assert!(details.fleets_present.is_empty(), "fleets are not resolved");
    assert!(details.megastructures.is_empty());
    assert_eq!(
        resources(&details.resources),
        [
            ("physics_research", 5.0),
            ("minerals", 11.0),
            ("alloys", 4.0),
        ],
        "d_physics_5, d_minerals_5 and two moons of d_minerals_3, two asteroids of d_alloys_2"
    );
    assert!(
        gd.initializer_details(8, "basic_init_02", None)
            .expect("bodies but no deposits")
            .resources
            .is_empty()
    );

    let classes: Vec<&str> = details.planets.iter().map(|p| p.class.as_str()).collect();
    assert_eq!(
        classes,
        [
            "sc_neutron_star",
            "pc_barren",
            "pc_asteroid",
            "pc_asteroid",
            "pc_relic",
            "pc_barren",
            "pc_barren",
        ],
        "count = 2 spawns two asteroids; the relic world carries two moons"
    );
    assert_eq!(
        details.planets.iter().filter(|p| p.moon).count(),
        2,
        "the relic world's moons"
    );
    assert_eq!(details.planets[0].habitable, None, "star is not a class");
    assert_eq!(details.planets[1].size, Some(18));
    assert_eq!(
        details.planets[2].deposits.len(),
        1,
        "each asteroid carries its own d_alloys_2"
    );
    assert!(details.planets.iter().all(|p| p.owner.is_none()));
    assert!(details.planets.iter().all(|p| !p.capital));

    let site = details.sites.first().expect("the Larion dig site");
    assert_eq!(site.kind, "larion_digsite");
    assert_eq!(site.planet, details.planets[4].id, "the relic world");
    assert!(
        details.planets.iter().all(|p| p.id != site.id),
        "a synthetic site id never collides with a body's"
    );
}

#[test]
fn a_home_system_a_megastructure_and_a_starbase_come_through() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let sol = gd
        .initializer_details(1, "sol_system_initializer", None)
        .expect("Sol");
    assert_eq!(sol.planets[0].class, "pc_g_star", "the star comes first");
    let earth = sol
        .planets
        .iter()
        .find(|p| p.name_key == "NAME_Earth")
        .expect("Earth");
    assert!(earth.capital && earth.colonised, "starting_planet = yes");
    assert_eq!(earth.habitable, Some(true));
    assert_eq!(earth.size, Some(18));
    assert_eq!(earth.name.key, "NAME_Earth");
    assert!(
        sol.planets
            .iter()
            .any(|p| p.moon && p.name_key == "NAME_Luna")
    );

    let lgate = gd
        .initializer_details(2, "distantstars_init_00", None)
        .expect("an L-Gate system");
    assert_eq!(
        lgate
            .megastructures
            .iter()
            .map(|m| m.kind.as_str())
            .collect::<Vec<_>>(),
        ["lgate_base"]
    );
    assert!(lgate.megastructures.iter().all(|m| m.owner.is_none()));

    let fallen = gd
        .initializer_details(3, "fallen_hive_war_2", None)
        .expect("a fallen empire system");
    let starbase = fallen.starbase.expect("create_starbase");
    assert_eq!(starbase.level, "starbase_outpost");
    assert!(!starbase.shipyard);
    assert!(starbase.owner.is_none() && starbase.name_key.is_empty());
}

#[test]
fn an_initializer_is_sourced_to_the_mod_that_defines_it_and_vanilla_to_nothing() {
    let gd = common::cached_fixture_with_mods();
    assert_eq!(
        gd.initializer_source("mod_one_init").as_deref(),
        Some("Mod One")
    );
    assert_eq!(gd.initializer_source("home_init"), None);
    assert_eq!(gd.initializer_source("no_such_init"), None);
}
