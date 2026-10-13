//! What the Prepare tests share: the sample saves opened as scenarios, a batch built with
//! the sample install's plain layouts, and the rows and choices the tests pick.

use sgf_core::document::Document;
use sgf_core::export::{self, ScenarioProfile};
use sgf_core::ops::Op;
use sgf_core::prepare::{
    self, PrepareChoice, PrepareError, PrepareOptions, PrepareRow, RowChoice, RowSystems,
};
use sgf_core::projections::galaxy::{PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;
use sgf_gamedata::GameData;
use sgf_gamedata::prepare::plain_draw;

/// The rows whose systems stand in no other of them.
pub const INITIALIZER_ROWS: [PrepareRow; 9] = [
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

/// The 4.4 sample's Sol: a seat on `sol_system_initializer` exported plain, and the
/// player's Sol seat on a generic start exported for Paint a Galaxy.
pub const SOL: u32 = 217;

/// The sample `save` opened as an unsaved scenario under `profile`, its names as the save
/// holds them.
pub fn scenario(save: Session, profile: ScenarioProfile) -> Session {
    let options = export::options_for_session(&save, "sample");
    let (text, _) = export::scenario_text(save.graph(), &options, &|_| None, &|_| None, profile);
    let doc = Document::from_scenario_bytes(text).expect("index the scenario");
    Session::from_document(None, doc).expect("project the scenario")
}

pub fn samples() -> [(&'static str, Session); 4] {
    [
        (
            "4_4_plain",
            scenario(super::open_4_4(), ScenarioProfile::Plain),
        ),
        (
            "4_4_paint",
            scenario(super::open_4_4(), ScenarioProfile::PaintAGalaxy),
        ),
        (
            "4_5_plain",
            scenario(super::open_4_5(), ScenarioProfile::Plain),
        ),
        (
            "4_5_paint",
            scenario(super::open_4_5(), ScenarioProfile::PaintAGalaxy),
        ),
    ]
}

pub fn current(session: &Session) -> Vec<u8> {
    session.doc().pieces().collect::<Vec<_>>().concat()
}

pub fn header_count_issues(session: &Session) -> Vec<String> {
    session
        .validate()
        .into_iter()
        .filter(|issue| issue.code == IssueCode::HeaderEmpireCount)
        .map(|issue| issue.message)
        .collect()
}

pub fn build(
    gd: &GameData,
    session: &Session,
    rows: &[RowSystems],
    choices: &[RowChoice],
) -> Option<Op> {
    let options = PrepareOptions::default();
    prepare::build(session, rows, choices, &plain_draw(gd, 0), &options).expect("build the batch")
}

/// Both of `build`'s and `kept_clear`'s answers to `choices`, which refuse alike.
pub fn refusals(
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

pub fn row_of(rows: &[RowSystems], row: PrepareRow) -> Vec<u32> {
    let found = rows.iter().find(|r| r.row == row);
    found.expect("every row is listed").systems.clone()
}

pub fn sol(choice: PrepareChoice) -> [RowChoice; 1] {
    [RowChoice {
        row: PrepareRow::Sol,
        choice,
    }]
}

pub fn set_initializer(session: &mut Session, system: u32, initializer: &str) {
    session
        .apply(Op::SetInitializer {
            system,
            initializer: Some(initializer.to_owned()),
        })
        .expect("set the initializer");
}

pub fn initializer_of(session: &Session, system: u32) -> &str {
    &session.graph().systems[&system].initializer
}

pub fn sol_seat(player: bool) -> SpawnScript {
    SpawnScript::PaintAGalaxy {
        kind: PaintSpawnKind::Sol,
        random_value: 0,
        player,
    }
}

pub fn random_seats() -> RowChoice {
    RowChoice {
        row: PrepareRow::EmpireSeats,
        choice: PrepareChoice::RandomSeats,
    }
}

pub fn options(seed: u64) -> PrepareOptions {
    PrepareOptions {
        seed,
        ..PrepareOptions::default()
    }
}

pub fn position(session: &Session, system: u32) -> (f64, f64) {
    let node = &session.graph().systems[&system];
    (node.x, node.y)
}
