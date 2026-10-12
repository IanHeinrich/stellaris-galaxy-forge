//! A model drawn on the CPU as the system view's camera sees it: a depth buffer, the diffuse
//! map, the normal map with its emissive channel, the empire-colour mask and one fixed light,
//! supersampled and cropped to the model. Faces wound away from the camera are culled, and
//! see-through surfaces are blended over the rest, farthest first.

use image::{Rgba, RgbaImage};

use super::ModelPlacement;
use super::space::{GROUND_RIGHT, GROUND_UP, Vec3, WORLD_PER_SAVE, cross, dot, normalize};

/// The editor's camera tilt from straight down, in degrees: its map is seen from above, with
/// a little tilt for depth.
const TILT_DEGREES: f32 = 15.0;
/// Screen pixels per save unit at the system view's closest zoom, where the largest body fills
/// the view's short side: a G star of size 27 in a view 1000 pixels high.
const CLOSEST_PX_PER_SAVE: f32 = 40.0;
/// The least and the most pixels along the sprite's longer side.
const MIN_LONG_SIDE: u32 = 256;
const MAX_LONG_SIDE: u32 = 2048;
/// The most samples per pixel along each axis.
const MAX_SS: u32 = 3;
/// The most samples along the frame's longer side, so a larger sprite takes fewer per pixel.
const MAX_SAMPLES_ALONG: u32 = 2048;
/// Space left round the model, as a share of its longer side.
const MARGIN: f32 = 0.01;
/// A stand-in empire colour for what the ship shader recolours.
const EMPIRE: [f32; 3] = [0.25, 0.55, 1.0];
/// The least diffuse alpha an alpha-tested surface is drawn at: the game clips below 1, and
/// this leaves room for the rounding of bilinear sampling.
const WHOLE_ALPHA: f32 = 1.0 - 0.5 / 255.0;

/// How a surface's colour meets what is already drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Blend {
    Opaque,
    /// Drawn opaque where its diffuse alpha is whole, and not at all elsewhere.
    AlphaTested,
    /// Blended at its diffuse alpha over the opaque surfaces, writing no depth.
    Alpha,
    /// Added at its diffuse alpha onto what is behind it, as [`Blend::Alpha`] otherwise.
    Added,
}

impl Blend {
    /// Drawn after the opaque surfaces, farthest first.
    fn see_through(self) -> bool {
        matches!(self, Self::Alpha | Self::Added)
    }
}

/// A texture as floats, for bilinear sampling with wrapping.
pub(super) struct Map {
    width: usize,
    height: usize,
    texels: Vec<[u8; 4]>,
}

impl Map {
    pub(super) fn new(image: &RgbaImage) -> Self {
        Self {
            width: image.width() as usize,
            height: image.height() as usize,
            texels: image.pixels().map(|p| p.0).collect(),
        }
    }

    fn sample(&self, [u, v]: [f32; 2]) -> [f32; 4] {
        if self.texels.is_empty() {
            return [0.6, 0.6, 0.6, 1.0];
        }
        let x = u * self.width as f32 - 0.5;
        let y = v * self.height as f32 - 0.5;
        let (x0, y0) = (x.floor(), y.floor());
        let (fx, fy) = (x - x0, y - y0);
        let wrap = |i: f32, n: usize| (i as i64).rem_euclid(n as i64) as usize;
        let at = |xi: f32, yi: f32| {
            self.texels[wrap(yi, self.height) * self.width + wrap(xi, self.width)]
                .map(|c| f32::from(c) / 255.0)
        };
        let (a, b, c, d) = (
            at(x0, y0),
            at(x0 + 1.0, y0),
            at(x0, y0 + 1.0),
            at(x0 + 1.0, y0 + 1.0),
        );
        std::array::from_fn(|i| {
            (a[i] * (1.0 - fx) + b[i] * fx) * (1.0 - fy) + (c[i] * (1.0 - fx) + d[i] * fx) * fy
        })
    }
}

/// One mesh, its vertices already placed in the model's space.
pub(super) struct Surface<'a> {
    pub(super) positions: Vec<Vec3>,
    pub(super) normals: Vec<Vec3>,
    pub(super) tangents: Vec<[f32; 4]>,
    pub(super) uvs: &'a [[f32; 2]],
    pub(super) triangles: &'a [[u32; 3]],
    pub(super) diffuse: Option<&'a Map>,
    pub(super) normal_map: Option<&'a Map>,
    pub(super) specular: Option<&'a Map>,
    /// Drawn into the depth buffer only, leaving the sprite clear where it is in front.
    pub(super) depth_only: bool,
    pub(super) blend: Blend,
    /// Both faces of each triangle are drawn, not only those wound towards its normals.
    pub(super) double_sided: bool,
    /// Its part's transform reverses the winding of its triangles.
    pub(super) mirrored: bool,
    /// The specular map's red marks what takes the empire colour.
    pub(super) empire_mask: bool,
}

struct Camera {
    right: Vec3,
    up: Vec3,
    forward: Vec3,
    light: Vec3,
}

impl Camera {
    fn tilted() -> Self {
        let (sin, cos) = TILT_DEGREES.to_radians().sin_cos();
        let sky = [0.0, 1.0, 0.0];
        let mix =
            |a: Vec3, wa: f32, b: Vec3, wb: f32| std::array::from_fn(|k| a[k] * wa + b[k] * wb);
        let light =
            std::array::from_fn(|k| -0.5 * GROUND_RIGHT[k] + 0.8 * sky[k] - 0.35 * GROUND_UP[k]);
        Self {
            right: GROUND_RIGHT,
            up: mix(GROUND_UP, cos, sky, sin),
            forward: mix(sky, -cos, GROUND_UP, sin),
            light: normalize(light),
        }
    }

    fn screen(&self, p: Vec3) -> [f32; 2] {
        [dot(p, self.right), dot(p, self.up)]
    }
}

/// The corners of what the camera sees of `positions`, with the margin round it, and its
/// longer side; `None` when they have no extent.
fn framed(camera: &Camera, positions: impl IntoIterator<Item = Vec3>) -> Option<Framed> {
    let (mut lo, mut hi) = ([f32::MAX; 2], [f32::MIN; 2]);
    for p in positions {
        let s = camera.screen(p);
        for k in 0..2 {
            lo[k] = lo[k].min(s[k]);
            hi[k] = hi[k].max(s[k]);
        }
    }
    let span = (hi[0] - lo[0]).max(hi[1] - lo[1]);
    if !span.is_finite() || span <= 0.0 {
        return None;
    }
    for k in 0..2 {
        lo[k] -= span * MARGIN;
        hi[k] += span * MARGIN;
    }
    Some(Framed {
        lo,
        hi,
        span: span * (1.0 + 2.0 * MARGIN),
    })
}

struct Framed {
    lo: [f32; 2],
    hi: [f32; 2],
    span: f32,
}

/// The sprite's longer side in pixels for a model whose vertices are `positions`: about what
/// it covers at the system view's closest zoom, within [`MIN_LONG_SIDE`] and
/// [`MAX_LONG_SIDE`].
pub(super) fn long_side(positions: impl IntoIterator<Item = Vec3>) -> u32 {
    let covered = framed(&Camera::tilted(), positions)
        .map_or(0.0, |f| f.span / WORLD_PER_SAVE * CLOSEST_PX_PER_SAVE);
    (covered.round() as u32).clamp(MIN_LONG_SIDE, MAX_LONG_SIDE)
}

/// The surfaces drawn into a sprite whose longer side is `long_side` pixels, with where the
/// model's origin falls in it; `None` when they have no vertices.
pub(super) fn render(
    surfaces: &[Surface<'_>],
    long_side: u32,
) -> Option<(RgbaImage, ModelPlacement)> {
    let camera = Camera::tilted();
    let Framed { lo, hi, span } = framed(
        &camera,
        surfaces.iter().flat_map(|s| s.positions.iter().copied()),
    )?;
    let ss = (MAX_SAMPLES_ALONG / long_side.max(1)).clamp(1, MAX_SS) as usize;
    let scale = long_side as f32 * ss as f32 / span;
    let side = |k: usize| {
        let pixels = ((hi[k] - lo[k]) * scale / ss as f32)
            .ceil()
            .min(long_side as f32);
        (pixels as usize).max(1) * ss
    };
    let (w, h) = (side(0), side(1));
    let mut frame = Frame {
        w,
        h,
        ss,
        depth: vec![f32::MAX; w * h],
        colour: vec![[0.0; 4]; w * h],
    };
    let projected: Vec<Vec<Vec3>> = surfaces
        .iter()
        .map(|surface| {
            surface
                .positions
                .iter()
                .map(|p| {
                    let s = camera.screen(*p);
                    [
                        (s[0] - lo[0]) * scale,
                        (hi[1] - s[1]) * scale,
                        dot(*p, camera.forward),
                    ]
                })
                .collect()
        })
        .collect();
    let mut see_through = Vec::new();
    for (s, surface) in surfaces.iter().enumerate() {
        for triangle in surface.triangles {
            let ids = triangle.map(|i| i as usize);
            let Some(points) = corners(&projected[s], ids) else {
                continue;
            };
            if !surface.double_sided && faces_away(&camera, surface, ids, surface.mirrored) {
                continue;
            }
            if surface.blend.see_through() {
                let depth = points.iter().map(|p| p[2]).sum::<f32>();
                see_through.push((depth, s, ids, points));
            } else {
                frame.fill(&camera, surface, ids, points);
            }
        }
    }
    see_through.sort_by(|a, b| b.0.total_cmp(&a.0));
    for (_, s, ids, points) in see_through {
        frame.fill(&camera, &surfaces[s], ids, points);
    }
    let placement = ModelPlacement {
        width: f64::from(w as f32 / scale / WORLD_PER_SAVE),
        height: f64::from(h as f32 / scale / WORLD_PER_SAVE),
        anchor_x: f64::from(-lo[0] * scale / w as f32),
        anchor_y: f64::from(hi[1] * scale / h as f32),
    };
    Some((frame.downsample(), placement))
}

/// The projected corners of triangle `ids`, when it has all three.
fn corners(projected: &[Vec3], [a, b, c]: [usize; 3]) -> Option<[Vec3; 3]> {
    Some([*projected.get(a)?, *projected.get(b)?, *projected.get(c)?])
}

/// Whether triangle `ids` is wound away from the camera. A mesh's triangles are wound
/// counter-clockwise about their vertex normals, so that is the face the game draws; a
/// `mirrored` part winds them clockwise.
fn faces_away(camera: &Camera, surface: &Surface<'_>, ids: [usize; 3], mirrored: bool) -> bool {
    let [a, b, c] = ids.map(|i| surface.positions[i]);
    let edge = |p: Vec3| std::array::from_fn(|k| p[k] - a[k]);
    let towards = dot(cross(edge(b), edge(c)), camera.forward);
    if mirrored {
        towards <= 0.0
    } else {
        towards >= 0.0
    }
}

struct Frame {
    w: usize,
    h: usize,
    /// Samples per pixel along each axis.
    ss: usize,
    depth: Vec<f32>,
    colour: Vec<[f32; 4]>,
}

impl Frame {
    fn fill(
        &mut self,
        camera: &Camera,
        surface: &Surface<'_>,
        ids: [usize; 3],
        [pa, pb, pc]: [Vec3; 3],
    ) {
        let area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
        if area.abs() < 1e-12 {
            return;
        }
        let x0 = pa[0].min(pb[0]).min(pc[0]).floor().max(0.0) as usize;
        let x1 = (pa[0].max(pb[0]).max(pc[0]).ceil().max(0.0) as usize).min(self.w - 1);
        let y0 = pa[1].min(pb[1]).min(pc[1]).floor().max(0.0) as usize;
        let y1 = (pa[1].max(pb[1]).max(pc[1]).ceil().max(0.0) as usize).min(self.h - 1);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                let w0 = ((pb[0] - px) * (pc[1] - py) - (pb[1] - py) * (pc[0] - px)) / area;
                let w1 = ((pc[0] - px) * (pa[1] - py) - (pc[1] - py) * (pa[0] - px)) / area;
                let w2 = 1.0 - w0 - w1;
                if w0 < 0.0 || w1 < 0.0 || w2 < 0.0 {
                    continue;
                }
                let z = w0 * pa[2] + w1 * pb[2] + w2 * pc[2];
                let i = y * self.w + x;
                if z >= self.depth[i] {
                    continue;
                }
                if surface.depth_only {
                    self.depth[i] = z;
                    self.colour[i] = [0.0; 4];
                    continue;
                }
                let [r, g, b, alpha] = shade(camera, surface, ids, [w0, w1, w2]);
                match surface.blend {
                    Blend::Opaque => {}
                    Blend::AlphaTested if alpha >= WHOLE_ALPHA => {}
                    Blend::AlphaTested => continue,
                    Blend::Alpha => {
                        self.colour[i] = over([r, g, b], alpha, self.colour[i]);
                        continue;
                    }
                    Blend::Added => {
                        self.colour[i] = added([r, g, b], alpha, self.colour[i]);
                        continue;
                    }
                }
                self.depth[i] = z;
                self.colour[i] = [r, g, b, 1.0];
            }
        }
    }

    fn downsample(&self) -> RgbaImage {
        let ss = self.ss;
        let (ow, oh) = (self.w / ss, self.h / ss);
        RgbaImage::from_fn(ow as u32, oh as u32, |x, y| {
            let mut acc = [0f32; 4];
            for dy in 0..ss {
                for dx in 0..ss {
                    let c = self.colour[(y as usize * ss + dy) * self.w + x as usize * ss + dx];
                    for k in 0..3 {
                        acc[k] += c[k] * c[3];
                    }
                    acc[3] += c[3];
                }
            }
            let channel = |v: f32| {
                if acc[3] > 0.0 {
                    ((v / acc[3]).clamp(0.0, 1.0) * 255.0).round() as u8
                } else {
                    0
                }
            };
            let alpha = (acc[3] / (ss * ss) as f32 * 255.0).round() as u8;
            Rgba([channel(acc[0]), channel(acc[1]), channel(acc[2]), alpha])
        })
    }
}

/// `colour` at `alpha` laid over `below`, each a colour and its coverage.
fn over(colour: Vec3, alpha: f32, below: [f32; 4]) -> [f32; 4] {
    let alpha = alpha.clamp(0.0, 1.0);
    let kept = below[3] * (1.0 - alpha);
    let total = alpha + kept;
    if total <= 0.0 {
        return [0.0; 4];
    }
    let [r, g, b] = std::array::from_fn(|k| (colour[k] * alpha + below[k] * kept) / total);
    [r, g, b, total]
}

/// `colour` at `alpha` added onto `below`. Over nothing, the light added is its own coverage.
fn added(colour: Vec3, alpha: f32, below: [f32; 4]) -> [f32; 4] {
    let light: Vec3 = colour.map(|c| (c * alpha.clamp(0.0, 1.0)).max(0.0));
    let sum: Vec3 = std::array::from_fn(|k| below[k] * below[3] + light[k]);
    let total = sum.iter().fold(below[3], |a, &c| a.max(c)).min(1.0);
    if total <= 0.0 {
        return [0.0; 4];
    }
    let [r, g, b] = sum.map(|c| (c / total).min(1.0));
    [r, g, b, total]
}

/// The colour of a surface at barycentric `weights` of triangle `ids` and its diffuse alpha:
/// its normal turned to the camera and bent by the normal map, its emissive parts and its
/// empire mask, when it reads one, in the stand-in empire colour.
fn shade(camera: &Camera, surface: &Surface<'_>, ids: [usize; 3], weights: [f32; 3]) -> [f32; 4] {
    let mix3 = |src: &[Vec3]| -> Option<Vec3> {
        let [a, b, c] = ids.map(|i| src.get(i));
        let (a, b, c) = (a?, b?, c?);
        Some(std::array::from_fn(|k| {
            weights[0] * a[k] + weights[1] * b[k] + weights[2] * c[k]
        }))
    };
    let uv = {
        let [a, b, c] = ids.map(|i| surface.uvs.get(i).copied().unwrap_or_default());
        std::array::from_fn(|k| weights[0] * a[k] + weights[1] * b[k] + weights[2] * c[k])
    };
    let base = surface
        .diffuse
        .map_or([0.6, 0.6, 0.6, 1.0], |m| m.sample(uv));
    let mut n = mix3(&surface.normals).map_or([0.0, 1.0, 0.0], normalize);
    if dot(n, camera.forward) > 0.0 {
        n = n.map(|c| -c);
    }
    let mut emissive = 0.0;
    if let Some(nm) = surface.normal_map.map(|m| m.sample(uv)) {
        emissive = nm[2].clamp(0.0, 1.0);
        let tangent = |i: usize| surface.tangents.get(ids[i]).copied();
        if let (Some(ta), Some(tb), Some(tc)) = (tangent(0), tangent(1), tangent(2)) {
            let t = normalize(std::array::from_fn(|k| {
                weights[0] * ta[k] + weights[1] * tb[k] + weights[2] * tc[k]
            }));
            let sign = if ta[3] < 0.0 { -1.0 } else { 1.0 };
            let bt = cross(n, t).map(|x| x * sign);
            let x = nm[1] * 2.0 - 1.0;
            let y = -(nm[3] * 2.0 - 1.0);
            let z = (1.0 - x * x - y * y).clamp(0.0, 1.0).sqrt();
            n = normalize(std::array::from_fn(|k| x * t[k] + y * bt[k] + z * n[k]));
        }
    }
    let peak = base[0].max(base[1]).max(base[2]);
    let diffuse: Vec3 =
        std::array::from_fn(|k| base[k] * (1.0 - emissive) + peak * EMPIRE[k] * emissive);
    let mask = match surface.specular {
        Some(map) if surface.empire_mask => map.sample(uv)[0],
        _ => 0.0,
    };
    let albedo: Vec3 =
        std::array::from_fn(|k| diffuse[k] * (1.0 - mask) + diffuse[k] * EMPIRE[k] * mask);
    let lit = 0.3 + 0.9 * dot(n, camera.light).max(0.0);
    [
        albedo[0] * lit * (1.0 - emissive) + diffuse[0] * emissive,
        albedo[1] * lit * (1.0 - emissive) + diffuse[1] * emissive,
        albedo[2] * lit * (1.0 - emissive) + diffuse[2] * emissive,
        base[3],
    ]
}
