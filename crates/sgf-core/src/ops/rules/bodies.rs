//! Where a system's planets and moons stand about their parents, and how close two of them
//! may stand before they count as one place.

/// The orbit of a planet's first moon, the one the game writes for most moons.
pub const MOON_RING_FIRST: f64 = 15.0;

/// How much further out each moon ring after the first lies.
pub const MOON_RING_STEP: f64 = 5.0;

/// How near, in units of radius and in degrees, two bodies about one parent stand before
/// they overlap.
pub const OVERLAP_TOLERANCE: f64 = 0.5;

/// How far from its belt's radius an asteroid of that belt may lie: the game scatters them,
/// so two asteroids of one belt that stand together do not overlap.
pub const BELT_SCATTER: f64 = 10.0;
