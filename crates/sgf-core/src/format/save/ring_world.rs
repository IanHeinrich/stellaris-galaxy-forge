//! Which save bodies and megastructure rows make up a ring world: vanilla's segment classes
//! and row types, with Gigastructural Engineering's larger rings, and the system flags each
//! size of ring leaves.

/// What the planet class of a ring world segment starts with: `pc_ringworld_*`, the damaged
/// ones included, and `pc_shattered_ring_habitable`.
pub const SEGMENT_CLASS_PREFIXES: [&str; 2] = ["pc_ringworld", "pc_shattered_ring"];

/// What the type of a ring world's megastructure row starts with: the base game's site,
/// frame sections and ruins, `ring_world_*`, and Gigastructural Engineering's larger rings'
/// stages and frame sections, `ringworld_*`.
pub const ROW_TYPE_PREFIXES: [&str; 2] = ["ring_world", "ringworld"];

/// How far from a ring's radius its segments and rows stand. The game spawns them up to 0.41
/// off, and Gigastructural Engineering's rings are 44 apart.
pub const RING_SLACK: f64 = 5.0;

/// The system flags a ring of one size leaves, and the radius its build chain spawns it at.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RingSize {
    pub radius: f64,
    pub flags: &'static [&'static str],
}

/// The base game's ring world, whose flags a ring of any radius not listed here takes.
pub const BASE_RING: RingSize = RingSize {
    radius: 45.0,
    flags: &[
        "ring_world_built",
        "ring_section_1",
        "ring_section_2",
        "ring_section_3",
    ],
};

/// Gigastructural Engineering's titanic, behemoth and gargantuan rings.
pub const LARGER_RINGS: [RingSize; 3] = [
    RingSize {
        radius: 90.0,
        flags: &["ring_world_built_one", "giga_has_titanic_ring"],
    },
    RingSize {
        radius: 134.0,
        flags: &["ring_world_built_two", "giga_has_behemoth_ring"],
    },
    RingSize {
        radius: 179.0,
        flags: &["ring_world_built_three", "giga_has_gargantuan_ring"],
    },
];

/// The size of the ring a segment or row `distance` from its system's centre is part of.
pub fn size_at(distance: f64) -> RingSize {
    LARGER_RINGS
        .into_iter()
        .find(|size| (distance - size.radius).abs() <= RING_SLACK)
        .unwrap_or(BASE_RING)
}

/// Whether a body of `class` is a ring world segment.
pub fn is_segment(class: &str) -> bool {
    SEGMENT_CLASS_PREFIXES
        .iter()
        .any(|prefix| class.starts_with(prefix))
}

/// Whether a megastructure row of type `kind` is part of a ring world.
pub fn is_ring_row(kind: &str) -> bool {
    ROW_TYPE_PREFIXES
        .iter()
        .any(|prefix| kind.starts_with(prefix))
}

/// Whether a segment or row at `at` from its system's centre is part of the ring of
/// `radius`; every ring's, without one.
pub fn on_ring((x, y): (f64, f64), radius: Option<f64>) -> bool {
    radius.is_none_or(|radius| (x.hypot(y) - radius).abs() <= RING_SLACK)
}
