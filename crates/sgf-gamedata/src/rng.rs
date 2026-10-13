//! The generator's random numbers: the core's SplitMix64 stream, so a seed means the same
//! system whatever crate versions build it.

use crate::install::script::Range;

pub use sgf_core::rng::Rng;

impl From<Range> for (f64, f64) {
    fn from(range: Range) -> Self {
        (range.min, range.max)
    }
}
