//! Prepare's Sol row on the 4.4 sample's Sol, on the sample install.

use std::collections::BTreeSet;

use sgf_core::export::ScenarioProfile;
use sgf_core::format::scenario::header_counts;
use sgf_core::format::scenario::paint::random_empire_start;
use sgf_core::format::scenario::seat_initializer;
use sgf_core::ops::Op;
use sgf_core::prepare::{self, PrepareChoice, PrepareError, PrepareOptions, PrepareRow, RowChoice};
use sgf_core::projections::galaxy::{PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;
use sgf_gamedata::prepare::{classify, plain_draw};

use crate::common;
use crate::common::prepare::{
    INITIALIZER_ROWS, SOL, build, current, header_count_issues, initializer_of, refusals, row_of,
    scenario, set_initializer, sol, sol_seat,
};

#[test]
fn every_sol_stands_in_the_sol_row_seat_or_not_and_in_no_other_initializer_row() {
    let gd = common::sample_install();
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

#[test]
fn each_sol_choice_on_a_plain_scenario_is_one_edit_that_undo_takes_back() {
    let gd = common::sample_install();
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
    assert_eq!(initializer_of(&session, SOL), seat_initializer(SOL));
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
    let gd = common::sample_install();
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

#[test]
fn a_sol_left_to_the_game_loses_its_initializer_unless_it_keeps_its_seat() {
    let gd = common::sample_install();
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
    assert_eq!(initializer_of(&session, SOL), seat_initializer(SOL));
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
    assert_eq!(initializer_of(&session, SOL), random_empire_start(SOL));
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
