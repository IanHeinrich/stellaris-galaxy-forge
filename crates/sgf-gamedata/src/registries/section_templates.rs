//! `common/section_templates`: the model each ship section is drawn with and the ship sizes
//! and slots it fits. Every block is a `ship_section_template`, named by its own `key`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use sgf_core::cst::Node;

use crate::install::layers::Layout;
use crate::install::script::ParsedDir;
use crate::registries::registry::Registry;
use crate::{Diagnostic, Meter};

pub(crate) const DIR: &str = "common/section_templates";

const TEMPLATE: &str = "ship_section_template";

pub type SectionTemplates = Registry<SectionTemplateDef>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SectionTemplateDef {
    pub key: String,
    /// The file the winning definition was read from.
    pub source: PathBuf,
    /// Where the winning definition stands in load order, across every file of the layout.
    pub rank: usize,
    /// Every `ship_size` it fits, in file order.
    pub ship_sizes: Vec<String>,
    /// Every `fits_on_slot`, in file order.
    pub slots: Vec<String>,
    /// The model, without the graphical culture prefix the game puts before it.
    pub entity: Option<String>,
}

impl SectionTemplates {
    /// The template that fits slot `slot` of ship size `size`; the latest in load order when
    /// several do.
    pub fn fitting(&self, size: &str, slot: &str) -> Option<&SectionTemplateDef> {
        self.iter()
            .filter(|t| t.ship_sizes.iter().any(|s| s == size) && t.slots.iter().any(|s| s == slot))
            .max_by_key(|t| t.rank)
    }
}

/// Every template across the layout, keyed by its `key`, the last in load order winning. A
/// key a later file repeats raises [`Diagnostic::Override`].
pub(crate) fn load(
    layout: &Layout,
    diagnostics: &mut Vec<Diagnostic>,
    meter: &mut Meter<'_>,
) -> SectionTemplates {
    let files = layout.files_in(DIR);
    meter.expect(files.len());
    let dir = ParsedDir::read(DIR, files, diagnostics, meter);
    let mut templates: BTreeMap<String, SectionTemplateDef> = BTreeMap::new();
    let blocks = dir.files().flat_map(|(file, root, src)| {
        root.find_all(TEMPLATE, src)
            .map(move |block| (file, block, src))
    });
    for (rank, (file, block, src)) in blocks.enumerate() {
        let Some(template) = read(block, src, file, rank) else {
            continue;
        };
        if let Some(earlier) = templates.get(&template.key)
            && earlier.source != template.source
        {
            diagnostics.push(Diagnostic::Override {
                key: template.key.clone(),
                from: earlier.source.clone(),
                to: template.source.clone(),
            });
        }
        templates.insert(template.key.clone(), template);
    }
    templates.into_iter().collect()
}

fn read(block: &Node, src: &[u8], file: &Path, rank: usize) -> Option<SectionTemplateDef> {
    let values = |field: &'static str| -> Vec<String> {
        block
            .find_all(field, src)
            .filter_map(|n| n.scalar_str(src))
            .map(str::to_owned)
            .collect()
    };
    Some(SectionTemplateDef {
        key: block.find("key", src)?.scalar_str(src)?.to_owned(),
        source: file.to_path_buf(),
        rank,
        ship_sizes: values("ship_size"),
        slots: values("fits_on_slot"),
        entity: block
            .find("entity", src)
            .and_then(|n| n.scalar_str(src))
            .filter(|name| !name.is_empty())
            .map(str::to_owned),
    })
}
