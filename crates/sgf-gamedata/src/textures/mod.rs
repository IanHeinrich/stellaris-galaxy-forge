//! Game textures by logical key: a DDS file from the layered install, decoded
//! (mip 0 only) to a PNG that is cached on disk.
//!
//! Keys, never paths, cross the IPC boundary:
//! `star_class:<icon>`, `flag:<category>/<file>`, `sprite:<GFX_name>[#<frame>]`
//! and `empire_flag:<bg>:<category>/<file>:<c0>,<c1>,<c2>,<c3>`.

use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use base64::prelude::*;
use image::imageops::{self, FilterType};
use image::{ImageFormat, Rgba, RgbaImage};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::GameData;
use crate::install::layers::Layout;
use crate::registries::gfx::Sprites;

mod dds;
mod key;

pub use key::TextureKey;

/// Where a `GFX_` sprite's texture lives; the `.gfx` registry implements it.
pub trait SpriteSource {
    /// The texture file (forward slashes, relative to a layer root) and the
    /// 1-based frame to crop, if any.
    fn resolve(&self, name: &str, frame: Option<u32>) -> Option<(String, Option<u32>)>;
    fn frame_count(&self, name: &str) -> Option<u32>;
}

/// A registry that knows no sprites: every `sprite:` key fails.
pub struct NoSprites;

impl SpriteSource for NoSprites {
    fn resolve(&self, _name: &str, _frame: Option<u32>) -> Option<(String, Option<u32>)> {
        None
    }

    fn frame_count(&self, _name: &str) -> Option<u32> {
        None
    }
}

impl SpriteSource for Sprites {
    fn resolve(&self, name: &str, frame: Option<u32>) -> Option<(String, Option<u32>)> {
        Sprites::resolve(self, name, frame)
    }

    fn frame_count(&self, name: &str) -> Option<u32> {
        Sprites::frame_count(self, name)
    }
}

/// A flag colour by its `flags/colors.txt` name.
pub type ColourLookup<'a> = &'a dyn Fn(&str) -> Option<[u8; 3]>;

impl GameData {
    /// `key` decoded through this install's sprites and flag colours.
    pub fn texture(&self, textures: &Textures, key: &str) -> TextureView {
        let colour = |name: &str| self.colors.get(name).map(|c| c.flag);
        textures.load(&self.layout, &*self.sprites, &colour, key)
    }

    pub fn texture_png(&self, textures: &Textures, key: &str) -> Result<Vec<u8>, TextureError> {
        let colour = |name: &str| self.colors.get(name).map(|c| c.flag);
        textures.png(&self.layout, &*self.sprites, &colour, key)
    }
}

impl TextureKey {
    /// The texture file relative to a layer root, for the keys that name one.
    fn rel_path(&self) -> Result<String, TextureError> {
        match self {
            Self::StarClass { icon } => Ok(format!("gfx/map/star_classes/{icon}.dds")),
            Self::Flag { category, file } | Self::Symbol { category, file } => {
                Ok(format!("flags/{category}/{file}"))
            }
            Self::Sprite { .. } | Self::EmpireFlag { .. } => {
                Err(TextureError::BadKey(self.to_string()))
            }
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

#[derive(Debug)]
pub struct Textures {
    cache_dir: PathBuf,
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
        Self { cache_dir }
    }

    pub fn cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    pub fn load(
        &self,
        layout: &Layout,
        sprites: &dyn SpriteSource,
        colour: ColourLookup<'_>,
        key: &str,
    ) -> TextureView {
        match self.png(layout, sprites, colour, key) {
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
            Err(e) => TextureView {
                key: key.to_owned(),
                width: 0,
                height: 0,
                png_base64: None,
                error: Some(e.to_string()),
            },
        }
    }

    /// The PNG for `key`: from the cache when its inputs are unchanged,
    /// else decoded, cached and returned.
    pub fn png(
        &self,
        layout: &Layout,
        sprites: &dyn SpriteSource,
        colour: ColourLookup<'_>,
        key: &str,
    ) -> Result<Vec<u8>, TextureError> {
        let key: TextureKey = key.parse()?;
        let job = Job::plan(&key, layout, sprites, colour)?;
        let cache_file = self.cache_dir.join(job.cache_name(&key));
        if let Ok(png) = fs::read(&cache_file) {
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
        let bytes = fs::read(&self.path).map_err(|e| decode_error(&self.path, e))?;
        dds::decode(&bytes).map_err(|reason| TextureError::Decode {
            path: self.path.clone(),
            reason,
        })
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
        icon: Input,
        mask: Input,
        frame: Input,
        colours: [Option<[u8; 3]>; 4],
    },
}

const EMPIRE_FLAG_MASK: &str = "gfx/interface/flags/empire_flag_64_mask.dds";
const EMPIRE_FLAG_FRAME: &str = "gfx/interface/flags/empire_flag_64_frame.dds";

impl Job {
    fn plan(
        key: &TextureKey,
        layout: &Layout,
        sprites: &dyn SpriteSource,
        colour: ColourLookup<'_>,
    ) -> Result<Self, TextureError> {
        match key {
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
                icon_category,
                icon_file,
                colours,
            } => Ok(Self::EmpireFlag {
                background: Input::resolve(layout, &format!("flags/backgrounds/{background}"))?,
                icon: Input::resolve(layout, &format!("flags/{icon_category}/{icon_file}"))?,
                mask: Input::resolve(layout, EMPIRE_FLAG_MASK)?,
                frame: Input::resolve(layout, EMPIRE_FLAG_FRAME)?,
                colours: resolve_colours(colours, colour)?,
            }),
            TextureKey::Symbol { .. } => Ok(Self::White(Input::resolve(layout, &key.rel_path()?)?)),
            _ => Ok(Self::Whole(Input::resolve(layout, &key.rel_path()?)?)),
        }
    }

    fn cache_name(&self, key: &TextureKey) -> String {
        let mut hasher = DefaultHasher::new();
        key.to_string().hash(&mut hasher);
        self.hash(&mut hasher);
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
            } => Ok(compose_empire_flag(
                &background.decode()?,
                &icon.decode()?,
                &mask.decode()?,
                &frame.decode()?,
                colours,
            )),
        }
    }
}

/// `null` contributes nothing; `#rrggbb` is literal; anything else is looked up. A name the
/// lookup lacks (a mod's `customcolor1951`, which the game decodes rather than defines) tints
/// nothing, so the flag still composes from its symbol, background and frame.
fn resolve_colours(
    names: &[String; 4],
    lookup: ColourLookup<'_>,
) -> Result<[Option<[u8; 3]>; 4], TextureError> {
    let mut colours = [None; 4];
    for (slot, name) in colours.iter_mut().zip(names) {
        *slot = match name.as_str() {
            "null" => None,
            hex if hex.starts_with('#') => {
                Some(parse_hex(hex).ok_or_else(|| TextureError::UnknownColour(name.clone()))?)
            }
            other => lookup(other),
        };
    }
    Ok(colours)
}

fn parse_hex(hex: &str) -> Option<[u8; 3]> {
    let digits = hex.strip_prefix('#')?;
    if digits.len() != 6 {
        return None;
    }
    let channel = |i: usize| u8::from_str_radix(&digits[i..i + 2], 16).ok();
    Some([channel(0)?, channel(2)?, channel(4)?])
}

/// The game's `GFX_empire_flag_64` (`interface/game_setup/customization.gfx`):
/// background at (5,5) 60×60, symbol at (12,12) 46×46, inside the 70×70 frame.
const BG_ORIGIN: u32 = 5;
const BG_SIZE: u32 = 60;
const SYMBOL_ORIGIN: u32 = 12;
const SYMBOL_SIZE: u32 = 46;

/// `gfx/FX/flag_sprite.shader`: the background's R, G and B channels each
/// weight one colour; the symbol is lerped in by its alpha, untinted; the
/// mask's alpha cuts the shape; the frame is lerped on top by its alpha.
fn compose_empire_flag(
    background: &RgbaImage,
    icon: &RgbaImage,
    mask: &RgbaImage,
    frame: &RgbaImage,
    colours: &[Option<[u8; 3]>; 4],
) -> RgbaImage {
    let (width, height) = frame.dimensions();
    let background = imageops::resize(background, BG_SIZE, BG_SIZE, FilterType::Triangle);
    let icon = imageops::resize(icon, SYMBOL_SIZE, SYMBOL_SIZE, FilterType::Triangle);
    let mask = imageops::resize(mask, width, height, FilterType::Triangle);
    let tint: Vec<[f32; 3]> = colours
        .iter()
        .take(3)
        .map(|c| c.map_or([0.0; 3], |[r, g, b]| [unit(r), unit(g), unit(b)]))
        .collect();
    RgbaImage::from_fn(width, height, |x, y| {
        let bg = clamped(
            &background,
            x as i64 - BG_ORIGIN as i64,
            y as i64 - BG_ORIGIN as i64,
        );
        let mut rgb = [0.0f32; 3];
        for (weight, colour) in bg.0.iter().zip(&tint) {
            for (out, c) in rgb.iter_mut().zip(colour) {
                *out = (*out + c * unit(*weight)).min(1.0);
            }
        }
        if let (Some(sx), Some(sy)) = (
            x.checked_sub(SYMBOL_ORIGIN).filter(|s| *s < SYMBOL_SIZE),
            y.checked_sub(SYMBOL_ORIGIN).filter(|s| *s < SYMBOL_SIZE),
        ) {
            let symbol = icon.get_pixel(sx, sy).0;
            let a = unit(symbol[3]);
            for (out, s) in rgb.iter_mut().zip(&symbol[..3]) {
                *out = lerp(*out, unit(*s), a);
            }
        }
        let alpha = unit(mask.get_pixel(x, y).0[3]);
        let f = frame.get_pixel(x, y).0;
        let fa = unit(f[3]);
        for (out, fc) in rgb.iter_mut().zip(&f[..3]) {
            *out = lerp(*out * alpha, unit(*fc), fa);
        }
        let alpha = alpha.max(fa);
        let straight = |c: f32| (if alpha > 0.0 { c / alpha } else { 0.0 } * 255.0).round() as u8;
        Rgba([
            straight(rgb[0]),
            straight(rgb[1]),
            straight(rgb[2]),
            (alpha * 255.0).round() as u8,
        ])
    })
}

fn clamped(image: &RgbaImage, x: i64, y: i64) -> Rgba<u8> {
    let x = x.clamp(0, image.width() as i64 - 1) as u32;
    let y = y.clamp(0, image.height() as i64 - 1) as u32;
    *image.get_pixel(x, y)
}

fn unit(v: u8) -> f32 {
    f32::from(v) / 255.0
}

fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
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
