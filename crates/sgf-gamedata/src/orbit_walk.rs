//! The walk over an initializer's `planet` or `moon` blocks that places each body as the
//! engine does: each block adds its `change_orbit` to a running orbit, then each instance
//! its `orbit_distance`, and each instance turns its `orbit_angle` on from the one before.
//! The roller and the example roll draw each range; the scenario details keep it as the
//! bounds a draw could give.

use sgf_core::format::save::details::Bounds;

use crate::initializers::InitPlanet;
use crate::install::script::Range;
use crate::rng::Rng;

/// The angle the game's saves start each walk from: the star's and planets' about the
/// centre, and each planet's moons' about it.
const WALK_START: f64 = 180.0;

/// How far past the running orbit the game places a body with no `orbit_distance` it can read.
const NO_DISTANCE: Range = Range {
    min: 10.0,
    max: 20.0,
};

/// A number the walk sums: a drawn one, or the bounds of every draw.
pub(crate) trait Step: Copy {
    fn fixed(n: f64) -> Self;
    fn plus(self, other: Self) -> Self;
}

impl Step for f64 {
    fn fixed(n: f64) -> Self {
        n
    }

    fn plus(self, other: Self) -> Self {
        self + other
    }
}

impl Step for Bounds {
    fn fixed(n: f64) -> Self {
        Bounds::fixed(n)
    }

    fn plus(self, other: Self) -> Self {
        Bounds {
            min: self.min + other.min,
            max: self.max + other.max,
        }
    }
}

/// A body's orbit and angle about its parent, or about the system's centre, with the running
/// orbit it stepped out from and the angle it turned on from.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Placed<N> {
    pub orbit: N,
    pub angle: N,
    /// The running orbit before this instance's distance: `orbit` less `step`.
    pub base: N,
    /// The distance this instance stepped out by: its `orbit_distance`, or [`NO_DISTANCE`].
    pub step: N,
    /// The angle of the body before it, or the walk's start.
    pub from: N,
}

/// How the walk turns each range into a number, and what it does with each body.
pub(crate) trait Walk<'p> {
    type Number: Step;
    type Error;

    /// How many instances `block` spawns.
    fn count(&mut self, block: &'p InitPlanet) -> u32;
    fn distance(&mut self, distance: Range) -> Self::Number;
    fn angle(&mut self, angle: Range) -> Self::Number;
    /// The turn of an instance whose block gives no `orbit_angle`.
    fn no_angle(&mut self) -> Self::Number {
        Self::Number::fixed(0.0)
    }
    /// One instance of `block`, where the walk has placed it.
    fn body(
        &mut self,
        block: &'p InitPlanet,
        placed: Placed<Self::Number>,
    ) -> Result<(), Self::Error>;
}

/// Walks `blocks` in file order from [`WALK_START`]. A block with no distance steps by
/// [`NO_DISTANCE`], one with no angle by [`Walk::no_angle`]. A spacer steps the running
/// orbit out and places nothing.
pub(crate) fn walk<'p, W: Walk<'p>>(
    blocks: &'p [InitPlanet],
    walker: &mut W,
) -> Result<(), W::Error> {
    let mut orbit = W::Number::fixed(0.0);
    let mut angle = W::Number::fixed(WALK_START);
    for block in blocks {
        orbit = orbit.plus(W::Number::fixed(block.change_orbit));
        if block.spacer() {
            for _ in 0..walker.count(block) {
                orbit = orbit.plus(walker.distance(block.orbit_distance.unwrap_or(NO_DISTANCE)));
            }
            continue;
        }
        for _ in 0..walker.count(block) {
            let base = orbit;
            let step = walker.distance(block.orbit_distance.unwrap_or(NO_DISTANCE));
            orbit = orbit.plus(step);
            let from = angle;
            let turn = match block.orbit_angle {
                Some(a) => walker.angle(a),
                None => walker.no_angle(),
            };
            angle = angle.plus(turn);
            walker.body(
                block,
                Placed {
                    orbit,
                    angle,
                    base,
                    step,
                    from,
                },
            )?;
        }
    }
    Ok(())
}

/// How a drawn walk draws its numbers, the same for the roller and the example roll.
pub(crate) mod draw {
    use super::{Range, Rng};

    /// A whole number between whole bounds, as the game writes orbits.
    pub(crate) fn distance(rng: &mut Rng, range: Range) -> f64 {
        if range.min.fract() == 0.0 && range.max.fract() == 0.0 {
            return rng.int(range.min as i64, range.max as i64) as f64;
        }
        rng.between(range)
    }

    pub(crate) fn angle(rng: &mut Rng, angle: Range) -> f64 {
        rng.between(angle)
    }

    /// The turn of a body whose block gives no angle: anywhere on its orbit.
    pub(crate) fn any_angle(rng: &mut Rng) -> f64 {
        rng.between(Range {
            min: 0.0,
            max: 360.0,
        })
    }
}
