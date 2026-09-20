//! The scenario grammar fixture, which every scenario op test is applied to.
use sgf_core::session::Session;

pub const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/scenario_grammar.txt"
);

pub fn open() -> Session {
    Session::open(FIXTURE).expect("open the scenario fixture")
}

/// The fixture as it sits on disk: what an undo has to put back byte for byte.
pub fn bytes() -> Vec<u8> {
    std::fs::read(FIXTURE).expect("read the fixture")
}

pub fn current(session: &Session) -> Vec<u8> {
    super::current(session)
}
