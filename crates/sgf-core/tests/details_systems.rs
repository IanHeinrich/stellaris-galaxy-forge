//! Details projection on the real sample save: Sol and the inspector's home systems,
//! a companion star, the resolver, names and flags.
use std::fmt::Write as _;

use sgf_core::format::save::details::{
    BodyRole, DepositCount, DetailsResolver, FleetPresence, HeuristicResolver, ResourceAmount,
    SystemDetails,
};
use sgf_core::projections::galaxy::FlagRef;
use sgf_core::projections::name::{NameTemplate, NameVariable};

use crate::common;

#[test]
fn sol_reads_as_the_inspector_lists_it() {
    let session = common::warmed();
    let details = session.details().expect("build details");
    let raw = |id: u32| details.raw(id).expect("system in projection");
    let sol = details
        .resolve(217, &HeuristicResolver, false)
        .expect("Sol resolved");
    assert_eq!(sol.id, 217);
    assert!(!sol.with_game_data);
    assert_eq!(sol.planets.len(), 24);
    let earth = sol.planets.iter().find(|p| p.id == 3).expect("Earth");
    assert_eq!(earth.name_key, "NAME_Earth");
    assert_eq!(earth.name, NameTemplate::plain("NAME_Earth"));
    assert_eq!(earth.class, "pc_continental");
    assert!(earth.colonised && earth.capital && !earth.moon && !earth.pre_ftl);
    assert_eq!(earth.owner, Some(0));
    assert_eq!(earth.habitable, None);
    assert_eq!(earth.size, Some(18));
    let page = sgf_core::entity::get_planet_page(session.doc(), 3).expect("Earth's page");
    assert!(earth.orbit.is_some_and(|orbit| orbit > 0.0));
    assert_eq!(earth.orbit, page.orbit, "the orbit the planet page reads");
    assert!(
        sol.planets.iter().all(|p| p.orbit.is_some()),
        "every body has one"
    );
    // A colony's own deposits are features and blockers, which the resolver drops; the
    // raw keys stay beside the summed amounts so nothing on the planet is hidden.
    assert_eq!(earth.pops, 5445);
    assert!(earth.deposits.is_empty());
    assert_eq!(earth.deposit_keys.len(), 10);
    assert_eq!(
        earth.deposit_keys[0],
        DepositCount {
            key: "d_mesopotamian_urban_corridor".to_owned(),
            count: 1,
        }
    );
    let mars = sol.planets.iter().find(|p| p.id == 5).expect("Mars");
    assert_eq!(mars.pops, 0);
    assert_eq!(
        mars.deposits,
        [ResourceAmount {
            resource: "minerals".to_owned(),
            amount: 3.0,
        }]
    );
    assert_eq!(
        mars.deposit_keys,
        [DepositCount {
            key: "d_minerals_3".to_owned(),
            count: 1,
        }]
    );
    assert_eq!(sol.planets.iter().filter(|p| p.colonised).count(), 1);
    assert_eq!(sol.planets.iter().filter(|p| p.moon).count(), 7);
    let starbase = sol.starbase.as_ref().expect("Sol starbase");
    assert_eq!(starbase.id, 0);
    assert_eq!((starbase.hull, starbase.max_hull), (10000.0, 10000.0));
    assert_eq!(
        starbase.name_key,
        "STARBASE_STATION_NAME_FORMAT_NON_PRIMARY"
    );
    assert_eq!(
        starbase.name.keys(),
        ["STARBASE_STATION_NAME_FORMAT_NON_PRIMARY", "NAME_Sol"]
    );
    assert_eq!(
        sol.fleets,
        FleetPresence {
            fleet_count: 6,
            military_count: 0,
            ship_count: 0,
            military_power: 0.0,
        }
    );
    let present: Vec<(u32, &str, Option<u32>, bool, f64)> = sol
        .fleets_present
        .iter()
        .map(|f| {
            (
                f.id,
                f.name_key.as_str(),
                f.owner,
                f.military,
                f.military_power,
            )
        })
        .collect();
    assert_eq!(
        present,
        [
            (0, "shipclass_starbase_name", Some(0), false, 691.60937),
            (369, "shipclass_mining_station_name", Some(0), false, 0.0),
            (370, "shipclass_mining_station_name", Some(0), false, 0.0),
            (371, "shipclass_mining_station_name", Some(0), false, 0.0),
            (372, "shipclass_mining_station_name", Some(0), false, 0.0),
            (373, "shipclass_research_station_name", Some(0), false, 0.0),
        ]
    );
    assert_eq!(
        sol.fleets_present[0].name,
        NameTemplate {
            key: "shipclass_starbase_name".to_owned(),
            literal: false,
            variables: vec![NameVariable {
                name: "PLANET".to_owned(),
                value: NameTemplate::plain("NAME_Sol"),
            }],
        }
    );
    assert!(sol.fleets_present.iter().all(|f| f.ships == 1));
    assert!(sol.megastructures.is_empty() && sol.sites.is_empty());
    let sol_deposits: usize = raw(217).planets.iter().map(|p| p.deposits.len()).sum();
    assert_eq!(sol_deposits, 18);
}

/// Each of Sol's stations works the planet naming it as `shipclass_orbital_station`: the
/// mining station at the star gathers energy, and the research station engineering.
#[test]
fn a_station_works_what_its_planets_deposits_produce() {
    let session = common::warmed();
    let details = session.details().expect("build details");
    let works = |resolver: &dyn DetailsResolver| {
        let sol = details.resolve(217, resolver, false).expect("Sol resolved");
        sol.fleets_present
            .iter()
            .map(|f| (f.id, f.works.join(",")))
            .collect::<Vec<_>>()
    };
    assert_eq!(
        works(&HeuristicResolver),
        [
            (0, String::new()),
            (369, "energy".to_owned()),
            (370, "minerals".to_owned()),
            (371, "energy".to_owned()),
            (372, "minerals".to_owned()),
            (373, "engineering".to_owned()),
        ]
    );
    let star = sgf_core::entity::get_planet_page(session.doc(), 0).expect("Sol's page");
    assert_eq!(star.station, Some(369), "the link the planet page reads");

    /// Every deposit also yields minerals, after what the key names.
    struct AlsoMinerals;
    impl DetailsResolver for AlsoMinerals {
        fn deposit_produces(&self, key: &str) -> Option<Vec<(String, f64)>> {
            let mut produces = HeuristicResolver.deposit_produces(key)?;
            produces.push(("minerals".to_owned(), 1.0));
            Some(produces)
        }
        fn planet_habitable(&self, _class: &str) -> Option<bool> {
            None
        }
    }
    let worked = works(&AlsoMinerals);
    assert_eq!(worked[1], (369, "energy,minerals".to_owned()));
    assert_eq!(worked[2], (370, "minerals".to_owned()));
}

/// Alpha Centauri's red dwarf companion, 327, has two planets: each names it as `moon_of`
/// without the moon bit of `binary_flags`, 512.
#[test]
fn planets_of_a_companion_star_are_not_moons() {
    let session = common::warmed();
    let details = session.details().expect("build details");
    let system = details
        .resolve(278, &HeuristicResolver, false)
        .expect("Alpha Centauri resolved");
    let body = |id: u32| {
        let p = system.planets.iter().find(|p| p.id == id).expect("a body");
        (p.moon, p.parent, p.role)
    };
    assert_eq!(body(328), (false, Some(327), BodyRole::Planet));
    assert_eq!(body(329), (false, Some(327), BodyRole::Planet));
    assert_eq!(body(327).2, BodyRole::Star);
    assert!(body(331).0, "331 is a moon");
    assert_eq!(body(331).2, BodyRole::Moon);
    assert_eq!(system.planets[0].role, BodyRole::Primary);
}

#[test]
fn heuristic_resolver_reads_the_amount_from_the_key() {
    let produces = |key: &str| HeuristicResolver.deposit_produces(key).unwrap();
    assert_eq!(produces("d_energy_3"), [("energy".to_owned(), 3.0)]);
    assert_eq!(
        produces("d_trade_value_2"),
        [("trade_value".to_owned(), 2.0)]
    );
    assert_eq!(HeuristicResolver.deposit_produces("d_veiny_cliffs"), None);
    assert_eq!(HeuristicResolver.planet_habitable("pc_continental"), None);
}

#[test]
fn names_are_templates_with_the_stand_in_as_name_key() {
    let session = common::warmed();
    let country = |id: u32| {
        session
            .graph()
            .countries
            .iter()
            .find(|c| c.id == id)
            .expect("country")
    };
    assert_eq!(
        country(0).name,
        NameTemplate::plain("EMPIRE_DESIGN_humans1")
    );
    assert_eq!(country(0).name_key, "EMPIRE_DESIGN_humans1");
    let valmennax = country(3);
    assert_eq!(valmennax.name.key, "%ADJECTIVE%");
    assert_eq!(
        valmennax.name.keys(),
        ["%ADJECTIVE%", "SPEC_Valmennax", "Consciousness"]
    );
    assert_eq!(valmennax.name_key, "SPEC_Valmennax Consciousness");
    let united = country(1);
    assert_eq!(
        united.name.keys(),
        [
            "%ADJ%",
            "United",
            "%ADJECTIVE%",
            "SPEC_RihiNar",
            "Sovereignty"
        ]
    );
    assert_eq!(united.name_key, "United");
    assert!(
        session
            .graph()
            .countries
            .iter()
            .all(|c| c.name.stand_in() == c.name_key)
    );

    let details = session.details().expect("build details");
    let delta_cephei = details
        .resolve(148, &HeuristicResolver, false)
        .expect("system 148");
    let moon = delta_cephei
        .planets
        .iter()
        .find(|p| p.id == 2061)
        .expect("planet 2061");
    assert!(moon.pre_ftl && moon.moon);
    assert_eq!(moon.name_key, "SUBPLANET_NAME_FORMAT");
    assert_eq!(
        moon.name.keys(),
        [
            "SUBPLANET_NAME_FORMAT",
            "PLANET_NAME_FORMAT",
            "Delta_Cephei"
        ]
    );
    let numeral = &moon.name.variables[1];
    assert_eq!(numeral.name, "NUMERAL");
    assert_eq!(numeral.value.key, "a");
    assert!(numeral.value.literal);
}

#[test]
fn countries_carry_their_flag_layers() {
    let session = common::warmed();
    let humans = session
        .graph()
        .countries
        .iter()
        .find(|c| c.id == 0)
        .expect("country 0");
    assert_eq!(
        humans.flag_icon,
        Some(FlagRef {
            category: "human".to_owned(),
            file: "flag_human_9.dds".to_owned(),
        })
    );
    assert_eq!(
        humans.flag_background,
        Some(FlagRef {
            category: "backgrounds".to_owned(),
            file: "00_solid.dds".to_owned(),
        })
    );
    assert_eq!(humans.colors, ["blue", "black"]);
}

/// Sol (the player's home system), Sirius (a corvette fleet), Barnard's Star (the science
/// ship) and Withrilli (a fallen empire's mixed fleet) as the inspector lists them.
#[test]
fn inspector_facts_of_the_home_systems() {
    let session = common::warmed();
    let details = session.details().expect("build details");
    let mut report = String::new();
    for id in [217, 448, 614, 521] {
        let system = details
            .resolve(id, &HeuristicResolver, false)
            .expect("system resolved");
        writeln!(report, "{}", system_report(&system)).expect("write report");
    }
    common::snapshot("inspector_facts", &report);
}

fn system_report(system: &SystemDetails) -> String {
    let mut out = format!("system {}\n", system.id);
    writeln!(out, "  resources: {}", amounts(&system.resources)).expect("write");
    if let Some(s) = &system.starbase {
        writeln!(
            out,
            "  starbase {} {} owner={:?} shipyard={} modules=[{}] buildings=[{}]",
            s.level,
            s.name_key,
            s.owner,
            s.shipyard,
            s.modules.join(", "),
            s.buildings.join(", "),
        )
        .expect("write");
    }
    for p in system
        .planets
        .iter()
        .filter(|p| p.pops > 0 || !p.deposits.is_empty())
    {
        writeln!(
            out,
            "  planet {} {} {} pops={} deposits: {}",
            p.id,
            p.name_key,
            p.class,
            p.pops,
            amounts(&p.deposits),
        )
        .expect("write");
    }
    for f in &system.fleets_present {
        let sizes: Vec<String> = f
            .ship_sizes
            .iter()
            .map(|s| format!("{} {}", s.key, s.count))
            .collect();
        writeln!(
            out,
            "  fleet {} {} ships={} military={} sizes: {}",
            f.id,
            f.name_key,
            f.ships,
            f.military,
            sizes.join(", "),
        )
        .expect("write");
    }
    out
}

fn amounts(rows: &[ResourceAmount]) -> String {
    if rows.is_empty() {
        return "-".to_owned();
    }
    rows.iter()
        .map(|r| format!("{} {}", r.resource, r.amount))
        .collect::<Vec<_>>()
        .join(", ")
}
