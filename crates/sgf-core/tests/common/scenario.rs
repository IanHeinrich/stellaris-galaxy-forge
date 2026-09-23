//! The scenario grammar fixture, which every scenario op test is applied to.
use std::collections::BTreeMap;

use sgf_core::document::Document;
use sgf_core::ops::Op;
use sgf_core::projections::galaxy::SystemNode;
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

/// Remove `ids`, apply the inverse the removal recorded, and assert the systems stand as
/// they did: each statement's text, and every system as a fresh open of the bytes
/// projects it, lanes in any order since the restored statements land last.
pub fn assert_removal_inverts_exactly(mut session: Session, ids: &[u32]) {
    let statements = |session: &Session| -> Vec<String> {
        let scenario = session.doc.scenario().expect("a scenario");
        ids.iter()
            .map(|&id| {
                let anchor = scenario.system(id).expect("the system");
                let bytes = session.doc.current(anchor).expect("its bytes");
                String::from_utf8_lossy(bytes).trim().to_owned()
            })
            .collect()
    };
    let before = statements(&session);
    let opened = systems(&reopened(&session));
    let result = session
        .apply(Op::RemoveSystems { ids: ids.to_vec() })
        .expect("remove the systems");
    for id in ids {
        assert!(!session.graph.systems.contains_key(id), "{id} is gone");
    }
    session.apply(result.inverse).expect("apply the inverse");
    assert_eq!(statements(&session), before);
    assert_eq!(systems(&reopened(&session)), opened);
    assert_eq!(systems(&session), opened);
}

fn reopened(session: &Session) -> Session {
    let doc = Document::from_scenario_bytes(current(session)).expect("index the bytes");
    Session::from_document(None, doc).expect("project the bytes")
}

fn systems(session: &Session) -> BTreeMap<u32, SystemNode> {
    session
        .graph
        .systems
        .iter()
        .map(|(&id, system)| {
            let mut system = system.clone();
            system.lanes.sort_by_key(|lane| lane.to);
            (id, system)
        })
        .collect()
}
