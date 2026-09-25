//! What the scripts say about a scenario before a game exists: the star and
//! global flags a system carries, the claims a game-start sweep makes on
//! them, and the day-one tier those claims give a territory.

use crate::common;

use std::collections::BTreeSet;

use sgf_gamedata::GameData;
use sgf_gamedata::scripts::claims::{Claim, ClaimEffect, DAY_ONE_DAYS, OwnerExpr};
use sgf_gamedata::scripts::facts::{self, ScenarioFacts};
use sgf_gamedata::scripts::trigger::Trigger;
use sgf_gamedata::scripts::{
    OwnerTier, ReferenceVia, ScenarioOwners, ScenarioSystem, ScriptRowKind, ScriptTiming,
    SystemColony,
};

use common::scripts::{install_with_mod, names, row, site, sys};

/// The same scenario as [`SCENARIO`], plus the system that plants its own
/// starbase and one whose statement carries an `effect` of its own.
fn fact_systems() -> Vec<ScenarioSystem<'static>> {
    vec![
        sys(1, "empire_capital_init"),
        sys(5, "basic_init_01"),
        sys(6, "contested_init"),
        ScenarioSystem::new(
            7,
            "mod_one_init",
            Some("set_star_flag = fixture_scenario\nset_global_flag = fixture_scenario_seen"),
        ),
    ]
}

fn flags(facts: &ScenarioFacts, system: u32) -> Vec<&str> {
    facts
        .system(system)
        .unwrap_or_else(|| panic!("system {system} has facts"))
        .star_flags
        .iter()
        .map(String::as_str)
        .collect()
}

#[test]
fn a_systems_star_flags_are_its_initializers_list_its_chain_and_its_own_effect() {
    let gd = common::cached_fixture_with_mods();
    let facts = facts::scenario_facts(gd, &fact_systems());

    assert_eq!(flags(&facts, 5), ["modded"]);
    assert_eq!(flags(&facts, 1), ["fixture_beacon"]);
    assert_eq!(flags(&facts, 7), ["fixture_scenario"]);
}

#[test]
fn global_flags_are_one_union_every_system_is_judged_against() {
    let gd = common::cached_fixture_with_mods();
    let facts = facts::scenario_facts(gd, &fact_systems());

    let global: Vec<&str> = facts.global_flags().iter().map(String::as_str).collect();
    assert_eq!(global, ["fixture_capital_made", "fixture_scenario_seen"]);

    let view = facts.view(5).expect("the plain system is judged too");
    assert!(view.global_flags.contains("fixture_capital_made"));
    assert!(view.star_flags.contains("modded"));
    assert!(!view.has_starbase);
    assert!(view.saved_targets.contains("fixture_empire"));
}

#[test]
fn only_the_chain_that_creates_a_starbase_has_one() {
    let gd = common::cached_fixture_with_mods();
    let facts = facts::scenario_facts(gd, &fact_systems());

    let has: Vec<(u32, bool)> = [1, 5, 6, 7]
        .map(|id| (id, facts.system(id).expect("facts").has_starbase))
        .to_vec();
    assert_eq!(has, [(1, false), (5, false), (6, true), (7, false)]);
}

/// The claims the fixture's `on_game_start` sweep makes, by the event they
/// are written in and the flags they insist on.
fn claims(gd: &GameData) -> Vec<(&str, Vec<&str>)> {
    gd.scripts
        .claims()
        .all()
        .iter()
        .map(|c| {
            (
                c.event.as_str(),
                c.required_flags.iter().map(String::as_str).collect(),
            )
        })
        .collect()
}

fn flag_set(items: &[&str]) -> BTreeSet<String> {
    items.iter().map(|s| (*s).to_owned()).collect()
}

#[test]
fn a_game_start_sweep_claims_every_system_carrying_the_flag_its_limit_names() {
    let gd = common::cached_fixture_with_mods();
    let claimed = flag_set(&["fixture_claimed"]);
    let found: Vec<&Claim> = gd.scripts.claims().for_flags(&claimed).collect();
    assert_eq!(found.len(), 1, "{found:#?}");

    let claim = found[0];
    assert_eq!(claim.event, "fixture.5");
    assert_eq!(claim.effect, ClaimEffect::Starbase);
    assert_eq!(claim.owner, OwnerExpr::Token("fixture_empire".to_owned()));
    assert_eq!(claim.required_flags, ["fixture_claimed"]);
    assert_eq!(
        claim.trigger,
        Trigger::All(vec![
            Trigger::All(vec![Trigger::Not(Box::new(Trigger::Any(vec![
                Trigger::Starbase
            ])))]),
            Trigger::All(vec![
                Trigger::StarFlag("fixture_claimed".to_owned()),
                Trigger::GlobalFlag("fixture_map_spawned".to_owned()),
            ]),
        ]),
        "the loop's own limit and the branch's",
    );
    assert!(
        gd.scripts.claims().for_flags(&BTreeSet::new()).count() == 0,
        "every fixture claim names a star flag",
    );
}

#[test]
fn a_later_branch_carries_the_negation_of_the_one_before_it() {
    let gd = common::cached_fixture_with_mods();
    let scoped = flag_set(&["fixture_scoped"]);
    let claim = gd
        .scripts
        .claims()
        .for_flags(&scoped)
        .next()
        .expect("the else_if branch");
    assert_eq!(claim.effect, ClaimEffect::SetOwner);
    assert_eq!(claim.owner, OwnerExpr::Scope("prev".to_owned()));
    assert_eq!(claim.required_flags, ["fixture_scoped"]);
    assert_eq!(
        claim.trigger,
        Trigger::All(vec![
            Trigger::All(vec![Trigger::Not(Box::new(Trigger::Any(vec![
                Trigger::Starbase
            ])))]),
            Trigger::Not(Box::new(Trigger::All(vec![
                Trigger::StarFlag("fixture_claimed".to_owned()),
                Trigger::GlobalFlag("fixture_map_spawned".to_owned()),
            ]))),
            Trigger::All(vec![
                Trigger::StarFlag("fixture_scoped".to_owned()),
                Trigger::Unknown,
            ]),
        ]),
    );
}

#[test]
fn an_event_a_month_out_is_past_day_one_and_the_next_days_event_is_not() {
    let gd = common::cached_fixture_with_mods();
    let events: Vec<&str> = claims(gd).into_iter().map(|(event, _)| event).collect();
    assert!(
        !events.contains(&"fixture.6"),
        "40 days is more than DAY_ONE_DAYS = {DAY_ONE_DAYS}: {events:?}",
    );
    assert!(events.contains(&"fixture.7"), "{events:?}");
    assert!(
        gd.scripts
            .claims()
            .for_flags(&flag_set(&["fixture_late"]))
            .next()
            .is_none(),
    );
}

#[test]
fn a_loop_inside_a_loop_claims_for_the_inner_one_only() {
    let gd = common::cached_fixture_with_mods();
    let nested: Vec<(&str, Vec<&str>)> = claims(gd)
        .into_iter()
        .filter(|(event, _)| *event == "fixture.7")
        .collect();
    assert_eq!(nested, [("fixture.7", vec!["fixture_inner"])]);
    assert!(
        gd.scripts
            .claims()
            .for_flags(&flag_set(&["fixture_outer"]))
            .next()
            .is_none(),
        "the outer system's flag is not the claimed one",
    );
}

#[test]
fn the_claims_are_in_the_order_the_on_action_lists_its_events() {
    let gd = common::cached_fixture_with_mods();
    assert_eq!(
        claims(gd),
        [
            ("fixture.5", vec!["fixture_claimed"]),
            ("fixture.5", vec!["fixture_scoped"]),
            ("fixture.7", vec!["fixture_inner"]),
        ],
    );
    let orders: Vec<usize> = gd.scripts.claims().all().iter().map(|c| c.order).collect();
    assert_eq!(orders, [0, 1, 2]);
    assert!(common::cached_fixture().scripts.claims().is_empty());
}

#[test]
fn a_sweep_that_gives_its_system_away_inside_a_scope_it_cannot_follow_claims_nothing() {
    let events = r#"namespace = many

event = {
	id = many.1
	is_triggered_only = yes
	immediate = {
		every_system = {
			limit = { has_star_flag = ancient_wonders_system }
			event_target:many_home = {
				set_owner = event_target:many_empire
			}
		}
		every_system = {
			limit = { has_star_flag = fixture_beacon }
			set_owner = event_target:many_empire
		}
	}
}
"#;
    let on_actions = "on_game_start = {\n\tevents = {\n\t\tmany.1\n\t}\n}\n";
    let (_dir, gd) = install_with_mod(&[
        ("events/zz_many.txt", events),
        ("common/on_actions/zz_many.txt", on_actions),
    ]);
    assert_eq!(
        claims(&gd),
        [("many.1", vec!["fixture_beacon"])],
        "the system the loop is on is not the one the scope hands away",
    );
}

/// A mod whose `on_game_start` sweeps the flag the fixture's fallen home
/// carries, fires one event a month out and one the next day, and hands the
/// systems it claims to a token no chain saved.
fn sweep_install() -> (tempfile::TempDir, GameData) {
    let events = concat!(
        "namespace = many
",
        "
",
        "event = {
",
        "	id = many.1
",
        "	is_triggered_only = yes
",
        "	immediate = {
",
        "		every_system = {
",
        "			limit = { has_star_flag = ancient_wonders_system }
",
        "			create_starbase = { size = starbase_hut owner = event_target:many_empire }
",
        "		}
",
        "		country_event = { id = many.2 days = 40 }
",
        "		country_event = { id = many.3 days = 1 }
",
        "	}
",
        "}
",
        "
",
        "event = {
",
        "	id = many.2
",
        "	is_triggered_only = yes
",
        "	immediate = {
",
        "		every_system = {
",
        "			limit = { has_star_flag = ancient_wonders_system }
",
        "			set_owner = event_target:many_empire
",
        "		}
",
        "	}
",
        "}
",
        "
",
        "event = {
",
        "	id = many.3
",
        "	is_triggered_only = yes
",
        "	immediate = {
",
        "		every_system = {
",
        "			limit = { has_star_flag = ancient_wonders_system }
",
        "			set_owner = event_target:many_empire
",
        "		}
",
        "	}
",
        "}
",
    );
    let on_actions = "on_game_start = {
	events = {
		many.1
	}
}
";
    install_with_mod(&[
        ("events/zz_many.txt", events),
        ("common/on_actions/zz_many.txt", on_actions),
    ])
}

#[test]
fn the_game_start_sweep_that_claims_a_system_is_a_day_one_row_on_its_flag() {
    let (_dir, gd) = sweep_install();
    let scripts = gd.system_scripts(3, Some("fallen_home"), None);

    let event = row(&scripts, ScriptRowKind::Event, "many.1");
    assert_eq!(event.timing, ScriptTiming::DayOne);
    assert_eq!(event.fired_by.as_deref(), Some("on_game_start"));
    assert_eq!(event.vias, [ReferenceVia::StarFlag]);
    assert_eq!(site(event).via, Some(ReferenceVia::StarFlag));
    assert_eq!(site(event).token.as_deref(), Some("ancient_wonders_system"));
    let lines: Vec<u32> = event.sites.iter().map(|s| s.location.line).collect();
    assert_eq!(
        lines,
        [3, 8],
        "the claim leads at the event's own line, then the line that reads the flag",
    );

    let elsewhere = gd.system_scripts(20, Some("region_init"), None);
    assert!(
        !names(&elsewhere).contains(&"many.1"),
        "a system without the swept flag is claimed by nothing: {:#?}",
        elsewhere.rows,
    );
}

#[test]
fn an_event_the_sweep_fires_a_month_out_is_later_and_the_next_days_is_day_one() {
    let (_dir, gd) = sweep_install();
    let scripts = gd.system_scripts(3, Some("fallen_home"), None);

    let month = row(&scripts, ScriptRowKind::Event, "many.2");
    assert_eq!(month.timing, ScriptTiming::Later);
    assert_eq!(month.fired_by.as_deref(), Some("from event many.1"));
    assert_eq!(
        month.site_count, 1,
        "no claim of its own: {:#?}",
        month.sites
    );

    let next = row(&scripts, ScriptRowKind::Event, "many.3");
    assert_eq!(
        next.timing,
        ScriptTiming::DayOne,
        "chained one day out, the walk still reaches it",
    );
    assert_eq!(next.fired_by.as_deref(), Some("from event many.1"));
}

#[test]
fn a_star_flag_the_scenario_statement_sets_reaches_the_sweep_that_claims_it() {
    let gd = common::cached_fixture_with_mods();
    let scripts = gd.system_scripts(
        5,
        Some("basic_init_01"),
        Some((
            "
	set_star_flag = fixture_claimed
"
            .to_owned(),
            7,
        )),
    );

    let event = row(&scripts, ScriptRowKind::Event, "fixture.5");
    assert_eq!(event.timing, ScriptTiming::DayOne);
    assert_eq!(event.site_count, 1);
    assert_eq!(site(event).via, Some(ReferenceVia::StarFlag));
    assert_eq!(site(event).token.as_deref(), Some("fixture_claimed"));
    assert_eq!(
        site(event).location.display,
        "events/zz_fixture_events.txt:57"
    );
    assert!(
        !names(&scripts).contains(&"fixture.7"),
        "the nested sweep wants a flag this system has none of: {:#?}",
        scripts.rows,
    );

    let plain = gd.system_scripts(5, Some("basic_init_01"), None);
    assert!(
        !names(&plain).contains(&"fixture.5"),
        "without the effect the system carries no swept flag: {:#?}",
        plain.rows,
    );
}

/// The same fixture empire, plus the systems only the game-start sweep can
/// give it: one flagged by its initializer's list, one by its chain, one
/// already walled off by a starbase, one the sweep hands to a scope, and one
/// whose moon is colonised without the system being anyone's.
const DAY_ONE: [ScenarioSystem<'static>; 7] = [
    sys(1, "empire_capital_init"),
    sys(2, "empire_colony_init"),
    sys(20, "sweep_seeded_init"),
    sys(21, "sweep_flagged_init"),
    sys(22, "sweep_walled_init"),
    sys(23, "sweep_scoped_init"),
    sys(24, "colony_only_init"),
];

/// Every owned system as `(system, token, tier, claiming event, assumed)`.
fn owned(owners: &ScenarioOwners) -> Vec<(u32, &str, OwnerTier, Option<&str>, bool)> {
    owners
        .owners
        .iter()
        .map(|o| {
            let territory = owners
                .territories
                .iter()
                .find(|t| t.country.id == o.territory)
                .expect("every owner names a territory");
            (
                o.system,
                territory.token.as_str(),
                o.tier,
                o.claimed_by.as_deref(),
                o.assumed,
            )
        })
        .collect()
}

#[test]
fn the_game_start_sweep_gives_a_flagged_system_to_the_empire_generation_already_owns() {
    let gd = common::cached_fixture_with_mods();
    let owners = gd.scenario_owners(&DAY_ONE);

    assert_eq!(
        owned(&owners),
        [
            (1, "fixture_empire", OwnerTier::Generation, None, false),
            (2, "fixture_empire", OwnerTier::Generation, None, false),
            (
                20,
                "fixture_empire",
                OwnerTier::DayOne,
                Some("fixture.5"),
                false
            ),
            (
                21,
                "fixture_empire",
                OwnerTier::DayOne,
                Some("fixture.5"),
                false
            ),
        ],
        "the walled, scoped and colony-only systems are nobody's",
    );
    assert_eq!(owners.day_one_systems, 2);
    assert_eq!(owners.assumed_systems, 0);

    let territory = &owners.territories[0];
    assert_eq!(territory.token, "fixture_empire");
    assert_eq!(
        territory.tier,
        OwnerTier::Generation,
        "a territory reads the earliest tier any of its systems was claimed at",
    );
    assert_eq!(territory.claimed_by, ["fixture.5"]);
    assert!(!territory.assumed);
    assert_eq!(territory.country.system_count, 4);
    assert_eq!(territory.country.capital_system, Some(1));
}

#[test]
fn a_system_the_sweep_hands_to_a_scope_is_unresolved_and_never_drawn() {
    let gd = common::cached_fixture_with_mods();
    let owners = gd.scenario_owners(&DAY_ONE);

    let wrote: Vec<(u32, &str)> = owners
        .unresolved
        .iter()
        .map(|u| (u.system, u.wrote.as_str()))
        .collect();
    assert_eq!(wrote, [(23, "set_owner = prev")]);
    assert!(owners.owners.iter().all(|o| o.system != 23));
}

#[test]
fn a_claim_that_rests_on_a_condition_it_cannot_judge_is_assumed() {
    let (_dir, gd) = install_with_sweep();
    let owners = gd.scenario_owners(&[sys(30, "sweep_guess_init")]);

    assert_eq!(
        owned(&owners),
        [(30, "sweep_empire", OwnerTier::DayOne, Some("sweep.1"), true)],
        "`is_capital` is not judged, and it could have settled the branch",
    );
    assert_eq!(owners.assumed_systems, 1);
    assert_eq!(owners.day_one_systems, 1);
    assert!(owners.territories[0].assumed);
    assert_eq!(owners.territories[0].tier, OwnerTier::DayOne);
    assert_eq!(owners.territories[0].country.capital_system, None);
}

/// The fixture install plus a mod that sweeps on a guard this editor cannot
/// judge: the fixture's own sweep only hands such a branch to a scope.
fn install_with_sweep() -> (tempfile::TempDir, GameData) {
    install_with_mod(&[
        (
            "common/on_actions/zz_sweep.txt",
            "on_game_start = {\n\tevents = {\n\t\tsweep.1\n\t}\n}\n",
        ),
        (
            "events/zz_sweep.txt",
            concat!(
                "namespace = sweep\n",
                "event = {\n",
                "\tid = sweep.1\n",
                "\tis_triggered_only = yes\n",
                "\timmediate = {\n",
                "\t\tevery_system = {\n",
                "\t\t\tif = {\n",
                "\t\t\t\tlimit = {\n",
                "\t\t\t\t\thas_star_flag = sweep_guess\n",
                "\t\t\t\t\tis_capital = yes\n",
                "\t\t\t\t}\n",
                "\t\t\t\tcreate_starbase = {\n",
                "\t\t\t\t\tsize = starbase_hut\n",
                "\t\t\t\t\towner = event_target:sweep_empire\n",
                "\t\t\t\t}\n",
                "\t\t\t}\n",
                "\t\t}\n",
                "\t}\n",
                "}\n",
            ),
        ),
        (
            "common/solar_system_initializers/zz_sweep.txt",
            "sweep_guess_init = {\n\tclass = sc_sun\n\tflags = { sweep_guess }\n}\n",
        ),
    ])
}

#[test]
fn the_bodies_the_scripts_colonise_are_listed_apart_from_the_territory() {
    let gd = common::cached_fixture_with_mods();
    let owners = gd.scenario_owners(&DAY_ONE);
    let empire = owners.territory_of("fixture_empire").expect("territory");

    assert_eq!(
        owners.colonies,
        [
            SystemColony {
                system: 1,
                planet_index: 0,
                territory: empire,
            },
            SystemColony {
                system: 24,
                planet_index: 2,
                territory: empire,
            },
        ],
        "the capital's own planet, and the moon of the second body of a system nobody owns",
    );
    assert!(
        owners.owners.iter().all(|o| o.system != 24),
        "a colony is not a territory",
    );
}

#[test]
fn a_claim_whose_global_flag_guard_nothing_sets_leaves_the_system_unowned() {
    let gd = common::cached_fixture_with_mods();
    let owners = gd.scenario_owners(&[sys(21, "sweep_flagged_init")]);

    assert!(
        owners.owners.iter().all(|o| o.system != 21),
        "fixture_map_spawned is only ever set by sweep_seeded_init, absent from this scenario: {:#?}",
        owners.owners,
    );
}

#[test]
fn a_claim_in_an_events_after_block_claims_the_system_its_loop_picked() {
    let events = r#"namespace = many

event = {
	id = many.1
	is_triggered_only = yes
	after = {
		every_system = {
			limit = { has_star_flag = fixture_beacon }
			set_owner = event_target:many_empire
		}
	}
}
"#;
    let on_actions = "on_game_start = {\n\tevents = {\n\t\tmany.1\n\t}\n}\n";
    let (_dir, gd) = install_with_mod(&[
        ("events/zz_many.txt", events),
        ("common/on_actions/zz_many.txt", on_actions),
    ]);

    assert_eq!(
        claims(&gd),
        [("many.1", vec!["fixture_beacon"])],
        "an `after` body runs where the event does, so the loop's system is the claimed one",
    );
}
