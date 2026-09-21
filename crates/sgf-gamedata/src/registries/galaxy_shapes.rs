//! `map/galaxy`: the shapes a scenario lists itself under with `supports_shape`, one
//! top-level block each. Kept in file order rather than keyed: the game's own menu
//! lists them as the file gives them, and a mod's file overrides vanilla's by name.

use std::path::PathBuf;

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::script;

const DIR: &str = "map/galaxy";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GalaxyShape {
    pub name: String,
    /// The definition file it was read from.
    pub source: PathBuf,
}

#[derive(Debug, Default)]
pub struct GalaxyShapes(Vec<GalaxyShape>);

impl GalaxyShapes {
    /// Every shape across the layout's winning files, in filename then file order. A
    /// name a later file repeats keeps its place and takes the later file as its
    /// source, as the game reads the later definition.
    pub(crate) fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Self {
        let mut shapes: Vec<GalaxyShape> = Vec::new();
        for file in layout.files_in(DIR) {
            let Some((root, src)) = script::parse_file(&file, diagnostics) else {
                continue;
            };
            for node in root.children() {
                let Some(name) = node.key_str(&src) else {
                    continue;
                };
                if name.starts_with('@') || node.scalar_span().is_some() {
                    continue;
                }
                match shapes.iter_mut().find(|shape| shape.name == name) {
                    Some(shape) => {
                        if shape.source != file {
                            diagnostics.push(Diagnostic::Override {
                                key: name.to_owned(),
                                from: shape.source.clone(),
                                to: file.clone(),
                            });
                            shape.source = file.clone();
                        }
                    }
                    None => shapes.push(GalaxyShape {
                        name: name.to_owned(),
                        source: file.clone(),
                    }),
                }
            }
        }
        Self(shapes)
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &GalaxyShape> {
        self.0.iter()
    }
}
