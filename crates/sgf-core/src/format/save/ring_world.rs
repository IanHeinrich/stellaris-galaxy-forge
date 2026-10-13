//! Which save bodies and megastructure rows make up a ring world: rows as the loaded install
//! says, and by their keys without it. And the base game's ring, whose flags a ring world
//! delete clears when the install has not said which flags each ring leaves.

use std::collections::BTreeMap;

/// What the planet class of a ring world segment starts with: `pc_ringworld_*`, the damaged
/// ones included, and `pc_shattered_ring_habitable`.
pub const SEGMENT_CLASS_PREFIXES: [&str; 2] = ["pc_ringworld", "pc_shattered_ring"];

/// What the type of a ring world's megastructure row starts with, for a type the loaded
/// install does not define: the base game's site, frame sections and ruins, `ring_world_*`,
/// and the larger rings' stages and frame sections a mod names `ringworld_*`.
pub const ROW_TYPE_PREFIXES: [&str; 2] = ["ring_world", "ringworld"];

/// How far from a ring's radius its segments and rows stand. The game spawns them up to 0.41
/// off, and the larger rings a mod adds stand 44 apart.
pub const RING_SLACK: f64 = 5.0;

/// The base game's ring world: the radius its chain lays its sections out at, and the
/// system flags it leaves.
pub const BASE_RING: (f64, [&str; 4]) = (
    45.0,
    [
        "ring_world_built",
        "ring_section_1",
        "ring_section_2",
        "ring_section_3",
    ],
);

/// Whether a body of `class` is a ring world segment.
pub fn is_segment(class: &str) -> bool {
    SEGMENT_CLASS_PREFIXES
        .iter()
        .any(|prefix| class.starts_with(prefix))
}

/// What the loaded install says of megastructure types: each type it defines, with whether
/// it is part of a ring world. Empty without an install.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RingWorldTypes(BTreeMap<String, bool>);

impl RingWorldTypes {
    /// The install's types, each with whether it is part of a ring world.
    pub fn new(types: impl IntoIterator<Item = (String, bool)>) -> Self {
        Self(types.into_iter().collect())
    }

    /// Whether a megastructure row of type `kind` is part of a ring world: as the install
    /// says for a type it defines, by the type's key otherwise.
    pub fn is_ring_row(&self, kind: &str) -> bool {
        self.0
            .get(kind)
            .copied()
            .unwrap_or_else(|| ring_row_by_key(kind))
    }
}

fn ring_row_by_key(kind: &str) -> bool {
    ROW_TYPE_PREFIXES
        .iter()
        .any(|prefix| kind.starts_with(prefix))
}

/// Whether a segment or row at `at` from its system's centre is part of the ring of
/// `radius`; every ring's, without one.
pub fn on_ring((x, y): (f64, f64), radius: Option<f64>) -> bool {
    radius.is_none_or(|radius| (x.hypot(y) - radius).abs() <= RING_SLACK)
}
