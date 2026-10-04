//! Galaxy projection and validator on the real sample save.
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::LazyLock;

use sgf_core::cst;
use sgf_core::projections::galaxy::{BypassLink, GalaxyGraph};
use sgf_core::validate::{IssueCode, Severity, validate};

use crate::common;
use common::load;

/// The 4.4 sample's galaxy, built once for the tests that only read it.
static GRAPH: LazyLock<GalaxyGraph> =
    LazyLock::new(|| GalaxyGraph::build(&load()).expect("build galaxy"));

#[test]
fn projection_matches_the_measured_facts() {
    let doc = load();
    let g = &*GRAPH;

    assert_eq!(g.systems.len(), 791);
    assert_eq!(g.order.len(), 791);
    assert_eq!(g.order, (0..=790).collect::<Vec<u32>>());

    let directed: usize = g.systems.values().map(|s| s.lanes.len()).sum();
    assert_eq!(directed, 2188);
    let undirected: HashSet<(u32, u32)> = g
        .systems
        .values()
        .flat_map(|s| {
            s.lanes
                .iter()
                .map(move |l| (s.id.min(l.to), s.id.max(l.to)))
        })
        .collect();
    assert_eq!(undirected.len(), 1092);
    let bridges: HashSet<(u32, u32)> = g
        .systems
        .values()
        .flat_map(|s| {
            s.lanes
                .iter()
                .filter(|l| l.bridge)
                .map(move |l| (s.id.min(l.to), s.id.max(l.to)))
        })
        .collect();
    assert_eq!(bridges.len(), 125);

    // Of the two lane-less systems 789 rides the wormhole to 788, so only 790 stands
    // apart.
    let components = g.components();
    assert_eq!(components.len(), 2);
    assert_eq!(g.baseline_components, 2);
    assert_eq!(components[0].len(), 790);
    assert_eq!(&components[1..], [vec![790]]);
    assert!(g.systems[&789].lanes.is_empty());
    assert!(g.systems[&790].lanes.is_empty());
    assert!(
        g.bypasses
            .contains(&BypassLink::Wormhole { a: 788, b: 789 })
    );

    assert!(
        (g.galaxy_radius - 499.9288).abs() < 1e-9,
        "{}",
        g.galaxy_radius
    );
    assert_eq!(g.core_radius, 112.5);
    assert_eq!(g.nebulae.len(), 9);
    assert!(g.nebulae.iter().all(|n| !n.systems.is_empty()));
    for (i, nebula) in g.nebulae.iter().enumerate() {
        for id in &nebula.systems {
            assert_eq!(g.systems[id].nebula, Some(i), "system {id} nebula");
        }
    }

    let zero = &g.systems[&0];
    assert_eq!(zero.name.key, "NAME_Gamma_Refuge");
    assert_eq!((zero.x, zero.y), (-144.22, 57.36));
    assert_eq!(zero.star_class, "sc_m");
    assert_eq!(zero.planet_count, 1);
    let lane = g.lane(0, 752).expect("lane 0 -> 752");
    assert_eq!(lane.length, 33.0);
    assert!(!lane.bridge);
    assert!(g.lane(752, 0).is_some());
    assert!(g.lane(0, 1).is_none());
    // Event-added lanes carry the exact distance as a decimal; a truncating parser fails here.
    assert_eq!(g.lane(788, 760).unwrap().length, 20.70131);
    assert_eq!(g.lane(787, 417).unwrap().length, 14.70166);

    for system in g.systems.values() {
        for lane in &system.lanes {
            let other = &g.systems[&lane.to];
            let expected = (system.x - other.x).hypot(system.y - other.y).floor();
            assert_eq!(
                lane.length.floor(),
                expected,
                "lane {} -> {} length",
                system.id,
                lane.to
            );
        }
    }

    let mut wormholes = 0;
    let mut gateways = 0;
    let mut lgates = 0;
    let mut other = 0;
    for link in &g.bypasses {
        match link {
            BypassLink::Wormhole { a, b } => {
                assert!(g.systems.contains_key(a) && g.systems.contains_key(b));
                wormholes += 1;
            }
            BypassLink::Gateway { system, .. } => {
                assert!(g.systems.contains_key(system));
                gateways += 1;
            }
            BypassLink::LGate { system } => {
                assert!(g.systems.contains_key(system));
                lgates += 1;
            }
            BypassLink::Other { system, kind } => {
                assert!(g.systems.contains_key(system));
                assert_eq!(kind, "shroud_tunnel");
                other += 1;
            }
        }
    }
    assert_eq!((wormholes, gateways, lgates, other), (6, 8, 6, 1));
    let with_bypasses = g
        .systems
        .values()
        .filter(|s| !s.bypass_ids.is_empty())
        .count();
    assert_eq!(with_bypasses, 27);

    let mut flag_counts: HashMap<&str, usize> = HashMap::new();
    let mut empty_initializer = 0;
    for system in g.systems.values() {
        if system.initializer.is_empty() {
            empty_initializer += 1;
        }
        for flag in &system.flags {
            *flag_counts.entry(flag.as_str()).or_default() += 1;
        }
    }
    assert_eq!(
        empty_initializer, 0,
        "every system in the sample names its initializer"
    );
    assert_eq!(flag_counts.get("guardian").copied().unwrap_or(0), 6);
    assert_eq!(flag_counts.get("enclave").copied().unwrap_or(0), 14);
    assert_eq!(flag_counts.get("lgate").copied().unwrap_or(0), 6);
    assert_eq!(
        flag_counts.get("empire_home_system").copied().unwrap_or(0),
        17
    );
    assert_eq!(flag_counts.get("hostile_system").copied().unwrap_or(0), 57);
    assert_eq!(
        flag_counts
            .get("galactic_landmark_system")
            .copied()
            .unwrap_or(0),
        11
    );
    assert_eq!(flag_counts.get("marauder_system").copied().unwrap_or(0), 6);
    assert!(!zero.initializer.is_empty());

    // Cross-check `owner` against the `sectors` section read independently: every system
    // listed under a sector with an `owner` keeps that owner; the marauder systems, which
    // have a null sector, are owned through their starbase.
    let mut sector_owner_of: HashMap<u32, u32> = HashMap::new();
    for entity in doc.index().entities("sectors") {
        let root = cst::parse(entity.stmt.slice(doc.original()), entity.stmt.start).unwrap();
        let Some(node) = root.children().first() else {
            continue;
        };
        let owner = node
            .find("owner", doc.original())
            .and_then(|n| n.scalar_str(doc.original()))
            .and_then(|s| s.parse::<u32>().ok());
        let Some(owner) = owner else {
            continue;
        };
        if let Some(systems) = node.find("systems", doc.original()) {
            for id in systems
                .children()
                .iter()
                .filter(|c| c.key.is_none())
                .filter_map(|c| c.scalar_str(doc.original())?.parse::<u32>().ok())
            {
                sector_owner_of.insert(id, owner);
            }
        }
    }
    for (id, owner) in &sector_owner_of {
        assert_eq!(g.systems[id].owner, Some(*owner), "system {id}");
    }
    let country_type: HashMap<u32, &str> = g
        .countries
        .iter()
        .map(|c| (c.id, c.country_type.as_str()))
        .collect();
    let marauders: HashSet<u32> = g
        .countries
        .iter()
        .filter(|c| c.country_type == "dormant_marauders")
        .map(|c| c.id)
        .collect();
    assert_eq!(marauders.len(), 2, "{marauders:?}");
    for id in [12, 13, 76, 435, 520, 574] {
        let system = &g.systems[&id];
        assert!(system.flags.iter().any(|f| f == "marauder_system"), "{id}");
        assert!(
            system.owner.is_some_and(|o| marauders.contains(&o)),
            "system {id} owner {:?}",
            system.owner
        );
    }
    assert_eq!(g.systems[&217].owner, Some(0), "Sol");
    let owned_systems = g.systems.values().filter(|s| s.owner.is_some()).count();
    let mut by_starbase: BTreeMap<&str, usize> = BTreeMap::new();
    for system in g.systems.values() {
        if sector_owner_of.contains_key(&system.id) {
            continue;
        }
        if let Some(owner) = system.owner {
            *by_starbase.entry(country_type[&owner]).or_default() += 1;
        }
    }
    eprintln!(
        "owned systems: {owned_systems} ({} by sector, {} by starbase only: {by_starbase:?})",
        sector_owner_of.len(),
        owned_systems - sector_owner_of.len()
    );
    assert!(owned_systems > sector_owner_of.len());
    assert!(owned_systems > 50 && owned_systems < 200, "{owned_systems}");

    assert!(g.countries.len() >= 17, "{}", g.countries.len());
    let default_countries = g
        .countries
        .iter()
        .filter(|c| c.country_type == "default")
        .count();
    assert_eq!(default_countries, 17);
    let country_ids: HashSet<u32> = g.countries.iter().map(|c| c.id).collect();
    for system in g.systems.values() {
        if let Some(owner) = system.owner {
            assert!(country_ids.contains(&owner), "owner {owner} unknown");
        }
    }
}

#[test]
fn countries_carry_their_capital_system_and_system_count() {
    let g = &*GRAPH;

    let humans = g.countries.iter().find(|c| c.id == 0).expect("country 0");
    assert_eq!(humans.name_key, "EMPIRE_DESIGN_humans1");
    assert_eq!(humans.capital_system, Some(217), "Earth sits in Sol");
    assert_eq!(humans.system_count, 1, "one sector at 2206.11.16");

    let owned = g.systems.values().filter(|s| s.owner.is_some()).count();
    let counted: u32 = g.countries.iter().map(|c| c.system_count).sum();
    assert_eq!(counted as usize, owned);
    for country in &g.countries {
        let counted = g
            .systems
            .values()
            .filter(|s| s.owner == Some(country.id))
            .count();
        assert_eq!(
            counted as u32, country.system_count,
            "country {}",
            country.id
        );
    }

    // Every capital is a system, and an empire's capital lies in its own space.
    let capitals = g.countries.iter().filter(|c| c.capital_system.is_some());
    assert!(
        capitals.clone().count() >= 17,
        "{}",
        capitals.clone().count()
    );
    for country in capitals {
        let system = &g.systems[&country.capital_system.unwrap()];
        if country.country_type == "default" {
            assert_eq!(system.owner, Some(country.id), "country {}", country.id);
        }
    }

    let summary: Vec<String> = g
        .countries
        .iter()
        .map(|c| {
            format!(
                "{} {} capital {:?} {} systems: {}",
                c.id, c.country_type, c.capital_system, c.system_count, c.name_key
            )
        })
        .collect();
    common::snapshot("countries", &summary.join("\n"));
}

#[test]
fn a_primitive_carries_its_pre_ftl_age_and_an_empire_none() {
    let session = common::open_4_5();
    let age = |id: u32| {
        let country = session.graph().countries.iter().find(|c| c.id == id);
        country.expect("the country").preftl_age.clone()
    };
    assert_eq!(age(36).as_deref(), Some("stone_age"));
    assert_eq!(age(37).as_deref(), Some("atomic_age"));
    assert_eq!(age(0), None);
    let primitives = session
        .graph()
        .countries
        .iter()
        .filter(|c| c.country_type == "primitive");
    for country in primitives {
        assert!(country.preftl_age.is_some(), "country {}", country.id);
    }
}

#[test]
fn sample_validates_to_one_isolated_system_and_the_games_own_duplicate_lanes() {
    let issues = validate(&GRAPH);
    // The game wrote the lanes 154<->708 and 401<->521 twice on both ends, and 789 is the
    // far end of the wormhole from 788, so 790 is the only system nothing reaches.
    let summary: Vec<(Severity, IssueCode, &[u32])> = issues
        .iter()
        .map(|i| (i.severity, i.code, i.systems.as_slice()))
        .collect();
    assert_eq!(
        summary,
        [
            (Severity::Info, IssueCode::LaneDuplicate, &[154u32, 708][..]),
            (Severity::Info, IssueCode::LaneDuplicate, &[401, 521]),
            (Severity::Warning, IssueCode::SystemIsolated, &[790]),
        ],
        "{issues:#?}"
    );
    for issue in &issues {
        for id in &issue.systems {
            assert!(issue.message.contains(&id.to_string()), "{}", issue.message);
        }
    }
    assert!(issues.iter().all(|i| i.code != IssueCode::LaneAsymmetric));
}

/// Hyper Relays in Sol and its neighbour 471, written as a late game writes them: each a
/// `relay_bypass` row its system lists. The map reads both ends' links to draw the lane
/// between them thicker.
#[test]
fn a_hyper_relay_projects_as_a_relay_bypass_on_its_system() {
    let session = common::open_edited(|gamestate| {
        let systems = gamestate.find("\ngalactic_object=").expect("the systems");
        for (system, bypass) in [(471, 27), (217, 28)] {
            let entry = format!("\n\t{system}=\n\t{{\n");
            let at = systems + gamestate[systems..].find(&entry).expect("the system") + entry.len();
            gamestate.insert_str(
                at,
                &format!("\t\tbypasses=\n\t\t{{\n\t\t\t{bypass} \n\t\t}}\n"),
            );
        }
        let table = gamestate.find("\nbypasses=\n{\n").expect("the bypasses");
        let end = table + gamestate[table..].find("\n}\n").expect("the table's end") + 1;
        for (bypass, other) in [(27, 28), (28, 27)] {
            gamestate.insert_str(
                end,
                &format!(
                    "\t{bypass}=\n\t{{\n\t\ttype=\"relay_bypass\"\n\t\tactive=yes\n\t\tconnections=\n\t\t{{\n\t\t\t{other} \n\t\t}}\n\t}}\n"
                ),
            );
        }
    });
    let relays: Vec<u32> = session
        .graph()
        .bypasses
        .iter()
        .filter_map(|link| match link {
            BypassLink::Other { system, kind } if kind == "relay_bypass" => Some(*system),
            _ => None,
        })
        .collect();
    assert_eq!(relays, [217, 471]);
    assert!(session.graph().lane(217, 471).is_some());
}
