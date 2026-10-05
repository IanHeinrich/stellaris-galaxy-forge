//! What the scripts say about a scenario before a game exists: the star and
//! global flags a system carries, and the claims a game-start sweep makes on
//! them.

use crate::common;

use std::collections::BTreeSet;

use sgf_gamedata::condition::Condition;
use sgf_gamedata::scripts::ScenarioSystem;
use sgf_gamedata::scripts::claims::{Claim, ClaimEffect, DAY_ONE_DAYS, OwnerExpr};
use sgf_gamedata::scripts::facts::{self, ScenarioFacts};

use common::scripts::{claims, install_with_mod, sys};

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
        Condition::All(vec![
            Condition::All(vec![Condition::Not(Box::new(Condition::Any(vec![
                Condition::Exists("starbase".to_owned())
            ])))]),
            Condition::All(vec![
                Condition::StarFlag("fixture_claimed".to_owned()),
                Condition::GlobalFlag("fixture_map_spawned".to_owned()),
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
        Condition::All(vec![
            Condition::All(vec![Condition::Not(Box::new(Condition::Any(vec![
                Condition::Exists("starbase".to_owned())
            ])))]),
            Condition::Not(Box::new(Condition::All(vec![
                Condition::StarFlag("fixture_claimed".to_owned()),
                Condition::GlobalFlag("fixture_map_spawned".to_owned()),
            ]))),
            Condition::All(vec![
                Condition::StarFlag("fixture_scoped".to_owned()),
                Condition::Call("is_capital".to_owned(), true),
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
