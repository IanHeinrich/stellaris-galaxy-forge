//! Static galaxy scenario scripts through the public API, on the grammar fixture.
use std::collections::BTreeSet;
use std::fmt::Write as _;

use sgf_core::document::{self, Document};
use sgf_core::format::scenario::listings::{ScenarioRoot, ScenarioSource, list_scenarios_in};
use sgf_core::ops::{Op, OpError};
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;
use sgf_core::views::{DocumentKind, GalaxyView};

mod common;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/scenario_grammar.txt"
);

fn open() -> Session {
    Session::open(FIXTURE).expect("open the scenario fixture")
}

/// Every distinct lane with its length, ascending.
fn lanes(session: &Session) -> Vec<(u32, u32, f64)> {
    let mut lanes: BTreeSet<(u32, u32, u64)> = BTreeSet::new();
    for system in session.graph.systems.values() {
        for lane in &system.lanes {
            let (a, b) = (system.id.min(lane.to), system.id.max(lane.to));
            lanes.insert((a, b, lane.length.to_bits()));
        }
    }
    lanes
        .into_iter()
        .map(|(a, b, length)| (a, b, f64::from_bits(length)))
        .collect()
}

#[test]
fn the_grammar_fixture_projects_into_the_galaxy() {
    let session = open();
    assert_eq!(session.kind(), DocumentKind::Scenario);
    assert_eq!(session.title(), "sgf_grammar");

    let g = &session.graph;
    assert_eq!(g.order, [1, 2, 16, 111, 3018, 9, 512, 888]);
    assert_eq!(g.systems.len(), 8);

    assert_eq!((g.systems[&1].x, g.systems[&1].y), (0.0, 0.0));
    assert_eq!((g.systems[&2].x, g.systems[&2].y), (0.0, -56.0));
    assert_eq!((g.systems[&16].x, g.systems[&16].y), (-54.0, -88.5));
    // `x = { min = 20 max = 30 }`: the generator picks in the range, the map shows the middle.
    assert_eq!((g.systems[&111].x, g.systems[&111].y), (25.0, 18.0));
    assert_eq!((g.systems[&9].x, g.systems[&9].y), (-90.0, 90.0));

    assert_eq!(g.systems[&2].name.key, "Coruscant");
    assert!(g.systems[&2].name.literal);
    assert_eq!(g.systems[&111].name.key, "NAME_Corellia");
    assert!(!g.systems[&111].name.literal);
    assert_eq!(g.systems[&16].name, Default::default());

    assert_eq!(g.systems[&1].initializer, "misc_system_init_01");
    assert_eq!(g.systems[&2].initializer, "custom_starting_init_01");
    assert_eq!(g.systems[&3018].initializer, "random_empire_init_01");
    assert_eq!(g.systems[&16].initializer, "");

    // 1-2 is listed both ways and 1-16 twice; `prevent_hyperlane` is not a lane.
    assert_eq!(
        lanes(&session),
        [
            (1, 2, 56.0),
            (1, 16, 103.0),
            (16, 111, 132.0),
            (111, 3018, 58.0),
            (512, 888, 44.0),
            (512, 3018, 99.0),
        ]
    );
    for &(a, b, _) in &lanes(&session) {
        assert!(g.lane(a, b).is_some() && g.lane(b, a).is_some(), "{a}-{b}");
    }
    assert!(g.systems[&9].lanes.is_empty());

    assert_eq!(g.nebulae.len(), 2);
    assert_eq!(g.nebulae[0].name.key, "NAME_N_Heart_Galaxy");
    assert!(!g.nebulae[0].name.literal);
    assert_eq!(g.nebulae[0].radius, 60.0);
    assert_eq!(g.nebulae[0].systems, [1, 2, 111]);
    assert_eq!(g.nebulae[1].name.key, "Far Cloud");
    assert!(g.nebulae[1].name.literal);
    assert_eq!(g.nebulae[1].systems, [9]);
    assert_eq!(g.systems[&111].nebula, Some(0));
    assert_eq!(g.systems[&9].nebula, Some(1));
    assert_eq!(g.systems[&3018].nebula, None);

    assert_eq!(g.core_radius, 10.0);
    assert_eq!(g.galaxy_radius, 128.0);

    let issues = session.validate();
    assert!(
        issues
            .iter()
            .any(|i| i.code == IssueCode::CoordinateTransform),
        "{issues:?}"
    );

    let view = GalaxyView::from(&session.graph);
    let mut report = String::new();
    writeln!(
        report,
        "radius {} core {} components {}",
        view.galaxy_radius, view.core_radius, view.components
    )
    .unwrap();
    for s in &view.systems {
        writeln!(
            report,
            "system {} \"{}\"{} ({}, {}) init={} nebula={:?} lanes={:?}",
            s.id,
            s.name.key,
            if s.name.literal { " literal" } else { "" },
            s.x,
            s.y,
            s.initializer,
            s.nebula,
            s.lanes.iter().map(|l| (l.to, l.length)).collect::<Vec<_>>()
        )
        .unwrap();
    }
    for n in &view.nebulae {
        writeln!(
            report,
            "nebula \"{}\" ({}, {}) r={} systems={:?}",
            n.name.key, n.x, n.y, n.radius, n.systems
        )
        .unwrap();
    }
    for issue in &issues {
        writeln!(
            report,
            "{} {}: {}",
            issue.severity, issue.code, issue.message
        )
        .unwrap();
    }
    common::snapshot("grammar_fixture", &report);
}

#[test]
fn saving_an_untouched_scenario_is_byte_identical_and_writes_nothing_twice() {
    let original = std::fs::read(FIXTURE).expect("read the fixture");
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("scenario_grammar.txt");

    let mut session = open();
    let outcome = session.save_as(&path).expect("save_as");
    assert_eq!(outcome.backup, None);
    assert_eq!(std::fs::read(&path).unwrap(), original);

    let outcome = session.save_as(&path).expect("save over the written file");
    assert_eq!(outcome.backup, None, "identical bytes make no backup");
    assert_eq!(std::fs::read(&path).unwrap(), original);
}

#[test]
fn the_kind_comes_from_the_bytes_not_the_extension() {
    let dir = tempfile::tempdir().unwrap();
    let misnamed = dir.path().join("actually_a_save.txt");
    std::fs::copy(common::SAMPLE, &misnamed).expect("copy the sample save");

    assert_eq!(document::sniff(&misnamed), DocumentKind::Save);
    assert_eq!(document::sniff(common::SAMPLE), DocumentKind::Save);
    assert_eq!(document::sniff(FIXTURE), DocumentKind::Scenario);
    assert_eq!(
        Document::load(&misnamed)
            .expect("load the misnamed save")
            .kind(),
        DocumentKind::Save
    );
}

#[test]
fn a_file_that_is_not_one_static_galaxy_scenario_is_refused() {
    let refusal = |text: &str| {
        Document::from_scenario_bytes(text.as_bytes().to_vec())
            .err()
            .map(|e| e.to_string())
            .unwrap_or_else(|| panic!("expected a refusal for {text:?}"))
    };

    let dynamic = refusal("setup_scenario = { name = \"x\" }\n");
    assert!(dynamic.contains("dynamic shape scenario"), "{dynamic}");

    let commented = refusal("# everything here is commented out\n#static_galaxy_scenario = { }\n");
    assert!(
        commented.contains("no `static_galaxy_scenario` block"),
        "{commented}"
    );

    let id = refusal("static_galaxy_scenario = {\n\tsystem = { id = \"two\" }\n}\n");
    assert!(
        id.contains("system id `two`") && id.contains("at byte 44") && id.contains("not a number"),
        "{id}"
    );

    let two = refusal("static_galaxy_scenario = { }\nstatic_galaxy_scenario = { }\n");
    assert!(two.contains("2 top-level statements"), "{two}");
}

#[test]
fn a_length_op_is_refused_and_leaves_the_scenario_untouched() {
    let mut session = open();
    let error = session
        .apply(Op::SetLaneLength {
            a: 1,
            b: 2,
            length: 40.0,
        })
        .expect_err("a scenario's lanes carry no length");
    assert!(
        matches!(
            error,
            OpError::Unsupported {
                op: "SetLaneLength",
                kind: DocumentKind::Scenario
            }
        ),
        "{error:?}"
    );
    assert_eq!(
        error.to_string(),
        "SetLaneLength is not supported for a scenario document"
    );
    assert!(
        session
            .apply(Op::NormaliseLaneLength { a: 1, b: 2 })
            .is_err()
    );
    assert!(
        session
            .apply(Op::NormaliseLaneLengths { systems: vec![1] })
            .is_err()
    );
    assert!(
        session
            .apply(Op::AddLane {
                a: 1,
                b: 9,
                bridge: true,
            })
            .is_err()
    );

    assert!(!session.doc.is_dirty());
    assert!(!session.is_dirty());
    assert_eq!(session.history().undo.len(), 0);
    assert_eq!(session.graph.systems[&1].x, 0.0);
}

#[test]
fn every_scenario_root_is_listed_with_its_name_count_and_overrides() {
    let tmp = tempfile::tempdir().expect("temp dir");
    let modded = tmp.path().join("star-maps/map/setup_scenarios");
    let install = tmp.path().join("install/map/setup_scenarios");
    std::fs::create_dir_all(&modded).expect("mod root");
    std::fs::create_dir_all(&install).expect("install root");
    std::fs::copy(FIXTURE, modded.join("grammar.txt")).expect("copy the fixture");
    std::fs::copy(FIXTURE, install.join("grammar.txt")).expect("copy the fixture");
    std::fs::write(
        modded.join("example.txt"),
        b"# the vanilla example, every line of it commented out\n# static_galaxy_scenario = { }\n",
    )
    .expect("write the commented-out example");

    let roots = [
        ScenarioRoot {
            dir: modded,
            source: ScenarioSource::Mod,
            mod_name: Some("Star Maps".to_owned()),
            enabled: true,
            load_rank: Some(1),
            replaces: false,
        },
        ScenarioRoot {
            dir: install,
            source: ScenarioSource::Install,
            mod_name: None,
            enabled: true,
            load_rank: Some(0),
            replaces: false,
        },
    ];
    let listings = list_scenarios_in(&roots);
    // The commented-out example holds no `static_galaxy_scenario` block: not a static
    // scenario, so not listed. Roots in the order given, files by name within each.
    assert_eq!(listings.len(), 2, "{listings:#?}");

    let winner = &listings[0];
    assert_eq!(winner.name, "sgf_grammar");
    assert_eq!(winner.systems, 8);
    assert_eq!(winner.error, None);
    assert_eq!(winner.shadowed_by, None);
    assert_eq!(winner.mod_name.as_deref(), Some("Star Maps"));
    assert!(winner.enabled);
    assert!(winner.size > 0 && winner.modified > 0);

    // Vanilla loads first, so the mod's file of the same name is the one the game reads.
    let shadowed = &listings[1];
    assert_eq!(shadowed.source, ScenarioSource::Install);
    assert_eq!(shadowed.name, "sgf_grammar");
    assert_eq!(shadowed.systems, 8);
    assert_eq!(shadowed.shadowed_by.as_deref(), Some("Star Maps"));
    assert_eq!(shadowed.mod_name, None);
}

#[test]
fn a_system_effect_block_is_read_with_its_line() {
    let session = open();
    let (text, line) = session
        .scenario_system_effect(3018)
        .expect("Iridonia carries an effect block");
    assert!(text.starts_with("effect = {"), "{text}");
    assert!(text.contains("log = \"Success system [This.GetName]\""));
    assert_eq!(line, 47);
    assert_eq!(session.scenario_system_effect(16), None);
}

#[test]
fn the_header_is_listed_in_file_order_and_survives_an_op_that_leaves_it_alone() {
    let mut session = open();
    let header = |session: &Session| GalaxyView::from(&session.graph).header;
    let before = header(&session);
    let keys: Vec<&str> = before.iter().map(|f| f.key.as_str()).collect();
    assert_eq!(
        keys,
        [
            "name",
            "priority",
            "default",
            "supports_shape",
            "num_empires",
            "num_empire_default",
            "fallen_empire_default",
            "fallen_empire_max",
            "marauder_empire_default",
            "marauder_empire_max",
            "advanced_empire_default",
            "colonizable_planet_odds",
            "primitive_odds",
            "num_wormhole_pairs",
            "num_wormhole_pairs_default",
            "num_gateways",
            "num_gateways_default",
            "num_hyperlanes_default",
            "random_hyperlanes",
            "core_radius",
            "crisis_strength",
            "extra_crisis_strength",
            "coordinate_transform",
        ]
    );
    assert_eq!(before[0].value, "\"sgf_grammar\"");
    assert_eq!(before[0].line, 6);
    assert_eq!(before[4].value, "{ min = 1 max = 2 }");
    let transform = &before[22];
    assert!(transform.value.starts_with('{'), "{transform:?}");
    assert!(transform.value.contains("mul = 1"), "{transform:?}");

    // The rebuild re-reads the header from the bytes standing now, so an op that writes
    // elsewhere leaves it whole and an undo does not strand a stale copy.
    session
        .apply(Op::MoveSystem {
            id: 2,
            x: 12.5,
            y: -60.25,
        })
        .expect("move a system");
    assert_eq!(header(&session), before);
    session.undo().expect("undo").expect("an op to undo");
    assert_eq!(header(&session), before);
}

#[test]
fn a_spawn_weight_and_its_modifiers_reach_the_projection() {
    let session = open();
    // `base = 0` beside a modifier is still a stated base; a system with no block has none.
    assert_eq!(session.graph.systems[&2].spawn_weight, Some(0.0));
    assert_eq!(session.graph.systems[&3018].spawn_weight, Some(1.0));
    assert_eq!(session.graph.systems[&1].spawn_weight, None);
    assert_eq!(session.graph.systems[&16].spawn_weight, None);
    // A block of modifiers with no `base` states no base weight, so it reads as none
    // rather than as 0: the modifiers that would decide it are script we do not read.
    assert_eq!(session.graph.systems[&512].spawn_weight, None);

    assert_eq!(session.graph.systems[&2].spawn_modifiers.len(), 1);
    assert_eq!(session.graph.systems[&512].spawn_modifiers.len(), 1);
    assert_eq!(session.graph.systems[&3018].spawn_modifiers.len(), 0);
    assert_eq!(session.graph.systems[&16].spawn_modifiers.len(), 0);
}

#[test]
fn a_prevented_pair_reaches_both_ends_and_is_no_lane() {
    let session = open();
    assert_eq!(session.graph.systems[&9].prevented, [1]);
    assert_eq!(session.graph.systems[&1].prevented, [9]);
    assert!(session.graph.systems[&2].prevented.is_empty());
    assert!(session.graph.lane(9, 1).is_none());
    assert!(session.graph.lane(1, 9).is_none());
}

#[test]
fn an_axis_written_as_a_range_is_warned_about_until_a_move_fixes_it() {
    let mut session = open();
    assert!(session.graph.systems[&111].position_range);
    assert!(!session.graph.systems[&2].position_range);
    let ranged = |session: &Session| {
        session
            .validate()
            .into_iter()
            .filter(|i| i.code == IssueCode::PositionRange)
            .map(|i| i.systems)
            .collect::<Vec<_>>()
    };
    assert_eq!(ranged(&session), [vec![111]]);

    session
        .apply(Op::MoveSystem {
            id: 111,
            x: 25.0,
            y: 18.0,
        })
        .expect("move the system with the ranged axis");
    assert!(!session.graph.systems[&111].position_range);
    assert!(ranged(&session).is_empty());
}

#[test]
fn every_effect_block_in_the_scenario_is_listed_in_one_pass() {
    let mut session = open();
    let effects = session.scenario_system_effects();
    assert_eq!(
        effects.iter().map(|&(id, ..)| id).collect::<Vec<_>>(),
        vec![3018]
    );
    assert!(effects[0].1.starts_with("effect = {"), "{effects:#?}");
    assert_eq!(effects[0].2, 47);
    for (id, text, line) in &effects {
        assert_eq!(
            session.scenario_system_effect(*id),
            Some((text.clone(), *line)),
            "system {id}"
        );
    }

    // A system added with no effect adds nothing to the list.
    session
        .apply(Op::AddSystem {
            id: None,
            x: 10.0,
            y: -20.0,
            name: Some("Effectless".to_owned()),
            initializer: None,
            spawn_weight: None,
        })
        .expect("add a system");
    assert_eq!(session.scenario_system_effects(), effects);

    session
        .apply(Op::RemoveSystem { id: 3018 })
        .expect("remove the system carrying the effect");
    assert!(
        session.scenario_system_effects().is_empty(),
        "{:#?}",
        session.scenario_system_effects()
    );

    assert!(common::open().scenario_system_effects().is_empty());
}

#[test]
fn a_new_system_is_never_given_the_null_id() {
    let text = format!(
        "static_galaxy_scenario = {{\n\tname = \"high ids\"\n\tsystem = {{ id = \"{}\" position = {{ x = 0 y = 0 }} }}\n}}\n",
        sgf_core::NULL_ID - 1
    );
    let doc = Document::from_scenario_bytes(text.into_bytes()).expect("index");
    let mut session = Session::from_document(None, doc).expect("project");
    assert_ne!(session.doc.scenario().unwrap().next_id(), sgf_core::NULL_ID);

    session
        .apply(Op::AddSystem {
            id: None,
            x: 10.0,
            y: 10.0,
            name: Some("Late".to_owned()),
            initializer: None,
            spawn_weight: None,
        })
        .expect("add a system beside one holding the highest id but one");
    assert!(
        !session.graph.systems.contains_key(&sgf_core::NULL_ID),
        "{:?}",
        session.graph.order
    );
}
