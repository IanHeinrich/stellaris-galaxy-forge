//! The Paint a Galaxy export profile's seats on the sample save: the Sol seat, home
//! initializers, a player that is not the United Nations of Earth, the capitals and
//! their neighbours, and the wormholes it flags.
use std::collections::BTreeSet;

use sgf_core::VERSION;
use sgf_core::export::{self, DroppedBypasses, ScenarioProfile};
use sgf_core::format::scenario::header_counts::{SeatCounts, seat_counts};
use sgf_core::format::scenario::{is_seat_initializer, seat_initializer};
use sgf_core::projections::galaxy::{BypassLink, Galaxy, PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;
use sgf_core::validate::{IssueCode, Severity};

use crate::common;
use common::coded;
use common::export::{
    NAME, Painted, SAVE_FILE, default_capitals, exported_as, find, no_names, no_sources, painted,
    seated,
};
use common::fixture::from_scenario_text;
use common::paint::left_out;

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
    common::open_edited(|gamestate| {
        let bytes = gamestate.as_bytes();
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
        gamestate.replace_range(start..end, "");
    })
}

/// The player is the United Nations of Earth, so its capital is the Sol seat, which only
/// the UNE weighs above zero. The game seated the UNE elsewhere while its seat named the
/// Sol initializer, the UNE's own, so the seat gets a generic start and the empire brings
/// its home. The Sol seat is the one reserved seat and the player's, so the player is set
/// aside once: 16 of the 17 seats are open, and the setup's 13 empires stand.
#[test]
fn the_une_player_takes_the_sol_seat_on_a_generic_start() {
    let Painted {
        save,
        text,
        report,
        reopened,
    } = painted();
    let galaxy: &Galaxy = reopened.graph();
    let player = save
        .graph()
        .countries
        .iter()
        .find(|c| c.id == 0)
        .and_then(|c| c.capital_system)
        .expect("the capital of country 0");
    assert_eq!(save.graph().player_country, Some(0));
    assert_eq!(report.player_seat, Some(player));
    assert_eq!(report.player_seat_kind, Some(PaintSpawnKind::Sol));
    assert_eq!(player, 217);
    assert!(
        save.graph()
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
    assert_eq!(galaxy.systems[&player].initializer, "basic_init_03");
    assert!(
        text.contains(
            "	system = { id = \"217\" name = \"NAME_Sol\" position = { x = 397.39 y = -180.25 } initializer = basic_init_03 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|SOL|yes|RANDOM_MODULO|1|RANDOM_VALUE|0| modifier = { add = 100000 has_country_flag = human_1 } } }
"
        ),
        "{text}"
    );
    assert_eq!(text.matches("modifier = {").count(), 1);

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
    let seated_as = |kind: PaintSpawnKind, player: bool| -> Vec<u32> {
        galaxy
            .systems
            .values()
            .filter(|s| {
                matches!(
                    &s.spawn_script,
                    Some(SpawnScript::PaintAGalaxy { kind: k, player: p, .. }) if *k == kind && *p == player
                )
            })
            .map(|s| s.id)
            .collect()
    };
    assert_eq!(seated_as(PaintSpawnKind::Sol, true), [player]);
    assert_eq!(seated_as(PaintSpawnKind::Enabled, false).len(), 16);

    let issues = sgf_core::validate::validate(reopened.graph());
    assert!(
        !issues
            .iter()
            .any(|i| i.code == IssueCode::PlayerSeatDuplicate),
        "{issues:?}"
    );
}

/// The export gives every seat whose initializer was an empire's home one of the game's
/// ordinary systems, so each is reported as information only. The game's random empire
/// starts are homes too, and every seat ends up on an ordinary system.
#[test]
fn every_home_initializer_on_a_seat_is_replaced_by_an_ordinary_system() {
    let Painted {
        report, reopened, ..
    } = painted();
    assert_eq!(report.home_initializers.len(), 16);
    assert!(report.home_initializers.iter().all(|h| h.replaced));
    let reported = report.issues();
    let homes = coded(&reported, IssueCode::HomeInitializer);
    assert_eq!(homes.len(), 16);
    assert!(
        homes.iter().all(|i| i.severity == Severity::Info),
        "{homes:?}"
    );
    for home in &report.home_initializers {
        let written = &reopened.graph().systems[&home.system].initializer;
        assert!(is_seat_initializer(written.as_str()), "{written}");
        assert_eq!(written, seat_initializer(home.system));
    }
    let seats: Vec<(u32, &str)> = reopened
        .graph()
        .systems
        .values()
        .filter(|s| s.spawn_script.is_some())
        .map(|s| (s.id, s.initializer.as_str()))
        .collect();
    assert_eq!(seats.len(), 17);
    assert!(
        seats.iter().all(|(_, i)| is_seat_initializer(i)),
        "{seats:?}"
    );
}

/// The sample with the player's `human_1` country flag taken out: a player that is not
/// the United Nations of Earth.
fn sample_without_une_flag() -> Session {
    common::open_edited(|gamestate| {
        let flag = "\t\t\thuman_1=62808000\n";
        assert!(gamestate.contains(flag), "the UNE flag in the sample");
        *gamestate = gamestate.replacen(flag, "", 1);
    })
}

#[test]
fn a_player_that_is_not_the_une_gets_a_first_player_seat() {
    let save = sample_without_une_flag();
    assert_eq!(save.graph().player_country, Some(0));
    assert!(
        save.graph()
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
            "	system = { id = \"217\" name = \"NAME_Sol\" position = { x = 397.39 y = -180.25 } initializer = basic_init_03 spawn_weight = { base = 0 add = value:painted_galaxy_spawn_weight|PREFERRED|yes|RANDOM_MODULO|10|RANDOM_VALUE|7| modifier = { add = 100000 has_country_flag = painted_galaxy_host } } }
"
        ),
        "{text}"
    );
    assert_eq!(text.matches("modifier = {").count(), 1);
    // Every seat but the host's is open, and the header counts say so.
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
        reopened.graph().systems[&217].spawn_script,
        Some(SpawnScript::PaintAGalaxy {
            kind: PaintSpawnKind::Preferred,
            random_value: 7,
            player: true,
        })
    );
    // The player's 1st Player seat is held for the host, so 16 are left to the AI.
    let seats = seat_counts(reopened.graph());
    assert_eq!(
        seats,
        SeatCounts {
            seats: 17,
            reserved: 1,
            player_on_reserved: true,
        }
    );
    assert_eq!(seats.safe(), 16);
    let issues = sgf_core::validate::validate(reopened.graph());
    assert!(
        !issues
            .iter()
            .any(|i| i.code == IssueCode::PlayerSeatDuplicate),
        "{issues:?}"
    );
}

#[test]
fn the_paint_a_galaxy_profile_seats_the_capitals_fills_their_neighbours_and_flags_wormholes() {
    let committed = common::open();
    let capitals = default_capitals(committed.graph());
    let first = *capitals.first().expect("a playable capital");
    let neighbour = committed.graph().systems[&first]
        .lanes
        .iter()
        .map(|lane| lane.to)
        .find(|to| !capitals.contains(to))
        .expect("a neighbour that is not a capital");
    let save = sample_without_initializer(neighbour);
    assert_eq!(save.graph().systems[&neighbour].initializer, "");
    assert_eq!(default_capitals(save.graph()), capitals);
    let (text, report) = exported_as(&save, NAME, ScenarioProfile::PaintAGalaxy);
    let text = String::from_utf8(text).expect("utf-8");
    // Every pair's ends are written, so the comment lines above the mod's own say
    // nothing was dropped.
    assert_eq!(report.dropped, DroppedBypasses::default());
    assert_eq!(report.dropped_summary, None);
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

    assert_eq!(capitals.len(), 17, "{capitals:?}");
    assert_eq!(
        text.matches("value:painted_galaxy_spawn_weight|").count(),
        capitals.len()
    );

    let reopened = from_scenario_text(text);
    let missing = left_out(save.graph(), reopened.graph());
    assert!(!missing.contains(&neighbour));
    let review: BTreeSet<u32> = report.home_initializers.iter().map(|h| h.system).collect();
    for (i, id) in capitals.iter().enumerate() {
        let system = &reopened.graph().systems[id];
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
        let expected = match save.graph().systems[id].initializer.as_str() {
            own if own.is_empty() || review.contains(id) || player => {
                seat_initializer(*id).to_owned()
            }
            own => own.to_owned(),
        };
        assert_eq!(system.initializer, expected, "{id}");
    }

    let near = within(save.graph(), &capitals, 2);
    let mut filled = 0;
    for id in save.graph().order.iter().filter(|id| !missing.contains(id)) {
        let written = &reopened.graph().systems[id];
        let own = &save.graph().systems[id].initializer;
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
    for link in &save.graph().bypasses {
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
fn the_paint_a_galaxy_profile_writes_no_base_weight_on_a_home_that_is_no_capital() {
    let mut graph = common::open().graph().clone();
    let capitals = default_capitals(&graph);
    let country = graph
        .countries
        .iter_mut()
        .find(|c| c.country_type == "default" && c.capital_system.is_some())
        .expect("a playable country with a capital");
    let home = country.capital_system.take().expect("its capital");
    assert!(
        graph.systems[&home]
            .flags
            .iter()
            .any(|f| f == "empire_home_system")
    );
    assert_eq!(default_capitals(&graph).len(), capitals.len() - 1);

    let options = export::options_for(&graph, NAME);
    assert_eq!(options.num_empires, (0, capitals.len() as u32 - 1));
    let (plain, _) = export::scenario_text(
        &graph,
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
        &graph,
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
    assert_eq!(reopened.graph().systems[&home].spawn_weight, None);
    assert_eq!(reopened.graph().systems[&home].spawn_script, None);
}
