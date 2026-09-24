//! Shared sample-save scaffolding for sgf-core's integration tests.
#![allow(dead_code)]

pub mod brush;
pub mod diff;
pub mod examples;
pub mod export;
pub mod fixture;
pub mod paint;
pub mod spec;

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use sgf_core::archive;
use sgf_core::document::Document;
use sgf_core::projections::galaxy::GalaxyGraph;
use sgf_core::session::Session;
use sgf_core::validate::{Issue, validate};
use sgf_core::views::DocumentKind;

pub const SAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/2206.11.16.sav");
/// A Stellaris 4.5.0 save on its first day, whose player empire set independent map colours.
pub const SAMPLE_4_5: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/2201.03.25.sav");
/// A Stellaris 3.4.5 save, which writes each block's opening brace on its key's line.
pub const SAMPLE_3_4: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/2200.04.11.sav");

/// The centre of the first nebula (Phantom Streak Miasma), which lists 108 first.
pub const NEBULA_0_CENTRE: (f64, f64) = (66.15, -136.85);

/// A clear patch of sky between Demon's Eye and the Weeping Ghost: a radius of 40 there
/// reaches four systems, one of which Demon's Eye lists today.
pub const NEW_NEBULA: (f64, f64, f64) = (-57.5, -305.0, 40.0);

/// Each sample save read and indexed once per test binary, for its opener to clone.
static SAMPLE_DOCUMENT: OnceLock<Document> = OnceLock::new();
static SAMPLE_4_5_DOCUMENT: OnceLock<Document> = OnceLock::new();
static SAMPLE_3_4_DOCUMENT: OnceLock<Document> = OnceLock::new();

/// Every cached sample with its path, for [`issues_at_open`] to recognise.
static CACHED: [(&OnceLock<Document>, &str); 3] = [
    (&SAMPLE_DOCUMENT, SAMPLE),
    (&SAMPLE_4_5_DOCUMENT, SAMPLE_4_5),
    (&SAMPLE_3_4_DOCUMENT, SAMPLE_3_4),
];

pub fn load() -> Document {
    Document::load(SAMPLE).expect("load sample")
}

fn open_cached(cache: &OnceLock<Document>, path: &str) -> Session {
    let doc = cache
        .get_or_init(|| Document::load(path).unwrap_or_else(|e| panic!("load {path}: {e}")))
        .clone();
    Session::from_document(Some(PathBuf::from(path)), doc)
        .unwrap_or_else(|e| panic!("open {path}: {e}"))
}

pub fn open() -> Session {
    open_cached(&SAMPLE_DOCUMENT, SAMPLE)
}

pub fn open_4_5() -> Session {
    open_cached(&SAMPLE_4_5_DOCUMENT, SAMPLE_4_5)
}

pub fn open_3_4() -> Session {
    open_cached(&SAMPLE_3_4_DOCUMENT, SAMPLE_3_4)
}

pub fn current(session: &Session) -> Vec<u8> {
    session.doc.pieces().flatten().copied().collect()
}

/// The session's current bytes as text, for a scenario.
pub fn text(session: &Session) -> String {
    String::from_utf8(current(session)).expect("utf-8")
}

/// The projection the session's current bytes would build, with no file involved.
pub fn reprojected(session: &Session) -> GalaxyGraph {
    let doc = Document::from_bytes(current(session), session.doc.meta().to_vec())
        .expect("index the current bytes");
    GalaxyGraph::build(&doc).expect("project the current bytes")
}

/// The issues the session's document raised as it was opened.
pub fn issues_at_open(session: &Session) -> Vec<Issue> {
    static SAMPLE_ISSUES: [OnceLock<Vec<Issue>>; 3] = [const { OnceLock::new() }; 3];
    let original = session.doc.original();
    for ((cache, path), issues) in CACHED.into_iter().zip(&SAMPLE_ISSUES) {
        if cache
            .get()
            .is_some_and(|sample| std::ptr::eq(sample.original(), original))
        {
            return issues
                .get_or_init(|| validate(&open_cached(cache, path).graph))
                .clone();
        }
    }
    let doc = match session.kind() {
        DocumentKind::Save => Document::from_bytes(original.to_vec(), session.doc.meta().to_vec()),
        DocumentKind::Scenario => Document::from_scenario_bytes(original.to_vec()),
    };
    let opened = Session::from_document(None, doc.expect("index the original bytes"))
        .expect("project the original bytes");
    validate(&opened.graph)
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

/// `insta::assert_snapshot!`, with each test file's snapshots under a folder named after it.
#[track_caller]
pub fn snapshot(name: &str, value: &str) {
    let caller = std::panic::Location::caller().file();
    let file = Path::new(caller)
        .file_stem()
        .expect("a test file")
        .to_string_lossy();
    let path = format!("../snapshots/{file}");
    insta::with_settings!({snapshot_path => path, prepend_module_to_snapshot => false}, {
        insta::assert_snapshot!(name, value);
    });
}
