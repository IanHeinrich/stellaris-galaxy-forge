//! What a system's details say its initializer defines: the bodies, their resources and
//! what a converted layout drops, on the fixture install, hand-written ones and the real
//! install.

use crate::common;

use sgf_core::format::save::details::ResourceAmount;
use sgf_gamedata::body_effects::Dropping;

use common::{INSTALL, fixed};

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
    let id = |index: usize| details.planets[index].id;
    let parents: Vec<Option<u32>> = details.planets.iter().map(|p| p.parent).collect();
    assert_eq!(
        parents,
        [None, None, Some(id(1)), None, Some(id(3))],
        "each moon orbits the world it was spawned under"
    );
    assert_eq!(
        resources(&details.resources),
        [("glow", 6.0)],
        "the star and both moons state d_glow_2; the world's under a random_list is left to \
         chance; d_fixture_blocker is a blocker, not an orbital deposit"
    );
    let star = &details.planets[0];
    assert_eq!(star.name_key, "NAME_Fixture_Star");
    assert_eq!(star.name.key, "NAME_Fixture_Star");
    assert_eq!(star.size, None, "a size range has no one size");
    assert_eq!(star.habitable, Some(false));
    assert!(!star.capital && !star.colonised);

    assert!(
        details.planets.iter().all(|p| p.ring == Some(false)),
        "no body states has_ring, and no fixture class has a chance_of_ring"
    );

    let world = &details.planets[1];
    assert!(world.capital && world.colonised, "starting_planet = yes");
    assert_eq!(world.habitable, Some(true));
    assert_eq!(world.size, Some(16));
    assert!(world.deposits.is_empty());
    let deposit_keys: Vec<&str> = world.deposit_keys.iter().map(|d| d.key.as_str()).collect();
    assert_eq!(deposit_keys, ["d_fixture_blocker"]);
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
        plain.planets[0].class, "pc_sun_star",
        "the body written as `star` is its initializer's star class's planet"
    );
    assert!(plain.resources.is_empty() && plain.starbase.is_none());
    assert!(plain.sites.is_empty() && plain.megastructures.is_empty());
}

#[test]
fn a_scenario_body_has_a_ring_as_the_generator_would_give_it() {
    let (_dir, gd) = common::hand_written(&[
        (
            "common/planet_classes/00_rings.txt",
            "pc_gas_giant = {
	chance_of_ring = 0.3
}
pc_rock = {
}
",
        ),
        (
            "common/solar_system_initializers/00_rings.txt",
            "ring_init = {
	class = sc_sun
	planet = { class = star }
	planet = { class = pc_gas_giant has_ring = yes }
	planet = { class = pc_gas_giant has_ring = no }
	planet = {
		class = pc_gas_giant
		moon = { class = pc_gas_giant has_ring = yes }
	}
	planet = { class = pc_rock }
	planet = { class = pc_rock has_ring = yes }
}
",
        ),
        (
            "localisation/english/fx_l_english.yml",
            "l_english:
",
        ),
    ]);
    let details = gd
        .initializer_details(9, "ring_init", None)
        .expect("the ring fixture");
    let rings: Vec<(&str, bool, Option<bool>)> = details
        .planets
        .iter()
        .map(|p| (p.class.as_str(), p.moon, p.ring))
        .collect();
    assert_eq!(
        rings,
        [
            ("star", false, Some(false)),
            ("pc_gas_giant", false, Some(true)),
            ("pc_gas_giant", false, Some(false)),
            ("pc_gas_giant", false, None),
            ("pc_gas_giant", true, Some(false)),
            ("pc_rock", false, Some(false)),
            ("pc_rock", false, Some(true)),
        ],
        "a stated has_ring wins; a moon and the star never have one; an unstated body is left \
         to a draw only when its class has a chance_of_ring"
    );
}

#[test]
fn a_converted_layout_drops_what_a_plain_one_cannot_write() {
    let (_dir, gd) = common::hand_written(&[
        (
            "common/solar_system_initializers/00_owned.txt",
            "owned_init = {
	planet = { class = star }
	planet = {
		class = pc_rock
		init_effect = {
			create_colony = yes
		}
	}
	planet = {
		class = pc_rock
		init_effect = {
			every_owned_pop = { some_effect = yes }
		}
	}
	planet = {
		class = pc_rock
		init_effect = {
			solar_system = { create_species = yes }
		}
	}
}
",
        ),
        ("localisation/english/fx_l_english.yml", "l_english:\n"),
    ]);
    let init = gd.initializers.get("owned_init").expect("owned_init");
    let cases = [
        ("create_colony", "an owned statement written plainly"),
        ("some_effect", "an owned scope, every_owned_pop"),
        (
            "create_species",
            "an owned statement inside a scope that is not itself owned",
        ),
    ];
    for (planet, (key, why)) in init.planets[1..].iter().zip(cases) {
        assert_eq!(
            planet.unwritten.get(Dropping::Script).as_deref(),
            Some(key),
            "a plain layout cannot write {why}"
        );
        assert_eq!(
            planet.unwritten.get(Dropping::Converted),
            &None,
            "a converted layout drops {why} instead"
        );
    }
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
            "pc_neutron_star",
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
    assert_eq!(
        details.planets[0].habitable,
        Some(false),
        "a star is not colonisable"
    );
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

/// Larionessi Refuge's two asteroids write no `size`, so each takes `pc_asteroid`'s
/// `planet_size = 5`.
#[test]
fn a_body_with_no_size_takes_its_classs_planet_size() {
    let Some(gd) = INSTALL.as_ref() else {
        return;
    };
    let details = gd
        .initializer_details(7, "unique_system_initializer_02", None)
        .expect("Larionessi Refuge");
    let asteroids: Vec<_> = details
        .planets
        .iter()
        .filter(|p| p.class == "pc_asteroid")
        .map(|p| (p.size, p.layout.as_ref().and_then(|l| l.size)))
        .collect();
    assert_eq!(asteroids, [(Some(5), Some(fixed(5.0))); 2]);
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
