//! The scenario fixtures in `testdata/`, each read and indexed once per test binary.
use std::path::PathBuf;
use std::sync::LazyLock;

use sgf_core::document::Document;
use sgf_core::session::Session;

macro_rules! fixture {
    ($file:literal) => {
        Fixture {
            path: concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/", $file),
            document: LazyLock::new(|| {
                let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../testdata/", $file);
                Document::load(path).unwrap_or_else(|e| panic!("{path}: {e}"))
            }),
        }
    };
}

/// Every statement shape the scenario grammar allows, on eight systems.
pub static GRAMMAR: Fixture = fixture!("scenario_grammar.txt");
/// A scenario as Paint a Galaxy writes one: scripted seats, fallen empire zones,
/// wormhole pairs and a header of counts.
pub static PAINTED: Fixture = fixture!("paint_a_galaxy.txt");
/// The sample save's whole galaxy, exported as a plain scenario.
pub static EXPORTED: Fixture = fixture!("4.4-early.scenario.txt");
/// The sample save's whole galaxy, exported under the Paint a Galaxy profile.
pub static EXPORTED_PAINT: Fixture = fixture!("4.4-early.paint.txt");

pub struct Fixture {
    pub path: &'static str,
    document: LazyLock<Document>,
}

impl Fixture {
    /// A session on the fixture, as opening its file would give.
    pub fn open(&self) -> Session {
        Session::from_document(Some(PathBuf::from(self.path)), self.document.clone())
            .expect("open the fixture")
    }

    /// The fixture as it sits on disk: what an undo has to put back byte for byte.
    pub fn bytes(&self) -> Vec<u8> {
        self.document.original().to_vec()
    }

    pub fn text(&self) -> String {
        String::from_utf8(self.bytes()).expect("utf-8")
    }

    /// The fixture with each `from` replaced by its `to` once, in order, opened unsaved.
    pub fn open_edited(&self, edits: &[(&str, &str)]) -> Session {
        let mut text = self.text();
        for (from, to) in edits {
            assert!(text.contains(from), "{from}");
            text = text.replacen(from, to, 1);
        }
        from_scenario_text(text)
    }
}

/// A scenario read from `text` rather than a file, opened unsaved.
pub fn from_scenario_text(text: impl AsRef<[u8]>) -> Session {
    let doc = Document::from_scenario_bytes(text.as_ref().to_vec()).expect("index the scenario");
    Session::from_document(None, doc).expect("project the scenario")
}
