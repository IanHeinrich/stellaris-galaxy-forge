//! The walk over an initializer's `planet` or `moon` blocks that places each body as the
//! engine does: each block adds its `change_orbit` to a running orbit, then each instance
//! its `orbit_distance`, and each instance turns its `orbit_angle` on from the one before.
//! The roller draws each range; the scenario details keep it as the bounds a draw could give.

use sgf_core::format::save::details::Bounds;

use crate::initializers::InitPlanet;
use crate::install::script::Range;

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

/// A body's orbit and angle about its parent, or about the system's centre.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Placed<N> {
    pub orbit: N,
    pub angle: N,
}

/// What each instance's `orbit_angle` turns on from.
#[derive(Debug, Clone, Copy)]
pub(crate) enum Turn<N> {
    /// The body before it, the first body from this angle: the engine's rule.
    FromPrevious(N),
    /// Nothing: each instance sits at its own `orbit_angle`, as the roller places moons.
    FromZero,
}

/// How the walk turns each range into a number, and what it does with each body.
pub(crate) trait Walk<'p> {
    type Number: Step;
    type Error;

    /// How many instances `block` spawns.
    fn count(&mut self, block: &'p InitPlanet) -> u32;
    fn distance(&mut self, distance: Range) -> Self::Number;
    fn angle(&mut self, angle: Range) -> Self::Number;
    /// One instance of `block`, where the walk has placed it.
    fn body(
        &mut self,
        block: &'p InitPlanet,
        placed: Placed<Self::Number>,
    ) -> Result<(), Self::Error>;
}

/// Walks `blocks` in file order. A block with no distance or no angle steps by 0.
pub(crate) fn walk<'p, W: Walk<'p>>(
    blocks: &'p [InitPlanet],
    turn: Turn<W::Number>,
    walker: &mut W,
) -> Result<(), W::Error> {
    let zero = W::Number::fixed(0.0);
    let mut orbit = zero;
    let mut angle = match turn {
        Turn::FromPrevious(start) => start,
        Turn::FromZero => zero,
    };
    for block in blocks {
        orbit = orbit.plus(W::Number::fixed(block.change_orbit));
        for _ in 0..walker.count(block) {
            orbit = orbit.plus(block.orbit_distance.map_or(zero, |d| walker.distance(d)));
            let step = block.orbit_angle.map_or(zero, |a| walker.angle(a));
            angle = match turn {
                Turn::FromPrevious(_) => angle.plus(step),
                Turn::FromZero => step,
            };
            walker.body(block, Placed { orbit, angle })?;
        }
    }
    Ok(())
}
