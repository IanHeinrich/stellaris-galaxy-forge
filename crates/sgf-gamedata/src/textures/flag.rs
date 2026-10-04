//! The composed empire flag: a background tinted by up to three colours, a symbol, a mask and
//! the frame.

use image::imageops::{self, FilterType};
use image::{Rgba, RgbaImage};

use super::TextureError;
use super::lookups::ColourLookup;

pub(super) const EMPIRE_FLAG_MASK: &str = "gfx/interface/flags/empire_flag_64_mask.dds";
pub(super) const EMPIRE_FLAG_FRAME: &str = "gfx/interface/flags/empire_flag_64_frame.dds";

/// `null` contributes nothing; `#rrggbb` is literal; anything else is looked up. A name the
/// lookup lacks (a mod's `customcolor1951`, which the game decodes rather than defines) tints
/// nothing, so the flag still composes from its symbol, background and frame.
pub(super) fn resolve_colours(
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
pub(super) fn compose_empire_flag(
    background: &RgbaImage,
    icon: Option<&RgbaImage>,
    mask: &RgbaImage,
    frame: &RgbaImage,
    colours: &[Option<[u8; 3]>; 4],
) -> RgbaImage {
    let (width, height) = frame.dimensions();
    let background = imageops::resize(background, BG_SIZE, BG_SIZE, FilterType::Triangle);
    let icon =
        icon.map(|icon| imageops::resize(icon, SYMBOL_SIZE, SYMBOL_SIZE, FilterType::Triangle));
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
        if let (Some(icon), Some(sx), Some(sy)) = (
            &icon,
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
