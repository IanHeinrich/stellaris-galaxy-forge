//! Details projection on the real sample save: what it counts across the whole galaxy.
use std::collections::HashMap;

use sgf_core::format::save::details::{
    ArchaeologySite, FleetPresence, FleetSummary, HeuristicResolver, MegastructureSummary,
};
use sgf_core::projections::name::NameTemplate;

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
    let systems = session.graph().systems.keys().map(|&id| raw(id));
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
    assert_eq!(moons, 1827);
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
    let systems = session.graph().systems.keys().map(|&id| raw(id));
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
    let systems = session.graph().systems.keys().map(|&id| raw(id));
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
        .graph()
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
    let systems = session.graph().systems.keys().map(|&id| raw(id));
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
    let systems = session.graph().systems.keys().map(|&id| raw(id));
    let sites: Vec<(u32, &ArchaeologySite)> = session
        .graph()
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
        .graph()
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
