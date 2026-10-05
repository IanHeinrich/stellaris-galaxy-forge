//! What a system's details say of who holds it: the far ends of its links, the bodies its
//! scripts colonise, the territory they name and a home system's starbase.

use crate::common;

use sgf_gamedata::initializers::PartnerRef;

use common::INSTALL;
use common::scripts::sys;

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
