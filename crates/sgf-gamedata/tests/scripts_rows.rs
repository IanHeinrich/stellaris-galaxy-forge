//! The per-system Scripts section on the synthetic install: what becomes a
//! row, what each row's sites say, and what the row and site caps do to a
//! system more scripts name than the section can hold.

use crate::common;

use std::sync::Arc;

use sgf_gamedata::GameData;
use sgf_gamedata::scripts::{
    ROW_LIMIT, ReferenceVia, SITE_LIMIT, ScriptRowKind, ScriptTiming, TERRITORY_BASE,
};

use common::scripts::{capital_scripts, install_with_mod, names, owners, row, site};

#[test]
fn the_capitals_scripts_name_its_initializer_effect_and_the_event_that_reads_its_flag() {
    let gd = common::cached_fixture_with_mods();
    let scripts = capital_scripts(gd);
    assert_eq!(scripts.system, 1);
    assert!(!scripts.truncated);

    let initializer = scripts.initializer.as_ref().expect("initializer");
    assert_eq!(
        initializer.display,
        "common/solar_system_initializers/zz_one.txt:13"
    );
    assert_eq!(initializer.layer, "Mod One");
    let file = initializer.file.as_deref().expect("a game-data file");
    assert!(file.ends_with("zz_one.txt"), "{file}");

    let owner = scripts.owner.as_ref().expect("owner");
    assert_eq!(owner.token, "fixture_empire");
    assert_eq!(owner.label, "Fixture Empire");
    assert!(owner.capital);
    assert_eq!(owner.territory, None, "filled in by attach_territory");

    let own = row(&scripts, ScriptRowKind::Initializer, "empire_capital_init");
    assert_eq!(own.timing, ScriptTiming::Generation);
    assert_eq!(site(own).location.layer, "Mod One");
    assert!(own.pinned);

    let effect = row(
        &scripts,
        ScriptRowKind::ScriptedEffect,
        "create_fixture_empire",
    );
    assert_eq!(effect.timing, ScriptTiming::Generation);
    assert_eq!(site(effect).location.layer, "Mod One");
    assert!(
        site(effect)
            .location
            .display
            .starts_with("common/scripted_effects/zz_countries.txt:"),
        "{}",
        site(effect).location.display
    );

    let event = row(&scripts, ScriptRowKind::Event, "fixture.1");
    assert_eq!(event.timing, ScriptTiming::DayOne);
    assert_eq!(event.fired_by.as_deref(), Some("on_game_start"));
    assert_eq!(event.vias, [ReferenceVia::StarFlag]);
    assert_eq!(event.site_count, 1);
    assert_eq!(site(event).via, Some(ReferenceVia::StarFlag));
    assert_eq!(site(event).token.as_deref(), Some("fixture_beacon"));
    assert_eq!(
        site(event).location.display,
        "events/zz_fixture_events.txt:12"
    );
    assert_eq!(site(event).location.layer, "Mod One");

    // The empire's token was saved in a country scope, so it names the
    // empire and not this system: the systems sharing it are not rows here.
    let initializers: Vec<&str> = scripts
        .rows
        .iter()
        .filter(|r| r.kind == ScriptRowKind::Initializer)
        .map(|r| r.name.as_str())
        .collect();
    assert_eq!(initializers, ["empire_capital_init"]);

    assert!(
        scripts
            .rows
            .iter()
            .flat_map(|r| &r.sites)
            .all(|s| s.location.layer == "Mod One" || s.location.layer == "vanilla"),
        "{:#?}",
        scripts.rows
    );
}

#[test]
fn two_initializers_setting_the_same_star_flag_do_not_reference_each_other() {
    let gd = common::cached_fixture_with_mods();
    let twin = gd.system_scripts(8, Some("beacon_twin_init"), None);
    let fallen = gd.system_scripts(3, Some("fallen_home"), None);

    assert!(!names(&twin).contains(&"fallen_home"), "{:#?}", twin.rows);
    assert!(
        !names(&twin).contains(&"empire_capital_init"),
        "{:#?}",
        twin.rows
    );
    assert!(
        !names(&fallen).contains(&"beacon_twin_init"),
        "{:#?}",
        fallen.rows
    );

    // Both still find the event that reads the flag.
    for scripts in [&twin, &fallen] {
        assert_eq!(
            site(row(scripts, ScriptRowKind::Event, "fixture.1"))
                .token
                .as_deref(),
            Some("fixture_beacon")
        );
    }
}

#[test]
fn an_initializers_own_flag_list_reaches_the_event_that_reads_it() {
    let gd = common::cached_fixture_with_mods();
    let scripts = gd.system_scripts(20, Some("region_init"), None);
    let event = row(&scripts, ScriptRowKind::Event, "fixture.2");
    assert_eq!(site(event).via, Some(ReferenceVia::StarFlag));
    assert_eq!(site(event).token.as_deref(), Some("fixture_region"));
}

#[test]
fn a_target_saved_outside_the_systems_scope_is_not_one_of_its_references() {
    let gd = common::cached_fixture_with_mods();
    let scripts = gd.system_scripts(21, Some("scope_probe_init"), None);

    let planet = row(&scripts, ScriptRowKind::Event, "fixture.3");
    assert_eq!(site(planet).via, Some(ReferenceVia::EventTarget));
    assert_eq!(site(planet).token.as_deref(), Some("fixture_planet_target"));

    assert!(
        !names(&scripts).contains(&"fixture.4"),
        "a target saved in last_created_country names the country: {:#?}",
        scripts.rows
    );
}

#[test]
fn attach_territory_joins_a_systems_owner_to_its_territory() {
    let gd = common::cached_fixture_with_mods();
    let owners = owners(gd);
    let mut scripts = capital_scripts(gd);
    scripts.attach_territory(&owners);
    assert_eq!(
        scripts.owner.as_ref().and_then(|o| o.territory),
        Some(TERRITORY_BASE)
    );
}

#[test]
fn a_spawned_initializer_is_a_row_and_never_an_owner() {
    let gd = common::cached_fixture_with_mods();
    let scripts = gd.system_scripts(3, Some("fallen_home"), None);
    let spawned: Vec<&str> = scripts
        .rows
        .iter()
        .filter(|r| r.kind == ScriptRowKind::SpawnedInitializer)
        .map(|r| r.name.as_str())
        .collect();
    assert_eq!(spawned, ["fallen_colony", "fallen_outpost"]);
    assert_eq!(
        scripts.owner.as_ref().map(|o| o.token.as_str()),
        Some("fixture_fallen")
    );
}

#[test]
fn a_scenario_effect_becomes_its_own_row_with_no_file_to_open() {
    let gd = common::cached_fixture_with_mods();
    let scripts = gd.system_scripts(
        5,
        Some("basic_init_01"),
        Some(("\n\tset_star_flag = late_flag\n".to_owned(), 42)),
    );
    let effect = row(&scripts, ScriptRowKind::ScenarioEffect, "effect");
    assert!(effect.pinned);
    assert_eq!(site(effect).location.line, 42);
    assert_eq!(site(effect).location.display, "scenario:42");
    assert_eq!(site(effect).location.file, None);
    assert_eq!(effect.title.as_deref(), Some("set_star_flag = late_flag"));
    assert!(scripts.owner.is_none());
}

#[test]
fn the_scanner_records_the_line_of_a_hit_and_never_a_commented_one() {
    let gd = common::cached_fixture_with_mods();
    let sites = gd.scripts.references("fixture_beacon");
    let found: Vec<(&str, &'static str)> = sites
        .iter()
        .map(|s| (s.location.display.as_str(), s.verb))
        .collect();
    assert_eq!(
        found,
        [
            (
                "common/scripted_effects/zz_countries.txt:16",
                "has_star_flag"
            ),
            ("events/zz_fixture_events.txt:12", "has_star_flag"),
        ],
        "the commented has_star_flag on line 4 must not be a hit, \
         and setting the flag is not a reference"
    );

    let callers: Vec<&str> = gd
        .scripts
        .callers_of("fixture.1")
        .iter()
        .map(String::as_str)
        .collect();
    assert_eq!(callers, ["on_game_start"]);
    assert!(gd.scripts.references("fixture_beacon_seen").is_empty());
}

/// The fixture install plus one mod whose only file is `events`, so a test
/// can write exactly the references it wants to read back.
fn install_with_events(events: &str) -> (tempfile::TempDir, GameData) {
    install_with_mod(&[("events/zz_many.txt", events)])
}

#[test]
fn a_system_with_more_referencing_scripts_than_the_row_cap_is_truncated() {
    let mut events = String::from("namespace = many\n");
    for n in 0..=u32::try_from(ROW_LIMIT).unwrap() {
        events.push_str(&format!(
            "event = {{\n\tid = many.{n}\n\ttrigger = {{ has_star_flag = fixture_beacon }}\n}}\n"
        ));
    }
    let (_dir, gd) = install_with_events(&events);
    assert_eq!(gd.scripts.references("fixture_beacon").len(), ROW_LIMIT + 1);

    let scripts = gd.system_scripts(3, Some("fallen_home"), None);
    assert!(scripts.truncated);
    assert_eq!(scripts.rows.len(), ROW_LIMIT);
}

#[test]
fn a_script_naming_the_system_on_several_lines_is_one_row_with_one_site_a_line() {
    let (_dir, gd) = install_with_events(concat!(
        "namespace = many\n",
        "event = {\n",
        "\tid = many.1\n",
        "\ttrigger = { has_star_flag = fixture_beacon has_star_flag = ancient_wonders_system }\n",
        "\timmediate = {\n",
        "\t\tremove_star_flag = fixture_beacon\n",
        "\t}\n",
        "}\n",
    ));
    let scripts = gd.system_scripts(3, Some("fallen_home"), None);
    assert_eq!(
        names(&scripts).iter().filter(|n| **n == "many.1").count(),
        1,
        "{:#?}",
        scripts.rows
    );

    let event = row(&scripts, ScriptRowKind::Event, "many.1");
    assert_eq!(
        event.site_count, 2,
        "the two flags on line 4 are one site: {:#?}",
        event.sites
    );
    let lines: Vec<u32> = event.sites.iter().map(|s| s.location.line).collect();
    assert_eq!(lines, [4, 6]);
    assert_eq!(event.vias, [ReferenceVia::StarFlag]);
    assert!(!event.pinned);
}

#[test]
fn a_row_with_more_sites_than_the_site_cap_still_counts_them_all() {
    let overflow = 5;
    let mut events = String::from("namespace = many\nevent = {\n\tid = many.1\n\ttrigger = {\n");
    for _ in 0..SITE_LIMIT + overflow {
        events.push_str("\t\thas_star_flag = fixture_beacon\n");
    }
    events.push_str("\t}\n}\n");
    let (_dir, gd) = install_with_events(&events);

    let scripts = gd.system_scripts(3, Some("fallen_home"), None);
    let event = row(&scripts, ScriptRowKind::Event, "many.1");
    assert_eq!(event.site_count as usize, SITE_LIMIT + overflow);
    assert_eq!(event.sites.len(), SITE_LIMIT);
    assert_eq!(site(event).location.line, 5, "the earliest line leads");
}

#[test]
fn an_event_reaching_the_system_two_ways_is_one_row_with_both_vias() {
    let gd = common::cached_fixture_with_mods();
    let scripts = gd.system_scripts(21, Some("scope_probe_init"), None);
    assert_eq!(
        names(&scripts)
            .iter()
            .filter(|n| **n == "fixture.3")
            .count(),
        1,
        "{:#?}",
        scripts.rows
    );

    let event = row(&scripts, ScriptRowKind::Event, "fixture.3");
    assert_eq!(event.site_count, 2);
    assert_eq!(
        event.vias,
        [ReferenceVia::EventTarget, ReferenceVia::StarFlag],
        "the event target line and the star flag line: {:#?}",
        event.sites
    );
    assert_eq!(event.timing, ScriptTiming::DayOne);
    assert_eq!(event.fired_by.as_deref(), Some("on_game_start"));
}

#[test]
fn an_effect_the_chain_calls_and_that_reads_the_system_is_one_row() {
    let gd = common::cached_fixture_with_mods();
    let scripts = capital_scripts(gd);
    assert_eq!(
        names(&scripts)
            .iter()
            .filter(|n| **n == "create_fixture_empire")
            .count(),
        1,
        "{:#?}",
        scripts.rows
    );

    let effect = row(
        &scripts,
        ScriptRowKind::ScriptedEffect,
        "create_fixture_empire",
    );
    assert_eq!(effect.site_count, 2);
    assert_eq!(effect.vias, [ReferenceVia::Call, ReferenceVia::StarFlag]);
    assert_eq!(
        site(effect).location.display,
        "common/scripted_effects/zz_countries.txt:1",
        "the definition line leads, not the earliest reference"
    );
    assert_eq!(effect.timing, ScriptTiming::Generation);
    assert_eq!(
        effect.sites[1].token.as_deref(),
        Some("fixture_beacon"),
        "the reference keeps the token the call site has none of"
    );
}

#[test]
fn the_initializer_and_the_scenario_effect_are_pinned_above_the_rest() {
    let gd = common::cached_fixture_with_mods();
    let scripts = gd.system_scripts(
        1,
        Some("empire_capital_init"),
        Some(("\n\tset_star_flag = late_flag\n".to_owned(), 7)),
    );
    let pinned: Vec<(ScriptRowKind, &str)> = scripts
        .rows
        .iter()
        .take_while(|r| r.pinned)
        .map(|r| (r.kind, r.name.as_str()))
        .collect();
    assert_eq!(
        pinned,
        [
            (ScriptRowKind::Initializer, "empire_capital_init"),
            (ScriptRowKind::ScenarioEffect, "effect"),
        ],
        "{:#?}",
        scripts.rows
    );
    assert!(
        scripts.rows[pinned.len()..].iter().all(|r| !r.pinned),
        "{:#?}",
        scripts.rows
    );
}

#[test]
fn an_event_is_found_by_id_and_its_file_is_parsed_once() {
    let gd = common::cached_fixture_with_mods();
    let loc = gd
        .scripts
        .event("fixture.3")
        .expect("the mod layer defines fixture.3");
    assert!(loc.file.ends_with("zz_fixture_events.txt"));

    let parsed = gd.scripts.parsed(&loc.file).expect("the event file parses");
    let event = parsed
        .at(loc.offset)
        .expect("the offset lands on the event block");
    assert_eq!(
        event
            .find("id", &parsed.src)
            .and_then(|n| n.scalar_str(&parsed.src)),
        Some("fixture.3")
    );
    assert!(event.find("immediate", &parsed.src).is_some());
    assert!(Arc::ptr_eq(
        &parsed,
        &gd.scripts.parsed(&loc.file).expect("the parse is cached")
    ));
}

#[test]
fn an_initializers_chain_is_walked_once_and_every_call_shares_it() {
    let gd = common::cached_fixture_with_mods();
    let chain = gd.scripts.chain(&gd.initializers, "empire_capital_init");
    assert_eq!(chain.star_flags, ["fixture_beacon"]);

    assert!(Arc::ptr_eq(
        &chain,
        &gd.scripts.chain(&gd.initializers, "empire_capital_init")
    ));
    assert!(!Arc::ptr_eq(
        &chain,
        &gd.scripts.chain(&gd.initializers, "basic_init_01")
    ));
}
