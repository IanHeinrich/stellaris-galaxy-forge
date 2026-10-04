//! The typeface the galaxy map writes empire names in. `interface/*.gfx` names the bitmap
//! font `map_name_border`, its `.fnt` names the face it was rendered from, and
//! `fonts/*.asset` maps that face to the TrueType file it ships as. Each step takes the
//! last layer's word, so a mod that replaces the font, or points the map at another, wins.

use std::path::{Path, PathBuf};

use base64::prelude::*;
use sgf_core::cst::Node;
use walkdir::WalkDir;

use crate::install::layers::Layout;
use crate::install::script::{self, find_deep, last_scalar};

/// The bitmap font the map's border names are drawn with.
const MAP_NAME_FONT: &str = "map_name_border";

/// The TrueType or OpenType file of the face the map writes empire names in, or `None` when
/// any step of the chain is missing.
pub fn map_name_font(layout: &Layout) -> Option<PathBuf> {
    let bitmap = bitmap_font_path(layout, MAP_NAME_FONT)?;
    let fnt = layout.resolve_file(&format!("{bitmap}.fnt"))?;
    let face = fnt_face(&std::fs::read(fnt).ok()?)?;
    let file = font_file(layout, &face)?;
    let path = layout.resolve_file(&file)?;
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    matches!(ext.as_str(), "ttf" | "otf").then_some(path)
}

/// The bytes of [`map_name_font`] as base64, for the app to load as a web font.
pub fn map_name_font_base64(layout: &Layout) -> Option<String> {
    let bytes = std::fs::read(map_name_font(layout)?).ok()?;
    Some(BASE64_STANDARD.encode(bytes))
}

/// The `path` of the last `bitmapfont` named `name` in any layer's `interface/*.gfx`.
fn bitmap_font_path(layout: &Layout, name: &str) -> Option<String> {
    let mut found = None;
    for layer in &layout.layers {
        for file in files_with_ext(&layer.root.join("interface"), "gfx") {
            let Some((root, src)) = script::parse_file(&file, &mut Vec::new()) else {
                continue;
            };
            for font in nodes(&root, "bitmapfont", &src) {
                if last_scalar(font, "name", &src) == Some(name)
                    && let Some(path) = last_scalar(font, "path", &src)
                {
                    found = Some(path.to_owned());
                }
            }
        }
    }
    found
}

/// The `face` of a BMFont text file's `info` line.
fn fnt_face(bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes);
    let info = text.lines().find(|line| line.starts_with("info "))?;
    let rest = &info[info.find("face=\"")? + "face=\"".len()..];
    Some(rest[..rest.find('"')?].to_owned())
}

/// The file of the last `font` called `face` in any layer's `fonts/*.asset`: its regular
/// style when it lists one, else its first.
fn font_file(layout: &Layout, face: &str) -> Option<String> {
    let mut found = None;
    for layer in &layout.layers {
        for file in files_with_ext(&layer.root.join("fonts"), "asset") {
            let Some((root, src)) = script::parse_file(&file, &mut Vec::new()) else {
                continue;
            };
            for font in root.find_all("font", &src) {
                if last_scalar(font, "name", &src) != Some(face) {
                    continue;
                }
                let styles: Vec<&Node> = font.find_all("fontstyle", &src).collect();
                let regular = styles
                    .iter()
                    .find(|s| last_scalar(s, "style", &src) == Some("regular"))
                    .or(styles.first());
                if let Some(path) = regular.and_then(|s| last_scalar(s, "file", &src)) {
                    found = Some(path.to_owned());
                }
            }
        }
    }
    found
}

fn nodes<'n>(root: &'n Node, key: &str, src: &[u8]) -> Vec<&'n Node> {
    let mut out = Vec::new();
    find_deep(root, key, src, &mut out);
    out
}

fn files_with_ext(dir: &Path, ext: &str) -> Vec<PathBuf> {
    WalkDir::new(dir)
        .sort_by_file_name()
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .map(|e| e.into_path())
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext)))
        .collect()
}
