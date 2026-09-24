//! Plain scenario export through the public API: the sample save's galaxy written out,
//! read back and compared against the committed fixture, a save opened as a scenario, and
//! a new empty scenario.
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use sgf_core::VERSION;
use sgf_core::document;
use sgf_core::emit::rounded;
use sgf_core::export::policy::Category;
use sgf_core::export::{self, DroppedBypasses, ExportReport, HomeInitializer, ScenarioProfile};
use sgf_core::projections::galaxy::{BypassLink, Galaxy};
use sgf_core::session::Session;
use sgf_core::validate::{IssueCode, Severity};
use sgf_core::views::DocumentKind;

mod common;
use common::export::{
    NAME, SAVE_FILE, at_fixture_version, default_capitals, exported_as, lanes, no_names,
    no_sources, seated,
};
use common::fixture::{EXPORTED, GRAMMAR, from_scenario_text};

/// The plain export as `sgf export-scenario` writes it from the sample save.
fn exported(session: &Session, name: &str) -> (Vec<u8>, ExportReport) {
    exported_as(session, name, ScenarioProfile::Plain)
}

/// The sample's bypasses as the save holds them: six wormhole pairs, each listed once;
/// gateways all on an initializer that rebuilds them; L-Gates all on one that spawns
/// `lgate_base`. So the plain export drops the pairs and nothing else.
fn assert_sample_bypasses(galaxy: &Galaxy) {
    let mut pairs = BTreeSet::new();
    for link in &galaxy.bypasses {
        match link {
            BypassLink::Wormhole { a, b } => {
                assert!(pairs.insert((a.min(b), a.max(b))), "{link:?} listed twice");
            }
            BypassLink::Gateway { system, .. } => {
                let initializer = &galaxy.systems[system].initializer;
                assert!(
                    initializer.starts_with("abandoned_gateways"),
                    "{system}: {initializer}"
                );
            }
            BypassLink::LGate { system } => {
                let initializer = galaxy.systems[system].initializer.as_str();
                assert!(
                    matches!(
                        initializer,
                        "distantstars_init_00" | "distantstars_init_01" | "distantstars_init_06"
                    ) || initializer.starts_with("lgate"),
                    "{system}: {initializer}"
                );
            }
            BypassLink::Other { .. } => {}
        }
    }
    assert_eq!(pairs.len(), 6);
}

#[test]
fn the_sample_exports_to_the_committed_fixture_and_reads_back_as_the_same_galaxy() {
    let save = common::open();
    let committed = EXPORTED.bytes();
    let (text, report) = exported(&save, NAME);
    assert_eq!(
        at_fixture_version(&text),
        committed,
        "the fixture is generated: re-export it with `sgf export-scenario` and write its version as 0.0.0"
    );
    let text = String::from_utf8(text).expect("utf-8");

    let capitals = default_capitals(&save);
    let seats = capitals.len();
    assert_eq!(seats, 17);
    let empires = seats - 1;
    assert!(
        text.starts_with(&format!(
            "# created by Stellaris Galaxy Forge {VERSION} (converted from save {SAVE_FILE})
# Systems: 791 · Empire seats: {seats} · Nebulae: 9
# Not carried over: 6 wormhole pairs
static_galaxy_scenario = {{
	name = \"{NAME}\"
	priority = 5
	supports_shape = elliptical
	supports_shape = ring
	supports_shape = spiral_2
	supports_shape = spiral_3
	supports_shape = spiral_4
	supports_shape = spiral_6
	supports_shape = bar
	supports_shape = starburst
	supports_shape = cartwheel
	supports_shape = spoked
	default = no
	num_empires = {{ min = 0 max = {empires} }}
	num_empire_default = {empires}
"
        )),
        "{}",
        &text[..800]
    );
    assert_eq!(text.matches("\tsupports_shape = ").count(), 10);
    assert_eq!(seated(&text), capitals);
    assert_eq!(text.matches("spawn_weight").count(), seats);

    assert_eq!(report.seats, seats as u32);
    let home = |system: u32, initializer: &str| HomeInitializer {
        system,
        initializer: initializer.to_owned(),
        replaced: false,
    };
    assert_eq!(
        report.home_initializers,
        [
            home(4, "une_deneb_system"),
            home(311, "shattered_ring_start"),
            home(786, "custom_starting_init_02"),
            home(787, "custom_starting_init_02"),
        ]
    );
    assert_sample_bypasses(&save.graph);
    assert_eq!(
        report.dropped,
        DroppedBypasses {
            wormhole_pairs: 6,
            gateways: 0,
            lgates: 0,
        }
    );
    assert_eq!(report.sources, []);
    assert_eq!(report.omitted, []);
    assert_eq!(report.fallen_empires, []);
    assert_eq!(report.player_seat, None);
    assert!(!report.setup_from_save);
    let by_category: BTreeMap<Category, u32> = report
        .by_category
        .iter()
        .map(|c| (c.category, c.systems))
        .collect();
    assert_eq!(by_category[&Category::Home], seats as u32);
    assert_eq!(by_category.values().sum::<u32>(), 791);
    assert!(
        report
            .by_category
            .windows(2)
            .all(|pair| pair[0].category < pair[1].category),
        "{:?}",
        report.by_category
    );

    let issues = report.issues();
    assert!(issues.iter().all(|i| i.severity == Severity::Warning));
    assert!(
        issues.iter().all(|i| i.note),
        "an export's issues are notes"
    );
    let dropped: Vec<&str> = issues
        .iter()
        .filter(|i| i.code == IssueCode::ExportDropped)
        .map(|i| i.message.as_str())
        .collect();
    assert_eq!(
        dropped,
        ["6 wormhole pairs were not carried into the scenario"]
    );
    let homes: Vec<(&[u32], bool)> = issues
        .iter()
        .filter(|i| i.code == IssueCode::HomeInitializer)
        .map(|i| {
            let named = i.message.contains(&format!("system {} ", i.systems[0]));
            (i.systems.as_slice(), named)
        })
        .collect();
    assert_eq!(
        homes,
        [
            (&[4][..], true),
            (&[311][..], true),
            (&[786][..], true),
            (&[787][..], true)
        ]
    );
    assert_eq!(issues.len(), 5);

    let scenario = EXPORTED.open();
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
        assert_eq!(
            written.spawn_weight,
            capitals.contains(id).then_some(1.0),
            "{id}"
        );
    }
    assert_eq!(lanes(&scenario.graph), lanes(&save.graph));
    assert_eq!(scenario.graph.nebulae.len(), 9);

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("roundtrip.txt");
    let mut scenario = scenario;
    scenario.save_as(&path).expect("save the scenario back out");
    assert_eq!(std::fs::read(&path).unwrap(), committed);

    // The save's shape leads the list; the sample's is elliptical, which leads anyway.
    let mut ring = common::open();
    ring.graph.setup.as_mut().expect("the sample's setup").shape = "ring".to_owned();
    let (text, report) = exported(&ring, NAME);
    let text = String::from_utf8(text).expect("utf-8");
    assert!(
        text.contains(
            "	priority = 5
	supports_shape = ring
	supports_shape = elliptical
	supports_shape = spiral_2
"
        ),
        "{}",
        &text[..800]
    );
    assert_eq!(text.matches("\tsupports_shape = ").count(), 10);
    assert_eq!(text.matches("\tsupports_shape = ring\n").count(), 1);
    assert_eq!(
        text.lines().count(),
        committed.split(|&b| b == b'\n').count() - 1
    );
    assert_eq!(report, exported(&save, NAME).1);
}

#[test]
fn a_save_opens_as_an_unsaved_scenario_of_the_same_galaxy() {
    let (mut session, report) = export::open_save_as_scenario(
        Path::new(common::SAMPLE),
        &no_names,
        &no_sources,
        ScenarioProfile::Plain,
    )
    .expect("open as scenario");
    assert_eq!(session.kind(), DocumentKind::Scenario);
    assert_eq!(session.title(), NAME);
    assert_eq!(session.path, None);
    assert!(session.is_dirty());
    assert_eq!(report, exported(&common::open(), NAME).1);
    assert!(
        common::current(&session).starts_with(
            format!(
                "# created by Stellaris Galaxy Forge {VERSION} (converted from save {SAVE_FILE})\n"
            )
            .as_bytes()
        )
    );

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

    let error = export::open_save_as_scenario(
        Path::new(GRAMMAR.path),
        &no_names,
        &no_sources,
        ScenarioProfile::Plain,
    )
    .expect_err("a scenario is not a save");
    assert!(error.to_string().contains("already a scenario"), "{error}");
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
        &String::from_utf8(at_fixture_version(&std::fs::read(&path).unwrap())).unwrap(),
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
        &String::from_utf8(at_fixture_version(&std::fs::read(&path).unwrap())).unwrap(),
    );
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
    let scenario = from_scenario_text(exported(&save, "My \"Best\" Galaxy").0);
    assert_eq!(scenario.title(), "My Best Galaxy");
    assert_eq!(scenario.graph.order, save.graph.order);
}
