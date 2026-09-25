//! Details projection on the real sample save.
use std::collections::HashMap;
use std::fmt::Write as _;

use sgf_core::format::save::details::{
    ArchaeologySite, DepositCount, DetailsResolver, FleetPresence, FleetSummary, HeuristicResolver,
    MegastructureSummary, ResourceAmount, SystemDetails,
};
use sgf_core::projections::galaxy::FlagRef;
use sgf_core::projections::name::{NameTemplate, NameVariable};

use crate::common;

#[test]
fn the_projection_is_built_once_and_covers_every_system() {
    let session = common::warmed();
    let details = session.details().expect("build details");
    assert!(std::sync::Arc::ptr_eq(
        &details,
        &session.details().unwrap()
    ));
    assert_eq!(details.len(), 791);
    assert!(details.resolve(9999, &HeuristicResolver, true).is_none());
    assert!(details.raw(9999).is_none());
}

#[test]
fn planets_are_counted_colonised_populated_and_owned() {
    let session = common::warmed();
    let details = session.details().expect("build details");
    let raw = |id: u32| details.raw(id).expect("system in projection");
    let systems = session.graph.systems.keys().map(|&id| raw(id));
    let planets: usize = systems.clone().map(|s| s.planets.len()).sum();
    assert_eq!(planets, 8403);
    let colonised = systems
        .clone()
        .flat_map(|s| &s.planets)
        .filter(|p| p.colonised)
        .count();
    assert_eq!(colonised, 42);
    let capitals = systems
        .clone()
        .flat_map(|s| &s.planets)
        .filter(|p| p.capital)
        .count();
    assert_eq!(capitals, 23);
    assert!(
        systems
            .clone()
            .flat_map(|s| &s.planets)
            .all(|p| p.owner.is_some() == p.colonised)
    );
    let moons = systems
        .clone()
        .flat_map(|s| &s.planets)
        .filter(|p| p.moon)
        .count();
    assert_eq!(moons, 2027);
    // 4.x keeps pops in `colony`, so exactly the colonised planets have any.
    let populated = systems
        .clone()
        .flat_map(|s| &s.planets)
        .filter(|p| p.pops > 0);
    assert_eq!(populated.clone().count(), 42);
    assert!(populated.clone().all(|p| p.colonised));
    assert_eq!(populated.map(|p| u64::from(p.pops)).sum::<u64>(), 175_298);
}

#[test]
fn starbases_carry_their_level_modules_and_hull() {
    let session = common::warmed();
    let details = session.details().expect("build details");
    let raw = |id: u32| details.raw(id).expect("system in projection");
    let systems = session.graph.systems.keys().map(|&id| raw(id));
    let mut levels: HashMap<&str, usize> = HashMap::new();
    for starbase in systems.clone().flat_map(|s| &s.starbases) {
        *levels.entry(starbase.level.as_str()).or_default() += 1;
    }
    // 128 starbases exist, but the 12 voidworm nests and 3 enclave stations sit on no
    // system's `starbases` list; the projection follows the list.
    assert_eq!(levels.values().sum::<usize>(), 113);
    let mut levels: Vec<_> = levels.into_iter().collect();
    levels.sort_unstable();
    assert_eq!(
        levels,
        [
            ("starbase_level_caravaneer", 1),
            ("starbase_level_citadel", 12),
            ("starbase_level_deep_space_citadel_3", 6),
            ("starbase_level_marauder", 6),
            ("starbase_level_outpost", 67),
            ("starbase_level_starport", 21),
        ]
    );
    let primary = systems.clone().filter(|s| !s.starbases.is_empty()).count();
    assert_eq!(primary, 107);
    let secondary = systems
        .clone()
        .flat_map(|s| s.starbases.iter().skip(1))
        .filter(|s| s.level == "starbase_level_deep_space_citadel_3")
        .count();
    assert_eq!(secondary, 6);
    let shipyards = systems
        .clone()
        .flat_map(|s| &s.starbases)
        .filter(|s| s.modules.iter().any(|m| m == "shipyard"))
        .count();
    assert_eq!(shipyards, 28);
    assert!(
        systems
            .clone()
            .flat_map(|s| &s.starbases)
            .all(|s| !s.name_key.is_empty())
    );

    // A starbase shows the hull of its station ship, which is the only place the save
    // keeps it.
    let hulls = systems.clone().flat_map(|s| &s.starbases);
    assert!(hulls.clone().all(|s| s.max_hull > 0.0));
    assert!(hulls.clone().all(|s| s.hull <= s.max_hull));
}

#[test]
fn fleets_carry_their_ships_orders_owner_and_power() {
    let session = common::warmed();
    let details = session.details().expect("build details");
    let raw = |id: u32| details.raw(id).expect("system in projection");
    let systems = session.graph.systems.keys().map(|&id| raw(id));
    let with_fleets = systems.clone().filter(|s| !s.fleets.is_empty()).count();
    assert_eq!(with_fleets, 230);
    let military = systems
        .clone()
        .flat_map(|s| &s.fleets)
        .filter(|f| f.military);
    assert_eq!(military.clone().count(), 178);
    let with_military = systems
        .clone()
        .filter(|s| s.fleets.iter().any(|f| f.military))
        .count();
    assert_eq!(with_military, 94);
    let power: f64 = military.clone().map(|f| f.military_power).sum();
    eprintln!("military power over the whole save: {power}");
    assert!(power > 0.0);
    assert!(military.clone().all(|f| f.owner.is_some()));
    // Every ship resolves a size, so the counted sizes account for the whole fleet.
    let counted = |f: &FleetSummary| f.ship_sizes.iter().map(|s| s.count).sum::<u32>();
    assert!(
        systems
            .clone()
            .flat_map(|s| &s.fleets)
            .all(|f| counted(f) == f.ships)
    );
    let strongest = session
        .graph
        .systems
        .keys()
        .map(|&id| (id, details.resolve(id, &HeuristicResolver, false).unwrap()))
        .max_by(|a, b| {
            a.1.fleets
                .military_power
                .total_cmp(&b.1.fleets.military_power)
        })
        .expect("a system");
    assert_eq!(strongest.0, 521, "Withrilli");
    let withrilli = strongest.1;
    assert_eq!(
        withrilli.fleets,
        FleetPresence {
            fleet_count: 14,
            military_count: 2,
            ship_count: 26,
            military_power: 549699.03125,
        }
    );
    assert_eq!(withrilli.fleets_present.len(), 14);
    assert!(
        withrilli
            .fleets_present
            .iter()
            .all(|f| f.owner == Some(16777230))
    );
    let voidfarers = withrilli
        .fleets_present
        .iter()
        .find(|f| f.id == 58)
        .expect("fleet 58");
    assert!(voidfarers.military);
    assert_eq!(voidfarers.military_power, 549699.03125);
    assert_eq!(voidfarers.ships, 25);
    assert_eq!(voidfarers.name_key, "MOL3_FLEET_ImbhsVoidfarers");
    assert_eq!(
        voidfarers.name,
        NameTemplate::plain("MOL3_FLEET_ImbhsVoidfarers")
    );
    // The fallen empire keeps a colossus here: military, one ship, no power, a planet-killer slot.
    let colossus = withrilli
        .fleets_present
        .iter()
        .find(|f| f.id == 59)
        .expect("fleet 59");
    assert!(colossus.military && colossus.military_power == 0.0 && colossus.planet_killer);
    assert_eq!(colossus.disabled_ships, 0);
    assert_eq!(
        withrilli
            .fleets_present
            .iter()
            .filter(|f| f.planet_killer)
            .count(),
        1
    );
    let starbase_fleet = &withrilli.fleets_present[0];
    assert!(
        !starbase_fleet.military,
        "a starbase is not a military fleet"
    );
    assert_eq!(starbase_fleet.military_power, 285834.52343);

    // The order is what the fleet is doing; a fleet sitting still has none.
    let ordered = systems
        .clone()
        .flat_map(|s| &s.fleets)
        .filter(|f| f.order.is_some());
    assert_eq!(ordered.clone().count(), 199);
    let mut orders: Vec<&str> = ordered.map(|f| f.order.as_deref().unwrap()).collect();
    orders.sort_unstable();
    orders.dedup();
    assert_eq!(
        orders,
        [
            "aggressive_stance_fleet_order",
            "build_orbital_station_order",
            "colonize_planet_order",
            "follow_order",
            "move_to_system_point_order",
            "orbit_planet_order",
            "research_anomaly_order",
            "return_fleet_order",
            "survey_planet_order",
        ]
    );
    let colonising = raw(537)
        .fleets
        .iter()
        .find(|f| f.id == 801)
        .expect("fleet 801");
    assert_eq!(colonising.order.as_deref(), Some("colonize_planet_order"));
}

#[test]
fn megastructures_name_their_kind_owner_and_orbit() {
    let session = common::warmed();
    let details = session.details().expect("build details");
    let raw = |id: u32| details.raw(id).expect("system in projection");
    let systems = session.graph.systems.keys().map(|&id| raw(id));
    let megastructures: Vec<&MegastructureSummary> =
        systems.clone().flat_map(|s| &s.megastructures).collect();
    assert_eq!(megastructures.len(), 25);
    let mut kinds: HashMap<&str, usize> = HashMap::new();
    for m in &megastructures {
        *kinds.entry(m.kind.as_str()).or_default() += 1;
    }
    let mut kinds: Vec<_> = kinds.into_iter().collect();
    kinds.sort_unstable();
    assert_eq!(
        kinds,
        [
            ("gateway_ruined", 8),
            ("interstellar_assembly_ruined", 1),
            ("lgate_base", 6),
            ("orbital_ring_ruined", 1),
            ("ring_world_ruined", 9),
        ]
    );
    assert_eq!(
        megastructures.iter().filter(|m| m.owner.is_none()).count(),
        16
    );
    assert_eq!(
        raw(311).megastructures,
        [MegastructureSummary {
            id: 1,
            kind: "ring_world_ruined".to_owned(),
            owner: Some(16777227),
            planet: None,
        }]
    );
    assert_eq!(raw(672).megastructures.len(), 3);
    // Only the two that sit in a planet's orbit name one; a ring world or a gateway
    // orbits the system itself.
    let mut orbiting: Vec<(&str, u32)> = megastructures
        .iter()
        .filter_map(|m| Some((m.kind.as_str(), m.planet?)))
        .collect();
    orbiting.sort_unstable();
    assert_eq!(
        orbiting,
        [
            ("interstellar_assembly_ruined", 829),
            ("orbital_ring_ruined", 1117),
        ]
    );
}

#[test]
fn sites_and_pre_ftl_planets_are_where_the_save_puts_them() {
    let session = common::warmed();
    let details = session.details().expect("build details");
    let raw = |id: u32| details.raw(id).expect("system in projection");
    let systems = session.graph.systems.keys().map(|&id| raw(id));
    let sites: Vec<(u32, &ArchaeologySite)> = session
        .graph
        .order
        .iter()
        .flat_map(|&id| raw(id).sites.iter().map(move |s| (id, s)))
        .collect();
    assert_eq!(sites.len(), 5);
    assert_eq!(
        sites[0],
        (
            29,
            &ArchaeologySite {
                id: 0,
                kind: "site_tiyanki_graveyard".to_owned(),
                planet: 1023,
            }
        )
    );
    assert_eq!(
        sites[4],
        (
            790,
            &ArchaeologySite {
                id: 4,
                kind: "site_ancient_robot_world".to_owned(),
                planet: 8311,
            }
        )
    );

    let pre_ftl: Vec<(u32, u32, Option<u32>)> = session
        .graph
        .order
        .iter()
        .flat_map(|&id| {
            raw(id)
                .planets
                .iter()
                .filter(|p| p.pre_ftl)
                .map(move |p| (id, p.id, p.owner))
        })
        .collect();
    assert_eq!(
        pre_ftl,
        [
            (78, 1415, Some(37)),
            (128, 1873, Some(41)),
            (148, 2061, Some(43))
        ]
    );
    assert!(
        systems
            .clone()
            .flat_map(|s| &s.planets)
            .all(|p| !p.pre_ftl || p.colonised)
    );
}

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
    let resources: Vec<(&str, f64)> = sol
        .resources
        .iter()
        .map(|ResourceAmount { resource, amount }| (resource.as_str(), *amount))
        .collect();
    assert_eq!(
        resources,
        [("energy", 13.0), ("minerals", 13.0), ("engineering", 5.0)]
    );
    assert_eq!(sol.planets.len(), 24);
    let earth = sol.planets.iter().find(|p| p.id == 3).expect("Earth");
    assert_eq!(earth.name_key, "NAME_Earth");
    assert_eq!(earth.name, NameTemplate::plain("NAME_Earth"));
    assert_eq!(earth.class, "pc_continental");
    assert!(earth.colonised && earth.capital && !earth.moon && !earth.pre_ftl);
    assert_eq!(earth.owner, Some(0));
    assert_eq!(earth.habitable, None);
    assert_eq!(earth.size, Some(18));
    let page = sgf_core::entity::get_planet_page(&session.doc, 3).expect("Earth's page");
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
    assert_eq!(starbase.level, "starbase_level_starport");
    assert_eq!(starbase.owner, Some(0));
    assert_eq!((starbase.hull, starbase.max_hull), (10000.0, 10000.0));
    assert_eq!(
        starbase.name_key,
        "STARBASE_STATION_NAME_FORMAT_NON_PRIMARY"
    );
    assert_eq!(
        starbase.name.keys(),
        ["STARBASE_STATION_NAME_FORMAT_NON_PRIMARY", "NAME_Sol"]
    );
    assert_eq!(starbase.modules, ["shipyard", "solar_panel_network"]);
    assert_eq!(starbase.buildings, ["crew_quarters"]);
    assert!(starbase.shipyard);
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
            .graph
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
            .graph
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
        .graph
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
