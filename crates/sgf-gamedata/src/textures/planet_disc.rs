//! `planet_disc:<class>`: the surface map a planet class's model wears, projected onto a
//! disc lit from the left. The class names an entity; an `entity = { … }` block in a
//! `gfx/models/planets` `.asset` file names the map as the `texture_diffuse` of its
//! `planet_geosphereShape` mesh, beside the `.asset` file.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use image::RgbaImage;
use image::imageops::{self, FilterType};
use sgf_core::cst::{self, Node};
use walkdir::WalkDir;

use super::sphere::{self, Plane, Wrap};
use crate::install::layers::Layout;
use crate::install::script::last_scalar;

const ASSETS: &str = "gfx/models/planets";
const SURFACE_MESH: &str = "planet_geosphereShape";
/// The disc's side, in pixels.
const DISC: u32 = 128;
/// How wide a map the disc is sampled from: a mip level of about this width, or the map
/// scaled down to it.
pub(super) const SOURCE_WIDTH: u32 = 256;

/// Entity name → the folder of its `.asset` file and its surface map's file name.
pub(super) type SurfaceMaps = BTreeMap<String, (String, String)>;

/// The surface map of `entity` in `maps`, relative to a layer root. The game numbers a
/// class's models `<entity>_01_entity`, `<entity>_02_entity` …; the first one stands for
/// them all.
pub(super) fn diffuse(layout: &Layout, maps: &SurfaceMaps, entity: &str) -> Option<String> {
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

/// Every entity's surface map in the `.asset` files of `layout`. A later layer's file of
/// the same path replaces the earlier one, and a later entity of the same name wins.
pub(super) fn surface_maps(layout: &Layout) -> SurfaceMaps {
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
            let Some(name) = last_scalar(entity, "name", &src) else {
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
        .find(|mesh| last_scalar(mesh, "name", src) == Some(SURFACE_MESH))
        .and_then(|mesh| last_scalar(mesh, "texture_diffuse", src))
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
    let plane = Plane::new(map, Wrap::Equirect);
    let light = [
        -std::f64::consts::FRAC_1_SQRT_2,
        0.0,
        std::f64::consts::FRAC_1_SQRT_2,
    ];
    sphere::render(DISC, 1, 1.0, |x, y, z| {
        let (u, v) = sphere::equirect(x, y, z);
        let shade = (x * light[0] + y * light[1] + z * light[2]).max(0.0);
        plane.sample(u, v).map(|c| c * shade)
    })
}
