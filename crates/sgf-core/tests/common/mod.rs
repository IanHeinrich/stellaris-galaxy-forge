//! Shared sample-save scaffolding for sgf-core's integration tests.
#![allow(dead_code)]

pub mod diff;
pub mod scenario;

use std::path::PathBuf;
use std::sync::LazyLock;

use sgf_core::archive;
use sgf_core::document::Document;
use sgf_core::projections::galaxy::GalaxyGraph;
use sgf_core::session::Session;

pub const SAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/2206.11.16.sav");

/// The centre of the first nebula (Phantom Streak Miasma), which lists 108 first.
pub const NEBULA_0_CENTRE: (f64, f64) = (66.15, -136.85);

/// A clear patch of sky between Demon's Eye and the Weeping Ghost: a radius of 40 there
/// reaches four systems, one of which Demon's Eye lists today.
pub const NEW_NEBULA: (f64, f64, f64) = (-57.5, -305.0, 40.0);

/// The sample save read and indexed once per test binary, for [`open`] to clone.
static SAMPLE_DOCUMENT: LazyLock<Document> = LazyLock::new(load);

pub fn load() -> Document {
    Document::load(SAMPLE).expect("load sample")
}

pub fn open() -> Session {
    Session::from_document(Some(PathBuf::from(SAMPLE)), SAMPLE_DOCUMENT.clone())
        .expect("open sample")
}

pub fn current(session: &Session) -> Vec<u8> {
    session.doc.pieces().flatten().copied().collect()
}

/// The projection a fresh load of the session's current bytes would build.
pub fn reloaded(session: &Session) -> GalaxyGraph {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("reloaded.sav");
    session.doc.save_as(&path).unwrap();
    GalaxyGraph::build(&Document::load(&path).unwrap()).unwrap()
}

/// The projection the session's current bytes would build, with no file involved.
pub fn reprojected(session: &Session) -> GalaxyGraph {
    let doc = Document::from_bytes(current(session), session.doc.meta().to_vec())
        .expect("index the current bytes");
    GalaxyGraph::build(&doc).expect("project the current bytes")
}

/// The sample save with `edit` applied to its gamestate, opened without going near a
/// file: the way to reach a galaxy the committed save does not hold.
pub fn open_edited(edit: impl FnOnce(&mut Vec<u8>)) -> Session {
    let raw = archive::read_sav(SAMPLE).expect("read the sample save");
    let mut gamestate = raw.gamestate;
    edit(&mut gamestate);
    let doc = Document::from_bytes(gamestate, raw.meta).expect("index the edited gamestate");
    Session::from_document(None, doc).expect("project the edited gamestate")
}

/// The whole sample gamestate, decompressed straight from the archive.
pub fn gamestate() -> Vec<u8> {
    archive::read_sav(SAMPLE)
        .unwrap_or_else(|e| panic!("{e}; is git-lfs installed and pulled?"))
        .gamestate
}

/// `insta::assert_snapshot!`, with each test binary's snapshots under a folder of its
/// own: `module_path!()` starts with the name of the file the binary was built from.
pub fn snapshot(name: &str, value: &str) {
    let binary = module_path!().split("::").next().expect("a module path");
    let path = format!("../snapshots/{binary}");
    insta::with_settings!({snapshot_path => path, prepend_module_to_snapshot => false}, {
        insta::assert_snapshot!(name, value);
    });
}
