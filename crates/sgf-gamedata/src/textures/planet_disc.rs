//! `planet_disc:<class>`: the surface map a planet class's model wears, projected onto a
//! disc lit from the left. The class names an entity; an `entity = { … }` block in a
//! `gfx/models` `.asset` file names the map as the `texture_diffuse` of its
//! `planet_geosphereShape` mesh, beside the `.asset` file. An entity with no such block
//! (vanilla: the tomb world's) leaves the map to the material its `.mesh` file stores. A
//! model with no such mesh whose `pieceShape1` a planet shader draws is a planet broken into
//! pieces (vanilla: the shattered world's), and that map is its pieces' surface. An entity
//! with neither, only `attach` lines (More Arcologies' city worlds), takes the surface of the
//! first entity it attaches that has one, those at its `planetloc` first.

use std::collections::BTreeSet;
use std::fs;

use image::RgbaImage;
use image::imageops::{self, FilterType};
use sgf_core::cst::Node;

use super::model::Assets;
use super::sphere::{self, Plane, Wrap};
use crate::install::layers::Layout;
use crate::install::script::last_scalar;

const ASSETS: &str = "gfx/models/planets";
const SURFACE_MESH: &str = "planet_geosphereShape";
/// The mesh of a planet model broken into pieces.
const PIECES_MESH: &str = "pieceShape1";
/// The locator a wrapper entity attaches its planet's surface at.
const PLANET_LOCATOR: &str = "planetloc";
/// What an entity draws with of its own; an entity with none of them draws nothing, or what
/// the entity it `clone`s draws.
const DRAWS: [&str; 5] = ["pdxmesh", "meshsettings", "attach", "particle", "state"];
/// How many `clone` steps an entity that draws nothing of its own is followed.
const CLONE_DEPTH: usize = 4;
/// How many `attach` steps down from an entity its surface is looked for.
const ATTACH_DEPTH: usize = 4;
/// The disc's side, in pixels.
const DISC: u32 = 128;
/// How wide a map the disc is sampled from: a mip level of about this width, or the map
/// scaled down to it.
pub(super) const SOURCE_WIDTH: u32 = 256;

/// What one `entity` block has for a planet surface.
#[derive(Debug, Clone)]
pub(super) enum EntitySurface {
    /// The folder of its `.asset` file and its surface map's file name.
    Map(String, String),
    /// Its `pdxmesh`, and the folder of its `.asset` file and its pieces' map when it names one.
    Mesh(String, Option<(String, String)>),
    /// The entities it attaches, those at `planetloc` first and each in file order.
    Attached(Vec<String>),
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

/// Whether `entity`, a block of a `.asset` file in `dir`, draws anything of its own, and what
/// it has for a planet surface: a map its `meshsettings` name, else its `pdxmesh`, else the
/// entities it attaches.
pub(super) fn entity_surface(
    entity: &Node,
    dir: &str,
    src: &[u8],
) -> (bool, Option<EntitySurface>) {
    let draws = DRAWS.iter().any(|key| entity.find(key, src).is_some());
    let in_dir = |file: &str| (dir.to_owned(), file.to_owned());
    let surface = if let Some(file) = mesh_map(entity, SURFACE_MESH, src) {
        Some(EntitySurface::Map(dir.to_owned(), file.to_owned()))
    } else if let Some(mesh) = last_scalar(entity, "pdxmesh", src) {
        let pieces = mesh_map(entity, PIECES_MESH, src).map(in_dir);
        Some(EntitySurface::Mesh(mesh.to_owned(), pieces))
    } else {
        Some(attached(entity, src))
            .filter(|attached| !attached.is_empty())
            .map(EntitySurface::Attached)
    };
    (draws, surface)
}

/// How many models the game numbers for `entity`: `<entity>_01_entity`,
/// `<entity>_02_entity` … in a row, else 1 for an entity of that name alone, else 0.
pub(crate) fn model_count(assets: &Assets, entity: &str) -> u32 {
    let known = |name: &str| assets.defined(name).is_some_and(|e| e.surface.is_some());
    let numbered = (1..)
        .take_while(|n| known(&format!("{entity}_{n:02}_entity")))
        .count();
    match numbered {
        0 => u32::from(known(&format!("{entity}_entity")) || known(entity)),
        n => u32::try_from(n).unwrap_or(u32::MAX),
    }
}

/// Whether the model of `entity` draws nothing: the first name the game tries for it that the
/// `.asset` files define is an entity that draws nothing, itself or through what it `clone`s.
/// This reads no `.mesh` file.
pub(crate) fn draws_nothing(assets: &Assets, entity: &str) -> bool {
    model_names(entity)
        .iter()
        .find(|name| assets.defined(name).is_some())
        .is_some_and(|name| hidden_entity(assets, name, CLONE_DEPTH))
}

fn hidden_entity(assets: &Assets, name: &str, depth: usize) -> bool {
    match assets.defined(name) {
        Some(e) if !e.draws => match &e.clone {
            None => true,
            Some(target) => depth > 0 && hidden_entity(assets, target, depth - 1),
        },
        _ => false,
    }
}

/// The `scale` of the model of `entity`: 1 when the first name the game tries for it that the
/// `.asset` files define writes none, `None` when they define none of those names.
pub(crate) fn asset_scale(assets: &Assets, entity: &str) -> Option<f64> {
    let defined = model_names(entity)
        .iter()
        .find_map(|name| assets.defined(name))?;
    let scale = defined.scale.as_deref().and_then(|s| s.parse().ok());
    Some(scale.unwrap_or(1.0))
}

/// The names the game tries for a class's model `entity`, in order.
fn model_names(entity: &str) -> [String; 3] {
    [
        format!("{entity}_01_entity"),
        format!("{entity}_entity"),
        entity.to_owned(),
    ]
}

/// The surface of `entity` in `maps`. The game numbers a class's models `<entity>_01_entity`,
/// `<entity>_02_entity` …; the first one stands for them all. A map an `.asset` names comes
/// before one a `.mesh` stores, whichever name each is under, a whole surface before pieces,
/// and an entity's own model before the ones it attaches.
pub(crate) fn surface(layout: &Layout, assets: &Assets, entity: &str) -> Surface {
    let names = model_names(entity);
    let names = names.each_ref().map(String::as_str);
    surface_among(layout, assets, &names, &mut BTreeSet::new(), ATTACH_DEPTH)
}

fn surface_among<'m>(
    layout: &Layout,
    assets: &'m Assets,
    names: &[&str],
    path: &mut BTreeSet<&'m str>,
    depth: usize,
) -> Surface {
    let surfaces: Vec<&'m EntitySurface> = names
        .iter()
        .filter_map(|name| assets.defined(name)?.surface.as_ref())
        .collect();
    let map = surfaces.iter().find_map(|s| match s {
        EntitySurface::Map(dir, file) => Some((dir, file)),
        _ => None,
    });
    if let Some((asset_dir, file)) = map {
        return Surface::Map(beside_or_in_assets(layout, asset_dir, file));
    }
    let pieces = surfaces.iter().find_map(|s| match s {
        EntitySurface::Mesh(_, pieces) => pieces.as_ref(),
        _ => None,
    });
    if let Some((asset_dir, file)) = pieces {
        return Surface::Pieces(beside_or_in_assets(layout, asset_dir, file));
    }
    let mesh = surfaces.iter().find_map(|s| match s {
        EntitySurface::Mesh(mesh, _) => Some(mesh),
        _ => None,
    });
    if let Some(mesh) = mesh {
        return mesh_surface(layout, assets, mesh);
    }
    let attached = surfaces.iter().find_map(|s| match s {
        EntitySurface::Attached(attached) => Some(attached),
        _ => None,
    });
    let Some(attached) = attached else {
        return Surface::Unknown;
    };
    if depth == 0 {
        return Surface::Unknown;
    }
    for target in attached {
        if !path.insert(target) {
            continue;
        }
        let surface = surface_among(layout, assets, &[target], path, depth - 1);
        path.remove(target.as_str());
        if matches!(surface, Surface::Map(_) | Surface::Pieces(_)) {
            return surface;
        }
    }
    Surface::Unknown
}

/// The surface the `.mesh` file of model `mesh` stores.
fn mesh_surface(layout: &Layout, assets: &Assets, mesh: &str) -> Surface {
    let Some(mesh) = assets.mesh_file(mesh) else {
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
pub(crate) fn diffuse(layout: &Layout, assets: &Assets, entity: &str) -> Option<String> {
    match surface(layout, assets, entity) {
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
