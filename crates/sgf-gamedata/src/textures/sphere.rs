//! One sphere renderer shared by `planet_disc` and `star_disc`: a pixel on a disc maps to a
//! point on the unit sphere, seen from far away, and each caller's `shade(x, y, z)` decides its
//! colour there. `x` and `y` are the sphere's right and up axes in -1 to 1; `z` is the axis
//! towards the viewer, 0 at the rim and 1 at the centre.

use std::f64::consts::{PI, TAU};

use image::imageops::{self, FilterType};
use image::{Rgba, RgbaImage};

/// How a [`Plane`] samples past its own edges.
#[derive(Debug, Clone, Copy)]
pub(super) enum Wrap {
    /// Longitude (`u`) wraps; latitude (`v`) clamps at the poles: an equirectangular map.
    Equirect,
    /// Both axes wrap: a texture tiled repeatedly, such as the lava shader's maps.
    Tile,
    /// Both axes clamp: a texture sampled near its own edges, such as one cube face.
    Clamp,
}

/// An image's RGB channels as `f64` in 0 to 1, row by row, sampled with its own [`Wrap`].
pub(super) struct Plane {
    width: usize,
    height: usize,
    texels: Vec<[f64; 3]>,
    wrap: Wrap,
}

impl Plane {
    pub(super) fn new(image: &RgbaImage, wrap: Wrap) -> Self {
        let texels = image
            .pixels()
            .map(|p| [p.0[0], p.0[1], p.0[2]].map(|c| f64::from(c) / 255.0))
            .collect();
        Self {
            width: image.width() as usize,
            height: image.height() as usize,
            texels,
            wrap,
        }
    }

    pub(super) fn width(&self) -> usize {
        self.width
    }

    pub(super) fn height(&self) -> usize {
        self.height
    }

    fn at(&self, x: usize, y: usize) -> [f64; 3] {
        self.texels[y * self.width + x]
    }

    fn axis_wraps(&self) -> (bool, bool) {
        match self.wrap {
            Wrap::Equirect => (true, false),
            Wrap::Tile => (true, true),
            Wrap::Clamp => (false, false),
        }
    }

    /// Bilinear at the texel position (`x`, `y`), wrapping or clamping each axis as `self.wrap`
    /// says.
    pub(super) fn bilinear(&self, x: f64, y: f64) -> [f64; 3] {
        let (wrap_u, wrap_v) = self.axis_wraps();
        let (x0, y0) = (x.floor(), y.floor());
        let (fx, fy) = (x - x0, y - y0);
        let index = |i: f64, n: usize, wrap: bool| {
            if wrap {
                (i as i64).rem_euclid(n as i64) as usize
            } else {
                (i.max(0.0) as usize).min(n - 1)
            }
        };
        let (xa, xb) = (
            index(x0, self.width, wrap_u),
            index(x0 + 1.0, self.width, wrap_u),
        );
        let (ya, yb) = (
            index(y0, self.height, wrap_v),
            index(y0 + 1.0, self.height, wrap_v),
        );
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

    /// Bilinear at normalized (`u`, `v`): each in texels once scaled by the plane's own width
    /// and height, wrapping or clamping past 0 or 1 as `self.wrap` says.
    pub(super) fn sample(&self, u: f64, v: f64) -> [f64; 3] {
        let (wrap_u, wrap_v) = self.axis_wraps();
        let place = |i: f64, n: usize, wrap: bool| {
            let i = i * n as f64 - 0.5;
            if wrap {
                i.rem_euclid(n as f64)
            } else {
                i.clamp(0.0, (n - 1) as f64)
            }
        };
        self.bilinear(place(u, self.width, wrap_u), place(v, self.height, wrap_v))
    }
}

/// The longitude/latitude of a point on the unit sphere, as an equirectangular `u`/`v` in 0 to
/// 1: `u` wraps round from the direction of `+z`, `v` runs from the `+y` pole to the `-y` one.
pub(super) fn equirect(x: f64, y: f64, z: f64) -> (f64, f64) {
    let u = 0.5 + x.atan2(z) / TAU;
    let v = 0.5 - y.clamp(-1.0, 1.0).asin() / PI;
    (u, v)
}

/// A disc of `side` pixels, `shade(x, y, z)` for each point of the sphere's visible face,
/// sampled `supersample` times finer per side and averaged down, with its edge faded out over
/// `feather` output pixels. `supersample` of 1 renders directly, with no resize, and a pixel
/// with no coverage is flat transparent black; a `supersample` above 1 shades every pixel
/// regardless of coverage, so the later averaging blends real colour into the rim rather than
/// a dark fringe.
pub(super) fn render(
    side: u32,
    supersample: u32,
    feather: f64,
    shade: impl Fn(f64, f64, f64) -> [f64; 3],
) -> RgbaImage {
    let size = side * supersample;
    let radius = f64::from(size) / 2.0;
    let feather = feather * f64::from(supersample);
    let fine = RgbaImage::from_fn(size, size, |px, py| {
        let x = (f64::from(px) + 0.5 - radius) / radius;
        let y = (radius - f64::from(py) - 0.5) / radius;
        let r = x.hypot(y);
        let coverage = (radius * (1.0 - r) / feather + 0.5).clamp(0.0, 1.0);
        if supersample <= 1 && coverage <= 0.0 {
            return Rgba([0; 4]);
        }
        // Coloured out to the corners even where coverage is 0: see the doc comment above.
        let (x, y) = if r > 1.0 { (x / r, y / r) } else { (x, y) };
        let z = (1.0 - x * x - y * y).max(0.0).sqrt();
        let [red, green, blue] = shade(x, y, z).map(byte);
        Rgba([red, green, blue, byte(coverage)])
    });
    if supersample <= 1 {
        fine
    } else {
        imageops::resize(&fine, side, side, FilterType::Triangle)
    }
}

/// `unit` in 0 to 1, as a channel byte.
fn byte(unit: f64) -> u8 {
    (unit * 255.0).round().clamp(0.0, 255.0) as u8
}
