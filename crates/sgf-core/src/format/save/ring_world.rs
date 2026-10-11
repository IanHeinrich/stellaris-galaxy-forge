//! Which save bodies and megastructure rows make up a ring world: vanilla's segment classes
//! and row types, to which Gigastructural Engineering's rings are added here.

/// What the planet class of a ring world segment starts with: `pc_ringworld_*`, the damaged
/// ones included, and `pc_shattered_ring_habitable`.
pub const SEGMENT_CLASS_PREFIXES: [&str; 2] = ["pc_ringworld", "pc_shattered_ring"];

/// What the type of a ring world's megastructure row starts with: the site, a frame's
/// sections and a ruined section.
pub const ROW_TYPE_PREFIX: &str = "ring_world";

/// How far from a ring's radius its segments and rows stand. The game spawns them up to 0.41
/// off, and Gigastructural Engineering's rings are 44 apart.
pub const RING_SLACK: f64 = 5.0;

/// Whether a body of `class` is a ring world segment.
pub fn is_segment(class: &str) -> bool {
    SEGMENT_CLASS_PREFIXES
        .iter()
        .any(|prefix| class.starts_with(prefix))
}

/// Whether a megastructure row of type `kind` is part of a ring world.
pub fn is_ring_row(kind: &str) -> bool {
    kind.starts_with(ROW_TYPE_PREFIX)
}

/// Whether a segment or row at `at` from its system's centre is part of the ring of
/// `radius`; every ring's, without one.
pub fn on_ring((x, y): (f64, f64), radius: Option<f64>) -> bool {
    radius.is_none_or(|radius| (x.hypot(y) - radius).abs() <= RING_SLACK)
}
