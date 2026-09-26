//! `planet_disc:<class>`: the surface map a planet class's model wears, projected onto a
//! disc lit from the left. The class names an entity; an `entity = { … }` block in a
//! `gfx/models/planets` `.asset` file names the map as the `texture_diffuse` of its
//! `planet_geosphereShape` mesh, beside the `.asset` file.

use std::collections::BTreeMap;
use std::f64::consts::{PI, TAU};
use std::fs;
use std::path::PathBuf;

use image::imageops::{self, FilterType};
use image::{Rgba, RgbaImage};
use sgf_core::cst::{self, Node};
use walkdir::WalkDir;

use crate::install::layers::Layout;

const ASSETS: &str = "gfx/models/planets";
const SURFACE_MESH: &str = "planet_geosphereShape";
/// The disc's side, in pixels.
const DISC: u32 = 128;
/// How wide a map the disc is sampled from: a mip level of about this width, or the map
/// scaled down to it.
pub(super) const SOURCE_WIDTH: u32 = 256;

/// The surface map of `entity`, relative to a layer root. The game numbers a class's
/// models `<entity>_01_entity`, `<entity>_02_entity` …; the first one stands for them all.
pub(super) fn diffuse(layout: &Layout, entity: &str) -> Option<String> {
    let maps = surface_maps(layout);
    [
        format!("{entity}_01_entity"),
        format!("{entity}_entity"),
        entity.to_owned(),
    ]
    .iter()
    .find_map(|name| maps.get(name))
    .map(|(asset_dir, file)| {
        let beside = format!("{asset_dir}/{file}");
        if layout.resolve_file(&beside).is_some() {
            beside
        } else {
            format!("{ASSETS}/{file}")
        }
    })
}

/// Entity name → the folder of its `.asset` file and its surface map's file name. A later
/// layer's file of the same path replaces the earlier one, and a later entity of the same
/// name wins.
fn surface_maps(layout: &Layout) -> BTreeMap<String, (String, String)> {
    let mut files: BTreeMap<String, (usize, PathBuf)> = BTreeMap::new();
    for (index, layer) in layout.layers.iter().enumerate() {
        let root = ASSETS.split('/').fold(layer.root.clone(), |p, s| p.join(s));
        for entry in WalkDir::new(&root)
            .sort_by_file_name()
            .into_iter()
            .flatten()
        {
            let path = entry.into_path();
            let is_asset = path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("asset"));
            if !is_asset || !path.is_file() {
                continue;
            }
            if let Ok(rel) = path.strip_prefix(&layer.root) {
                let rel = rel.to_string_lossy().replace('\\', "/");
                files.insert(rel.to_ascii_lowercase(), (index, path));
            }
        }
    }
    let mut ordered: Vec<(usize, String, PathBuf)> = files
        .into_values()
        .filter_map(|(index, path)| {
            let rel = path
                .strip_prefix(&layout.layers[index].root)
                .ok()?
                .parent()?
                .to_string_lossy()
                .replace('\\', "/");
            Some((index, rel, path))
        })
        .collect();
    ordered.sort();
    let mut maps = BTreeMap::new();
    for (_, dir, path) in ordered {
        let Ok(src) = fs::read(&path) else {
            continue;
        };
        let Ok(root) = cst::parse_script(&src, 0) else {
            continue;
        };
        for entity in root
            .children()
            .iter()
            .filter(|n| n.key_str(&src) == Some("entity"))
        {
            let Some(name) = scalar(entity, "name", &src) else {
                continue;
            };
            if let Some(file) = surface_map(entity, &src) {
                maps.insert(name.to_owned(), (dir.clone(), file.to_owned()));
            }
        }
    }
    maps
}

fn surface_map<'a>(entity: &Node, src: &'a [u8]) -> Option<&'a str> {
    entity
        .find_all("meshsettings", src)
        .find(|mesh| scalar(mesh, "name", src) == Some(SURFACE_MESH))
        .and_then(|mesh| scalar(mesh, "texture_diffuse", src))
        .filter(|file| !file.is_empty())
}

fn scalar<'a>(node: &Node, key: &str, src: &'a [u8]) -> Option<&'a str> {
    node.find(key, src)?.scalar_str(src)
}

/// `map`, an equirectangular projection, seen from far away as a sphere lit by a light
/// to the left of the viewer, at 45°. Outside the disc is transparent black.
pub(super) fn bake(map: &RgbaImage) -> RgbaImage {
    let scaled;
    let map = if map.width() > SOURCE_WIDTH {
        scaled = imageops::resize(map, SOURCE_WIDTH, SOURCE_WIDTH / 2, FilterType::Triangle);
        &scaled
    } else {
        map
    };
    let light = [
        -std::f64::consts::FRAC_1_SQRT_2,
        0.0,
        std::f64::consts::FRAC_1_SQRT_2,
    ];
    let radius = f64::from(DISC) / 2.0;
    RgbaImage::from_fn(DISC, DISC, |px, py| {
        let x = (f64::from(px) + 0.5 - radius) / radius;
        let y = (radius - f64::from(py) - 0.5) / radius;
        let r = x.hypot(y);
        let coverage = (radius * (1.0 - r) + 0.5).clamp(0.0, 1.0);
        if coverage <= 0.0 {
            return Rgba([0; 4]);
        }
        let (x, y) = if r > 1.0 { (x / r, y / r) } else { (x, y) };
        let z = (1.0 - x * x - y * y).max(0.0).sqrt();
        let u = 0.5 + x.atan2(z) / TAU;
        let v = 0.5 - y.clamp(-1.0, 1.0).asin() / PI;
        let shade = (x * light[0] + y * light[1] + z * light[2]).max(0.0);
        let [red, green, blue] = sample(map, u, v).map(|c| byte(c * shade));
        Rgba([red, green, blue, byte(coverage * 255.0)])
    })
}

/// Bilinear, wrapping round in longitude and clamped at the poles.
fn sample(map: &RgbaImage, u: f64, v: f64) -> [f64; 3] {
    let (w, h) = (i64::from(map.width()), i64::from(map.height()));
    let x = u * w as f64 - 0.5;
    let y = (v * h as f64 - 0.5).clamp(0.0, (h - 1) as f64);
    let (x0, y0) = (x.floor(), y.floor());
    let (fx, fy) = (x - x0, y - y0);
    let texel = |dx: i64, dy: i64| {
        let tx = (x0 as i64 + dx).rem_euclid(w) as u32;
        let ty = (y0 as i64 + dy).clamp(0, h - 1) as u32;
        map.get_pixel(tx, ty).0
    };
    let (a, b, c, d) = (texel(0, 0), texel(1, 0), texel(0, 1), texel(1, 1));
    std::array::from_fn(|i| {
        let top = f64::from(a[i]) * (1.0 - fx) + f64::from(b[i]) * fx;
        let bottom = f64::from(c[i]) * (1.0 - fx) + f64::from(d[i]) * fx;
        top * (1.0 - fy) + bottom * fy
    })
}

fn byte(value: f64) -> u8 {
    value.round().clamp(0.0, 255.0) as u8
}
