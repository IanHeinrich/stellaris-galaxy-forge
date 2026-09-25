//! Shared sample-save scaffolding for sgf-core's integration tests.
#![allow(dead_code)]

pub mod brush;
pub mod diff;
pub mod examples;
pub mod export;
pub mod fixture;
pub mod paint;
pub mod spec;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, MutexGuard, OnceLock};

use sgf_core::archive;
use sgf_core::document::Document;
use sgf_core::format::save::details::RawPlanet;
use sgf_core::ops::OpError;
use sgf_core::projections::galaxy::GalaxyGraph;
use sgf_core::session::Session;
use sgf_core::validate::{Issue, IssueCode, validate};
use sgf_core::views::DocumentKind;

pub const SAMPLE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/4.4-early.sav");
/// A Stellaris 4.5.0 save on its first day, whose player empire set independent map colours.
pub const SAMPLE_4_5: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../testdata/4.5-day-one.sav"
);
/// A Stellaris 3.4.5 save, which writes each block's opening brace on its key's line.
pub const SAMPLE_3_4: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/3.4.sav");

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

fn cached(cache: &'static OnceLock<Document>, path: &str) -> &'static Document {
    cache.get_or_init(|| Document::load(path).unwrap_or_else(|e| panic!("load {path}: {e}")))
}

/// The 4.4 sample's document as the cache holds it.
pub fn load() -> Document {
    cached(&SAMPLE_DOCUMENT, SAMPLE).clone()
}

pub fn load_4_5() -> Document {
    cached(&SAMPLE_4_5_DOCUMENT, SAMPLE_4_5).clone()
}

pub fn load_3_4() -> Document {
    cached(&SAMPLE_3_4_DOCUMENT, SAMPLE_3_4).clone()
}

fn open_cached(cache: &'static OnceLock<Document>, path: &str) -> Session {
    let doc = cached(cache, path).clone();
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

/// The 4.4 sample with `edit` applied to its gamestate: see [`open_edited_sample`].
pub fn open_edited(edit: impl FnOnce(&mut String)) -> Session {
    open_edited_sample(SAMPLE, |gamestate, _| edit(gamestate))
}

/// The sample save at `path` with `edit` applied to its gamestate and its meta, as a
/// session with no path: the way to reach a galaxy the committed saves do not hold.
pub fn open_edited_sample(path: &str, edit: impl FnOnce(&mut String, &mut String)) -> Session {
    let (cache, _) = CACHED
        .into_iter()
        .find(|(_, cached)| *cached == path)
        .unwrap_or_else(|| panic!("{path} is no sample save"));
    let sample = cached(cache, path);
    let mut gamestate = String::from_utf8(sample.original().to_vec()).expect("utf-8");
    let mut meta = String::from_utf8(sample.meta().to_vec()).expect("utf-8");
    edit(&mut gamestate, &mut meta);
    let doc = Document::from_bytes(gamestate.into_bytes(), meta.into_bytes())
        .expect("index the edited save");
    Session::from_document(None, doc).expect("project the edited save")
}

/// The 4.4 sample with its details projection built, shared by the tests that only read
/// it.
pub fn warmed() -> MutexGuard<'static, Session> {
    static WARMED: LazyLock<Mutex<Session>> = LazyLock::new(|| {
        let mut session = open();
        session.warm_details().expect("build details");
        Mutex::new(session)
    });
    WARMED.lock().unwrap_or_else(|held| held.into_inner())
}

/// The session's findings, each as its code, systems and message.
pub fn findings(session: &Session) -> BTreeSet<(IssueCode, Vec<u32>, String)> {
    session
        .validate()
        .into_iter()
        .map(|issue| (issue.code, issue.systems, issue.message))
        .collect()
}

/// A refusal case: what is refused, and whether an error is the refusal it should meet.
pub type Refused<T> = (T, fn(&OpError) -> bool);

/// The issues of `code`.
pub fn coded(issues: &[Issue], code: IssueCode) -> Vec<&Issue> {
    issues.iter().filter(|issue| issue.code == code).collect()
}

/// The message of the one issue of `code`.
#[track_caller]
pub fn only_message(issues: &[Issue], code: IssueCode) -> String {
    match coded(issues, code)[..] {
        [issue] => issue.message.clone(),
        ref found => panic!("one {code} issue, found {found:?}"),
    }
}

/// The bodies the details list for system `id`, star first.
pub fn planets(session: &Session, id: u32) -> Vec<RawPlanet> {
    let details = session.details().expect("details");
    let system = details
        .raw(id)
        .unwrap_or_else(|| panic!("system {id}'s details"));
    system.planets.clone()
}

/// How many entries of the name database's `list` block hold `name`.
pub fn pooled(session: &Session, list: &str, name: &str) -> usize {
    let text = text(session);
    let start = text
        .find(&format!("\n\t{list}=\n"))
        .unwrap_or_else(|| panic!("the {list} pool"));
    let end = start + text[start..].find("\t}\n").expect("the pool's end");
    text[start..end]
        .matches(&format!("\t\t\"{name}\"\n"))
        .count()
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

/// The ids of the bodies the details list for system `id`, star first.
pub fn planet_ids(session: &Session, id: u32) -> Vec<u32> {
    planets(session, id).iter().map(|p| p.id).collect()
}

/// The names the name database's `list` block holds, in file order.
pub fn pool_names(session: &Session, list: &str) -> Vec<String> {
    let text = text(session);
    let start = text
        .find(&format!("\n\t{list}=\n\t{{\n"))
        .unwrap_or_else(|| panic!("the {list} pool"));
    let end = start + text[start..].find("\t}\n").expect("the pool's end");
    text[start..end]
        .lines()
        .filter_map(|line| line.strip_prefix("\t\t\"")?.strip_suffix('"'))
        .map(str::to_owned)
        .collect()
}
