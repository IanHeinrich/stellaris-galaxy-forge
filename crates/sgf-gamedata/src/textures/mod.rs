//! Game textures by logical key: a DDS file from the layered install, decoded
//! (mip 0 only) to a PNG that is cached on disk.
//!
//! Keys, never paths, cross the IPC boundary:
//! `star_class:<icon>`, `deposit:<icon>`, `icon:<path under gfx/interface/icons>`,
//! `flag:<category>/<file>`, `sprite:<GFX_name>[#<frame>]`,
//! `empire_flag:<bg>:<category>/<file>:<c0>,<c1>,<c2>,<c3>` (an empty emblem draws the background alone), `planet_disc:<class>`,
//! `planet_disc_shattered:<class>:<seed>`, `planet_model:<entity>`, `star_disc:<class>` and
//! `planet_ring`.

use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::prelude::*;
use image::imageops::{self, FilterType};
use image::{ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::install::layers::Layout;
use crate::registries::flags::{background_path, emblem_path};

mod dds;
mod flag;
mod key;
mod lookups;
pub(crate) mod planet_disc;
mod shatter;
mod sphere;
mod star_disc;

pub use key::TextureKey;
pub use lookups::{Lookups, StarBody};
pub use star_disc::StarAtmosphere;

/// Part of every rendered job's cache name, so a change to how any texture is baked (a sphere
/// disc, a composed flag, a cropped frame) is baked afresh rather than served stale from a
/// user's disk cache.
const BAKE: u32 = 3;

/// A cached PNG nobody has asked for in this long is deleted at start-up.
const CACHE_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);

/// A cache hit renews the file once it is this old, so a texture in use is never pruned.
const CACHE_RENEW_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

impl TextureKey {
    /// Whether a layer of `layout` has the file this key names.
    pub(crate) fn exists(&self, layout: &Layout) -> bool {
        self.rel_path()
            .is_ok_and(|rel| layout.resolve_file(&rel).is_some())
    }

    /// The texture file relative to a layer root, for the keys that name one.
    fn rel_path(&self) -> Result<String, TextureError> {
        match self {
            Self::StarClass { icon } => Ok(format!("gfx/map/star_classes/{icon}.dds")),
            Self::Deposit { icon } => Ok(format!("{DEPOSIT_ICONS}/{icon}.dds")),
            Self::Icon { path } => Ok(format!("{ICONS}/{path}")),
            Self::PlanetRing => Ok(PLANET_RING.to_owned()),
            Self::Flag { category, file } | Self::Symbol { category, file } => {
                Ok(emblem_path(category, file))
            }
            Self::Sprite { .. }
            | Self::EmpireFlag { .. }
            | Self::PlanetDisc { .. }
            | Self::ShatteredDisc { .. }
            | Self::PlanetModel { .. }
            | Self::StarDisc { .. } => Err(TextureError::BadKey(self.to_string())),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum TextureError {
    #[error("bad texture key `{0}`")]
    BadKey(String),
    #[error("{0}: not in any layer")]
    NotFound(String),
    #[error("sprite `{0}` is not in the sprite registry")]
    UnknownSprite(String),
    #[error("sprite `{name}` has {count} frame(s), not {frame}")]
    BadFrame {
        name: String,
        frame: u32,
        count: u32,
    },
    #[error("unknown flag colour `{0}`")]
    UnknownColour(String),
    #[error("planet class `{0}` has no surface map to draw as a disc")]
    NoDisc(String),
    #[error("planet model `{0}` has no surface map to draw as a disc")]
    NoModelDisc(String),
    #[error("{}: {reason}", path.display())]
    Decode { path: PathBuf, reason: String },
    #[error("png encoding failed: {0}")]
    Encode(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TextureView {
    pub key: String,
    pub width: u32,
    pub height: u32,
    pub png_base64: Option<String>,
    pub error: Option<String>,
}

impl TextureView {
    /// A texture that could not be made: `key`, no pixels and the reason.
    pub fn failed(key: &str, error: impl Into<String>) -> Self {
        Self {
            key: key.to_owned(),
            width: 0,
            height: 0,
            png_base64: None,
            error: Some(error.into()),
        }
    }
}

#[derive(Debug)]
pub struct Textures {
    cache_dir: PathBuf,
    /// The graphics settings of the last layout a `star_disc:` key was asked of, read once.
    worlds: Memo<star_disc::Worlds>,
}

type Memo<T> = Mutex<Option<(Layout, Arc<T>)>>;

/// What `slot` holds for `layout`, read by `read` the first time and again only when the
/// layout changes.
fn memo<T>(slot: &Memo<T>, layout: &Layout, read: impl FnOnce(&Layout) -> T) -> Arc<T> {
    let mut held = slot.lock().unwrap_or_else(PoisonError::into_inner);
    match &*held {
        Some((read_from, value)) if read_from == layout => Arc::clone(value),
        _ => {
            let value = Arc::new(read(layout));
            *held = Some((layout.clone(), Arc::clone(&value)));
            value
        }
    }
}

impl Textures {
    /// `None` puts the cache under the platform cache directory.
    pub fn new(cache_dir: Option<PathBuf>) -> Self {
        let cache_dir = cache_dir.unwrap_or_else(|| {
            dirs::cache_dir()
                .unwrap_or_else(std::env::temp_dir)
                .join("stellaris-galaxy-forge")
                .join("textures")
        });
        prune(&cache_dir);
        Self {
            cache_dir,
            worlds: Mutex::default(),
        }
    }

    fn worlds(&self, layout: &Layout) -> Arc<star_disc::Worlds> {
        memo(&self.worlds, layout, star_disc::worlds)
    }

    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    pub fn load(&self, layout: &Layout, lookups: &Lookups<'_>, key: &str) -> TextureView {
        match self.png(layout, lookups, key) {
            Ok(png) => {
                let (width, height) = png_size(&png);
                TextureView {
                    key: key.to_owned(),
                    width,
                    height,
                    png_base64: Some(BASE64_STANDARD.encode(&png)),
                    error: None,
                }
            }
            Err(e) => TextureView::failed(key, e.to_string()),
        }
    }

    /// The PNG for `key`: from the cache when its inputs are unchanged,
    /// else decoded, cached and returned.
    pub fn png(
        &self,
        layout: &Layout,
        lookups: &Lookups<'_>,
        key: &str,
    ) -> Result<Vec<u8>, TextureError> {
        let key: TextureKey = key.parse()?;
        let job = Job::plan(&key, layout, lookups, self)?;
        let cache_file = self.cache_dir.join(job.cache_name(&key));
        if let Ok(png) = fs::read(&cache_file) {
            renew(&cache_file);
            return Ok(png);
        }
        let png = encode_png(&job.render()?)?;
        write_atomically(&cache_file, &png);
        Ok(png)
    }
}

/// A texture file with its identity for the cache.
#[derive(Debug, Hash)]
struct Input {
    path: PathBuf,
    len: u64,
    mtime_nanos: u128,
}

impl Input {
    fn resolve(layout: &Layout, rel: &str) -> Result<Self, TextureError> {
        let path = layout
            .resolve_file(rel)
            .ok_or_else(|| TextureError::NotFound(rel.to_owned()))?;
        let meta = fs::metadata(&path).map_err(|e| decode_error(&path, e))?;
        let mtime_nanos = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |d| d.as_nanos());
        Ok(Self {
            path,
            len: meta.len(),
            mtime_nanos,
        })
    }

    fn decode(&self) -> Result<RgbaImage, TextureError> {
        self.decode_near(u32::MAX)
    }

    /// The smallest mip level at least `width` wide, or mip 0 when that is narrower.
    fn decode_near(&self, width: u32) -> Result<RgbaImage, TextureError> {
        let bytes = fs::read(&self.path).map_err(|e| decode_error(&self.path, e))?;
        dds::decode_near(&bytes, width).map_err(|reason| self.decode_failed(reason))
    }

    /// A cube map's six faces, each read as [`Self::decode_near`] reads an image.
    fn decode_cube_near(&self, width: u32) -> Result<Vec<RgbaImage>, TextureError> {
        let bytes = fs::read(&self.path).map_err(|e| decode_error(&self.path, e))?;
        dds::decode_cube_near(&bytes, width).map_err(|reason| self.decode_failed(reason))
    }

    fn decode_failed(&self, reason: String) -> TextureError {
        TextureError::Decode {
            path: self.path.clone(),
            reason,
        }
    }
}

fn decode_error(path: &Path, e: std::io::Error) -> TextureError {
    TextureError::Decode {
        path: path.to_path_buf(),
        reason: e.to_string(),
    }
}

/// Everything a render needs, resolved up front so the cache name covers it.
#[derive(Debug, Hash)]
enum Job {
    Whole(Input),
    White(Input),
    Frame {
        input: Input,
        frame: u32,
        count: u32,
    },
    EmpireFlag {
        background: Input,
        icon: Option<Input>,
        mask: Input,
        frame: Input,
        colours: [Option<[u8; 3]>; 4],
    },
    PlanetDisc(Input),
    ShatteredDisc {
        input: Input,
        seed: u32,
    },
    StarSurface(Input),
    StarLava {
        noise: Input,
        lava_map: Input,
        stone_map: Input,
        lava: star_disc::Lava,
        atmosphere: Option<StarAtmosphere>,
    },
}

pub(crate) const ICONS: &str = "gfx/interface/icons";
const DEPOSIT_ICONS: &str = "gfx/interface/icons/deposits";
const PLANET_RING: &str = "gfx/models/planets/ring_tiling_diffuse.dds";

impl Job {
    fn plan(
        key: &TextureKey,
        layout: &Layout,
        lookups: &Lookups<'_>,
        textures: &Textures,
    ) -> Result<Self, TextureError> {
        let Lookups {
            sprites, colour, ..
        } = *lookups;
        match key {
            TextureKey::StarDisc { class } => Self::plan_star(class, layout, lookups, textures),
            TextureKey::PlanetDisc { class } => {
                let no_disc = || TextureError::NoDisc(class.clone());
                let rel = (lookups.planet_surface)(class).ok_or_else(no_disc)?;
                Ok(Self::PlanetDisc(Input::resolve(layout, &rel)?))
            }
            TextureKey::ShatteredDisc { class, seed } => {
                let no_disc = || TextureError::NoDisc(class.clone());
                let rel = (lookups.planet_pieces)(class).ok_or_else(no_disc)?;
                Ok(Self::ShatteredDisc {
                    input: Input::resolve(layout, &rel)?,
                    seed: *seed,
                })
            }
            TextureKey::PlanetModel { entity } => {
                let no_disc = || TextureError::NoModelDisc(entity.clone());
                let rel = (lookups.model_surface)(entity).ok_or_else(no_disc)?;
                Ok(Self::PlanetDisc(Input::resolve(layout, &rel)?))
            }
            TextureKey::Sprite { name, frame } => {
                let (rel, frame) = sprites
                    .resolve(name, *frame)
                    .ok_or_else(|| TextureError::UnknownSprite(name.clone()))?;
                let input = Input::resolve(layout, &rel)?;
                match frame {
                    None => Ok(Self::Whole(input)),
                    Some(frame) => {
                        let count = sprites.frame_count(name).unwrap_or(1);
                        if frame < 1 || frame > count {
                            return Err(TextureError::BadFrame {
                                name: name.clone(),
                                frame,
                                count,
                            });
                        }
                        Ok(Self::Frame {
                            input,
                            frame,
                            count,
                        })
                    }
                }
            }
            TextureKey::EmpireFlag {
                background,
                icon,
                colours,
            } => Ok(Self::EmpireFlag {
                background: Input::resolve(layout, &background_path(background))?,
                icon: icon
                    .as_ref()
                    .map(|(category, file)| Input::resolve(layout, &emblem_path(category, file)))
                    .transpose()?,
                mask: Input::resolve(layout, flag::EMPIRE_FLAG_MASK)?,
                frame: Input::resolve(layout, flag::EMPIRE_FLAG_FRAME)?,
                colours: flag::resolve_colours(colours, colour)?,
            }),
            TextureKey::Symbol { .. } => Ok(Self::White(Input::resolve(layout, &key.rel_path()?)?)),
            _ => Ok(Self::Whole(Input::resolve(layout, &key.rel_path()?)?)),
        }
    }

    /// A star's own surface map when its entity names one, else the star shader in its
    /// lighting class's colours.
    fn plan_star(
        class: &str,
        layout: &Layout,
        lookups: &Lookups<'_>,
        textures: &Textures,
    ) -> Result<Self, TextureError> {
        let no_disc = || TextureError::NoDisc(class.to_owned());
        let body = (lookups.star_body)(class).ok_or_else(no_disc)?;
        if let Some(rel) = &body.surface {
            return Ok(Self::StarSurface(Input::resolve(layout, rel)?));
        }
        let worlds = textures.worlds(layout);
        let (world, lava) =
            star_disc::world_for(&worlds, body.lighting.as_deref(), body.atmosphere)
                .ok_or_else(no_disc)?;
        let [noise, lava_map, stone_map] = world.maps();
        Ok(Self::StarLava {
            noise: Input::resolve(layout, noise)?,
            lava_map: Input::resolve(layout, lava_map)?,
            stone_map: Input::resolve(layout, stone_map)?,
            lava,
            atmosphere: body.atmosphere,
        })
    }

    fn cache_name(&self, key: &TextureKey) -> String {
        self.cache_name_at_bake(key, BAKE)
    }

    /// [`Self::cache_name`], taking the bake version as an argument so a test can see two
    /// versions disagree without recompiling.
    fn cache_name_at_bake(&self, key: &TextureKey, bake: u32) -> String {
        let mut hasher = DefaultHasher::new();
        key.to_string().hash(&mut hasher);
        self.hash(&mut hasher);
        bake.hash(&mut hasher);
        format!("{:016x}.png", hasher.finish())
    }

    fn render(&self) -> Result<RgbaImage, TextureError> {
        match self {
            Self::Whole(input) => input.decode(),
            Self::White(input) => {
                let mut image = input.decode()?;
                for px in image.pixels_mut() {
                    px.0[..3].fill(255);
                }
                Ok(image)
            }
            Self::Frame {
                input,
                frame,
                count,
            } => {
                let sheet = input.decode()?;
                let width = sheet.width() / count;
                if width == 0 {
                    return Err(TextureError::Decode {
                        path: input.path.clone(),
                        reason: format!("{} px wide cannot hold {count} frames", sheet.width()),
                    });
                }
                Ok(
                    imageops::crop_imm(&sheet, (frame - 1) * width, 0, width, sheet.height())
                        .to_image(),
                )
            }
            Self::EmpireFlag {
                background,
                icon,
                mask,
                frame,
                colours,
            } => Ok(flag::compose_empire_flag(
                &background.decode()?,
                icon.as_ref().map(Input::decode).transpose()?.as_ref(),
                &mask.decode()?,
                &frame.decode()?,
                colours,
            )),
            Self::PlanetDisc(input) => Ok(planet_disc::bake(
                &input.decode_near(planet_disc::SOURCE_WIDTH)?,
            )),
            Self::ShatteredDisc { input, seed } => Ok(shatter::shatter(
                &planet_disc::bake(&input.decode_near(planet_disc::SOURCE_WIDTH)?),
                u64::from(*seed),
            )),
            Self::StarSurface(input) => Ok(star_disc::bake_surface(
                &input.decode_near(star_disc::SURFACE_WIDTH)?,
            )),
            Self::StarLava {
                noise,
                lava_map,
                stone_map,
                lava,
                atmosphere,
            } => {
                let maps = star_disc::Maps {
                    noise: noise
                        .decode_cube_near(star_disc::NOISE_WIDTH)?
                        .iter()
                        .map(|face| {
                            let side = star_disc::NOISE_WIDTH.min(face.width());
                            let face = imageops::resize(face, side, side, FilterType::Triangle);
                            sphere::Plane::new(&face, sphere::Wrap::Clamp)
                        })
                        .collect(),
                    lava: sphere::Plane::new(
                        &lava_map.decode_near(star_disc::LAVA_WIDTH)?,
                        sphere::Wrap::Tile,
                    ),
                    stone: sphere::Plane::new(
                        &stone_map.decode_near(star_disc::STONE_WIDTH)?,
                        sphere::Wrap::Tile,
                    ),
                };
                Ok(star_disc::bake_lava(&maps, *lava, *atmosphere))
            }
        }
    }
}

fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, TextureError> {
    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|e| TextureError::Encode(e.to_string()))?;
    Ok(png.into_inner())
}

/// Width and height from the IHDR chunk; zeros for anything that is not a PNG.
fn png_size(png: &[u8]) -> (u32, u32) {
    let field = |at: usize| {
        png.get(at..at + 4)
            .and_then(|b| b.try_into().ok())
            .map_or(0, u32::from_be_bytes)
    };
    (field(16), field(20))
}

/// Deletes the `.png` files directly inside `dir` that were last used more than [`CACHE_MAX_AGE`] ago.
fn prune(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let unused_since = entry
            .metadata()
            .ok()
            .filter(|meta| meta.is_file())
            .and_then(|meta| meta.modified().ok())
            .and_then(|modified| SystemTime::now().duration_since(modified).ok());
        if path.extension().is_some_and(|ext| ext == "png")
            && unused_since.is_some_and(|age| age > CACHE_MAX_AGE)
        {
            let _ = fs::remove_file(path);
        }
    }
}

/// Stamps a cache file as used now when its last stamp is a day old.
fn renew(path: &Path) {
    let stale = fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| SystemTime::now().duration_since(modified).ok())
        .is_some_and(|age| age > CACHE_RENEW_AFTER);
    if stale {
        let _ = fs::File::options()
            .write(true)
            .open(path)
            .and_then(|file| file.set_modified(SystemTime::now()));
    }
}

/// A cache write that fails leaves nothing behind and is not an error.
fn write_atomically(path: &Path, bytes: &[u8]) {
    let Some(dir) = path.parent() else {
        return;
    };
    if fs::create_dir_all(dir).is_err() {
        return;
    }
    let tmp = dir.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_default(),
        std::process::id()
    ));
    if fs::write(&tmp, bytes).is_ok() && fs::rename(&tmp, path).is_err() {
        let _ = fs::remove_file(&tmp);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> Input {
        Input {
            path: PathBuf::from("x"),
            len: 0,
            mtime_nanos: 0,
        }
    }

    /// Every rendered kind of [`Job`] gets a different cache name when the bake version
    /// differs, not only the star kinds.
    #[test]
    fn every_rendered_kind_changes_cache_name_when_bake_differs() {
        let key = TextureKey::PlanetRing;
        let jobs = [
            Job::Whole(input()),
            Job::White(input()),
            Job::Frame {
                input: input(),
                frame: 1,
                count: 2,
            },
            Job::EmpireFlag {
                background: input(),
                icon: Some(input()),
                mask: input(),
                frame: input(),
                colours: [None, None, None, None],
            },
            Job::PlanetDisc(input()),
            Job::ShatteredDisc {
                input: input(),
                seed: 1,
            },
            Job::StarSurface(input()),
            Job::StarLava {
                noise: input(),
                lava_map: input(),
                stone_map: input(),
                lava: star_disc::Lava {
                    bright: [0.0; 3],
                    hot_stone: [0.0; 3],
                    cold_stone: [0.0; 3],
                },
                atmosphere: None,
            },
        ];
        for job in jobs {
            let a = job.cache_name_at_bake(&key, 1);
            let b = job.cache_name_at_bake(&key, 2);
            assert_ne!(a, b, "{job:?}");
        }
    }
}
