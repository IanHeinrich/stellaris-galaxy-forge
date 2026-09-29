//! `planet_disc_shattered:<class>:<seed>`: a lit disc broken into shards along jagged cracks,
//! each pushed out from the centre and turned a little, with a few fragments past the edge.
//! The seed is the planet's id, so each planet breaks its own way, and always the same way.

use std::f64::consts::TAU;

use image::{Rgba, RgbaImage};

/// The share of the image's half-width the planet fills before it breaks, leaving room for its
/// shards to part.
const CORE: f64 = 0.8;
/// The fewest and most shards, and the count from which one sits in the middle.
const SHARDS: (u64, u64) = (5, 9);
const CENTRED_FROM: usize = 7;
/// How far a shard off the middle moves out, in planet radii, and the most it turns, in radians.
const PUSH: (f64, f64) = (0.06, 0.11);
const TURN: f64 = 0.09;
/// How far the cracks wander from straight lines, in planet radii.
const JAG: f64 = 0.08;
/// How far in from a crack a shard's edge darkens, in planet radii, and how dark it gets there.
const RIM: f64 = 0.045;
const RIM_DARK: f64 = 0.5;
/// The fewest and most fragments, their distance from the centre and their size, in planet
/// radii.
const FRAGMENTS: (u64, u64) = (3, 6);
const FRAGMENT_REACH: (f64, f64) = (1.12, 1.18);
const FRAGMENT_SIZE: (f64, f64) = (0.035, 0.06);
const FRAGMENT_CORNERS: usize = 5;
/// Samples per output pixel along each side, so the cracks' edges are smooth.
const SUPERSAMPLE: u32 = 3;

type Pt = [f64; 2];

/// `disc`, a lit disc filling its square image, broken as `seed` says, the same size.
pub(super) fn shatter(disc: &RgbaImage, seed: u64) -> RgbaImage {
    let mut rng = Rng(seed);
    let side = disc.width();
    let cells = Cells::new(&sites(&mut rng), seed, side * SUPERSAMPLE);
    let shards: Vec<Shard> = cells
        .centroids()
        .into_iter()
        .map(|centre| Shard::new(centre, &mut rng))
        .collect();
    let count = rng.count(FRAGMENTS);
    let fragments: Vec<Fragment> = (0..count).map(|_| Fragment::new(&mut rng)).collect();
    let half = f64::from(side) / 2.0;
    let step = 1.0 / f64::from(SUPERSAMPLE);
    RgbaImage::from_fn(side, side, |px, py| {
        let mut sum = [0.0; 4];
        for sy in 0..SUPERSAMPLE {
            for sx in 0..SUPERSAMPLE {
                let x = f64::from(px) + (f64::from(sx) + 0.5) * step;
                let y = f64::from(py) + (f64::from(sy) + 0.5) * step;
                let q = [(x - half) / half / CORE, (half - y) / half / CORE];
                let colour = shard_colour(disc, &cells, &shards, q)
                    .or_else(|| fragments.iter().find_map(|f| f.colour(disc, q)))
                    .unwrap_or([0.0; 4]);
                for (total, c) in sum.iter_mut().zip(colour) {
                    *total += c;
                }
            }
        }
        let n = f64::from(SUPERSAMPLE * SUPERSAMPLE);
        let alpha = sum[3] / n;
        let straight = |c: f64| if alpha > 0.0 { c / n / alpha } else { 0.0 };
        Rgba([
            byte(straight(sum[0])),
            byte(straight(sum[1])),
            byte(straight(sum[2])),
            byte(alpha),
        ])
    })
}

/// The colour at `q`, premultiplied, of the shard that covers it, darkened towards its cracks:
/// of those that cover it, the one it lies deepest inside.
fn shard_colour(disc: &RgbaImage, cells: &Cells, shards: &[Shard], q: Pt) -> Option<[f64; 4]> {
    let (p, depth) = shards
        .iter()
        .enumerate()
        .filter_map(|(i, shard)| {
            let p = shard.source(q);
            let (owner, depth) = cells.at(p)?;
            (owner == i).then_some((p, depth))
        })
        .max_by(|a, b| a.1.total_cmp(&b.1))?;
    let rim = RIM_DARK + (1.0 - RIM_DARK) * smoothstep(depth / RIM);
    let [r, g, b, a] = sample(disc, p);
    Some([r * rim, g * rim, b * rim, a])
}

/// Where the shards' cells are seeded: round a ring, and one near the middle when there are
/// many.
fn sites(rng: &mut Rng) -> Vec<Pt> {
    let count = rng.count(SHARDS);
    let centred = count >= CENTRED_FROM;
    let ring = count - usize::from(centred);
    let mut sites = Vec::with_capacity(count);
    if centred {
        let (angle, r) = (rng.range(0.0, TAU), rng.range(0.0, 0.2));
        sites.push([r * angle.cos(), r * angle.sin()]);
    }
    let start = rng.range(0.0, TAU);
    let spacing = TAU / ring as f64;
    for i in 0..ring {
        let angle = start + spacing * (i as f64 + rng.range(-0.3, 0.3));
        let r = rng.range(0.45, 0.8);
        sites.push([r * angle.cos(), r * angle.sin()]);
    }
    sites
}

/// Which shard each point of the unbroken planet belongs to, and how far inside it lies: the
/// nearest site to the point once it is nudged by noise, so the cracks between cells are jagged.
struct Cells {
    side: usize,
    /// Per texel over the planet's square, row by row from the top: its shard and depth.
    texels: Vec<Option<(usize, f64)>>,
    count: usize,
}

impl Cells {
    fn new(sites: &[Pt], seed: u64, side: u32) -> Self {
        let side = side as usize;
        let mut texels = Vec::with_capacity(side * side);
        for iy in 0..side {
            for ix in 0..side {
                let p = [
                    (ix as f64 + 0.5) / side as f64 * 2.0 - 1.0,
                    1.0 - (iy as f64 + 0.5) / side as f64 * 2.0,
                ];
                texels.push((p[0].hypot(p[1]) <= 1.0).then(|| nearest(sites, nudged(p, seed))));
            }
        }
        Self {
            side,
            texels,
            count: sites.len(),
        }
    }

    fn at(&self, p: Pt) -> Option<(usize, f64)> {
        let index = |c: f64| {
            let i = (c * self.side as f64).floor();
            (0.0..self.side as f64).contains(&i).then_some(i as usize)
        };
        let (ix, iy) = (index((p[0] + 1.0) / 2.0)?, index((1.0 - p[1]) / 2.0)?);
        self.texels[iy * self.side + ix]
    }

    /// Each shard's middle, as the mean of the texels it holds.
    fn centroids(&self) -> Vec<Pt> {
        let mut sums = vec![(0.0, 0.0, 0usize); self.count];
        for (i, texel) in self.texels.iter().enumerate() {
            if let Some((owner, _)) = texel {
                let (x, y) = (i % self.side, i / self.side);
                let sum = &mut sums[*owner];
                sum.0 += (x as f64 + 0.5) / self.side as f64 * 2.0 - 1.0;
                sum.1 += 1.0 - (y as f64 + 0.5) / self.side as f64 * 2.0;
                sum.2 += 1;
            }
        }
        sums.into_iter()
            .map(|(x, y, n)| {
                let n = n.max(1) as f64;
                [x / n, y / n]
            })
            .collect()
    }
}

/// The nearest of `sites` to `p`, and half the gap between its distance and the next's: about
/// how far `p` lies inside its cell.
fn nearest(sites: &[Pt], p: Pt) -> (usize, f64) {
    let (mut best, mut first, mut second) = (0, f64::INFINITY, f64::INFINITY);
    for (i, site) in sites.iter().enumerate() {
        let d = (p[0] - site[0]).hypot(p[1] - site[1]);
        if d < first {
            (best, second, first) = (i, first, d);
        } else if d < second {
            second = d;
        }
    }
    (best, (second - first) / 2.0)
}

fn nudged(p: Pt, seed: u64) -> Pt {
    [
        p[0] + JAG * wobble(seed ^ 0x5eed_0001, p),
        p[1] + JAG * wobble(seed ^ 0x5eed_0002, p),
    ]
}

/// Value noise in -1 to 1 over three octaves, coarse bends first.
fn wobble(seed: u64, p: Pt) -> f64 {
    [(3.0, 0.55), (8.0, 0.3), (21.0, 0.15)]
        .iter()
        .enumerate()
        .map(|(octave, (frequency, weight))| {
            weight
                * value_noise(
                    seed.wrapping_add(octave as u64),
                    p[0] * frequency,
                    p[1] * frequency,
                )
        })
        .sum()
}

fn value_noise(seed: u64, x: f64, y: f64) -> f64 {
    let (x0, y0) = (x.floor(), y.floor());
    let (fx, fy) = (ease(x - x0), ease(y - y0));
    let (ix, iy) = (x0 as i64, y0 as i64);
    let at = |dx: i64, dy: i64| lattice(seed, ix + dx, iy + dy);
    let top = at(0, 0) + (at(1, 0) - at(0, 0)) * fx;
    let bottom = at(0, 1) + (at(1, 1) - at(0, 1)) * fx;
    top + (bottom - top) * fy
}

fn lattice(seed: u64, x: i64, y: i64) -> f64 {
    let key = seed
        ^ (x as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15)
        ^ (y as u64).wrapping_mul(0xc2b2_ae3d_27d4_eb4f);
    Rng(key).unit() * 2.0 - 1.0
}

fn ease(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

fn smoothstep(t: f64) -> f64 {
    ease(t.clamp(0.0, 1.0))
}

/// One shard: its cell of the planet, moved out from the centre and turned about its own middle.
struct Shard {
    centre: Pt,
    offset: Pt,
    /// The cosine and sine of its turn.
    turn: (f64, f64),
}

impl Shard {
    fn new(centre: Pt, rng: &mut Rng) -> Self {
        let off_middle = centre[0].hypot(centre[1]);
        let push = rng.range(PUSH.0, PUSH.1) * (off_middle / 0.35).min(1.0);
        let offset = if off_middle > 0.0 {
            [centre[0] / off_middle * push, centre[1] / off_middle * push]
        } else {
            [0.0, 0.0]
        };
        let sign = if rng.unit() < 0.5 { -1.0 } else { 1.0 };
        let angle = sign * TURN * rng.range(0.3, 1.0);
        Self {
            centre,
            offset,
            turn: (angle.cos(), angle.sin()),
        }
    }

    /// The point of the unbroken planet this shard shows at `q`.
    fn source(&self, q: Pt) -> Pt {
        let (cos, sin) = self.turn;
        let x = q[0] - self.offset[0] - self.centre[0];
        let y = q[1] - self.offset[1] - self.centre[1];
        [
            cos * x + sin * y + self.centre[0],
            -sin * x + cos * y + self.centre[1],
        ]
    }
}

/// A small rock past the planet's edge, showing the surface of the limb it broke from.
struct Fragment {
    centre: Pt,
    /// The point of the unbroken planet under its middle.
    from: Pt,
    size: f64,
    spin: f64,
    corners: [f64; FRAGMENT_CORNERS],
}

impl Fragment {
    fn new(rng: &mut Rng) -> Self {
        let angle = rng.range(0.0, TAU);
        let (cos, sin) = (angle.cos(), angle.sin());
        let reach = rng.range(FRAGMENT_REACH.0, FRAGMENT_REACH.1);
        Self {
            centre: [reach * cos, reach * sin],
            from: [0.88 * cos, 0.88 * sin],
            size: rng.range(FRAGMENT_SIZE.0, FRAGMENT_SIZE.1),
            spin: rng.range(0.0, TAU),
            corners: std::array::from_fn(|_| rng.range(0.55, 1.0)),
        }
    }

    fn colour(&self, disc: &RgbaImage, q: Pt) -> Option<[f64; 4]> {
        let v = [q[0] - self.centre[0], q[1] - self.centre[1]];
        let distance = v[0].hypot(v[1]);
        if distance >= self.size {
            return None;
        }
        let turn = (v[1].atan2(v[0]) + self.spin).rem_euclid(TAU) / TAU * FRAGMENT_CORNERS as f64;
        let corner = turn.floor() as usize % FRAGMENT_CORNERS;
        let next = self.corners[(corner + 1) % FRAGMENT_CORNERS];
        let reach = self.corners[corner] + (next - self.corners[corner]) * turn.fract();
        (distance < self.size * reach)
            .then(|| sample(disc, [self.from[0] + v[0], self.from[1] + v[1]]))
    }
}

/// `disc` at the planet point `p`, bilinear, premultiplied, each channel in 0 to 1.
fn sample(disc: &RgbaImage, p: Pt) -> [f64; 4] {
    let (w, h) = (disc.width() as i64, disc.height() as i64);
    let x = (p[0] + 1.0) / 2.0 * w as f64 - 0.5;
    let y = (1.0 - p[1]) / 2.0 * h as f64 - 0.5;
    let (x0, y0) = (x.floor(), y.floor());
    let (fx, fy) = (x - x0, y - y0);
    let texel = |ix: i64, iy: i64| {
        let px = disc
            .get_pixel(ix.clamp(0, w - 1) as u32, iy.clamp(0, h - 1) as u32)
            .0;
        let a = f64::from(px[3]) / 255.0;
        let channel = |i: usize| f64::from(px[i]) / 255.0 * a;
        [channel(0), channel(1), channel(2), a]
    };
    let (ix, iy) = (x0 as i64, y0 as i64);
    let (a, b, c, d) = (
        texel(ix, iy),
        texel(ix + 1, iy),
        texel(ix, iy + 1),
        texel(ix + 1, iy + 1),
    );
    std::array::from_fn(|i| {
        let top = a[i] + (b[i] - a[i]) * fx;
        let bottom = c[i] + (d[i] - c[i]) * fx;
        top + (bottom - top) * fy
    })
}

fn byte(unit: f64) -> u8 {
    (unit * 255.0).round().clamp(0.0, 255.0) as u8
}

/// SplitMix64: a small generator whose sequence for a seed never changes.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// In 0 to 1.
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }

    fn range(&mut self, low: f64, high: f64) -> f64 {
        low + (high - low) * self.unit()
    }

    fn count(&mut self, (low, high): (u64, u64)) -> usize {
        (low + self.next() % (high - low + 1)) as usize
    }
}
