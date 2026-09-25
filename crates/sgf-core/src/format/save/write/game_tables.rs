//! What the core copies from Stellaris 4.5's own files instead of reading them from the
//! install: the start event `game_start.50`'s nebula dressing (the calm cloud types each
//! star class weighs, the class A stars an Ocean Paradise flag gives `rare_nebula_1`, the
//! turbulent type each calm one pairs with, where a cloud stands beside its star, and the
//! DLC that brings cloaking), and the define `SPAWN_SYSTEM_BUFFER_DISTANCE`. A game update
//! that changes either needs these changed with it; `docs/game-data-notes.md` gives them
//! a section of their own.

/// How close the game lets a system it spawns stand to another
/// (`SPAWN_SYSTEM_BUFFER_DISTANCE`).
pub const SPAWN_BUFFER: f64 = 10.0;
pub(crate) const FIRST_CONTACT: &str = "First Contact Story Pack";
/// The star flag that makes `game_start.50` give an A-class star `rare_nebula_1`.
pub(crate) const OCEAN_PARADISE: &str = "ocean_paradise_nebula";
/// The star flag of an empire's home system, which the game never makes turbulent.
pub(crate) const HOME_SYSTEM: &str = "empire_home_system";
pub(crate) const TURBULENT_KINDS: [&str; 2] = ["turbulent_nebula_1", "turbulent_nebula_2"];
/// The star classes `game_start.50` gives `rare_nebula_1` when flagged Ocean Paradise.
pub(crate) const CLASS_A: [&str; 4] = ["sc_a", "sc_binary_1", "sc_binary_9", "sc_binary_10"];
/// The calm types `game_start.50` weighs for each star class, in its table's order.
pub(crate) const CALM_KINDS: &[(&[&str], &[&str])] = &[
    (
        &[
            "sc_b",
            "sc_binary_2",
            "sc_binary_5",
            "sc_trinary_2",
            "sc_trinary_4",
        ],
        &["nebula_3", "nebula_4", "rare_nebula_1"],
    ),
    (
        &["sc_a", "sc_binary_1", "sc_binary_9", "sc_binary_10"],
        &["nebula_3", "nebula_4", "rare_nebula_1", "rare_nebula_2"],
    ),
    (&["sc_f"], &["nebula_3", "nebula_4", "rare_nebula_1"]),
    (
        &["sc_g", "sc_binary_8", "sc_trinary_1"],
        &["nebula_1", "rare_nebula_2"],
    ),
    (
        &[
            "sc_k",
            "sc_binary_7",
            "sc_trinary_3",
            "sc_m",
            "sc_m_giant",
            "sc_binary_3",
            "sc_binary_4",
            "sc_binary_6",
        ],
        &["nebula_1", "nebula_2", "rare_nebula_2"],
    ),
    (&["sc_t"], &["nebula_3", "rare_nebula_1"]),
    (
        &["sc_black_hole"],
        &[
            "nebula_1",
            "nebula_2",
            "nebula_3",
            "nebula_4",
            "rare_nebula_1",
            "rare_nebula_2",
        ],
    ),
    (
        &["sc_neutron_star", "sc_pulsar"],
        &["nebula_3", "nebula_4", "rare_nebula_1", "rare_nebula_2"],
    ),
];
pub(crate) const EVERY_CALM_KIND: [&str; 6] = [
    "nebula_1",
    "nebula_2",
    "nebula_3",
    "nebula_4",
    "rare_nebula_1",
    "rare_nebula_2",
];

/// Whether `kind` is one of the cloud types `game_start.50` places.
pub(crate) fn is_cloud_kind(kind: &str) -> bool {
    EVERY_CALM_KIND.contains(&kind) || TURBULENT_KINDS.contains(&kind)
}

pub(crate) fn calm_kinds(class: &str) -> Option<&'static [&'static str]> {
    CALM_KINDS
        .iter()
        .find(|(classes, _)| classes.contains(&class))
        .map(|&(_, kinds)| kinds)
}

/// The turbulent type the star classes that roll a calm `kind` roll beside it.
pub(crate) fn turbulent_of(kind: &str) -> &'static str {
    match kind {
        "nebula_1" | "nebula_2" | "rare_nebula_2" => "turbulent_nebula_2",
        _ => "turbulent_nebula_1",
    }
}

/// The first calm type of the star class that turns into the turbulent `kind`, else the
/// class's first, else the first of any class that does.
pub(crate) fn calm_of(kind: &str, class: &str) -> &'static str {
    let kinds = calm_kinds(class).unwrap_or(&EVERY_CALM_KIND);
    kinds
        .iter()
        .chain(EVERY_CALM_KIND.iter())
        .copied()
        .find(|&calm| turbulent_of(calm) == kind)
        .unwrap_or(kinds[0])
}

/// Where `set_location = { distance = 0 angle = random }` puts a cloud beside a star of
/// `size` at `(x, y)`.
pub(crate) fn beside((x, y): (f64, f64), size: f64) -> (f64, f64) {
    let offset = 0.33 * size;
    (x + offset + 4.7, y + offset + 8.7)
}
