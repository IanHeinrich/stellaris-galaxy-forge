//! `common/defines/00_defines.txt`, `NGraphics`: the constants the map uses
//! to draw territory borders.

use crate::Diagnostic;
use crate::install::layers::Layout;
use crate::install::script;

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
    pub(crate) fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Self {
        let Some(file) = layout.file_in("common/defines", "00_defines.txt") else {
            return Self::default();
        };
        let Some((root, src)) = script::parse_file(&file, diagnostics) else {
            return Self::default();
        };
        let Some(graphics) = root.find("NGraphics", &src) else {
            return Self::default();
        };
        let defaults = Self::default();
        Self {
            system_radius: field(graphics, "BORDER_SYSTEM_RADIUS", &src)
                .unwrap_or(defaults.system_radius),
            hyperlane_thickness: field(graphics, "BORDER_HYPERLANE_THICKNESS", &src)
                .unwrap_or(defaults.hyperlane_thickness),
        }
    }
}

fn field(node: &sgf_core::cst::Node, key: &str, src: &[u8]) -> Option<f64> {
    node.find(key, src)?.scalar_str(src)?.parse().ok()
}
