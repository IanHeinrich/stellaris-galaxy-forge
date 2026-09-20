//! Scenario export through the public API: the sample save's galaxy written out, read
//! back and compared against the committed fixture.
use std::collections::BTreeSet;
use std::path::Path;

use sgf_core::document;
use sgf_core::emit::rounded;
use sgf_core::export::{self, ScenarioProfile};
use sgf_core::projections::galaxy::{BypassLink, Galaxy, PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;
use sgf_core::views::DocumentKind;

mod common;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/2206.11.16.scenario.txt"
);
const GRAMMAR: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/scenario_grammar.txt"
);
/// The fixture's name: the sample save's file stem, as the exporter defaults to.
const NAME: &str = "2206.11.16";

/// No game data, so every name is written as the save holds it.
fn no_names(_: &str) -> Option<String> {
    None
}

/// Every undirected lane once, ascending.
fn lanes(galaxy: &Galaxy) -> BTreeSet<(u32, u32)> {
    let mut pairs = BTreeSet::new();
    for system in galaxy.systems.values() {
        for lane in &system.lanes {
            pairs.insert((system.id.min(lane.to), system.id.max(lane.to)));
        }
    }
    pairs
}

fn exported(session: &Session, name: &str) -> Vec<u8> {
    let options = export::options_for(&session.graph, name);
    export::scenario_text(&session.graph, &options, &no_names, ScenarioProfile::Plain)
}

#[test]
fn the_sample_exports_to_the_committed_fixture_and_reads_back_as_the_same_galaxy() {
    let save = common::open();
    let committed = std::fs::read(FIXTURE).expect("read the committed scenario fixture");
    assert_eq!(
        exported(&save, NAME),
        committed,
        "the fixture is generated: re-export it with `sgf export-scenario`"
    );

    let scenario = Session::open(FIXTURE).expect("open the exported scenario");
    assert_eq!(scenario.kind(), DocumentKind::Scenario);
    assert_eq!(scenario.title(), NAME);
    assert_eq!(scenario.graph.order, save.graph.order);
    assert_eq!(scenario.graph.systems.len(), 791);
    for (id, system) in &save.graph.systems {
        let written = &scenario.graph.systems[id];
        assert_eq!(
            (written.x, written.y),
            (rounded(system.x), rounded(system.y))
        );
        assert_eq!(written.initializer, system.initializer);
    }
    assert_eq!(lanes(&scenario.graph), lanes(&save.graph));
    assert_eq!(scenario.graph.nebulae.len(), 9);

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("roundtrip.txt");
    let mut scenario = scenario;
    scenario.save_as(&path).expect("save the scenario back out");
    assert_eq!(std::fs::read(&path).unwrap(), committed);
}

#[test]
fn a_save_opens_as_an_unsaved_scenario_of_the_same_galaxy() {
    let mut session =
        export::open_save_as_scenario(Path::new(common::SAMPLE), &no_names, ScenarioProfile::Plain)
            .expect("open as scenario");
    assert_eq!(session.kind(), DocumentKind::Scenario);
    assert_eq!(session.title(), NAME);
    assert_eq!(session.path, None);
    assert!(session.is_dirty());

    let error = session
        .save_to(None)
        .expect_err("a pathless document cannot save in place");
    assert!(matches!(error, document::Error::NoPath), "{error:?}");

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("from_save.txt");
    session.save_as(&path).expect("save_as names the file");
    assert_eq!(session.path.as_deref(), Some(path.as_path()));
    assert!(!session.is_dirty());

    let reopened = Session::open(&path).expect("reopen what was saved");
    assert_eq!(reopened.graph.order, session.graph.order);
    assert_eq!(lanes(&reopened.graph), lanes(&session.graph));

    let error =
        export::open_save_as_scenario(Path::new(GRAMMAR), &no_names, ScenarioProfile::Plain)
            .expect_err("a scenario is not a save");
    assert!(error.to_string().contains("already a scenario"), "{error}");
}

#[test]
fn scenario_text_opens_as_an_unsaved_scenario_named_from_its_header() {
    let text = std::fs::read(GRAMMAR).expect("read the grammar fixture");
    let mut session = export::open_scenario_text(text).expect("open the scenario text");
    assert_eq!(session.kind(), DocumentKind::Scenario);
    assert_eq!(session.title(), "sgf_grammar");
    assert_eq!(session.path, None);
    assert!(session.is_dirty());

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("from_text.txt");
    session.save_as(&path).expect("save_as names the file");
    assert_eq!(session.path.as_deref(), Some(path.as_path()));
}

#[test]
fn scenario_text_without_a_static_galaxy_scenario_block_is_refused() {
    let error = export::open_scenario_text(b"hello = 1".to_vec()).expect_err("not a scenario file");
    assert!(
        error.to_string().contains("static_galaxy_scenario"),
        "{error}"
    );
}

#[test]
fn a_new_scenario_is_a_header_with_nothing_in_it() {
    let mut session =
        export::new_scenario("sgf_test", 0.0, ScenarioProfile::Plain).expect("new scenario");
    assert_eq!(session.kind(), DocumentKind::Scenario);
    assert_eq!(session.title(), "sgf_test");
    assert!(session.graph.systems.is_empty());
    assert!(session.graph.nebulae.is_empty());
    assert_eq!(session.graph.galaxy_radius, 0.0);
    assert_eq!(session.path, None);
    assert!(session.is_dirty());

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sgf_test.txt");
    session.save_as(&path).expect("save the new scenario");

    let reopened = Session::open(&path).expect("reopen the new scenario");
    assert_eq!(reopened.title(), "sgf_test");
    assert!(reopened.graph.systems.is_empty());
    common::snapshot(
        "new_scenario",
        &String::from_utf8(std::fs::read(&path).unwrap()).unwrap(),
    );
}

#[test]
fn a_new_paint_a_galaxy_scenario_is_the_mods_header_with_nothing_in_it() {
    let mut session =
        export::new_scenario("sgf_test", 0.0, ScenarioProfile::PaintAGalaxy).expect("new scenario");
    assert_eq!(session.title(), "sgf_test");
    assert!(session.graph.systems.is_empty());

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sgf_test.txt");
    session.save_as(&path).expect("save the new scenario");
    let reopened = Session::open(&path).expect("reopen the new scenario");
    assert_eq!(reopened.title(), "sgf_test");
    common::snapshot(
        "new_scenario_paint",
        &String::from_utf8(std::fs::read(&path).unwrap()).unwrap(),
    );
}

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

/// Where `needle` first occurs in `bytes` at or after `from`.
fn find(bytes: &[u8], from: usize, needle: &str) -> usize {
    from + bytes[from..]
        .windows(needle.len())
        .position(|w| w == needle.as_bytes())
        .unwrap_or_else(|| panic!("{needle:?} not found"))
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

fn default_capitals(save: &Session) -> BTreeSet<u32> {
    save.graph
        .countries
        .iter()
        .filter(|c| c.country_type == "default")
        .filter_map(|c| c.capital_system)
        .collect()
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
    let options = export::options_for(&save.graph, NAME);
    let text = export::scenario_text(
        &save.graph,
        &options,
        &no_names,
        ScenarioProfile::PaintAGalaxy,
    );
    let text = String::from_utf8(text).expect("utf-8");
    assert!(
        text.starts_with(
            "# Written by Stellaris Galaxy Forge for the Paint a Galaxy mod (Steam Workshop 3532904115), which this map requires.
static_galaxy_scenario = {
	name = \"2206.11.16\"
	priority = 10
"
        ),
        "{}",
        &text[..300]
    );

    assert!(capitals.len() > 1, "{capitals:?}");
    let empires = capitals.len() - 1;
    assert!(
        text.contains(&format!(
            "	num_empires = {{ min = 0 max = {empires} }}
	num_empire_default = {empires}
"
        )),
        "{}",
        &text[..1200]
    );
    assert!(
        text.contains(&format!(
            "	nomad_empire_max = {empires}
"
        )),
        "{}",
        &text[..1200]
    );
    assert!(
        text.contains(
            "	fallen_empire_default = 2
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

    let reopened =
        export::open_scenario_text(text.into_bytes()).expect("the profile's text reads back");
    assert_eq!(reopened.graph.order, save.graph.order);
    for (i, id) in capitals.iter().enumerate() {
        let system = &reopened.graph.systems[id];
        assert_eq!(
            system.spawn_script,
            Some(SpawnScript::PaintAGalaxy {
                kind: PaintSpawnKind::Enabled,
                random_value: (i % 10) as u8,
            }),
            "{id}"
        );
        assert!(!system.initializer.is_empty(), "{id}");
        let expected = match save.graph.systems[id].initializer.as_str() {
            "" => format!("random_empire_init_0{}", id % 6 + 1),
            own => own.to_owned(),
        };
        assert_eq!(system.initializer, expected, "{id}");
    }

    let near = within(&save.graph, &capitals, 2);
    let mut filled = 0;
    for id in &save.graph.order {
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
fn a_scenario_name_that_cannot_be_quoted_is_refused_or_dropped() {
    for name in ["My \"Best\" Galaxy", "back\\slash", "two\nlines", ""] {
        let error = export::new_scenario(name, 0.0, ScenarioProfile::Plain).expect_err("refused");
        assert!(
            error.to_string().contains("scenario name"),
            "{name:?}: {error}"
        );
    }

    let save = common::open();
    let doc = document::Document::from_scenario_bytes(exported(&save, "My \"Best\" Galaxy"))
        .expect("an exported scenario reads back");
    let scenario = Session::from_document(None, doc).expect("project the exported scenario");
    assert_eq!(scenario.title(), "My Best Galaxy");
    assert_eq!(scenario.graph.order, save.graph.order);
}

#[test]
fn writing_over_a_scenario_backs_the_old_one_up() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("target.txt");

    let first = export::write_scenario(&path, b"first").expect("write");
    assert_eq!(first.backup, None);

    let second = export::write_scenario(&path, b"second").expect("write over");
    let backup = second.backup.expect("a backup of the displaced file");
    assert!(
        backup
            .file_name()
            .unwrap()
            .to_string_lossy()
            .contains(".bak-"),
        "{}",
        backup.display()
    );
    assert_eq!(std::fs::read(&backup).unwrap(), b"first");
    assert_eq!(std::fs::read(&path).unwrap(), b"second");
}
