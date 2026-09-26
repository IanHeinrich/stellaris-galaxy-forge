//! `flags/colors.txt`: the empire colour palette (flag, map and ship
//! swatches per named colour). The winning `colors.txt` (last layer that
//! provides one) is parsed whole, entries keyed by name.

use sgf_core::cst::Node;

use crate::Diagnostic;
use crate::install::layers::{Layout, VANILLA};
use crate::install::script;
use crate::registries::registry::Registry;

#[derive(Debug, Default)]
pub struct Colors {
    pub entries: Registry<ColorDef>,
    /// The name of the mod whose `colors.txt` won; `None` for vanilla's, or for none.
    pub source: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColorDef {
    pub name: String,
    pub flag: [u8; 3],
    pub map: [u8; 3],
    pub ship: [u8; 3],
}

pub(crate) fn load(layout: &Layout, diagnostics: &mut Vec<Diagnostic>) -> Colors {
    let mut colors = Colors::default();
    let Some(file) = layout.file_in("flags", "colors.txt") else {
        return colors;
    };
    colors.source = layout
        .layer_of(&file)
        .map(|(layer, _)| layer.name.clone())
        .filter(|name| name != VANILLA);
    if let Some((root, src)) = script::parse_file(&file, diagnostics)
        && let Some(block) = root.find("colors", &src)
    {
        for child in block.children() {
            let Some(name) = child.key_str(&src) else {
                continue;
            };
            if let Some(def) = read_color(name.to_owned(), child, &src) {
                colors.entries.insert(def.name.clone(), def);
            }
        }
    }
    colors
}

fn read_color(name: String, node: &Node, src: &[u8]) -> Option<ColorDef> {
    Some(ColorDef {
        flag: read_rgb(node, "flag", src)?,
        map: read_rgb(node, "map", src)?,
        ship: read_rgb(node, "ship", src)?,
        name,
    })
}

/// `key = rgb { r g b }` in 0 to 255, or `key = hsv { h s v }` in 0 to 1.
pub(crate) fn read_rgb(node: &Node, key: &str, src: &[u8]) -> Option<[u8; 3]> {
    let channel = node.find(key, src)?;
    let rgb = script::list_items(channel, "rgb", src);
    if let Some(triple) = to_triple(&rgb) {
        return Some(triple.map(clamp_u8));
    }
    let hsv = script::list_items(channel, "hsv", src);
    let [h, s, v] = to_triple(&hsv)?;
    Some(hsv_to_rgb(h, s, v))
}

fn to_triple(items: &[String]) -> Option<[f64; 3]> {
    let [a, b, c] = items else { return None };
    Some([a.parse().ok()?, b.parse().ok()?, c.parse().ok()?])
}

fn clamp_u8(x: f64) -> u8 {
    x.round().clamp(0.0, 255.0) as u8
}

fn hsv_to_rgb(h: f64, s: f64, v: f64) -> [u8; 3] {
    hsv_to_unit(h, s, v).map(|c| clamp_u8(c * 255.0))
}

/// `key = hsv { h s v }` or `key = rgb { r g b }` as channels in 0 to 1, left unclamped
/// above 1: the graphics settings write values past it.
pub(crate) fn read_unit_rgb(node: &Node, key: &str, src: &[u8]) -> Option<[f64; 3]> {
    let channel = node.find_all(key, src).last()?;
    let rgb = script::list_items(channel, "rgb", src);
    if let Some(triple) = to_triple(&rgb) {
        return Some(triple.map(|c| c / 255.0));
    }
    let [h, s, v] = to_triple(&script::list_items(channel, "hsv", src))?;
    Some(hsv_to_unit(h, s, v))
}

fn hsv_to_unit(h: f64, s: f64, v: f64) -> [f64; 3] {
    if s <= 0.0 {
        return [v; 3];
    }
    let h = h * 6.0;
    let i = h.floor();
    let f = h - i;
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));
    match (i as i64).rem_euclid(6) {
        0 => [v, t, p],
        1 => [q, v, p],
        2 => [p, v, t],
        3 => [p, q, v],
        4 => [t, p, v],
        _ => [v, p, q],
    }
}
