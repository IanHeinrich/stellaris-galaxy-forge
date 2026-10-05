//! Preparing a scenario for a new game, on both sample saves opened as a plain and as a
//! Paint a Galaxy scenario, with the real install: which row each system stands in, what
//! each preset writes, that the header's counts follow the map, and that undo puts every
//! byte back.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

use sgf_core::document::Document;
use sgf_core::export::{self, ScenarioProfile};
use sgf_core::format::scenario::fe_zone::{centre, distance};
use sgf_core::format::scenario::header_counts;
use sgf_core::format::scenario::marauder::clan_count;
use sgf_core::format::scenario::paint::basic_initializer;
use sgf_core::format::scenario::{FeKind, FeZone};
use sgf_core::ops::Op;
use sgf_core::prepare::{
    self, PlainDraw, PrepareChoice, PrepareError, PrepareOptions, PreparePreset, PrepareRow,
    RowChoice, RowSystems,
};
use sgf_core::projections::galaxy::{GalaxyGraph, PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;
use sgf_gamedata::GameData;
use sgf_gamedata::prepare::{classify, plain_draw};

use crate::common;

/// The rows whose systems stand in no other of them.
const INITIALIZER_ROWS: [PrepareRow; 9] = [
    PrepareRow::HomeStarts,
    PrepareRow::Sol,
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

fn header_count_issues(session: &Session) -> Vec<String> {
    session
        .validate()
        .into_iter()
        .filter(|issue| issue.code == IssueCode::HeaderEmpireCount)
        .map(|issue| issue.message)
        .collect()
}

fn build(
    gd: &GameData,
    session: &Session,
    rows: &[RowSystems],
    choices: &[RowChoice],
) -> Option<Op> {
    let options = PrepareOptions::default();
    prepare::build(session, rows, choices, &plain_draw(gd, 0), &options).expect("build the batch")
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
            (PrepareRow::Sol, 1),
            (PrepareRow::HomeNeighbours, 32),
            (PrepareRow::OriginAndEvent, 7),
            (PrepareRow::FallenEmpires, 24),
            (PrepareRow::MarauderClans, 6),
            (PrepareRow::Guardians, 6),
            (PrepareRow::Enclaves, 14),
            (PrepareRow::Primitives, 4),
            (PrepareRow::SpecialSystems, 88),
            (PrepareRow::OrdinarySystems, 593),
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
        let profile = prepare::profile(&session);
        let original = session.doc().original().to_vec();
        assert_eq!(
            build(
                gd,
                &session,
                &rows,
                &PreparePreset::Faithful.choices(profile)
            ),
            None,
            "{name}: Faithful changes nothing"
        );
        for (preset, label, shown) in [
            (PreparePreset::FreshStart, "fresh_start", None),
            (PreparePreset::BareShell, "bare_shell", Some(SHOWN)),
        ] {
            let op = build(gd, &session, &rows, &preset.choices(profile)).expect("a change");
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
            assert_eq!(
                header_count_issues(&session),
                Vec::<String>::new(),
                "{name} {label}"
            );
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
    let refused = prepare::build(
        &session,
        &rows,
        &[unoffered],
        &plain_draw(gd, 0),
        &PrepareOptions::default(),
    );
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
    let refused = prepare::build(
        &session,
        &rows,
        &twice,
        &plain_draw(gd, 0),
        &PrepareOptions::default(),
    );
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
    let empires = session.graph().header_block_count("num_empires", "max");
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
    for key in ["fallen_empire_max", "fallen_empire_default"] {
        assert_eq!(session.graph().header_count(key), Some(0), "{key}");
    }
    assert_eq!(
        session.graph().header_block_count("num_empires", "max"),
        empires,
        "the empire counts stay with no seat left"
    );
    assert!(
        !String::from_utf8_lossy(&current(&session))
            .contains("painted_galaxy_fe_custom_connection")
    );
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), session.doc().original());
}

#[test]
fn fallen_empires_and_marauder_clans_left_out_take_their_header_counts_down_in_the_same_edit() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let original = session.doc().original().to_vec();
    let count = |session: &Session, key| session.graph().header_count(key);
    assert_eq!(header_count_issues(&session), Vec::<String>::new());
    assert_ne!(count(&session, "fallen_empire_max"), Some(0));
    assert_ne!(count(&session, "marauder_empire_max"), Some(0));
    let rows = classify(&session, gd);
    let choices = [
        (PrepareRow::FallenEmpires, PrepareChoice::None),
        (PrepareRow::MarauderClans, PrepareChoice::Plain),
    ]
    .map(|(row, choice)| RowChoice { row, choice });
    let op = build(gd, &session, &rows, &choices).expect("a change");
    let Op::Batch { ops, description } = &op else {
        panic!("one batch");
    };
    let (header, systems) = ops.split_last().expect("members");
    assert!(
        matches!(header, Op::SetHeaderKeys { .. }),
        "the header comes last: {header:?}"
    );
    assert_eq!(
        description,
        &format!(
            "Prepared {} systems for a new game",
            prepare::changed(&session, &op)
        )
    );

    let without_header = Op::Batch {
        description: description.clone(),
        ops: systems.to_vec(),
    };
    session
        .apply(without_header)
        .expect("apply the systems alone");
    assert_eq!(header_count_issues(&session).len(), 1);
    session.undo().expect("undo").expect("an edit to undo");

    session.apply(op).expect("apply the batch");
    assert_eq!(session.history().undo.len(), 1, "one undo step");
    assert_eq!(header_count_issues(&session), Vec::<String>::new());
    for key in [
        "fallen_empire_max",
        "fallen_empire_default",
        "marauder_empire_max",
        "marauder_empire_default",
    ] {
        assert_eq!(count(&session, key), Some(0), "{key}");
    }
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), original, "undo is byte-exact");
}

#[test]
fn one_marauder_clan_left_out_takes_the_marauder_counts_down_by_one() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let original = session.doc().original().to_vec();
    let count = |session: &Session, key| {
        session
            .graph()
            .header_count(key)
            .expect("the header states the key")
    };
    let clans = clan_count(session.graph());
    assert!(clans > 1, "{clans}");
    assert_eq!(count(&session, "marauder_empire_max"), clans);
    assert_eq!(count(&session, "marauder_empire_default"), clans);
    let rows: Vec<RowSystems> = classify(&session, gd)
        .into_iter()
        .map(|row| match row.row {
            PrepareRow::MarauderClans => {
                let clan_of = |id: &u32| session.graph().systems[id].marauder.map(|r| r.clan());
                let first = clan_of(&row.systems[0]);
                RowSystems {
                    systems: row
                        .systems
                        .iter()
                        .copied()
                        .filter(|id| clan_of(id) == first)
                        .collect(),
                    ..row
                }
            }
            _ => row,
        })
        .collect();
    let choices = [RowChoice {
        row: PrepareRow::MarauderClans,
        choice: PrepareChoice::Plain,
    }];
    let op = build(gd, &session, &rows, &choices).expect("a change");
    session.apply(op).expect("apply the batch");
    assert_eq!(clan_count(session.graph()), clans - 1);
    assert_eq!(count(&session, "marauder_empire_max"), clans - 1);
    assert_eq!(count(&session, "marauder_empire_default"), clans - 1);
    assert_eq!(header_count_issues(&session), Vec::<String>::new());
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), original, "undo is byte-exact");
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
            (PrepareRow::Sol, 0),
            (PrepareRow::HomeNeighbours, 32),
            (PrepareRow::OriginAndEvent, 7),
            (PrepareRow::FallenEmpires, 4),
            (PrepareRow::MarauderClans, 6),
            (PrepareRow::Guardians, 6),
            (PrepareRow::Enclaves, 14),
            (PrepareRow::Primitives, 4),
            (PrepareRow::SpecialSystems, 87),
            (PrepareRow::OrdinarySystems, 591),
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
    let refused = prepare::build(
        &session,
        &rows,
        &plain,
        &PlainDraw::default(),
        &PrepareOptions::default(),
    );
    assert_eq!(refused, Err(PrepareError::NoPlainLayouts));
}

/// The 4.4 sample's Sol: a seat on `sol_system_initializer` exported plain, and the
/// player's Sol seat on a generic start exported for Paint a Galaxy.
const SOL: u32 = 217;

fn row_of(rows: &[RowSystems], row: PrepareRow) -> Vec<u32> {
    let found = rows.iter().find(|r| r.row == row);
    found.expect("every row is listed").systems.clone()
}

fn sol(choice: PrepareChoice) -> [RowChoice; 1] {
    [RowChoice {
        row: PrepareRow::Sol,
        choice,
    }]
}

fn set_initializer(session: &mut Session, system: u32, initializer: &str) {
    session
        .apply(Op::SetInitializer {
            system,
            initializer: Some(initializer.to_owned()),
        })
        .expect("set the initializer");
}

fn initializer_of(session: &Session, system: u32) -> &str {
    &session.graph().systems[&system].initializer
}

fn sol_seat(player: bool) -> SpawnScript {
    SpawnScript::PaintAGalaxy {
        kind: PaintSpawnKind::Sol,
        random_value: 0,
        player,
    }
}

#[test]
fn every_sol_stands_in_the_sol_row_seat_or_not_and_in_no_other_initializer_row() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mut session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let rows = classify(&session, gd);
    assert_eq!(row_of(&rows, PrepareRow::Sol), [SOL]);
    assert!(row_of(&rows, PrepareRow::EmpireSeats).contains(&SOL));
    assert!(!row_of(&rows, PrepareRow::HomeStarts).contains(&SOL));
    let ordinary = row_of(&rows, PrepareRow::OrdinarySystems);
    let [primitive, geocentric] = [ordinary[0], ordinary[1]];
    set_initializer(&mut session, primitive, "pre_ftl_init_sol");
    set_initializer(&mut session, geocentric, "init_sol_geocentric");
    let rows = classify(&session, gd);
    let sols: BTreeSet<u32> = row_of(&rows, PrepareRow::Sol).into_iter().collect();
    assert_eq!(sols, BTreeSet::from([SOL, primitive, geocentric]));
    for row in INITIALIZER_ROWS
        .into_iter()
        .chain([PrepareRow::OrdinarySystems])
        .filter(|&row| row != PrepareRow::Sol)
    {
        let others = row_of(&rows, row);
        assert!(others.iter().all(|id| !sols.contains(id)), "{row:?}");
    }
}

/// Both of `build`'s and `kept_clear`'s answers to `choices`, which refuse alike.
fn refusals(
    gd: &GameData,
    session: &Session,
    rows: &[RowSystems],
    choices: &[RowChoice],
) -> [Option<PrepareError>; 2] {
    let draw = plain_draw(gd, 0);
    let options = PrepareOptions::default();
    let built = prepare::build(session, rows, choices, &draw, &options);
    let clear = prepare::kept_clear(session, rows, choices, &draw, &options);
    [built.err(), clear.err()]
}

#[test]
fn each_sol_choice_on_a_plain_scenario_is_one_edit_that_undo_takes_back() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mut session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let primitive = row_of(&classify(&session, gd), PrepareRow::OrdinarySystems)[0];
    set_initializer(&mut session, primitive, "pre_ftl_init_sol");
    let before = current(&session);
    let rows = classify(&session, gd);
    let sols: BTreeSet<u32> = row_of(&rows, PrepareRow::Sol).into_iter().collect();
    assert_eq!(sols, BTreeSet::from([primitive, SOL]));
    let is_seat = |session: &Session, id| header_counts::is_seat(&session.graph().systems[&id]);
    assert!(is_seat(&session, SOL));
    let plain = plain_draw(gd, 0);
    let is_drawn = |session: &Session, id| {
        let drawn = initializer_of(session, id);
        plain.layouts.iter().any(|l| l.key == drawn)
    };
    let seats_none = RowChoice {
        row: PrepareRow::EmpireSeats,
        choice: PrepareChoice::None,
    };

    let op = build(gd, &session, &rows, &sol(PrepareChoice::Plain)).expect("a change");
    session.apply(op).expect("apply Plain");
    assert_eq!(initializer_of(&session, SOL), basic_initializer(SOL));
    assert!(is_seat(&session, SOL), "the seat stays");
    assert!(is_drawn(&session, primitive));
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), before, "undo is byte-exact");

    let choices = [seats_none, sol(PrepareChoice::Plain)[0]];
    let op = build(gd, &session, &rows, &choices).expect("a change");
    session.apply(op).expect("apply Plain with no seats");
    assert!(!is_seat(&session, SOL));
    assert!(is_drawn(&session, SOL), "an unseated Sol is a plain system");
    session.undo().expect("undo").expect("an edit to undo");

    let home = row_of(&rows, PrepareRow::HomeStarts)[0];
    let generic = RowChoice {
        row: PrepareRow::HomeStarts,
        choice: PrepareChoice::GenericStart,
    };
    let op = build(gd, &session, &rows, &[seats_none, generic]).expect("a change");
    session
        .apply(op)
        .expect("apply Generic start with no seats");
    assert!(is_drawn(&session, home), "an unseated home start is plain");
    session.undo().expect("undo").expect("an edit to undo");

    let pre_ftl = sol(PrepareChoice::PreFtlEarth);
    for choices in [&pre_ftl[..], &[seats_none, pre_ftl[0]]] {
        let op = build(gd, &session, &rows, choices).expect("a change");
        session.apply(op).expect("apply Pre-FTL Earth");
        assert_eq!(
            initializer_of(&session, SOL),
            "pre_ftl_init_sol",
            "the seat"
        );
        assert!(!is_seat(&session, SOL));
        assert!(is_drawn(&session, primitive), "the other Sol is plain");
        assert_eq!(session.history().undo.len(), 2, "one undo step");
        session.undo().expect("undo").expect("an edit to undo");
        assert_eq!(current(&session), before, "undo is byte-exact");
    }

    let refused = Some(PrepareError::UneSeatOnPlain);
    let une = sol(PrepareChoice::UneSeat);
    assert_eq!(
        refusals(gd, &session, &rows, &une),
        [refused.clone(), refused]
    );
}

#[test]
fn une_seat_makes_the_one_sol_the_sol_seat_and_keeps_its_initializer() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let seat_of = |session: &Session, id| session.graph().systems[&id].spawn_script.clone();
    assert_eq!(seat_of(&session, SOL), Some(sol_seat(true)), "the export's");
    assert!(row_of(&classify(&session, gd), PrepareRow::Sol).is_empty());
    set_initializer(&mut session, SOL, "sol_system_initializer");
    let rows = classify(&session, gd);
    assert_eq!(row_of(&rows, PrepareRow::Sol), [SOL]);
    let une = sol(PrepareChoice::UneSeat);
    assert_eq!(build(gd, &session, &rows, &une), None, "Sol holds the seat");

    let other = row_of(&rows, PrepareRow::EmpireSeats)
        .into_iter()
        .find(|&id| id != SOL)
        .expect("another seat");
    let players = SpawnScript::PaintAGalaxy {
        kind: PaintSpawnKind::Preferred,
        random_value: 0,
        player: true,
    };
    let enabled = SpawnScript::PaintAGalaxy {
        kind: PaintSpawnKind::Enabled,
        random_value: 0,
        player: false,
    };
    for (system, script) in [(other, players), (SOL, enabled)] {
        session
            .apply(Op::SetSpawnScript {
                system,
                script: Some(script),
            })
            .expect("move the player's seat");
    }
    let duplicates = |session: &Session| {
        let issues = session.validate().into_iter();
        issues
            .filter(|issue| issue.code == IssueCode::PlayerSeatDuplicate)
            .count()
    };
    assert_eq!(duplicates(&session), 0);
    let before = current(&session);
    let rows = classify(&session, gd);
    let op = build(gd, &session, &rows, &une).expect("a change");
    let Op::Batch { ops, .. } = &op else {
        panic!("one batch");
    };
    assert_eq!(ops.len(), 1);
    let result = session.apply(op).expect("apply UNE seat");
    assert_eq!(result.entry.description, "Prepared 1 system for a new game");
    assert_eq!(initializer_of(&session, SOL), "sol_system_initializer");
    assert_eq!(seat_of(&session, SOL), Some(sol_seat(false)));
    assert_eq!(
        duplicates(&session),
        0,
        "the player's marker stays where it was"
    );
    assert_eq!(header_count_issues(&session), Vec::<String>::new());
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), before, "undo is byte-exact");

    session
        .apply(Op::SetSpawnScript {
            system: other,
            script: Some(sol_seat(false)),
        })
        .expect("seat Sol elsewhere");
    let taken = Some(PrepareError::SolSeatTaken(other));
    assert_eq!(refusals(gd, &session, &rows, &une), [taken.clone(), taken]);
    session.undo().expect("undo").expect("an edit to undo");

    let primitive = row_of(&rows, PrepareRow::OrdinarySystems)[0];
    set_initializer(&mut session, primitive, "pre_ftl_init_sol");
    let rows = classify(&session, gd);
    let several = Some(PrepareError::SeveralSols(row_of(&rows, PrepareRow::Sol)));
    assert_eq!(
        refusals(gd, &session, &rows, &une),
        [several.clone(), several]
    );
}

/// `from` and every system within `jumps` lanes of it.
fn within(session: &Session, from: &BTreeSet<u32>, jumps: usize) -> BTreeSet<u32> {
    let systems = &session.graph().systems;
    let mut reached = from.clone();
    for _ in 0..jumps {
        let next: Vec<u32> = systems
            .values()
            .flat_map(|s| s.lanes.iter().map(move |lane| (s.id, lane.to)))
            .filter_map(
                |(a, b)| match (reached.contains(&a), reached.contains(&b)) {
                    (true, false) => Some(b),
                    (false, true) => Some(a),
                    _ => None,
                },
            )
            .collect();
        reached.extend(next);
    }
    reached
}

#[test]
fn bare_shell_gives_plain_systems_within_two_jumps_of_a_seat_unless_told_not_to() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let draw = plain_draw(gd, 0);
    for (name, session) in samples() {
        let rows = classify(&session, gd);
        let choices = PreparePreset::BareShell.choices(prepare::profile(&session));
        let empty = session
            .graph()
            .systems
            .values()
            .filter(|s| s.initializer.is_empty() && !header_counts::is_seat(s));
        let rowed: BTreeSet<u32> = INITIALIZER_ROWS
            .into_iter()
            .chain([PrepareRow::OrdinarySystems, PrepareRow::FallenEmpires])
            .flat_map(|row| row_of(&rows, row))
            .collect();
        let old_capitals = row_of(&rows, PrepareRow::EmpireSeats)
            .into_iter()
            .filter(|id| !rowed.contains(id));
        let decided: BTreeSet<u32> = choices
            .iter()
            .filter(|c| c.choice == PrepareChoice::GameDecides)
            .flat_map(|c| row_of(&rows, c.row))
            .chain(empty.map(|s| s.id))
            .chain(old_capitals)
            .collect();
        let clear: BTreeSet<u32> =
            prepare::kept_clear(&session, &rows, &choices, &draw, &PrepareOptions::default())
                .expect("the choices are offered")
                .into_iter()
                .collect();
        assert!(!clear.is_empty(), "{name}");

        let mut on = session.clone();
        on.apply(build(gd, &session, &rows, &choices).expect("a change"))
            .expect("apply bare shell");
        let seats: BTreeSet<u32> = on
            .graph()
            .systems
            .values()
            .filter(|s| header_counts::is_seat(s))
            .map(|s| s.id)
            .collect();
        let decided: BTreeSet<u32> = decided.difference(&seats).copied().collect();
        let near = within(&on, &seats, prepare::CLEAR_JUMPS);
        let near: BTreeSet<u32> = decided.intersection(&near).copied().collect();
        let changed: BTreeSet<u32> = near
            .iter()
            .copied()
            .filter(|&id| !is_plain(&session, &draw, id))
            .collect();
        assert_eq!(clear, changed, "{name}");
        assert!(clear.len() < near.len(), "{name}: some are plain already");
        for &id in &decided {
            match near.contains(&id) {
                true if clear.contains(&id) => assert!(is_plain(&on, &draw, id)),
                true => assert_eq!(initializer_of(&on, id), initializer_of(&session, id)),
                false => assert_eq!(initializer_of(&on, id), "", "{name}: system {id}"),
            }
        }

        let mut off = session.clone();
        let options = PrepareOptions {
            clear_around_seats: false,
            ..PrepareOptions::default()
        };
        let op = prepare::build(&session, &rows, &choices, &draw, &options)
            .expect("build the batch")
            .expect("a change");
        off.apply(op).expect("apply bare shell");
        for system in off.graph().systems.values() {
            let id = system.id;
            if decided.contains(&id) {
                assert_eq!(system.initializer, "", "{name}: system {id}");
            }
            if !near.contains(&id) {
                assert_eq!(
                    system.initializer,
                    initializer_of(&on, id),
                    "{name}: system {id}"
                );
            }
        }
    }
}

fn is_plain(session: &Session, draw: &PlainDraw, id: u32) -> bool {
    let held = initializer_of(session, id);
    held == "painted_galaxy_rl_basic" || draw.layouts.iter().any(|l| l.key == held)
}

#[test]
fn taking_out_the_wormhole_pairs_reports_the_systems_it_cuts_off() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mut session = scenario(common::open_4_5(), ScenarioProfile::PaintAGalaxy);
    let rows = classify(&session, gd);
    let names = [RowChoice {
        row: PrepareRow::SystemNames,
        choice: PrepareChoice::GameNames,
    }];
    let op = build(gd, &session, &rows, &names).expect("a change");
    assert_eq!(prepare::cut_off(&session, &op), Vec::<u32>::new());

    let pairs = [RowChoice {
        row: PrepareRow::WormholePairs,
        choice: PrepareChoice::None,
    }];
    let op = build(gd, &session, &rows, &pairs).expect("a change");
    let cut = prepare::cut_off(&session, &op);
    let mut expected = vec![591, 592];
    expected.extend(594..=600);
    assert_eq!(cut, expected);
    let graph = session.graph();
    assert!(header_counts::is_seat(&graph.systems[&592]));
    assert!(
        graph.systems[&591].lanes.is_empty(),
        "only its wormhole reaches it"
    );
    let alone = &graph.systems[&593];
    assert!(
        alone.lanes.is_empty() && alone.wormhole_pair.is_none(),
        "cut off already"
    );
    session.apply(op).expect("apply the batch");
    let disconnected: Vec<Vec<u32>> = session
        .validate()
        .into_iter()
        .filter(|issue| issue.code == IssueCode::Disconnected)
        .map(|issue| issue.systems)
        .collect();
    assert_eq!(disconnected, [cut]);
}

#[test]
fn faithful_fills_a_system_left_empty_beside_a_seat_unless_told_not_to() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let draw = plain_draw(gd, 0);
    for profile in [ScenarioProfile::Plain, ScenarioProfile::PaintAGalaxy] {
        let faithful = PreparePreset::Faithful.choices(profile);
        let mut session = scenario(common::open_4_4(), profile);
        let graph = session.graph();
        let beside = beside_a_seat(graph);
        session
            .apply(Op::SetInitializer {
                system: beside,
                initializer: None,
            })
            .expect("empty the neighbour");
        let rows = classify(&session, gd);
        assert_eq!(
            prepare::kept_clear(
                &session,
                &rows,
                &faithful,
                &draw,
                &PrepareOptions::default()
            ),
            Ok(vec![beside]),
            "{profile:?}"
        );
        let op = build(gd, &session, &rows, &faithful).expect("a change");
        let Op::Batch { ops, .. } = &op else {
            panic!("one batch");
        };
        assert_eq!(ops.len(), 1, "{profile:?}");
        let before = current(&session);
        session.apply(op).expect("apply faithful");
        assert!(is_plain(&session, &draw, beside), "{profile:?}");
        session.undo().expect("undo").expect("an edit to undo");
        assert_eq!(current(&session), before, "undo is byte-exact");

        let off = PrepareOptions {
            clear_around_seats: false,
            ..PrepareOptions::default()
        };
        let left = prepare::build(&session, &rows, &faithful, &draw, &off);
        assert_eq!(left, Ok(None), "{profile:?}");
    }
}

/// The first system one lane from a seat that is no seat itself and has an initializer.
fn beside_a_seat(graph: &GalaxyGraph) -> u32 {
    let systems = graph.order.iter().filter_map(|id| graph.systems.get(id));
    let seats = systems.filter(|s| header_counts::is_seat(s));
    seats
        .flat_map(|seat| seat.lanes.iter().map(|lane| lane.to))
        .find(|id| {
            let next = &graph.systems[id];
            !header_counts::is_seat(next) && !next.initializer.is_empty()
        })
        .expect("a system beside a seat")
}

fn random_seats() -> RowChoice {
    RowChoice {
        row: PrepareRow::EmpireSeats,
        choice: PrepareChoice::RandomSeats,
    }
}

fn position(session: &Session, system: u32) -> (f64, f64) {
    let node = &session.graph().systems[&system];
    (node.x, node.y)
}

fn options(seed: u64) -> PrepareOptions {
    PrepareOptions {
        seed,
        ..PrepareOptions::default()
    }
}

#[test]
fn new_random_seats_are_as_many_as_the_old_spaced_apart_on_generic_starts_with_the_old_seats_in_order()
 {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    for (name, mut session) in samples() {
        let rows = classify(&session, gd);
        let old = row_of(&rows, PrepareRow::EmpireSeats);
        let graph = session.graph();
        let old_seats: Vec<(Option<SpawnScript>, Option<f64>)> = old
            .iter()
            .map(|id| {
                let system = &graph.systems[id];
                (system.spawn_script.clone(), system.spawn_weight)
            })
            .collect();
        let choices = [random_seats()];
        let drawn = prepare::drawn(&session, &rows, &choices, &options(0)).expect("draw");
        assert_eq!(drawn.seats.len(), old.len(), "{name}");
        assert!(drawn.zones.is_empty(), "{name}");
        let floor = match drawn.seat_floor {
            Some(floor) => {
                assert!(floor < prepare::RANDOM_START_DISTANCE, "{name}: {floor}");
                floor
            }
            None => prepare::RANDOM_START_DISTANCE,
        };
        for (i, &a) in drawn.seats.iter().enumerate() {
            assert!(!old.contains(&a), "{name}: {a} is an old seat");
            for &b in &drawn.seats[i + 1..] {
                let apart = distance(position(&session, a), position(&session, b));
                assert!(apart >= floor, "{name}: {a} and {b} are {apart} apart");
            }
        }

        let before = current(&session);
        let op = build(gd, &session, &rows, &choices).expect("a change");
        session.apply(op).expect("apply new random seats");
        let graph = session.graph();
        let seats: BTreeSet<u32> = graph
            .systems
            .values()
            .filter(|s| header_counts::is_seat(s))
            .map(|s| s.id)
            .collect();
        assert_eq!(seats, drawn.seats.iter().copied().collect(), "{name}");
        for (&id, (script, weight)) in drawn.seats.iter().zip(&old_seats) {
            let system = &graph.systems[&id];
            assert!(
                system.initializer.starts_with("random_empire_init_"),
                "{name}: {id} has {}",
                system.initializer
            );
            let carried = match script {
                Some(SpawnScript::PaintAGalaxy {
                    kind: PaintSpawnKind::Sol,
                    random_value,
                    ..
                }) => Some(SpawnScript::PaintAGalaxy {
                    kind: PaintSpawnKind::Enabled,
                    random_value: *random_value,
                    player: false,
                }),
                script => script.clone(),
            };
            assert_eq!(system.spawn_script, carried, "{name}: {id}");
            if script.is_none() {
                assert_eq!(system.spawn_weight, *weight, "{name}: {id}");
            }
        }
        assert_eq!(
            header_count_issues(&session),
            Vec::<String>::new(),
            "{name}"
        );
        session.undo().expect("undo").expect("an edit to undo");
        assert_eq!(current(&session), before, "{name}: undo is byte-exact");
    }
}

#[test]
fn the_same_seed_draws_the_same_seats_and_another_seed_others() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let rows = classify(&session, gd);
    let choices = [random_seats()];
    let seats = |seed| {
        prepare::drawn(&session, &rows, &choices, &options(seed))
            .expect("draw")
            .seats
    };
    let first = seats(0);
    assert_eq!(seats(0), first);
    let other = seats(1);
    assert_ne!(other, first);

    let op = prepare::build(&session, &rows, &choices, &plain_draw(gd, 1), &options(1))
        .expect("build the batch")
        .expect("a change");
    session.apply(op).expect("apply new random seats");
    let seated: BTreeSet<u32> = session
        .graph()
        .systems
        .values()
        .filter(|s| header_counts::is_seat(s))
        .map(|s| s.id)
        .collect();
    assert_eq!(seated, other.into_iter().collect());
}

#[test]
fn new_random_zones_fit_up_to_six_apart_from_each_other_and_from_the_new_seats() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let rows = classify(&session, gd);
    let choices = [
        random_seats(),
        RowChoice {
            row: PrepareRow::FallenEmpires,
            choice: PrepareChoice::RandomZones,
        },
    ];
    let drawn = prepare::drawn(&session, &rows, &choices, &options(0)).expect("draw");
    assert!(
        (1..=6).contains(&drawn.zones.len()),
        "{}",
        drawn.zones.len()
    );
    let before = current(&session);
    let op = build(gd, &session, &rows, &choices).expect("a change");
    session.apply(op).expect("apply new random zones");
    let graph = session.graph();
    let zones: Vec<(u32, FeZone)> = graph
        .order
        .iter()
        .filter_map(|id| Some((*id, graph.systems[id].fe_zone.clone()?)))
        .collect();
    let anchors: BTreeSet<u32> = zones.iter().map(|(id, _)| *id).collect();
    let expected: BTreeSet<u32> = drawn.zones.iter().map(|(id, _)| *id).collect();
    assert_eq!(anchors, expected);
    let seats: Vec<(f64, f64)> = drawn
        .seats
        .iter()
        .map(|&id| position(&session, id))
        .collect();
    let centres: Vec<(f64, f64)> = zones
        .iter()
        .map(|(id, zone)| centre(position(&session, *id), zone))
        .collect();
    for (i, (id, zone)) in zones.iter().enumerate() {
        assert_eq!(zone.kind, FeKind::Random, "{id}");
        assert!(zone.fallback && !zone.preferred, "{id}");
        for other in &centres[i + 1..] {
            assert!(distance(centres[i], *other) >= 60.0, "{id}");
        }
        for seat in &seats {
            assert!(distance(centres[i], *seat) >= 75.0, "{id}");
        }
    }
    let fallen = u32::try_from(zones.len()).expect("a few zones");
    assert_eq!(graph.header_count("fallen_empire_max"), Some(fallen));
    assert_eq!(header_count_issues(&session), Vec::<String>::new());
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), before, "undo is byte-exact");

    let plain = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let rows = classify(&plain, gd);
    let refused = Some(PrepareError::RandomZonesOnPlain);
    assert_eq!(
        refusals(gd, &plain, &rows, &choices[1..]),
        [refused.clone(), refused]
    );
}

#[test]
fn a_sol_left_to_the_game_loses_its_initializer_unless_it_keeps_its_seat() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let unguarded = PrepareOptions {
        clear_around_seats: false,
        ..PrepareOptions::default()
    };
    let draw = plain_draw(gd, 0);
    let decides = sol(PrepareChoice::GameDecides);
    let mut session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let before = current(&session);
    let rows = classify(&session, gd);
    let op = prepare::build(&session, &rows, &decides, &draw, &unguarded)
        .expect("build the batch")
        .expect("a change");
    session.apply(op).expect("apply Game decides");
    assert_eq!(initializer_of(&session, SOL), basic_initializer(SOL));
    assert!(header_counts::is_seat(&session.graph().systems[&SOL]));
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), before, "undo is byte-exact");

    let seats_none = RowChoice {
        row: PrepareRow::EmpireSeats,
        choice: PrepareChoice::None,
    };
    let choices = [seats_none, decides[0]];
    let op = prepare::build(&session, &rows, &choices, &draw, &unguarded)
        .expect("build the batch")
        .expect("a change");
    session.apply(op).expect("apply Game decides with no seats");
    assert_eq!(initializer_of(&session, SOL), "");
    session.undo().expect("undo").expect("an edit to undo");

    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    set_initializer(&mut session, SOL, "sol_system_initializer");
    let before = current(&session);
    let rows = classify(&session, gd);
    assert_eq!(row_of(&rows, PrepareRow::Sol), [SOL]);
    let op = prepare::build(&session, &rows, &decides, &draw, &unguarded)
        .expect("build the batch")
        .expect("a change");
    session.apply(op).expect("apply Game decides");
    assert_eq!(initializer_of(&session, SOL), basic_initializer(SOL));
    assert_eq!(
        session.graph().systems[&SOL].spawn_script,
        Some(SpawnScript::PaintAGalaxy {
            kind: PaintSpawnKind::Enabled,
            random_value: 0,
            player: false,
        })
    );
    assert_eq!(header_count_issues(&session), Vec::<String>::new());
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), before, "undo is byte-exact");
}

#[test]
fn new_random_seats_on_a_map_with_no_seats_are_refused() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mut session = scenario(common::open_4_4(), ScenarioProfile::Plain);
    let rows = classify(&session, gd);
    let seats_none = RowChoice {
        row: PrepareRow::EmpireSeats,
        choice: PrepareChoice::None,
    };
    let op = build(gd, &session, &rows, &[seats_none]).expect("a change");
    session.apply(op).expect("take every seat away");
    let rows = classify(&session, gd);
    let refused = Some(PrepareError::NoSeatsToDraw);
    assert_eq!(
        refusals(gd, &session, &rows, &[random_seats()]),
        [refused.clone(), refused]
    );
}

#[test]
fn an_unseated_capital_on_a_generic_start_follows_the_ordinary_systems_row() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let rows = classify(&session, gd);
    let generic =
        |session: &Session, id: u32| initializer_of(session, id).starts_with("random_empire_init_");
    let old: Vec<u32> = row_of(&rows, PrepareRow::EmpireSeats)
        .into_iter()
        .filter(|&id| generic(&session, id))
        .collect();
    assert!(!old.is_empty());
    let before = current(&session);

    let shell = PreparePreset::BareShell.choices(ScenarioProfile::PaintAGalaxy);
    session
        .apply(build(gd, &session, &rows, &shell).expect("a change"))
        .expect("apply bare shell");
    for &id in &old {
        let system = &session.graph().systems[&id];
        assert!(!header_counts::is_seat(system), "{id} is seated again");
        assert!(!generic(&session, id), "{id} keeps {}", system.initializer);
    }
    session.undo().expect("undo").expect("an edit to undo");
    assert_eq!(current(&session), before, "undo is byte-exact");

    let custom = [
        (PrepareRow::EmpireSeats, PrepareChoice::None),
        (PrepareRow::OrdinarySystems, PrepareChoice::Keep),
    ]
    .map(|(row, choice)| RowChoice { row, choice });
    session
        .apply(build(gd, &session, &rows, &custom).expect("a change"))
        .expect("apply the seats taken away");
    for &id in &old {
        assert!(
            !header_counts::is_seat(&session.graph().systems[&id]),
            "{id}"
        );
        assert!(generic(&session, id), "{id} keeps its start");
    }
}

#[test]
fn new_random_seats_keep_the_spacing_from_a_seat_that_stays() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let mut session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    set_initializer(&mut session, SOL, "sol_system_initializer");
    let rows = classify(&session, gd);
    let choices = [random_seats(), sol(PrepareChoice::UneSeat)[0]];
    for seed in 0..8 {
        let drawn = prepare::drawn(&session, &rows, &choices, &options(seed)).expect("draw");
        let floor = drawn.seat_floor.unwrap_or(prepare::RANDOM_START_DISTANCE);
        assert!(!drawn.seats.contains(&SOL), "seed {seed}");
        for &id in &drawn.seats {
            let apart = distance(position(&session, id), position(&session, SOL));
            assert!(apart >= floor, "seed {seed}: {id} is {apart} from Sol");
        }
    }
    let op = build(gd, &session, &rows, &choices).expect("a change");
    session.apply(op).expect("apply new random seats");
    assert_eq!(
        session.graph().systems[&SOL].spawn_script,
        Some(sol_seat(true)),
        "Sol keeps its seat"
    );
    assert_eq!(header_count_issues(&session), Vec::<String>::new());
}

#[test]
fn bare_shell_puts_at_most_two_new_zones_on_the_rim_of_the_galaxy() {
    let Some(gd) = common::INSTALL.as_ref() else {
        return;
    };
    let session = scenario(common::open_4_4(), ScenarioProfile::PaintAGalaxy);
    let rows = classify(&session, gd);
    let choices = PreparePreset::BareShell.choices(ScenarioProfile::PaintAGalaxy);
    let radius = session
        .graph()
        .systems
        .values()
        .map(|s| s.x.hypot(s.y))
        .fold(0.0, f64::max);
    for seed in 0..8 {
        let drawn = prepare::drawn(&session, &rows, &choices, &options(seed)).expect("draw");
        let rim = drawn
            .zones
            .iter()
            .map(|(id, zone)| centre(position(&session, *id), zone))
            .filter(|&c| distance(c, (0.0, 0.0)) > 0.8 * radius)
            .count();
        assert!(rim <= 2, "seed {seed}: {rim} zones on the rim");
        assert!(
            drawn.zones.len() >= 3,
            "seed {seed}: {} zones",
            drawn.zones.len()
        );
    }
}
