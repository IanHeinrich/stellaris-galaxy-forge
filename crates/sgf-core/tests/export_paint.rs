//! The Paint a Galaxy export profile on the sample save: the committed fixture, the seats
//! it writes on the capitals and their neighbours, the fallen empires it places and the
//! wormholes it flags.
use std::collections::BTreeSet;

use sgf_core::VERSION;
use sgf_core::export::{self, DroppedBypasses, ScenarioProfile};
use sgf_core::format::scenario::FeLinkFlags;
use sgf_core::format::scenario::fe_zone::{self, FeKind};
use sgf_core::format::scenario::header_counts::{SeatCounts, seat_counts};
use sgf_core::ops::rules::fe_zone as placement;
use sgf_core::projections::galaxy::{BypassLink, Galaxy, PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;
use sgf_core::validate::{IssueCode, Severity};

use crate::common;
use common::export::{
    NAME, SAVE_FILE, at_fixture_version, default_capitals, exported_as, find, no_names, no_sources,
    seated,
};
use common::fixture::{EXPORTED_PAINT, from_scenario_text};
use common::paint::{assert_paint_export_holds_together, left_out};

/// The systems within `jumps` lanes of any of `from`, `from` included.
fn within(galaxy: &Galaxy, from: &BTreeSet<u32>, jumps: usize) -> BTreeSet<u32> {
    let mut reached = from.clone();
    let mut frontier = from.clone();
    for _ in 0..jumps {
        let mut next = BTreeSet::new();
        for id in &frontier {
            for lane in &galaxy.systems[id].lanes {
                if reached.insert(lane.to) {
                    next.insert(lane.to);
                }
            }
        }
        frontier = next;
    }
    reached
}

/// The sample save with system `id`'s initializer blanked, since the save itself
/// names one on every system.
fn sample_without_initializer(id: u32) -> Session {
    common::open_edited(|bytes| {
        let section = find(
            bytes,
            0,
            "
galactic_object=",
        );
        let entity = find(
            bytes,
            section,
            &format!(
                "
	{id}=
	{{"
            ),
        );
        let start = find(bytes, entity, "initializer=\"") + "initializer=\"".len();
        let end = find(bytes, start, "\"");
        bytes.drain(start..end);
    })
}

/// The sample's fallen empires: country id, capital, and the kind the mod's table gives
/// the capital's initializer.
fn sample_fallen_empires(save: &Session) -> Vec<(u32, u32, FeKind)> {
    let mut fallen: Vec<(u32, u32, FeKind)> = save
        .graph
        .countries
        .iter()
        .filter(|c| c.country_type == "fallen_empire")
        .map(|c| {
            let capital = c.capital_system.expect("a fallen empire's capital");
            let kind = match save.graph.systems[&capital].initializer.as_str() {
                "fallen_1" => FeKind::Materialist,
                "fallen_2" => FeKind::Spiritualist,
                "fallen_machine" => FeKind::Machine,
                other => panic!("{other}"),
            };
            (c.id, capital, kind)
        })
        .collect();
    fallen.sort_unstable_by_key(|f| f.0);
    fallen
}

#[test]
fn the_paint_a_galaxy_export_of_the_sample_matches_its_fixture_and_holds_together() {
    let save = common::open();
    let committed = EXPORTED_PAINT.bytes();
    let (text, report) = exported_as(&save, NAME, ScenarioProfile::PaintAGalaxy);
    assert_eq!(
        at_fixture_version(&text),
        committed,
        "the fixture is generated: re-export it with `sgf export-scenario --profile paint-a-galaxy` and write its version as 0.0.0"
    );
    let text = String::from_utf8(text).expect("utf-8");
    assert!(
        text.starts_with(&format!(
            "#\u{200B} created by Stellaris Galaxy Forge {VERSION} (converted from save 2206.11.16.sav)
# Systems: 765 · Empire seats: 17 · Nebulae: 9
# Written by Stellaris Galaxy Forge for the Paint a Galaxy mod (Steam Workshop 3532904115), which this map requires.
static_galaxy_scenario = {{
	name = \"2206.11.16\"
	priority = 10
	supports_shape = elliptical
"
        )),
        "{}",
        &text[..300]
    );
    assert!(
        text.contains(
            "	num_wormhole_pairs = { min = 0 max = 5 }
	num_wormhole_pairs_default = 1
	num_gateways = { min = 0 max = 5 }
	num_gateways_default = 1
	num_hyperlanes = { min = 0.5 max = 3 }
	num_hyperlanes_default = 0.75
	colonizable_planet_odds = 0.25
	primitive_odds = 0.25
	fallen_empire_max = 3
	marauder_empire_max = 2
"
        ),
        "{}",
        &text[..1200]
    );
    assert!(
        text.contains(
            "	num_empires = { min = 0 max = 16 }
	num_empire_default = 13
	advanced_empire_default = 0
	nomad_empire_default = 2
	nomad_empire_max = 16
	fallen_empire_default = 3
	marauder_empire_default = 2
	crisis_strength = 1.0
	core_radius = 112.5
"
        ),
        "{}",
        &text[..1200]
    );
    assert!(report.setup_from_save);
    assert_eq!(report.omitted, []);

    let fallen = sample_fallen_empires(&save);
    assert_eq!(
        fallen.iter().map(|f| f.2).collect::<Vec<_>>(),
        [FeKind::Machine, FeKind::Materialist, FeKind::Spiritualist]
    );
    let max_id = *save.graph.systems.keys().max().unwrap();
    assert_eq!(max_id, 790);
    let anchors: Vec<u32> = (1..=3).map(|i| max_id + i).collect();
    assert_eq!(report.fallen_empires.len(), 3);
    for (i, ((country, capital, kind), fe)) in fallen.iter().zip(&report.fallen_empires).enumerate()
    {
        assert_eq!(fe.kind, *kind, "{country}");
        assert_eq!(fe.anchor, Some(anchors[i]), "{country}");
        assert!(fe.exact, "{country}");
        let named = save.graph.countries.iter().find(|c| c.id == *country);
        assert_eq!(fe.name, named.unwrap().name_key, "{capital}");
    }
    assert_eq!(
        report
            .fallen_empires
            .iter()
            .map(|f| f.systems_left_out)
            .collect::<Vec<_>>(),
        [11, 5, 13]
    );

    let reopened = from_scenario_text(&text);
    let galaxy: &Galaxy = &reopened.graph;
    let typed = assert_paint_export_holds_together(&save.graph, &reopened.graph, &report);
    assert_eq!(typed.keys().copied().collect::<Vec<_>>(), anchors);
    let missing = left_out(&save.graph, galaxy);
    for (country, capital, _) in &fallen {
        assert!(missing.contains(capital), "{country}: {capital} is written");
        for system in save.graph.systems.values() {
            if system.owner == Some(*country) {
                assert!(missing.contains(&system.id), "{country} owns {}", system.id);
            }
        }
    }
    let mut kept_order: Vec<u32> = save
        .graph
        .order
        .iter()
        .filter(|id| !missing.contains(id))
        .copied()
        .collect();
    kept_order.extend(&anchors);
    assert_eq!(galaxy.order, kept_order);
    for (anchor, (_, capital, _)) in anchors.iter().zip(&fallen) {
        let system = &galaxy.systems[anchor];
        assert_eq!(system.initializer, "painted_galaxy_rl_basic");
        assert_eq!(system.name.key, "");
        assert_eq!(system.lanes.len(), 1, "{anchor}: {:?}", system.lanes);
        assert_eq!(system.spawn_script, None);
        let (effect, _) = reopened.scenario_system_effect(*anchor).expect("flags");
        assert!(
            effect.contains("{ set_star_flag = painted_galaxy_automatic_initializer set_star_flag = painted_galaxy_fe_spawn "),
            "{anchor}: {effect}"
        );
        assert!(
            effect.ends_with(&format!(
                "set_star_flag = painted_galaxy_fe_spawn_preferred set_star_flag = painted_galaxy_fe_custom_connections set_star_flag = painted_galaxy_fe_custom_connection_id_{} }}",
                anchor - anchors[0]
            )),
            "{anchor}: {effect}"
        );
        let zone = &typed[anchor];
        assert_eq!(zone.distance, 40);
        let centre = fe_zone::centre((system.x, system.y), zone);
        let old = &save.graph.systems[capital];
        let off = (centre.0 - old.x).hypot(centre.1 - old.y);
        assert!(off < 0.01, "{anchor}: {centre:?} is {off} from {capital}");
    }

    // Each zone takes the custom connections of the kept systems that had a lane into
    // the cluster it replaces and stand within the mod's reach of the ring, under the
    // ids 0, 1 and 2, and no other system links.
    assert_eq!(
        report
            .fallen_empires
            .iter()
            .map(|f| f.links)
            .collect::<Vec<_>>(),
        [6, 7, 12]
    );
    for (i, (anchor, fe)) in anchors.iter().zip(&report.fallen_empires).enumerate() {
        let link = &galaxy.systems[anchor].fe_link;
        assert_eq!(
            *link,
            FeLinkFlags {
                custom: true,
                id: Some(i as u8),
                to: Vec::new(),
            },
            "{anchor}"
        );
        let linked: Vec<u32> = galaxy
            .order
            .iter()
            .filter(|id| galaxy.systems[id].fe_link.to.contains(&(i as u8)))
            .copied()
            .collect();
        assert_eq!(linked.len() as u32, fe.links, "{anchor}: {linked:?}");
        assert!(!linked.is_empty(), "{anchor}");
    }
    for system in galaxy.systems.values() {
        assert_eq!(
            system.fe_link.custom,
            anchors.contains(&system.id),
            "{}",
            system.id
        );
        for n in &system.fe_link.to {
            assert!(usize::from(*n) < anchors.len(), "{}: {n}", system.id);
            let old = &save.graph.systems[&system.id];
            assert!(
                old.lanes.iter().any(|lane| missing.contains(&lane.to)),
                "{} links to {n} but had no lane into a cluster",
                system.id
            );
            let anchor = &galaxy.systems[&anchors[usize::from(*n)]];
            let centre = fe_zone::centre((anchor.x, anchor.y), &typed[&anchor.id]);
            let reach = (system.x - centre.0).hypot(system.y - centre.1);
            assert!(reach <= 100.0, "{} links to {n} from {reach}", system.id);
        }
    }

    let player = save
        .graph
        .countries
        .iter()
        .find(|c| c.id == 0)
        .and_then(|c| c.capital_system)
        .expect("the capital of country 0");
    assert_eq!(save.graph.player_country, Some(0));
    assert_eq!(report.player_seat, Some(player));
    assert_eq!(report.player_seat_kind, Some(PaintSpawnKind::Sol));
    assert_eq!(player, 217);
    // The player is the United Nations of Earth, so its capital is the Sol seat, which
    // only the UNE weighs above zero.
    assert!(
        save.graph
            .countries
            .iter()
            .find(|c| c.id == 0)
            .expect("country 0")
            .flags
            .iter()
            .any(|flag| flag == "human_1")
    );
    assert_eq!(
        galaxy.systems[&player].spawn_script,
        Some(SpawnScript::PaintAGalaxy {
            kind: PaintSpawnKind::Sol,
            random_value: 0,
            player: true,
        })
    );
    // The game seated the UNE elsewhere while its seat named the Sol initializer, the
    // UNE's own, so the seat gets a generic start and the empire brings its home.
    assert_eq!(galaxy.systems[&player].initializer, "random_empire_init_02");
    assert!(
        text.contains(
            "	system = { id = \"217\" name = \"NAME_Sol\" position = { x = 397.39 y = -180.25 } initializer = random_empire_init_02 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|SOL|yes|RANDOM_MODULO|1|RANDOM_VALUE|0| modifier = { add = 100000 has_country_flag = human_1 } } }
"
        ),
        "{text}"
    );
    assert_eq!(text.matches("modifier = {").count(), 1);
    // The Sol seat is the one reserved seat and the player's, so the player is set
    // aside once: 16 of the 17 seats are open, and the setup's 13 empires stand.
    let seats = seat_counts(galaxy);
    assert_eq!(
        seats,
        SeatCounts {
            seats: 17,
            reserved: 1,
            player_on_reserved: true,
        }
    );
    assert_eq!(seats.safe(), 16);
    let players: Vec<u32> = galaxy
        .systems
        .values()
        .filter(|s| {
            matches!(
                s.spawn_script,
                Some(SpawnScript::PaintAGalaxy {
                    kind: PaintSpawnKind::Sol,
                    player: true,
                    ..
                })
            )
        })
        .map(|s| s.id)
        .collect();
    assert_eq!(players, [player]);
    let others = galaxy
        .systems
        .values()
        .filter(|s| {
            matches!(
                s.spawn_script,
                Some(SpawnScript::PaintAGalaxy {
                    kind: PaintSpawnKind::Enabled,
                    player: false,
                    ..
                })
            )
        })
        .count();
    assert_eq!(others, 16);
    assert_eq!(report.home_initializers.len(), 4);
    assert!(report.home_initializers.iter().all(|h| h.replaced));
    // The export gave every one of them a generic start, so none is left to answer for.
    let reported = report.issues();
    let homes: Vec<_> = reported
        .iter()
        .filter(|i| i.code == IssueCode::HomeInitializer)
        .collect();
    assert_eq!(homes.len(), 4);
    assert!(
        homes.iter().all(|i| i.severity == Severity::Info),
        "{homes:?}"
    );
    for home in &report.home_initializers {
        assert_eq!(
            galaxy.systems[&home.system].initializer,
            format!("random_empire_init_0{}", home.system % 6 + 1)
        );
    }
    let issues = sgf_core::validate::validate(&reopened.graph);
    // The Sol seat stands on a generic start, so it is no mismatch.
    assert!(
        !issues.iter().any(|i| matches!(
            i.code,
            IssueCode::SolSeatMismatch | IssueCode::PlayerSeatDuplicate
        )),
        "{issues:?}"
    );
    let isolated: Vec<u32> = issues
        .iter()
        .filter(|i| i.code == IssueCode::SystemIsolated)
        .flat_map(|i| i.systems.clone())
        .collect();
    let isolated_before: Vec<u32> = save
        .graph
        .systems
        .values()
        .filter(|s| s.lanes.is_empty())
        .map(|s| s.id)
        .collect();
    assert!(
        isolated.iter().all(|id| isolated_before.contains(id)),
        "{isolated:?} beyond {isolated_before:?}"
    );
}

/// The sample with the player's `human_1` country flag taken out: a player that is not
/// the United Nations of Earth.
fn sample_without_une_flag() -> Session {
    common::open_edited(|bytes| {
        let flag = b"\t\t\thuman_1=62808000\n";
        let at = bytes
            .windows(flag.len())
            .position(|w| w == flag)
            .expect("the UNE flag in the sample");
        bytes.drain(at..at + flag.len());
    })
}

#[test]
fn a_player_that_is_not_the_une_gets_a_preferred_seat() {
    let save = sample_without_une_flag();
    assert_eq!(save.graph.player_country, Some(0));
    assert!(
        save.graph
            .countries
            .iter()
            .find(|c| c.id == 0)
            .expect("country 0")
            .flags
            .iter()
            .all(|flag| flag != "human_1")
    );
    let (text, report) = exported_as(&save, NAME, ScenarioProfile::PaintAGalaxy);
    let text = String::from_utf8(text).expect("utf-8");
    assert_eq!(report.player_seat, Some(217));
    assert_eq!(report.player_seat_kind, Some(PaintSpawnKind::Preferred));
    assert!(
        text.contains(
            "	system = { id = \"217\" name = \"NAME_Sol\" position = { x = 397.39 y = -180.25 } initializer = random_empire_init_02 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|7| modifier = { add = 100000 } } }
"
        ),
        "{text}"
    );
    assert_eq!(text.matches("modifier = {").count(), 1);
    // Without a reserved seat every seat is open, and the header counts say so.
    assert!(
        text.contains(
            "	num_empires = { min = 0 max = 16 }
	num_empire_default = 13
"
        ),
        "{}",
        &text[..1200]
    );
    let reopened = from_scenario_text(text);
    assert_eq!(
        reopened.graph.systems[&217].spawn_script,
        Some(SpawnScript::PaintAGalaxy {
            kind: PaintSpawnKind::Preferred,
            random_value: 7,
            player: true,
        })
    );
    // The player's preferred seat is one of the 17 open ones, so 16 are left to the AI.
    let seats = seat_counts(&reopened.graph);
    assert_eq!(
        seats,
        SeatCounts {
            seats: 17,
            reserved: 0,
            player_on_reserved: false,
        }
    );
    assert_eq!(seats.safe(), 16);
    let issues = sgf_core::validate::validate(&reopened.graph);
    assert!(
        !issues.iter().any(|i| matches!(
            i.code,
            IssueCode::SolSeatMismatch | IssueCode::PlayerSeatDuplicate
        )),
        "{issues:?}"
    );
}

#[test]
fn the_paint_a_galaxy_profile_seats_the_capitals_fills_their_neighbours_and_flags_wormholes() {
    let committed = common::open();
    let capitals = default_capitals(&committed);
    let first = *capitals.first().expect("a playable capital");
    let neighbour = committed.graph.systems[&first]
        .lanes
        .iter()
        .map(|lane| lane.to)
        .find(|to| !capitals.contains(to))
        .expect("a neighbour that is not a capital");
    let save = sample_without_initializer(neighbour);
    assert_eq!(save.graph.systems[&neighbour].initializer, "");
    assert_eq!(default_capitals(&save), capitals);
    let (text, report) = exported_as(&save, NAME, ScenarioProfile::PaintAGalaxy);
    let text = String::from_utf8(text).expect("utf-8");
    // Every pair's ends are written, so the comment lines above the mod's own say
    // nothing was dropped.
    assert_eq!(report.dropped, DroppedBypasses::default());
    assert!(
        report
            .issues()
            .iter()
            .all(|issue| issue.code != IssueCode::ExportDropped),
        "{:?}",
        report.issues()
    );
    let systems = text
        .lines()
        .filter(|line| line.starts_with("\tsystem = "))
        .count();
    assert!(
        text.starts_with(&format!(
            "#\u{200B} created by Stellaris Galaxy Forge {VERSION} (converted from save {SAVE_FILE})
# Systems: {systems} · Empire seats: {} · Nebulae: 9
# Written by Stellaris Galaxy Forge for the Paint a Galaxy mod (Steam Workshop 3532904115), which this map requires.
static_galaxy_scenario = {{
	name = \"{NAME}\"
	priority = 10
",
            capitals.len()
        )),
        "{}",
        &text[..400]
    );

    // 17 seats, the player's the Sol seat: the setup's 13 empires fit under the 16
    // seats any empire may take, and its advanced and nomad counts stand as set.
    assert_eq!(capitals.len(), 17, "{capitals:?}");
    assert!(
        text.contains(
            "	num_empires = { min = 0 max = 16 }
	num_empire_default = 13
	advanced_empire_default = 0
	nomad_empire_default = 2
	nomad_empire_max = 16
"
        ),
        "{}",
        &text[..1200]
    );
    assert!(
        text.contains(
            "	fallen_empire_default = 3
	marauder_empire_default = 2
	crisis_strength = 1.0
	core_radius = 112.5
"
        ),
        "{}",
        &text[..1200]
    );
    assert_eq!(
        text.matches("value:painted_galaxy_spawn_weight|").count(),
        capitals.len()
    );

    let reopened = from_scenario_text(text);
    let missing = left_out(&save.graph, &reopened.graph);
    assert!(!missing.contains(&neighbour));
    let review: BTreeSet<u32> = report.home_initializers.iter().map(|h| h.system).collect();
    for (i, id) in capitals.iter().enumerate() {
        let system = &reopened.graph.systems[id];
        let player = report.player_seat == Some(*id);
        let (kind, random_value) = if player {
            (PaintSpawnKind::Sol, 0)
        } else {
            (PaintSpawnKind::Enabled, (i % 10) as u8)
        };
        assert_eq!(
            system.spawn_script,
            Some(SpawnScript::PaintAGalaxy {
                kind,
                random_value,
                player,
            }),
            "{id}"
        );
        assert!(!system.initializer.is_empty(), "{id}");
        let expected = match save.graph.systems[id].initializer.as_str() {
            own if own.is_empty() || review.contains(id) || player => {
                format!("random_empire_init_0{}", id % 6 + 1)
            }
            own => own.to_owned(),
        };
        assert_eq!(system.initializer, expected, "{id}");
    }

    let near = within(&save.graph, &capitals, 2);
    let mut filled = 0;
    for id in save.graph.order.iter().filter(|id| !missing.contains(id)) {
        let written = &reopened.graph.systems[id];
        let own = &save.graph.systems[id].initializer;
        let filler = own.is_empty() && near.contains(id) && !capitals.contains(id);
        assert_eq!(
            written.initializer == "painted_galaxy_rl_basic",
            filler,
            "{id}: {:?}",
            written.initializer
        );
        if filler {
            filled += 1;
            let (effect, _) = reopened.scenario_system_effect(*id).expect("a flag");
            assert!(
                effect.contains("set_star_flag = painted_galaxy_automatic_initializer"),
                "{id}: {effect}"
            );
        } else if !capitals.contains(id) {
            assert_eq!(written.initializer, *own, "{id}");
        }
        assert_eq!(
            written.spawn_script.is_some(),
            capitals.contains(id),
            "{id}"
        );
    }
    assert_eq!(filled, 1, "the one blanked neighbour is filled");

    let mut pairs = 0;
    for link in &save.graph.bypasses {
        let BypassLink::Wormhole { a, b } = link else {
            continue;
        };
        pairs += 1;
        for end in [a, b] {
            let (effect, _) = reopened
                .scenario_system_effect(*end)
                .expect("wormhole flags");
            assert!(
                effect.contains(&format!("set_star_flag = painted_galaxy_wormhole_{pairs} "))
                    && effect.contains("set_star_flag = empire_cluster"),
                "{end}: {effect}"
            );
        }
    }
    assert_eq!(pairs, 6);
}

#[test]
fn the_paint_a_galaxy_profile_places_only_the_saves_own_fallen_empires() {
    let save = common::open();
    let options = export::options_for(&save.graph, NAME);
    let (plain, report) = export::scenario_text(
        &save.graph,
        &options,
        &no_names,
        &no_sources,
        ScenarioProfile::Plain,
    );
    assert_eq!(report.fallen_empire_zones, 0);
    assert!(
        !String::from_utf8(plain)
            .unwrap()
            .contains("painted_galaxy_fe_spawn")
    );

    let (paint, report) = export::scenario_text(
        &save.graph,
        &options,
        &no_names,
        &no_sources,
        ScenarioProfile::PaintAGalaxy,
    );
    let text = String::from_utf8_lossy(&paint);
    let typed = report.fallen_empires.len() as u32;
    assert_eq!(typed, 3);
    assert_eq!(
        text.matches("set_star_flag = painted_galaxy_fe_spawn ")
            .count() as u32,
        report.fallen_empire_zones + typed
    );
    let fallen_max = (report.fallen_empire_zones + typed).min(6);
    assert!(
        text.contains(&format!("\tfallen_empire_max = {fallen_max}\n")),
        "{}",
        &text[..1200]
    );
    let reopened = from_scenario_text(&paint);
    let galaxy: &Galaxy = &reopened.graph;
    let anchors: BTreeSet<u32> = report
        .fallen_empires
        .iter()
        .filter_map(|f| f.anchor)
        .collect();
    let mut centres = Vec::new();
    for id in &galaxy.order {
        let anchor = &galaxy.systems[id];
        let Some(zone) = &anchor.fe_zone else {
            continue;
        };
        let centre = fe_zone::centre((anchor.x, anchor.y), zone);
        if anchors.contains(id) {
            assert!(zone.preferred, "{id}");
        } else {
            assert_eq!(zone.kind, FeKind::Random, "{id}");
            assert_eq!(zone.distance, 40, "{id}");
            assert!(!zone.preferred && !zone.fallback, "{id}");
            assert!(centre.0.hypot(centre.1) >= 130.0, "{id}: {centre:?}");
        }
        assert!(!fe_zone::is_off_map(centre), "{id}: {centre:?}");
        for system in galaxy.systems.values() {
            assert!(
                !fe_zone::inside(centre, (system.x, system.y)),
                "{id}: {} stands in the ring at {centre:?}",
                system.id
            );
        }
        for &(other, other_centre) in &centres {
            assert!(
                !fe_zone::overlaps(centre, other_centre),
                "{id} and {other} overlap at {centre:?} and {other_centre:?}"
            );
        }
        centres.push((*id, centre));
    }
    assert_eq!(centres.len() as u32, typed);
    assert_eq!(
        report.fallen_empire_zones, 0,
        "a save's export places only the zones its fallen empires ask for"
    );
    assert!(
        !placement::candidates(&placement::sites(galaxy)).is_empty(),
        "the mod's candidates stay available to Fit"
    );
    let issues = sgf_core::validate::validate(&reopened.graph);
    assert!(
        issues
            .iter()
            .all(|issue| !issue.code.as_str().starts_with("fe_zone"))
    );
    assert!(
        issues
            .iter()
            .all(|issue| issue.code != IssueCode::HeaderEmpireCount),
        "{issues:?}"
    );
}

#[test]
fn the_paint_a_galaxy_profile_writes_no_base_weight_on_a_home_that_is_no_capital() {
    let mut save = common::open();
    let capitals = default_capitals(&save);
    let country = save
        .graph
        .countries
        .iter_mut()
        .find(|c| c.country_type == "default" && c.capital_system.is_some())
        .expect("a playable country with a capital");
    let home = country.capital_system.take().expect("its capital");
    assert!(
        save.graph.systems[&home]
            .flags
            .iter()
            .any(|f| f == "empire_home_system")
    );
    assert_eq!(default_capitals(&save).len(), capitals.len() - 1);

    let options = export::options_for(&save.graph, NAME);
    assert_eq!(options.num_empires, (0, capitals.len() as u32 - 1));
    let (plain, _) = export::scenario_text(
        &save.graph,
        &options,
        &no_names,
        &no_sources,
        ScenarioProfile::Plain,
    );
    let plain = String::from_utf8(plain).expect("utf-8");
    assert_eq!(
        seated(&plain),
        capitals,
        "the plain profile still seats the flagged home"
    );

    let (paint, _) = export::scenario_text(
        &save.graph,
        &options,
        &no_names,
        &no_sources,
        ScenarioProfile::PaintAGalaxy,
    );
    let paint = String::from_utf8(paint).expect("utf-8");
    assert!(!paint.contains("spawn_weight = { base = 1 }"), "{paint}");
    assert_eq!(
        paint
            .matches("spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|")
            .count(),
        capitals.len() - 1
    );
    assert_eq!(
        paint.matches(" spawn_weight = {").count(),
        capitals.len() - 1
    );
    let reopened = from_scenario_text(paint);
    assert_eq!(reopened.graph.systems[&home].spawn_weight, None);
    assert_eq!(reopened.graph.systems[&home].spawn_script, None);
}
