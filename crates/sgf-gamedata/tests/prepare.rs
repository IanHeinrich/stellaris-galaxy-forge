//! Preparing a scenario for a new game, on both sample saves opened as a plain and as a
//! Paint a Galaxy scenario, with the real install: which row each system stands in, what
//! each preset writes, and that undo puts every byte back.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

use sgf_core::document::Document;
use sgf_core::export::{self, ScenarioProfile};
use sgf_core::ops::Op;
use sgf_core::prepare::{
    self, PlainDraw, PrepareChoice, PrepareError, PreparePreset, PrepareRow, RowChoice, RowSystems,
};
use sgf_core::session::Session;
use sgf_gamedata::GameData;
use sgf_gamedata::prepare::{classify, plain_draw};

use crate::common;

/// The rows whose systems stand in no other of them.
const INITIALIZER_ROWS: [PrepareRow; 8] = [
    PrepareRow::HomeStarts,
    PrepareRow::HomeNeighbours,
    PrepareRow::OriginAndEvent,
    PrepareRow::MarauderClans,
    PrepareRow::Guardians,
    PrepareRow::Enclaves,
    PrepareRow::Primitives,
    PrepareRow::SpecialSystems,
];

/// How many changed lines a Bare shell snapshot shows before it counts the rest.
const SHOWN: usize = 40;

/// The sample `save` opened as an unsaved scenario under `profile`, its names as the save
/// holds them.
fn scenario(save: Session, profile: ScenarioProfile) -> Session {
    let options = export::options_for_session(&save, "sample");
    let (text, _) = export::scenario_text(save.graph(), &options, &|_| None, &|_| None, profile);
    let doc = Document::from_scenario_bytes(text).expect("index the scenario");
    Session::from_document(None, doc).expect("project the scenario")
}

fn samples() -> [(&'static str, Session); 4] {
    [
        (
            "4_4_plain",
            scenario(common::open_4_4(), ScenarioProfile::Plain),
        ),
        (
            "4_4_paint",
            scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy),
        ),
        (
            "4_5_plain",
            scenario(common::open_4_5(), ScenarioProfile::Plain),
        ),
        (
            "4_5_paint",
            scenario(common::open_4_5(), ScenarioProfile::PaintAGalaxy),
        ),
    ]
}

fn current(session: &Session) -> Vec<u8> {
    session.doc().pieces().collect::<Vec<_>>().concat()
}

fn build(
    gd: &GameData,
    session: &Session,
    rows: &[RowSystems],
    choices: &[RowChoice],
) -> Option<Op> {
    prepare::build(session, rows, choices, &plain_draw(gd, 0)).expect("build the batch")
}

/// The description, the members by op, and each line the batch rewrote, the first
/// `shown` of them when given.
fn report(session: &Session, result_description: &str, op: &Op, shown: Option<usize>) -> String {
    let Op::Batch { ops, .. } = op else {
        panic!("one batch");
    };
    let mut out = format!("{result_description}\n");
    let mut members: BTreeMap<&str, usize> = BTreeMap::new();
    for member in ops {
        *members.entry(member.name()).or_default() += 1;
    }
    for (name, n) in members {
        writeln!(out, "{name}: {n}").unwrap();
    }
    let before = String::from_utf8_lossy(session.doc().original()).into_owned();
    let after = String::from_utf8_lossy(&current(session)).into_owned();
    let (before, after): (Vec<&str>, Vec<&str>) =
        (before.lines().collect(), after.lines().collect());
    assert_eq!(before.len(), after.len(), "every change stays on its line");
    let changed: Vec<(&str, &str)> = before
        .iter()
        .zip(&after)
        .filter(|(b, a)| b != a)
        .map(|(b, a)| (*b, *a))
        .collect();
    let limit = shown.unwrap_or(changed.len());
    for (b, a) in changed.iter().take(limit) {
        writeln!(out, "-{}\n+{}", b.trim(), a.trim()).unwrap();
    }
    if changed.len() > limit {
        writeln!(out, "… {} more changed lines", changed.len() - limit).unwrap();
    }
    out
}

#[test]
fn each_system_stands_in_one_initializer_row_unless_it_is_a_seat_or_a_fallen_empires() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let rows = classify(&session, gd);
    let counts: Vec<(PrepareRow, usize)> = rows.iter().map(|r| (r.row, r.systems.len())).collect();
    assert_eq!(
        counts,
        [
            (PrepareRow::EmpireSeats, 17),
            (PrepareRow::HomeStarts, 4),
            (PrepareRow::HomeNeighbours, 32),
            (PrepareRow::OriginAndEvent, 7),
            (PrepareRow::FallenEmpires, 24),
            (PrepareRow::MarauderClans, 6),
            (PrepareRow::Guardians, 6),
            (PrepareRow::Enclaves, 14),
            (PrepareRow::Primitives, 4),
            (PrepareRow::SpecialSystems, 184),
            (PrepareRow::OrdinarySystems, 497),
            (PrepareRow::WormholePairs, 0),
            (PrepareRow::SystemNames, 791),
        ]
    );
    let of = |row: PrepareRow| -> BTreeSet<u32> {
        let found = rows
            .iter()
            .find(|r| r.row == row)
            .expect("every row is listed");
        found.systems.iter().copied().collect()
    };
    let mut placed: BTreeSet<u32> = BTreeSet::new();
    for row in INITIALIZER_ROWS
        .into_iter()
        .chain([PrepareRow::OrdinarySystems])
    {
        for id in of(row) {
            assert!(
                placed.insert(id),
                "system {id} stands in two initializer rows"
            );
        }
    }
    let unplaced: BTreeSet<u32> = of(PrepareRow::SystemNames)
        .difference(&placed)
        .copied()
        .collect();
    let seats_and_fallen: BTreeSet<u32> = of(PrepareRow::EmpireSeats)
        .union(&of(PrepareRow::FallenEmpires))
        .copied()
        .collect();
    assert!(unplaced.is_subset(&seats_and_fallen), "{unplaced:?}");
    assert!(of(PrepareRow::HomeStarts).is_subset(&of(PrepareRow::EmpireSeats)));
}

#[test]
fn each_preset_on_each_sample_and_profile_is_one_edit_that_undo_takes_back() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    for (name, mut session) in samples() {
        let rows = classify(&session, gd);
        let original = session.doc().original().to_vec();
        assert_eq!(
            build(gd, &session, &rows, &PreparePreset::Faithful.choices()),
            None,
            "{name}: Faithful changes nothing"
        );
        for (preset, label, shown) in [
            (PreparePreset::FreshStart, "fresh_start", None),
            (PreparePreset::BareShell, "bare_shell", Some(SHOWN)),
        ] {
            let op = build(gd, &session, &rows, &preset.choices()).expect("a change");
            let result = session.apply(op.clone()).expect("apply the batch");
            assert_eq!(
                session.history().undo.len(),
                1,
                "{name} {label}: one undo step"
            );
            let out = report(&session, &result.entry.description, &op, shown);
            insta::with_settings!({snapshot_path => "snapshots/prepare", prepend_module_to_snapshot => false}, {
                insta::assert_snapshot!(format!("{name}_{label}"), out);
            });
            session.undo().expect("undo").expect("an edit to undo");
            assert_eq!(
                current(&session),
                original,
                "{name} {label}: undo is byte-exact"
            );
            assert!(
                !session.doc().is_dirty(),
                "{name} {label}: undo leaves the overlay empty"
            );
        }
    }
}

#[test]
fn a_choice_its_row_does_not_offer_is_refused() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let rows = classify(&session, gd);
    let unoffered = RowChoice {
        row: PrepareRow::OrdinarySystems,
        choice: PrepareChoice::Plain,
    };
    let refused = prepare::build(&session, &rows, &[unoffered], &plain_draw(gd, 0));
    assert_eq!(
        refused,
        Err(PrepareError::Unoffered {
            row: PrepareRow::OrdinarySystems,
            choice: PrepareChoice::Plain
        })
    );
    let twice = [
        RowChoice {
            row: PrepareRow::SystemNames,
            choice: PrepareChoice::Keep,
        },
        RowChoice {
            row: PrepareRow::SystemNames,
            choice: PrepareChoice::GameNames,
        },
    ];
    let refused = prepare::build(&session, &rows, &twice, &plain_draw(gd, 0));
    assert_eq!(
        refused,
        Err(PrepareError::RowTwice(PrepareRow::SystemNames))
    );
}

#[test]
fn seats_zones_and_names_left_out_on_a_paint_a_galaxy_map_go_and_undo_brings_them_back() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let zones: BTreeSet<u8> = session
        .graph()
        .systems
        .values()
        .filter(|system| system.fe_zone.is_some())
        .filter_map(|system| system.fe_link.id)
        .collect();
    let linked = |session: &Session| {
        let systems = session.graph().systems.values();
        systems
            .filter(|s| {
                s.fe_link.custom
                    || s.fe_link.id.is_some()
                    || s.fe_link.to.iter().any(|n| zones.contains(n))
            })
            .count()
    };
    assert!(
        linked(&session) > zones.len(),
        "the zones take custom connections: {zones:?}"
    );
    let rows = classify(&session, gd);
    let choices = [
        (PrepareRow::EmpireSeats, PrepareChoice::None),
        (PrepareRow::FallenEmpires, PrepareChoice::None),
        (PrepareRow::SystemNames, PrepareChoice::GameNames),
    ]
    .map(|(row, choice)| RowChoice { row, choice });
    let op = build(gd, &session, &rows, &choices).expect("a change");
    let result = session.apply(op.clone()).expect("apply the batch");
    let out = report(&session, &result.entry.description, &op, Some(0));
    insta::with_settings!({snapshot_path => "snapshots/prepare", prepend_module_to_snapshot => false}, {
        insta::assert_snapshot!("4_4_paint_seats_zones_names", out);
    });
    for system in session.graph().systems.values() {
        assert!(
            system.spawn_script.is_none() && system.spawn_weight.is_none(),
            "{}",
            system.id
        );
        assert!(system.fe_zone.is_none(), "{}", system.id);
        assert!(system.name.key.is_empty(), "{}", system.id);
    }
    assert_eq!(linked(&session), 0, "no link into a removed zone is left");
    assert!(
        !String::from_utf8_lossy(&current(&session))
            .contains("painted_galaxy_fe_custom_connection")
    );
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn a_paint_a_galaxy_export_has_no_home_starts_left_to_make_generic() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let counts: Vec<(PrepareRow, usize)> = classify(&session, gd)
        .iter()
        .map(|r| (r.row, r.systems.len()))
        .collect();
    assert_eq!(
        counts,
        [
            (PrepareRow::EmpireSeats, 17),
            (PrepareRow::HomeStarts, 0),
            (PrepareRow::HomeNeighbours, 32),
            (PrepareRow::OriginAndEvent, 7),
            (PrepareRow::FallenEmpires, 4),
            (PrepareRow::MarauderClans, 6),
            (PrepareRow::Guardians, 6),
            (PrepareRow::Enclaves, 14),
            (PrepareRow::Primitives, 4),
            (PrepareRow::SpecialSystems, 183),
            (PrepareRow::OrdinarySystems, 495),
            (PrepareRow::WormholePairs, 12),
            (PrepareRow::SystemNames, 765),
        ]
    );
}

#[test]
fn an_initializer_the_install_does_not_know_stands_with_the_special_systems() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mut session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let system = session.graph().order[0];
    session
        .apply(Op::SetInitializer {
            system,
            initializer: Some("sgf_unknown_layout".to_owned()),
        })
        .expect("set an initializer no install has");
    let rows = classify(&session, gd);
    let special = rows
        .iter()
        .find(|r| r.row == PrepareRow::SpecialSystems)
        .expect("the row");
    assert!(special.systems.contains(&system), "{system}");
}

#[test]
fn plain_system_with_nothing_to_draw_is_refused() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let rows = classify(&session, gd);
    let plain = [RowChoice {
        row: PrepareRow::OriginAndEvent,
        choice: PrepareChoice::Plain,
    }];
    let refused = prepare::build(&session, &rows, &plain, &PlainDraw::default());
    assert_eq!(refused, Err(PrepareError::NoPlainLayouts));
}
