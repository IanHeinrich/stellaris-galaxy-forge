//! Galaxy projection and validator on the real sample save.
use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Instant;

use sgf_core::cst;
use sgf_core::projections::galaxy::{BypassLink, GalaxyGraph, Lane};
use sgf_core::validate::{IssueCode, Severity, validate};

use crate::common;
use common::load;

#[test]
fn projection_matches_the_measured_facts() {
    let doc = load();
    let started = Instant::now();
    let g = GalaxyGraph::build(&doc).expect("build galaxy");
    eprintln!("galaxy projection built in {:?}", started.elapsed());

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
    let doc = load();
    let g = GalaxyGraph::build(&doc).expect("build galaxy");

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
fn sample_validates_to_one_isolated_system_and_the_games_own_duplicate_lanes() {
    let doc = load();
    let g = GalaxyGraph::build(&doc).unwrap();
    let issues = validate(&g);
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

#[test]
fn refresh_system_reproduces_the_loaded_node() {
    let doc = load();
    let mut g = GalaxyGraph::build(&doc).unwrap();
    let before = g.systems[&0].clone();
    let entity = doc.index().entity("galactic_object", 0).unwrap();
    let node = cst::parse(entity.stmt.slice(doc.original()), entity.stmt.start).unwrap();
    g.refresh_system(0, &node, doc.original()).unwrap();
    assert_eq!(g.systems[&0], before);
    assert_eq!(g.order.len(), 791);
}

#[test]
fn refresh_system_picks_up_edited_text() {
    let doc = load();
    let mut g = GalaxyGraph::build(&doc).unwrap();
    let before = g.systems[&0].clone();
    let entity = doc.index().entity("galactic_object", 0).unwrap();
    let text = String::from_utf8(entity.stmt.slice(doc.original()).to_vec()).unwrap();
    assert_eq!(text.matches("x=-144.22").count(), 1);
    let lane_752 = "			{
				to=752
				length=33
			}
 
";
    assert_eq!(text.matches(lane_752).count(), 1);
    let edited = text.replace("x=-144.22", "x=-150").replace(lane_752, "");

    let node = cst::parse(edited.as_bytes(), 0).unwrap();
    g.refresh_system(0, &node, edited.as_bytes()).unwrap();
    let after = &g.systems[&0];
    assert_eq!(after.x, -150.0);
    assert_eq!(after.y, before.y);
    assert_eq!(after.lanes.len(), before.lanes.len() - 1);
    assert!(g.lane(0, 752).is_none());
    assert!(g.lane(0, 200).is_some());
    assert_eq!(after.nebula, before.nebula);
    assert_eq!(after.name, before.name);
    assert_eq!(g.order.len(), 791);
}

#[test]
fn validator_reports_every_rule_on_a_mutated_graph() {
    let doc = load();
    let mut g = GalaxyGraph::build(&doc).unwrap();

    // 752 still lists 0, but 0 no longer lists 752.
    g.systems.get_mut(&0).unwrap().lanes.retain(|l| l.to != 752);
    g.systems.get_mut(&1).unwrap().lanes.push(Lane {
        to: 1,
        length: 0.0,
        bridge: false,
        stale: false,
    });
    g.systems.get_mut(&3).unwrap().lanes.push(Lane {
        to: 9999,
        length: 1.0,
        bridge: false,
        stale: false,
    });
    g.systems.get_mut(&2).unwrap().x = 600.0;
    // Cut system 5 out of the graph on both ends of each of its lanes.
    let neighbours: Vec<u32> = g.systems[&5].lanes.iter().map(|l| l.to).collect();
    for n in neighbours {
        g.systems.get_mut(&n).unwrap().lanes.retain(|l| l.to != 5);
    }
    g.systems.get_mut(&5).unwrap().lanes.clear();
    // 108 stays listed in the first nebula but sits far from it; 455 sits at that
    // nebula's centre without being listed anywhere.
    let member = g.systems.get_mut(&108).unwrap();
    (member.x, member.y) = (200.0, -50.0);
    let (cx, cy) = (g.nebulae[0].x, g.nebulae[0].y);
    let stray = g.systems.get_mut(&455).unwrap();
    (stray.x, stray.y) = (cx, cy);

    let issues = validate(&g);
    let summary: Vec<(Severity, IssueCode, &[u32])> = issues
        .iter()
        .map(|i| (i.severity, i.code, i.systems.as_slice()))
        .collect();
    assert_eq!(
        summary,
        [
            (Severity::Error, IssueCode::LaneAsymmetric, &[752u32, 0][..]),
            (Severity::Error, IssueCode::LaneEndpointMissing, &[3, 9999]),
            (Severity::Error, IssueCode::LaneSelf, &[1]),
            (Severity::Info, IssueCode::LaneDuplicate, &[154, 708]),
            (Severity::Info, IssueCode::LaneDuplicate, &[401, 521]),
            (Severity::Warning, IssueCode::SystemIsolated, &[5]),
            (Severity::Warning, IssueCode::SystemIsolated, &[790]),
            (Severity::Warning, IssueCode::OutOfBounds, &[2]),
            (Severity::Warning, IssueCode::Disconnected, &[5]),
            (Severity::Warning, IssueCode::NebulaMembership, &[108]),
            (Severity::Warning, IssueCode::NebulaMembership, &[455]),
        ],
        "{issues:#?}"
    );
    let disconnected = issues
        .iter()
        .find(|i| i.code == IssueCode::Disconnected)
        .unwrap();
    assert!(
        disconnected.message.ends_with("newly separated: 5"),
        "{}",
        disconnected.message
    );
    let membership: Vec<&str> = issues
        .iter()
        .filter(|i| i.code == IssueCode::NebulaMembership)
        .map(|i| i.message.as_str())
        .collect();
    assert_eq!(
        membership,
        [
            "system 108 (Ascensions End) is listed in nebula Phantom Streak Miasma but lies 159.56 from its centre, beyond its radius 30",
            "system 455 (Mihil) lies 0.00 from the centre of nebula Phantom Streak Miasma (radius 30) but no nebula lists it",
        ]
    );
}

#[test]
fn a_lane_less_wormhole_end_is_not_reported_isolated() {
    let doc = load();
    let mut g = GalaxyGraph::build(&doc).unwrap();
    for (a, b) in [(788u32, 789u32), (52, 449)] {
        assert!(g.bypasses.contains(&BypassLink::Wormhole { a, b }));
    }
    let neighbours: Vec<u32> = g.systems[&52].lanes.iter().map(|l| l.to).collect();
    for n in neighbours {
        g.systems.get_mut(&n).unwrap().lanes.retain(|l| l.to != 52);
    }
    g.systems.get_mut(&52).unwrap().lanes.clear();

    let isolated: Vec<u32> = validate(&g)
        .iter()
        .filter(|i| i.code == IssueCode::SystemIsolated)
        .flat_map(|i| i.systems.clone())
        .collect();
    assert_eq!(isolated, [790]);
}

#[test]
fn a_lane_less_l_gate_system_is_reported_as_a_note() {
    let doc = load();
    let mut g = GalaxyGraph::build(&doc).unwrap();
    assert!(g.bypasses.contains(&BypassLink::LGate { system: 208 }));
    let neighbours: Vec<u32> = g.systems[&208].lanes.iter().map(|l| l.to).collect();
    for n in neighbours {
        g.systems.get_mut(&n).unwrap().lanes.retain(|l| l.to != 208);
    }
    g.systems.get_mut(&208).unwrap().lanes.clear();

    let issue = validate(&g)
        .into_iter()
        .find(|i| i.code == IssueCode::SystemIsolated && i.systems == [208])
        .expect("208 is still reported");
    assert_eq!(issue.severity, Severity::Info);
    assert!(issue.message.contains("L-Gate"), "{}", issue.message);
}
