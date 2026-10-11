//! Vectors, the transforms an assembly places its parts with, and the turn from a model's own
//! axes to the save's.

pub(super) type Vec3 = [f32; 3];

pub(super) fn dot(a: Vec3, b: Vec3) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub(super) fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

pub(super) fn normalize(v: Vec3) -> Vec3 {
    let len = dot(v, v).sqrt().max(1e-9);
    v.map(|c| c / len)
}

/// Game world units per save unit (`SYSTEM_SPACE_SCALE_MULT`).
pub(super) const WORLD_PER_SAVE: f32 = 10.0;

/// A model's axes in save space: the game draws the Science Nexus, long along model X, up and
/// down the screen, and the editor puts screen-up at −save y, so model X is −save y, model Z
/// is +save x and model Y is height.
pub(super) fn to_save(p: Vec3) -> Vec3 {
    [p[2], -p[0], p[1]].map(|c| c / WORLD_PER_SAVE)
}

/// Screen-right and screen-up on the ground plane, in model axes, as [`to_save`] turns them
/// with the editor's screen-right at −save x.
pub(super) const GROUND_RIGHT: Vec3 = [0.0, 0.0, -1.0];
pub(super) const GROUND_UP: Vec3 = [1.0, 0.0, 0.0];

/// A linear map, as three columns, then a translation. It hashes by its bits.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Affine {
    pub(super) columns: [Vec3; 3],
    pub(super) translation: Vec3,
}

impl Affine {
    pub(super) const IDENTITY: Self = Self {
        columns: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        translation: [0.0; 3],
    };

    pub(super) fn scale(s: f32) -> Self {
        Self {
            columns: Self::IDENTITY.columns.map(|c| c.map(|x| x * s)),
            translation: [0.0; 3],
        }
    }

    /// `position` and the rotation quaternion `q` (`x y z w`).
    pub(super) fn from_quaternion(q: [f32; 4], position: Vec3) -> Self {
        let len = q.iter().map(|c| c * c).sum::<f32>().sqrt();
        let [x, y, z, w] = if len > 1e-9 {
            q.map(|c| c / len)
        } else {
            [0.0, 0.0, 0.0, 1.0]
        };
        Self {
            columns: [
                [
                    1.0 - 2.0 * (y * y + z * z),
                    2.0 * (x * y + z * w),
                    2.0 * (x * z - y * w),
                ],
                [
                    2.0 * (x * y - z * w),
                    1.0 - 2.0 * (x * x + z * z),
                    2.0 * (y * z + x * w),
                ],
                [
                    2.0 * (x * z + y * w),
                    2.0 * (y * z - x * w),
                    1.0 - 2.0 * (x * x + y * y),
                ],
            ],
            translation: position,
        }
    }

    /// An `.asset` locator's `rotation = { yaw pitch roll }` in degrees, about model Y, X and Z:
    /// `scale`, then the roll, the pitch and the yaw, then `position`. A ring world's pieces
    /// turn by their yaw alone to face its star.
    pub(super) fn from_euler(degrees: Vec3, scale: f32, position: Vec3) -> Self {
        let [yaw, pitch, roll] = degrees.map(f32::to_radians);
        let mut placed = Self::yaw(yaw)
            .then_before(Self::rotation(1, 2, pitch))
            .then_before(Self::rotation(0, 1, roll))
            .then_before(Self::scale(scale));
        placed.translation = position;
        placed
    }

    /// A turn by `radians` about model Y, Z towards X: a model's heading on the ground.
    pub(super) fn yaw(radians: f32) -> Self {
        Self::rotation(2, 0, radians)
    }

    /// A rotation by `angle` that turns axis `a` towards axis `b`.
    fn rotation(a: usize, b: usize, angle: f32) -> Self {
        let mut r = Self::IDENTITY;
        let (sin, cos) = angle.sin_cos();
        r.columns[a][a] = cos;
        r.columns[a][b] = sin;
        r.columns[b][a] = -sin;
        r.columns[b][b] = cos;
        r
    }

    /// The same map from the 12 floats a joint's `tx` holds.
    pub(super) fn from_columns(m: &[f32; 12]) -> Self {
        Self {
            columns: [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]],
            translation: [m[9], m[10], m[11]],
        }
    }

    pub(super) fn apply(&self, p: Vec3) -> Vec3 {
        let mut out = self.translation;
        for (axis, column) in self.columns.iter().enumerate() {
            for k in 0..3 {
                out[k] += column[k] * p[axis];
            }
        }
        out
    }

    pub(super) fn apply_vector(&self, v: Vec3) -> Vec3 {
        let mut out = [0.0; 3];
        for (axis, column) in self.columns.iter().enumerate() {
            for k in 0..3 {
                out[k] += column[k] * v[axis];
            }
        }
        out
    }

    /// `self` applied to what `inner` gives: `inner` first, then `self`.
    pub(super) fn then_before(&self, inner: Self) -> Self {
        Self {
            columns: inner.columns.map(|c| self.apply_vector(c)),
            translation: self.apply(inner.translation),
        }
    }

    /// The inverse of an invertible map; the identity for a singular one.
    pub(super) fn inverse(&self) -> Self {
        let [a, b, c] = self.columns;
        let det = dot(a, cross(b, c));
        if det.abs() < 1e-12 {
            return Self::IDENTITY;
        }
        let rows = [cross(b, c), cross(c, a), cross(a, b)].map(|r| r.map(|x| x / det));
        let columns = [0, 1, 2].map(|k| [rows[0][k], rows[1][k], rows[2][k]]);
        let linear = Self {
            columns,
            translation: [0.0; 3],
        };
        let translation = linear.apply_vector(self.translation).map(|x| -x);
        Self {
            columns,
            translation,
        }
    }

    /// Its bits, for a cache name: two transforms that differ bake differently.
    pub(super) fn bits(&self) -> [u32; 12] {
        let mut bits = [0; 12];
        for (i, v) in self
            .columns
            .iter()
            .flatten()
            .chain(&self.translation)
            .enumerate()
        {
            bits[i] = v.to_bits();
        }
        bits
    }
}

impl std::hash::Hash for Affine {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        self.bits().hash(state);
    }
}
