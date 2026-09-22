//! `map/setup_scenarios`: the galaxy sizes the new game screen offers, one
//! `setup_scenario` block each with the number of stars it generates. The static
//! scenarios that share the folder carry no `num_stars` and are not sizes.

use std::path::PathBuf;

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::scenarios::SCENARIO_DIR;
use crate::install::script;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GalaxySize {
    /// The block's `name`, which is also its localisation key (`huge`).
    pub name: String,
    pub num_stars: u32,
    /// The definition file it was read from.
    pub source: PathBuf,
}

#[derive(Debug, Default)]
pub struct GalaxySizes(Vec<GalaxySize>);

impl GalaxySizes {
    /// Every size across the layout's winning files, in filename then file order.
    pub(crate) fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Self {
        let mut sizes = Vec::new();
        for file in layout.files_in(&SCENARIO_DIR.join("/")) {
            let Some((root, src)) = script::parse_file(&file, diagnostics) else {
                continue;
            };
            for block in root.find_all("setup_scenario", &src) {
                let name = block.find("name", &src).and_then(|n| n.scalar_str(&src));
                let num_stars = block
                    .find("num_stars", &src)
                    .and_then(|n| n.scalar_str(&src))
                    .and_then(|n| n.parse().ok());
                if let (Some(name), Some(num_stars)) = (name, num_stars) {
                    sizes.push(GalaxySize {
                        name: name.to_owned(),
                        num_stars,
                        source: file.clone(),
                    });
                }
            }
        }
        Self(sizes)
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = &GalaxySize> {
        self.0.iter()
    }

    /// The size with the most stars; `None` when no file defines one.
    pub fn largest(&self) -> Option<&GalaxySize> {
        self.0.iter().max_by_key(|size| size.num_stars)
    }
}
