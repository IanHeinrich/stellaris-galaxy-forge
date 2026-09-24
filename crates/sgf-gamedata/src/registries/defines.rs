//! `common/defines`: the `NGraphics` constants the map uses to draw territory
//! borders, and the `NGameplay` ones that set how many deposits a new body rolls.

use std::path::PathBuf;
use std::sync::Arc;

use sgf_core::cst::Node;

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::script;

type Parsed = (Node, Arc<[u8]>);

/// Every file under `common/defines` in load order, each read and parsed once, so a
/// broken file is reported once however many readers look at it. `None` where it failed.
pub(crate) struct DefineFiles(Vec<(PathBuf, Option<Parsed>)>);

impl DefineFiles {
    pub(crate) fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Self {
        Self(
            layout
                .files_in("common/defines")
                .into_iter()
                .map(|file| {
                    let parsed = script::parse_file(&file, diagnostics);
                    (file, parsed)
                })
                .collect(),
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BorderDefines {
    pub system_radius: f64,
    pub hyperlane_thickness: f64,
}

impl Default for BorderDefines {
    fn default() -> Self {
        Self {
            system_radius: 35.0,
            hyperlane_thickness: 20.0,
        }
    }
}

impl BorderDefines {
    pub(crate) fn load(files: &DefineFiles) -> Self {
        let Some((root, src)) = files
            .0
            .iter()
            .find(|(file, _)| file.file_name().is_some_and(|f| f == "00_defines.txt"))
            .and_then(|(_, parsed)| parsed.as_ref())
        else {
            return Self::default();
        };
        let Some(graphics) = root.find("NGraphics", src) else {
            return Self::default();
        };
        let defaults = Self::default();
        Self {
            system_radius: field(graphics, "BORDER_SYSTEM_RADIUS", src)
                .unwrap_or(defaults.system_radius),
            hyperlane_thickness: field(graphics, "BORDER_HYPERLANE_THICKNESS", src)
                .unwrap_or(defaults.hyperlane_thickness),
        }
    }
}

fn field(node: &Node, key: &str, src: &[u8]) -> Option<f64> {
    node.find(key, src)?.scalar_str(src)?.parse().ok()
}

/// `NGameplay`: how many deposits a new body rolls, and the Resource Abundance range.
/// Every file under `common/defines` is read in order, a later value replacing an earlier
/// one, since a mod changes a define by writing it again in a file of its own.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DepositDefines {
    pub min_blocked: f64,
    pub min_unblocked: f64,
    pub colony: DepositCounts,
    pub non_colony: DepositCounts,
    pub abundance_default: f64,
    pub abundance_max: f64,
}

/// `*_DEPOSITS_FIXED_BASE` and friends for one kind of body.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DepositCounts {
    pub fixed_base: f64,
    pub random_base: f64,
    pub fixed_from_size: f64,
    pub random_from_size: f64,
}

impl DepositCounts {
    /// How many draws a body of `size` gets.
    pub fn draws(self, size: f64) -> usize {
        floor(
            self.fixed_base
                + self.random_base
                + (self.fixed_from_size + self.random_from_size) * size,
        )
    }

    /// How many deposits a body of `size` is topped up to.
    pub fn minimum(self, size: f64) -> usize {
        floor(self.fixed_base + self.fixed_from_size * size)
    }
}

fn floor(n: f64) -> usize {
    n.floor().max(0.0) as usize
}

impl Default for DepositDefines {
    fn default() -> Self {
        Self {
            min_blocked: 1.0,
            min_unblocked: 3.0,
            colony: DepositCounts {
                fixed_base: 5.0,
                random_base: 2.0,
                fixed_from_size: 0.2,
                random_from_size: 0.2,
            },
            non_colony: DepositCounts {
                fixed_base: 1.0,
                random_base: 0.0,
                fixed_from_size: 0.0,
                random_from_size: 0.0,
            },
            abundance_default: 2.0,
            abundance_max: 5.0,
        }
    }
}

impl DepositDefines {
    pub(crate) fn load(files: &DefineFiles) -> Self {
        let mut out = Self::default();
        for (root, src) in files.0.iter().filter_map(|(_, parsed)| parsed.as_ref()) {
            for gameplay in root.find_all("NGameplay", src) {
                out.read(gameplay, src);
            }
        }
        out
    }

    /// The factor a save's `galaxy.resource_abundance` gives, the default when it has none.
    pub fn abundance(&self, saved: Option<f64>) -> f64 {
        saved.unwrap_or(self.abundance_default)
    }

    fn read(&mut self, node: &Node, src: &[u8]) {
        let set = |target: &mut f64, key: &str| {
            if let Some(n) = field(node, key, src) {
                *target = n;
            }
        };
        set(&mut self.min_blocked, "MIN_BLOCKED_DEPOSITS");
        set(&mut self.min_unblocked, "MIN_UNBLOCKED_DEPOSITS");
        for (counts, prefix) in [
            (&mut self.colony, "COLONY"),
            (&mut self.non_colony, "NON_COLONY"),
        ] {
            set(
                &mut counts.fixed_base,
                &format!("{prefix}_DEPOSITS_FIXED_BASE"),
            );
            set(
                &mut counts.random_base,
                &format!("{prefix}_DEPOSITS_RANDOM_BASE"),
            );
            set(
                &mut counts.fixed_from_size,
                &format!("{prefix}_DEPOSITS_FIXED_FROM_SIZE"),
            );
            set(
                &mut counts.random_from_size,
                &format!("{prefix}_DEPOSITS_RANDOM_FROM_SIZE"),
            );
        }
        set(&mut self.abundance_default, "RESOURCE_ABUNDANCE_DEFAULT");
        set(&mut self.abundance_max, "RESOURCE_ABUNDANCE_MAX");
    }
}
