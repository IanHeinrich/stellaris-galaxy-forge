//! `star_disc:<class>`: a star planet class's sphere as the system view draws it, lit from
//! within. A star whose entity names a surface map (the brown dwarf's banded one) shows that
//! map. Every other star is one frame of the game's star shader, `PixelPdxMeshStar` in
//! `gfx/FX/pdxmesh.shader`: a noise cube map drawn as veins of lava over stone in the colours
//! of the `gfx/worldgfx` settings whose `world` is the body's lighting class, turning towards
//! the planet class's atmosphere colour at the limb.

use std::collections::BTreeMap;
use std::f64::consts::{PI, TAU};
use std::fs;
use std::hash::{Hash, Hasher};

use image::imageops::{self, FilterType};
use image::{Rgba, RgbaImage};
use sgf_core::cst::{self, Node};

use crate::install::layers::Layout;
use crate::registries::colors;

const WORLDGFX: &str = "gfx/worldgfx";
/// The settings the game falls back on, whose maps a lighting class without its own settings
/// is drawn with.
const FALLBACK_WORLD: &str = "default";
/// The disc's side, in pixels, and how many samples a side each pixel averages.
const DISC: u32 = 256;
const SUPERSAMPLE: u32 = 2;
/// How wide a mip level each map is read at: about as fine as the disc shows it.
pub(super) const NOISE_WIDTH: u32 = 256;
pub(super) const LAVA_WIDTH: u32 = 128;
pub(super) const STONE_WIDTH: u32 = 64;
pub(super) const SURFACE_WIDTH: u32 = 512;
/// Part of every cache name, so a change to how discs are baked is baked afresh.
pub(super) const BAKE: u32 = 1;

/// The shader's constants: its animation speed, how many veins the noise makes, and how many
/// times the lava and stone maps repeat round the sphere.
const LAVA_ANIMATION_SPEED: f64 = 0.08;
const LAVA_FIELD_SIZE: f64 = 10.0;
const LAVA_STONE_HOTNESS: f64 = 0.1;
const LAVA_TILE: f64 = 10.0;
const STONE_TILE: f64 = 25.0;
/// The moment of the animation the disc shows, and how far the pole leans towards the viewer.
const FRAME_TIME: f64 = 3.0;
const TILT: f64 = 0.35;
/// The shader brightens the limb by up to 3.5 times; less keeps it from reading as a rim.
const LIMB_BOOST: f64 = 1.2;
/// Brighter towards the centre, so the disc reads as a lit body rather than a flat one.
const CORE_GAIN: f64 = 0.3;
/// The game lays thousands of glowing particles over the surface in its own hue. Each point
/// gains up to this much of its colour at full brightness, the most where it is darkest, so a
/// dim star glows without a bright one washing out.
const GLAZE: f64 = 0.45;
/// The shader's own doubling, then a Reinhard tone map whose white is `WHITE`.
const EXPOSURE: f64 = 2.2;
const WHITE: f64 = 2.0;
/// A surface map lit from within: its gain, and how much darker the limb is than the centre.
const SURFACE_GAIN: f64 = 1.5;
const SURFACE_LIMB: f64 = 0.35;
/// How many output pixels the edge fades over.
const FEATHER_PX: f64 = 1.25;
/// The colours a lighting class with no settings of its own is drawn in, as shares of its
/// tint: its atmosphere colour, else a neutral grey.
const FALLBACK_TINT: [f64; 3] = [0.62, 0.66, 0.7];
const FALLBACK_SHARES: [f64; 3] = [1.6, 0.5, 1.2];

/// A lighting class's graphics settings: the three colours of its surface and the maps it
/// draws them through, each relative to a layer root.
#[derive(Debug, Clone)]
pub(super) struct World {
    lava: Option<Lava>,
    noise: String,
    lava_map: String,
    stone_map: String,
}

impl World {
    pub(super) fn maps(&self) -> [&str; 3] {
        [&self.noise, &self.lava_map, &self.stone_map]
    }
}

/// `lava_bright_color`, `lava_hot_stone_color` and `lava_cold_stone_color`, each times its
/// `_intensity`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Lava {
    bright: [f64; 3],
    hot_stone: [f64; 3],
    cold_stone: [f64; 3],
}

impl Hash for Lava {
    fn hash<H: Hasher>(&self, state: &mut H) {
        for channel in [self.bright, self.hot_stone, self.cold_stone]
            .iter()
            .flatten()
        {
            channel.to_bits().hash(state);
        }
    }
}

/// A star planet class's `atmosphere_color`, `atmosphere_intensity` and `atmosphere_width`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StarAtmosphere {
    pub colour: [u8; 3],
    pub intensity: f64,
    pub width: f64,
}

impl Hash for StarAtmosphere {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.colour.hash(state);
        self.intensity.to_bits().hash(state);
        self.width.to_bits().hash(state);
    }
}

impl StarAtmosphere {
    fn unit(&self) -> [f64; 3] {
        self.colour.map(|c| f64::from(c) / 255.0)
    }
}

/// Lighting class (`world`) → its settings.
pub(super) type Worlds = BTreeMap<String, World>;

/// Every `gfx_settings` block in the install's `gfx/worldgfx` files, by its `world`.
pub(super) fn worlds(layout: &Layout) -> Worlds {
    let mut worlds = Worlds::new();
    for path in layout.files_in(WORLDGFX) {
        let Ok(src) = fs::read(&path) else {
            continue;
        };
        let Ok(root) = cst::parse_script(&src, 0) else {
            continue;
        };
        for settings in root
            .children()
            .iter()
            .filter(|n| n.key_str(&src) == Some("gfx_settings"))
        {
            if let Some((name, world)) = read_world(settings, &src) {
                worlds.insert(name, world);
            }
        }
    }
    worlds
}

fn read_world(node: &Node, src: &[u8]) -> Option<(String, World)> {
    let lava = (|| {
        Some(Lava {
            bright: lava_colour(node, "bright", src)?,
            hot_stone: lava_colour(node, "hot_stone", src)?,
            cold_stone: lava_colour(node, "cold_stone", src)?,
        })
    })();
    let world = World {
        lava,
        noise: scalar(node, "tex_lava_noise", src)?.to_owned(),
        lava_map: scalar(node, "tex_lava_diffuse", src)?.to_owned(),
        stone_map: scalar(node, "tex_stone_diffuse", src)?.to_owned(),
    };
    Some((scalar(node, "world", src)?.to_owned(), world))
}

fn lava_colour(node: &Node, name: &str, src: &[u8]) -> Option<[f64; 3]> {
    let colour = colors::read_unit_rgb(node, &format!("lava_{name}_color"), src)?;
    let intensity = scalar(node, &format!("lava_{name}_intensity"), src)
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(1.0);
    Some(colour.map(|c| c * intensity))
}

fn scalar<'a>(node: &Node, key: &str, src: &'a [u8]) -> Option<&'a str> {
    node.find_all(key, src)
        .last()?
        .scalar_str(src)
        .filter(|s| !s.is_empty())
}

/// The settings `lighting` draws with and their colours: its own, else the fallback's maps in
/// colours taken from the atmosphere, or from grey when the class has none.
pub(super) fn world_for<'w>(
    worlds: &'w Worlds,
    lighting: Option<&str>,
    atmosphere: Option<StarAtmosphere>,
) -> Option<(&'w World, Lava)> {
    if let Some(world) = lighting.and_then(|name| worlds.get(name))
        && let Some(lava) = world.lava
    {
        return Some((world, lava));
    }
    let fallback = worlds.get(FALLBACK_WORLD)?;
    let tint = atmosphere.map_or(FALLBACK_TINT, |a| a.unit());
    let [bright, hot_stone, cold_stone] = FALLBACK_SHARES.map(|share| tint.map(|c| c * share));
    let lava = Lava {
        bright,
        hot_stone,
        cold_stone,
    };
    Some((fallback, lava))
}

/// The maps a disc samples, each as linear channels in 0 to 1.
pub(super) struct Maps {
    /// The six faces of the noise cube, red channel only.
    pub(super) noise: Vec<Plane>,
    pub(super) lava: Plane,
    pub(super) stone: Plane,
}

/// An image's channels as `f64` in 0 to 1, row by row.
pub(super) struct Plane {
    width: usize,
    height: usize,
    texels: Vec<[f64; 3]>,
}

impl Plane {
    pub(super) fn new(image: &RgbaImage) -> Self {
        let texels = image
            .pixels()
            .map(|p| [p.0[0], p.0[1], p.0[2]].map(|c| f64::from(c) / 255.0))
            .collect();
        Self {
            width: image.width() as usize,
            height: image.height() as usize,
            texels,
        }
    }

    fn at(&self, x: usize, y: usize) -> [f64; 3] {
        self.texels[y * self.width + x]
    }

    /// Bilinear at (`u`, `v`) in texels, wrapping both ways.
    fn wrapped(&self, u: f64, v: f64) -> [f64; 3] {
        let (w, h) = (self.width as f64, self.height as f64);
        let x = (u * w - 0.5).rem_euclid(w);
        let y = (v * h - 0.5).rem_euclid(h);
        self.bilinear(x, y, true)
    }

    /// Bilinear at the texel position (`x`, `y`), clamped at the edges unless `wrap`.
    fn bilinear(&self, x: f64, y: f64, wrap: bool) -> [f64; 3] {
        let (x0, y0) = (x.floor(), y.floor());
        let (fx, fy) = (x - x0, y - y0);
        let index = |i: f64, n: usize| {
            if wrap {
                (i as i64).rem_euclid(n as i64) as usize
            } else {
                (i.max(0.0) as usize).min(n - 1)
            }
        };
        let (xa, xb) = (index(x0, self.width), index(x0 + 1.0, self.width));
        let (ya, yb) = (index(y0, self.height), index(y0 + 1.0, self.height));
        let (a, b, c, d) = (
            self.at(xa, ya),
            self.at(xb, ya),
            self.at(xa, yb),
            self.at(xb, yb),
        );
        std::array::from_fn(|i| {
            let top = a[i] * (1.0 - fx) + b[i] * fx;
            let bottom = c[i] * (1.0 - fx) + d[i] * fx;
            top * (1.0 - fy) + bottom * fy
        })
    }
}

/// The noise cube's red channel in direction `n`, faces in Direct3D's order and orientation.
fn cube(faces: &[Plane], [x, y, z]: [f64; 3]) -> f64 {
    let (ax, ay, az) = (x.abs(), y.abs(), z.abs());
    let (face, s, t, major) = if ax >= ay && ax >= az {
        if x > 0.0 {
            (0, -z, -y, ax)
        } else {
            (1, z, -y, ax)
        }
    } else if ay >= az {
        if y > 0.0 {
            (2, x, z, ay)
        } else {
            (3, x, -z, ay)
        }
    } else if z > 0.0 {
        (4, x, -y, az)
    } else {
        (5, -x, -y, az)
    };
    let plane = &faces[face];
    let major = major.max(1e-9);
    let u = (s / major + 1.0) / 2.0 * plane.width as f64 - 0.5;
    let v = (t / major + 1.0) / 2.0 * plane.height as f64 - 0.5;
    plane.bilinear(u, v, false)[0]
}

/// The star shader for one frame, over a sphere seen from far away.
pub(super) fn bake_lava(maps: &Maps, lava: Lava, atmosphere: Option<StarAtmosphere>) -> RgbaImage {
    let air = atmosphere.map(|a| (a.unit(), a.intensity, a.width));
    render(|x, y, z| {
        let (sin, cos) = TILT.sin_cos();
        let (ny, nz) = (y * cos + z * sin, z * cos - y * sin);
        let noise = 3.0 * (cube(&maps.noise, [x, ny, nz]) - 0.5);
        let veins = ((noise + FRAME_TIME * LAVA_ANIMATION_SPEED) * LAVA_FIELD_SIZE).sin();
        let heat = (1.0 - veins) * 0.5;
        let lava_mask = (-veins).clamp(0.0, 1.0).powi(2).powf(0.7);
        let stone_share = 1.0 - veins.clamp(0.0, 1.0);
        let u = 0.5 + x.atan2(nz) / TAU;
        let v = ny.clamp(-1.0, 1.0).acos() / PI;
        let lava_texel = maps.lava.wrapped(u * LAVA_TILE, v * LAVA_TILE);
        let stone = maps.stone.wrapped(u * STONE_TILE, v * STONE_TILE);
        let limb = smoothstep(0.5, 1.0, 1.0 - z);
        let colour: [f64; 3] = std::array::from_fn(|i| {
            let hot = stone[i] * lava.hot_stone[i] * (heat + LAVA_STONE_HOTNESS);
            let cold = hot + stone[i] * lava.cold_stone[i];
            let rock = cold * (1.0 - stone_share) + hot * stone_share;
            let mut c = (rock + lava_texel[i] * lava.bright[i] * lava_mask).clamp(0.0, 1.0);
            if let Some((colour, intensity, width)) = air {
                let reach = (width - z).clamp(0.0, 1.0);
                let k = (reach * reach * intensity).clamp(0.0, 1.0);
                c = c * (1.0 - k) + colour[i] * k;
            }
            (c + c * limb * LIMB_BOOST).min(1.0)
        });
        let peak = colour.iter().copied().fold(1e-6, f64::max);
        let glaze = GLAZE * (1.0 - peak.min(1.0)) / peak;
        colour.map(|c| tone((c + glaze * c) * (1.0 + CORE_GAIN * z)))
    })
}

/// `map`, an equirectangular projection, wrapped round a sphere that shines by its own light.
pub(super) fn bake_surface(map: &RgbaImage) -> RgbaImage {
    let map = Plane::new(map);
    render(|x, y, z| {
        let u = 0.5 + x.atan2(z) / TAU;
        let v = 0.5 - y.clamp(-1.0, 1.0).asin() / PI;
        let texel = map.wrapped(u, v);
        let light = SURFACE_GAIN * (1.0 - SURFACE_LIMB * (1.0 - z));
        texel.map(|c| tone(c * light))
    })
}

/// A disc of `shade(x, y, z)` for each point of the sphere's visible face, `x` right and `y`
/// up, averaged down from a finer grid, with its edge faded out.
fn render(shade: impl Fn(f64, f64, f64) -> [f64; 3]) -> RgbaImage {
    let size = DISC * SUPERSAMPLE;
    let radius = f64::from(size) / 2.0;
    let feather = FEATHER_PX * f64::from(SUPERSAMPLE);
    let fine = RgbaImage::from_fn(size, size, |px, py| {
        let x = (f64::from(px) + 0.5 - radius) / radius;
        let y = (radius - f64::from(py) - 0.5) / radius;
        let r = x.hypot(y);
        let coverage = (radius * (1.0 - r) / feather + 0.5).clamp(0.0, 1.0);
        // Coloured out to the corners, so averaging down leaves no dark fringe on the edge.
        let (x, y) = if r > 1.0 { (x / r, y / r) } else { (x, y) };
        let z = (1.0 - x * x - y * y).max(0.0).sqrt();
        let [red, green, blue] = shade(x, y, z).map(byte);
        Rgba([red, green, blue, byte(coverage)])
    });
    imageops::resize(&fine, DISC, DISC, FilterType::Triangle)
}

fn tone(c: f64) -> f64 {
    let c = c * EXPOSURE;
    c * (1.0 + c / (WHITE * WHITE)) / (1.0 + c)
}

fn smoothstep(from: f64, to: f64, x: f64) -> f64 {
    let t = ((x - from) / (to - from)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn byte(unit: f64) -> u8 {
    (unit * 255.0).round().clamp(0.0, 255.0) as u8
}
