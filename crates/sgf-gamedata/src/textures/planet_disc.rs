//! `planet_disc:<class>`: the surface map a planet class's model wears, projected onto a
//! disc lit from the left. The class names an entity; an `entity = { … }` block in a
//! `gfx/models` `.asset` file names the map as the `texture_diffuse` of its
//! `planet_geosphereShape` mesh, beside the `.asset` file. An entity with no such block
//! (vanilla: the tomb world's) leaves the map to the material its `.mesh` file stores. A
//! model with no such mesh whose `pieceShape1` a planet shader draws is a planet broken into
//! pieces (vanilla: the shattered world's), and that map is its pieces' surface. An entity
//! with neither, only `attach` lines (More Arcologies' city worlds), takes the surface of the
//! first entity it attaches that has one, those at its `planetloc` first.

use std::collections::{BTreeMap, BTreeSet};
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
/// Where entities and models are defined: a habitat's are among the ships'.
const MODELS: &str = "gfx/models";
const SURFACE_MESH: &str = "planet_geosphereShape";
/// The mesh of a planet model broken into pieces.
const PIECES_MESH: &str = "pieceShape1";
/// The locator a wrapper entity attaches its planet's surface at.
const PLANET_LOCATOR: &str = "planetloc";
/// How many `attach` steps down from an entity its surface is looked for.
const ATTACH_DEPTH: usize = 4;
/// The disc's side, in pixels.
const DISC: u32 = 128;
/// How wide a map the disc is sampled from: a mip level of about this width, or the map
/// scaled down to it.
pub(super) const SOURCE_WIDTH: u32 = 256;

/// What the `.asset` and `.gfx` files of `gfx/models` say about each entity's surface.
#[derive(Debug, Default)]
pub(crate) struct SurfaceMaps {
    /// Entity name → the folder of its `.asset` file and its surface map's file name.
    maps: BTreeMap<String, (String, String)>,
    /// Entity name → the folder of its `.asset` file and its pieces' map, for an entity whose
    /// `.asset` names no surface map.
    pieces: BTreeMap<String, (String, String)>,
    /// Entity name → its `pdxmesh`, for an entity whose `.asset` names no surface map.
    meshes: BTreeMap<String, String>,
    /// `pdxmesh` name → its `.mesh` file, relative to a layer root.
    mesh_files: BTreeMap<String, String>,
    /// Entity name → the entities it attaches, those at `planetloc` first and each in file
    /// order, for an entity with neither a surface map nor a `pdxmesh`.
    attached: BTreeMap<String, Vec<String>>,
}

/// What an entity's model has for a surface.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Surface {
    /// A map to bake into a disc, relative to a layer root.
    Map(String),
    /// A map to bake into a disc and break apart: the model is a planet in pieces.
    Pieces(String),
    /// None: the model is read, and has no planet surface.
    Flat,
    /// The files read do not say: no model of that name, or its `.mesh` missing.
    Unknown,
}

impl SurfaceMaps {
    /// How many models the game numbers for `entity`: `<entity>_01_entity`,
    /// `<entity>_02_entity` … in a row, else 1 for an entity of that name alone, else 0.
    pub(crate) fn model_count(&self, entity: &str) -> u32 {
        let known = |name: &str| {
            self.maps.contains_key(name)
                || self.meshes.contains_key(name)
                || self.attached.contains_key(name)
        };
        let numbered = (1..)
            .take_while(|n| known(&format!("{entity}_{n:02}_entity")))
            .count();
        match numbered {
            0 => u32::from(known(&format!("{entity}_entity")) || known(entity)),
            n => u32::try_from(n).unwrap_or(u32::MAX),
        }
    }
}

/// The surface of `entity` in `maps`. The game numbers a class's models `<entity>_01_entity`,
/// `<entity>_02_entity` …; the first one stands for them all. A map an `.asset` names comes
/// before one a `.mesh` stores, whichever name each is under, a whole surface before pieces,
/// and an entity's own model before the ones it attaches.
pub(crate) fn surface(layout: &Layout, maps: &SurfaceMaps, entity: &str) -> Surface {
    let names = [
        format!("{entity}_01_entity"),
        format!("{entity}_entity"),
        entity.to_owned(),
    ];
    let names = names.each_ref().map(String::as_str);
    surface_among(layout, maps, &names, &mut BTreeSet::new(), ATTACH_DEPTH)
}

fn surface_among<'m>(
    layout: &Layout,
    maps: &'m SurfaceMaps,
    names: &[&str],
    path: &mut BTreeSet<&'m str>,
    depth: usize,
) -> Surface {
    if let Some((asset_dir, file)) = names.iter().find_map(|name| maps.maps.get(*name)) {
        return Surface::Map(beside_or_in_assets(layout, asset_dir, file));
    }
    if let Some((asset_dir, file)) = names.iter().find_map(|name| maps.pieces.get(*name)) {
        return Surface::Pieces(beside_or_in_assets(layout, asset_dir, file));
    }
    if let Some(mesh) = names.iter().find_map(|name| maps.meshes.get(*name)) {
        return mesh_surface(layout, maps, mesh);
    }
    let Some(attached) = names.iter().find_map(|name| maps.attached.get(*name)) else {
        return Surface::Unknown;
    };
    if depth == 0 {
        return Surface::Unknown;
    }
    for target in attached {
        if !path.insert(target) {
            continue;
        }
        let surface = surface_among(layout, maps, &[target], path, depth - 1);
        path.remove(target.as_str());
        if matches!(surface, Surface::Map(_) | Surface::Pieces(_)) {
            return surface;
        }
    }
    Surface::Unknown
}

/// The surface the `.mesh` file of model `mesh` stores.
fn mesh_surface(layout: &Layout, maps: &SurfaceMaps, mesh: &str) -> Surface {
    let Some(mesh) = maps.mesh_files.get(mesh) else {
        return Surface::Unknown;
    };
    let Some(bytes) = layout.resolve_file(mesh).and_then(|p| fs::read(p).ok()) else {
        return Surface::Unknown;
    };
    let dir = mesh.rsplit_once('/').map_or("", |(dir, _)| dir);
    if let Some(file) = material_diffuse(&bytes, SURFACE_MESH) {
        Surface::Map(beside_or_in_assets(layout, dir, file))
    } else if let Some(file) = material_diffuse(&bytes, PIECES_MESH) {
        Surface::Pieces(beside_or_in_assets(layout, dir, file))
    } else {
        Surface::Flat
    }
}

/// The surface map of `entity` in `maps`, relative to a layer root.
pub(crate) fn diffuse(layout: &Layout, maps: &SurfaceMaps, entity: &str) -> Option<String> {
    match surface(layout, maps, entity) {
        Surface::Map(rel) => Some(rel),
        Surface::Pieces(_) | Surface::Flat | Surface::Unknown => None,
    }
}

fn beside_or_in_assets(layout: &Layout, dir: &str, file: &str) -> String {
    let beside = format!("{dir}/{file}");
    if layout.resolve_file(&beside).is_some() {
        beside
    } else {
        format!("{ASSETS}/{file}")
    }
}

/// The `diff` texture of the material of object `shape` in a binary `.mesh`, when a planet
/// shader draws it: a star's names a placeholder. An object opens with `[[<shape>` and its
/// material with `[[[[material`; each property is `!`, the name's length in a byte, the name, a
/// type byte (`i`, `f` or `s`) and a little-endian `u32` count of values, each four bytes, or
/// for `s` a `u32` length and that many bytes ending in NUL.
fn material_diffuse<'a>(mesh: &'a [u8], shape: &str) -> Option<&'a str> {
    const MATERIAL: &[u8] = b"[[[[material\0";
    let header = [b"[[", shape.as_bytes(), b"\0"].concat();
    let object = find(mesh, &header, 0)?;
    let end = next_object(mesh, object + header.len());
    let mut at = find(&mesh[..end], MATERIAL, object)? + MATERIAL.len();
    let u32_at = |at: usize| -> Option<usize> {
        let bytes = mesh.get(at..at.checked_add(4)?)?;
        Some(u32::from_le_bytes(bytes.try_into().ok()?) as usize)
    };
    let (mut shader, mut diff) = (None, None);
    while mesh.get(at) == Some(&b'!') {
        let name_len = usize::from(*mesh.get(at + 1)?);
        let name = mesh.get(at + 2..at + 2 + name_len)?;
        let kind = *mesh.get(at + 2 + name_len)?;
        let count = u32_at(at + 3 + name_len)?;
        at += 7 + name_len;
        match kind {
            b's' => {
                for _ in 0..count {
                    let len = u32_at(at)?;
                    let start = at + 4;
                    at = start.checked_add(len)?;
                    let value = mesh.get(start..at)?;
                    let value = value.strip_suffix(b"\0").unwrap_or(value);
                    let value = std::str::from_utf8(value).ok();
                    match name {
                        b"shader" => shader = value,
                        b"diff" => diff = value,
                        _ => {}
                    }
                }
            }
            b'i' | b'f' => at = at.checked_add(count.checked_mul(4)?)?,
            _ => return None,
        }
        if at > mesh.len() {
            return None;
        }
    }
    let planet = shader.is_some_and(|s| s.starts_with("PdxMeshPlanet"));
    diff.filter(|d| planet && !d.is_empty())
}

/// Where the object after `from` opens, or the end of `mesh`: `[[`, not after another `[`,
/// then a name and a NUL, then its first child's `[[[`.
fn next_object(mesh: &[u8], from: usize) -> usize {
    let mut at = from;
    while let Some(open) = find(mesh, b"[[", at) {
        let name = open + 2;
        let named = mesh[name..]
            .iter()
            .position(|&b| !(b.is_ascii_alphanumeric() || b"_.:-".contains(&b)))
            .filter(|&len| len > 0)
            .is_some_and(|len| mesh[name + len..].starts_with(b"\0[[["));
        if named && mesh.get(open.wrapping_sub(1)) != Some(&b'[') {
            return open;
        }
        at = open + 1;
    }
    mesh.len()
}

fn find(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    haystack
        .get(from..)?
        .windows(needle.len())
        .position(|w| w == needle)
        .map(|i| from + i)
}

/// The files of extension `ext` under `gfx/models` in the layers of `layout`, each
/// with its folder relative to its layer root, in layer order then path order. A later
/// layer's file of the same path replaces the earlier one.
fn layered_files(layout: &Layout, ext: &str) -> Vec<(String, PathBuf)> {
    let mut files: BTreeMap<String, (usize, PathBuf)> = BTreeMap::new();
    for (index, layer) in layout.layers.iter().enumerate() {
        let root = MODELS.split('/').fold(layer.root.clone(), |p, s| p.join(s));
        for entry in WalkDir::new(&root)
            .sort_by_file_name()
            .into_iter()
            .flatten()
        {
            let path = entry.into_path();
            let matches = path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case(ext));
            if !matches || !path.is_file() {
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
    ordered
        .into_iter()
        .map(|(_, dir, path)| (dir, path))
        .collect()
}

/// Every entity's surface map in the `.asset` files of `layout`, the model of each entity
/// that names none, the entities each entity with neither attaches, and the `.mesh` file of
/// each model in the `.gfx` files. A later layer's
/// file of the same path replaces the earlier one, and a later entity or model of the same
/// name wins.
pub(crate) fn surface_maps(layout: &Layout) -> SurfaceMaps {
    let mut maps = SurfaceMaps::default();
    for (dir, path) in layered_files(layout, "asset") {
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
            let attached = attached(entity, &src);
            if let Some(file) = mesh_map(entity, SURFACE_MESH, &src) {
                maps.meshes.remove(name);
                maps.pieces.remove(name);
                maps.attached.remove(name);
                maps.maps
                    .insert(name.to_owned(), (dir.clone(), file.to_owned()));
            } else if let Some(mesh) = last_scalar(entity, "pdxmesh", &src) {
                maps.maps.remove(name);
                maps.attached.remove(name);
                match mesh_map(entity, PIECES_MESH, &src) {
                    Some(file) => maps
                        .pieces
                        .insert(name.to_owned(), (dir.clone(), file.to_owned())),
                    None => maps.pieces.remove(name),
                };
                maps.meshes.insert(name.to_owned(), mesh.to_owned());
            } else if !attached.is_empty() {
                maps.maps.remove(name);
                maps.pieces.remove(name);
                maps.meshes.remove(name);
                maps.attached.insert(name.to_owned(), attached);
            }
        }
    }
    for (_, path) in layered_files(layout, "gfx") {
        let Ok(src) = fs::read(&path) else {
            continue;
        };
        let Ok(root) = cst::parse_script(&src, 0) else {
            continue;
        };
        for types in root
            .children()
            .iter()
            .filter(|n| n.key_str(&src) == Some("objectTypes"))
        {
            for mesh in types.find_all("pdxmesh", &src) {
                let name = last_scalar(mesh, "name", &src);
                let file = last_scalar(mesh, "file", &src);
                if let (Some(name), Some(file)) = (name, file) {
                    let file = file.replace('\\', "/");
                    maps.mesh_files.insert(name.to_owned(), file);
                }
            }
        }
    }
    maps
}

/// The entities `entity` attaches, each `attach = { "<locator>" = "<entity>" }`, those at
/// `planetloc` first. The planet's surface is mostly there, but Planetary Diversity's
/// tidally locked worlds use `tiltLoc` and vanilla's Uranus-like gas giant `part1`.
fn attached(entity: &Node, src: &[u8]) -> Vec<String> {
    let mut targets: Vec<(bool, String)> = entity
        .find_all("attach", src)
        .flat_map(Node::children)
        .filter_map(|target| {
            let name = target.scalar_str(src).filter(|name| !name.is_empty())?;
            Some((target.key_str(src) != Some(PLANET_LOCATOR), name.to_owned()))
        })
        .collect();
    targets.sort_by_key(|(elsewhere, _)| *elsewhere);
    targets.into_iter().map(|(_, name)| name).collect()
}

fn mesh_map<'a>(entity: &Node, shape: &str, src: &'a [u8]) -> Option<&'a str> {
    entity
        .find_all("meshsettings", src)
        .find(|mesh| last_scalar(mesh, "name", src) == Some(shape))
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
