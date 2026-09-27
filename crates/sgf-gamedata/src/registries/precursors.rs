//! `common/precursor_civilizations`: the precursors galaxy generation spreads across the
//! map, one top-level block each. The key is the star flag the game sets on every system
//! of the precursor's region, and its localisation key. Kept in file order rather than
//! keyed, so the app lists them as the game defines them.

use std::path::PathBuf;

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::script;

pub(crate) const DIR: &str = "common/precursor_civilizations";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrecursorDef {
    pub key: String,
    /// The definition file it was read from.
    pub source: PathBuf,
}

#[derive(Debug, Default)]
pub struct PrecursorCivilizations(Vec<PrecursorDef>);

impl PrecursorCivilizations {
    /// Every precursor across the layout's winning files, in filename then file order. A
    /// key a later file repeats keeps its place and takes the later file as its source,
    /// as the game reads the later definition.
    pub(crate) fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Self {
        let mut defs: Vec<PrecursorDef> = Vec::new();
        for file in layout.files_in(DIR) {
            let Some((root, src)) = script::parse_file(&file, diagnostics) else {
                continue;
            };
            for node in root.children() {
                let Some(key) = node.key_str(&src) else {
                    continue;
                };
                if key.starts_with('@') || node.scalar_span().is_some() {
                    continue;
                }
                match defs.iter_mut().find(|def| def.key == key) {
                    Some(def) => {
                        if def.source != file {
                            diagnostics.push(Diagnostic::Override {
                                key: key.to_owned(),
                                from: def.source.clone(),
                                to: file.clone(),
                            });
                            def.source = file.clone();
                        }
                    }
                    None => defs.push(PrecursorDef {
                        key: key.to_owned(),
                        source: file.clone(),
                    }),
                }
            }
        }
        Self(defs)
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &PrecursorDef> {
        self.0.iter()
    }
}
