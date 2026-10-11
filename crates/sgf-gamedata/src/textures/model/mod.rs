//! `model:<culture>:<entity>[:yaw<degrees>]`: a megastructure's or starbase's model, its
//! meshes read from their `.mesh` files, turned by the yaw about its up axis and drawn from
//! above at a slight tilt, at the size the game draws it.
//! The entity is looked up as `<culture>_<entity>`, then `mammalian_01_<entity>`, then
//! `<entity>`. Skipped: skinned animation (the bind pose is drawn), particles, specular and
//! environment light, bloom, atmospheres, and additive and scrolling extras such as the Dyson
//! Sphere's rays. A planet the model holds, as the Arc Furnace's, hides what is behind it but
//! is left clear, so the editor's own planet shows through.

use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use image::RgbaImage;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{Input, TextureError, encode_png};
use crate::GameData;
use crate::install::layers::Layout;
use assets::{Placed, ROOT, Step};
use mesh::MeshFile;
use space::{Affine, Vec3};

mod assets;
mod mesh;
mod raster;
mod space;

pub(crate) use assets::Assets;

/// Shaders whose meshes are not drawn: collision volumes, glows added over the model, effects
/// drawn by scrolling their texture, such as the Hyper Relay's portal, and planet atmospheres.
const SKIPPED_SHADERS: [&str; 4] = ["Collision", "Additive", "AnimateUV", "Atmosphere"];
/// Where planet textures are: a sphere about the model's origin drawn with one is the planet
/// the model is built round.
const PLANET_TEXTURES: &str = "gfx/models/planets/";
/// How far a sphere's farthest vertex may be from its centre, against its nearest.
const SPHERE_SPREAD: f32 = 1.3;
/// How far a planet's centre may be from the model's origin, as a share of its radius.
const PLANET_OFF_CENTRE: f32 = 0.15;
/// The width a texture is decoded at, or the nearest mip level to it.
const TEXTURE_WIDTH: u32 = 512;

/// Where a model sprite goes: its size in save units, and where the model's origin falls in
/// it, as a share of its width and height from the top left.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ModelPlacement {
    pub width: f64,
    pub height: f64,
    pub anchor_x: f64,
    pub anchor_y: f64,
}

/// A model's extent in save units: save x, save y and height above its origin.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelBounds {
    pub min: [f64; 3],
    pub max: [f64; 3],
}

impl ModelBounds {
    pub fn size(&self) -> [f64; 3] {
        std::array::from_fn(|k| self.max[k] - self.min[k])
    }
}

/// A model resolved from its `.asset` and `.gfx` definitions, with no `.mesh` file read: what
/// its cache name covers.
pub(super) struct ModelJob {
    entity: String,
    /// The turn about model Y, in whole degrees.
    yaw: u16,
    layout: Layout,
    assets: Arc<Assets>,
    parts: Vec<Part>,
}

/// A mesh file the model draws: where it is placed, the file, and the textures its
/// `meshsettings` name. A file in no layer is `None`, and the part is not drawn.
#[derive(Debug, Hash)]
struct Part {
    placed: Placed,
    input: Option<Input>,
    named: Vec<Option<Input>>,
}

/// A part with its `.mesh` file read, and the meshes of it that are drawn.
struct Loaded {
    transform: Affine,
    mesh: Arc<MeshFile>,
    looks: Vec<Look>,
}

/// One mesh of a part that is drawn, by its shape and its place in the shape, with its maps.
struct Look {
    shape: usize,
    mesh: usize,
    diffuse: Option<PathBuf>,
    normal: Option<PathBuf>,
    specular: Option<PathBuf>,
    /// Drawn with a texture from [`PLANET_TEXTURES`].
    planet_textured: bool,
}

impl Hash for ModelJob {
    fn hash<H: Hasher>(&self, state: &mut H) {
        for layer in &self.layout.layers {
            layer.root.hash(state);
        }
        self.parts.hash(state);
        self.yaw.hash(state);
    }
}

impl fmt::Debug for ModelJob {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ModelJob")
            .field("entity", &self.entity)
            .field("parts", &self.parts)
            .finish_non_exhaustive()
    }
}

impl ModelJob {
    pub(super) fn plan(
        layout: &Layout,
        assets: Arc<Assets>,
        cultures: &[String],
        entity: &str,
        yaw: u16,
    ) -> Result<Self, TextureError> {
        let missing = || TextureError::NoModel(entity.to_owned());
        let name = assets.entity_name(cultures, entity).ok_or_else(missing)?;
        let placed = assets.resolve(&name).ok_or_else(missing)?;
        if placed.is_empty() {
            return Err(TextureError::EmptyModel(entity.to_owned()));
        }
        let parts = placed
            .into_iter()
            .map(|placed| {
                let mesh_dir = folder(&placed.file);
                let named = placed
                    .settings
                    .iter()
                    .flat_map(|s| [&s.diffuse, &s.normal, &s.specular])
                    .flatten()
                    .map(|name| {
                        let path = assets.texture(layout, name, mesh_dir, &placed.asset_dir)?;
                        Input::at(path).ok()
                    })
                    .collect();
                Part {
                    input: Input::resolve(layout, &placed.file).ok(),
                    named,
                    placed,
                }
            })
            .collect();
        Ok(Self {
            entity: entity.to_owned(),
            yaw,
            layout: layout.clone(),
            assets,
            parts,
        })
    }

    /// Each part whose mesh file reads and that draws something, placed. Each `.mesh` file is
    /// read once, however many parts draw it or are placed at its locators. A part that cannot
    /// be read or placed is left out; the model fails only when nothing is left, with the first
    /// file that could not be read, if any.
    fn load(&self) -> Result<Vec<Loaded>, TextureError> {
        let mut read: HashMap<String, Result<Arc<MeshFile>, String>> = HashMap::new();
        let mut mesh = |file: &str| -> Result<Arc<MeshFile>, String> {
            read.entry(file.to_owned())
                .or_insert_with(|| read_mesh(&self.layout, file))
                .clone()
        };
        let mut unread = None;
        let mut loaded = Vec::new();
        'parts: for part in self.parts.iter().filter(|p| p.input.is_some()) {
            let file = part.placed.file.as_str();
            let own = match mesh(file) {
                Ok(own) => own,
                Err(reason) => {
                    unread.get_or_insert(TextureError::Decode {
                        path: PathBuf::from(file),
                        reason,
                    });
                    continue;
                }
            };
            let mut transform = Affine::yaw(f32::from(self.yaw).to_radians());
            for step in &part.placed.steps {
                let at = match step {
                    Step::Fixed(at) => *at,
                    Step::Locator { file, name } => {
                        let found = mesh(file).ok().and_then(|m| assets::locate(&m, name));
                        match found {
                            Some(at) => at,
                            None if name == ROOT => Affine::IDENTITY,
                            None => continue 'parts,
                        }
                    }
                };
                transform = transform.then_before(at);
            }
            let looks = self.looks(&part.placed, &own);
            if !looks.is_empty() {
                loaded.push(Loaded {
                    transform,
                    mesh: own,
                    looks,
                });
            }
        }
        if loaded.is_empty() {
            return Err(unread.unwrap_or_else(|| TextureError::EmptyModel(self.entity.clone())));
        }
        Ok(loaded)
    }

    /// The meshes of `mesh` that are drawn, with the maps its settings or its material name.
    fn looks(&self, placed: &Placed, mesh: &MeshFile) -> Vec<Look> {
        let mesh_dir = folder(&placed.file);
        let texture = |name: Option<String>| {
            self.assets
                .texture(&self.layout, &name?, mesh_dir, &placed.asset_dir)
        };
        let mut looks = Vec::new();
        for (s, shape) in mesh.shapes.iter().enumerate() {
            for (m, mesh) in shape.meshes.iter().enumerate() {
                let settings = placed.settings.iter().find(|ms| ms.matches(&shape.name, m));
                let pick = |set: Option<&Option<String>>, own: &str| -> Option<String> {
                    set.cloned()
                        .flatten()
                        .or_else(|| (!own.is_empty()).then(|| own.to_owned()))
                };
                let material = &mesh.material;
                let shader = pick(settings.map(|ms| &ms.shader), &material.shader);
                let skipped = shader
                    .as_deref()
                    .is_some_and(|s| SKIPPED_SHADERS.iter().any(|k| s.contains(k)));
                if skipped || mesh.triangles.is_empty() {
                    continue;
                }
                let diffuse = texture(pick(settings.map(|ms| &ms.diffuse), &material.diffuse));
                let normal = texture(pick(settings.map(|ms| &ms.normal), &material.normal));
                let specular = texture(pick(settings.map(|ms| &ms.specular), &material.specular));
                let own = [&material.diffuse, &material.normal, &material.specular]
                    .map(|name| texture(Some(name.clone())));
                let planet_textured = [&diffuse, &normal, &specular]
                    .into_iter()
                    .chain(&own)
                    .flatten()
                    .any(|path| self.is_planet_texture(path));
                looks.push(Look {
                    shape: s,
                    mesh: m,
                    diffuse,
                    normal,
                    specular,
                    planet_textured,
                });
            }
        }
        looks
    }

    /// Whether `path` is under [`PLANET_TEXTURES`] in one of the layers.
    fn is_planet_texture(&self, path: &Path) -> bool {
        self.layout.layers.iter().any(|layer| {
            path.strip_prefix(&layer.root).is_ok_and(|rel| {
                let rel = rel.to_string_lossy().replace('\\', "/");
                rel.to_ascii_lowercase().starts_with(PLANET_TEXTURES)
            })
        })
    }

    fn bounds(&self) -> Result<ModelBounds, TextureError> {
        let (mut min, mut max) = ([f64::MAX; 3], [f64::MIN; 3]);
        for p in self.load()?.iter().flat_map(Loaded::positions) {
            let p = space::to_save(p);
            for k in 0..3 {
                min[k] = min[k].min(f64::from(p[k]));
                max[k] = max[k].max(f64::from(p[k]));
            }
        }
        Ok(ModelBounds { min, max })
    }

    fn bake(&self) -> Result<(RgbaImage, ModelPlacement), TextureError> {
        let loaded = self.load()?;
        let mut maps: HashMap<&PathBuf, Option<raster::Map>> = HashMap::new();
        for path in loaded
            .iter()
            .flat_map(|p| &p.looks)
            .flat_map(|l| [&l.diffuse, &l.normal, &l.specular].into_iter().flatten())
        {
            maps.entry(path).or_insert_with(|| {
                let image = Input::at(path.clone()).and_then(|i| i.decode_near(TEXTURE_WIDTH));
                image.ok().map(|i| raster::Map::new(&i))
            });
        }
        let map = |path: &Option<PathBuf>| path.as_ref().and_then(|p| maps.get(p)?.as_ref());
        let surfaces: Vec<raster::Surface<'_>> = loaded
            .iter()
            .flat_map(|part| {
                part.looks.iter().map(move |look| {
                    let mesh = &part.mesh.shapes[look.shape].meshes[look.mesh];
                    let along = |v: &Vec3| normalize_or_zero(part.transform.apply_vector(*v));
                    let positions: Vec<Vec3> = mesh
                        .positions
                        .iter()
                        .map(|p| part.transform.apply(*p))
                        .collect();
                    raster::Surface {
                        depth_only: look.planet_textured && is_planet(&positions),
                        normals: mesh.normals.iter().map(along).collect(),
                        tangents: mesh
                            .tangents
                            .iter()
                            .map(|t| {
                                let [x, y, z] = along(&[t[0], t[1], t[2]]);
                                [x, y, z, t[3]]
                            })
                            .collect(),
                        uvs: &mesh.uvs,
                        triangles: &mesh.triangles,
                        diffuse: map(&look.diffuse),
                        normal_map: map(&look.normal),
                        specular: map(&look.specular),
                        positions,
                    }
                })
            })
            .collect();
        raster::render(&surfaces).ok_or_else(|| TextureError::EmptyModel(self.entity.clone()))
    }

    pub(super) fn render(&self) -> Result<RgbaImage, TextureError> {
        self.bake().map(|(image, _)| image)
    }

    /// The baked sprite as a PNG that holds its placement.
    pub(super) fn encode(&self) -> Result<Vec<u8>, TextureError> {
        let (image, placement) = self.bake()?;
        Ok(with_placement(encode_png(&image)?, &placement))
    }

    /// A job that draws nothing, for a test of cache names.
    #[cfg(test)]
    pub(super) fn empty() -> Self {
        Self {
            entity: String::new(),
            yaw: 0,
            layout: Layout::default(),
            assets: Arc::default(),
            parts: Vec::new(),
        }
    }
}

fn folder(file: &str) -> &str {
    file.rsplit_once('/').map_or("", |(dir, _)| dir)
}

fn read_mesh(layout: &Layout, file: &str) -> Result<Arc<MeshFile>, String> {
    let path = layout
        .resolve_file(file)
        .ok_or_else(|| "not in any layer".to_owned())?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    mesh::read(&bytes).map(Arc::new)
}

/// Whether `positions` make a sphere about the model's origin.
fn is_planet(positions: &[Vec3]) -> bool {
    if positions.is_empty() {
        return false;
    }
    let count = positions.len() as f32;
    let centre: Vec3 = std::array::from_fn(|k| positions.iter().map(|p| p[k]).sum::<f32>() / count);
    let distance = |a: Vec3, b: Vec3| {
        let d: Vec3 = std::array::from_fn(|k| a[k] - b[k]);
        space::dot(d, d).sqrt()
    };
    let (mut near, mut far) = (f32::MAX, 0.0f32);
    for p in positions {
        let r = distance(*p, centre);
        near = near.min(r);
        far = far.max(r);
    }
    near > 0.0
        && far <= near * SPHERE_SPREAD
        && distance(centre, [0.0; 3]) <= near * PLANET_OFF_CENTRE
}

fn normalize_or_zero(v: Vec3) -> Vec3 {
    let len = space::dot(v, v).sqrt();
    if len > 1e-9 { v.map(|c| c / len) } else { v }
}

impl Loaded {
    fn positions(&self) -> impl Iterator<Item = Vec3> + '_ {
        self.looks.iter().flat_map(move |look| {
            let mesh = &self.mesh.shapes[look.shape].meshes[look.mesh];
            mesh.positions.iter().map(|p| self.transform.apply(*p))
        })
    }
}

/// The keyword of the PNG text chunk a model sprite's placement is kept in.
const PLACEMENT_CHUNK: &[u8] = b"sgf-model-placement";
/// The PNG signature and its IHDR chunk, which every PNG opens with.
const PNG_HEAD: usize = 8 + 25;

/// `png` with `placement` in a text chunk after its header, so a cached sprite keeps it.
fn with_placement(png: Vec<u8>, placement: &ModelPlacement) -> Vec<u8> {
    let ModelPlacement {
        width,
        height,
        anchor_x,
        anchor_y,
    } = placement;
    let mut body = b"tEXt".to_vec();
    body.extend(PLACEMENT_CHUNK);
    body.push(0);
    body.extend(format!("{width} {height} {anchor_x} {anchor_y}").bytes());
    let mut out = png[..PNG_HEAD.min(png.len())].to_vec();
    out.extend(u32::try_from(body.len() - 4).unwrap_or(0).to_be_bytes());
    out.extend(&body);
    out.extend(crc32(&body).to_be_bytes());
    out.extend(png.get(PNG_HEAD..).unwrap_or_default());
    out
}

/// The placement a model sprite's PNG holds; `None` for any other PNG.
pub(super) fn placement(png: &[u8]) -> Option<ModelPlacement> {
    let mut at = 8;
    while let Some(len) = png.get(at..at + 4) {
        let len = u32::from_be_bytes(len.try_into().ok()?) as usize;
        let kind = png.get(at + 4..at + 8)?;
        let data = png.get(at + 8..(at + 8).checked_add(len)?)?;
        if kind == b"IDAT" {
            return None;
        }
        let text = data
            .strip_prefix(PLACEMENT_CHUNK)
            .and_then(|d| d.strip_prefix(b"\0"));
        if let (b"tEXt", Some(text)) = (kind, text) {
            let numbers: Vec<f64> = std::str::from_utf8(text)
                .ok()?
                .split(' ')
                .map(str::parse)
                .collect::<Result<_, _>>()
                .ok()?;
            let [width, height, anchor_x, anchor_y] = numbers[..] else {
                return None;
            };
            return Some(ModelPlacement {
                width,
                height,
                anchor_x,
                anchor_y,
            });
        }
        at += 12 + len;
    }
    None
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

impl GameData {
    /// The extent of the model a `model:` texture key names, in save units; it reads the
    /// model's `.mesh` files but bakes nothing.
    pub fn model_bounds(&self, key: &str) -> Result<ModelBounds, TextureError> {
        let super::TextureKey::Model {
            culture,
            entity,
            yaw,
        } = key.parse()?
        else {
            return Err(TextureError::BadKey(key.to_owned()));
        };
        ModelJob::plan(
            &self.layout,
            Arc::clone(&self.models),
            &self.graphical_cultures.chain(&culture),
            &entity,
            yaw,
        )?
        .bounds()
    }
}
