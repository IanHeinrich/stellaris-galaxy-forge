//! The empire counts a Paint a Galaxy header carries, sized by the seats the map holds
//! the way the app's `generate_galaxy_txt.ts` sizes them: `S` seats of which `R` are
//! reserved for one empire (a reserved letter or Sol) leave `S - R - 1` seats any
//! empire may take, and the defaults are shares of `S - 1`.

use crate::keys::scenario as keys;
use crate::projections::galaxy::{Galaxy, PaintSpawnKind, SpawnScript, SystemNode};

/// The five keys [`empire_counts`] writes, in the order the header lists them.
pub const KEYS: [&str; 5] = [
    keys::NUM_EMPIRES,
    keys::NUM_EMPIRE_DEFAULT,
    keys::ADVANCED_EMPIRE_DEFAULT,
    keys::NOMAD_EMPIRE_DEFAULT,
    keys::NOMAD_EMPIRE_MAX,
];

/// The header values for `seats` seats of which `reserved` are held for one empire,
/// each as the raw text right of `=`.
pub fn empire_counts(seats: u32, reserved: u32) -> Vec<(&'static str, String)> {
    let most = seats.saturating_sub(1);
    let safe = seats.saturating_sub(reserved).saturating_sub(1);
    vec![
        (keys::NUM_EMPIRES, format!("{{ min = 0 max = {most} }}")),
        (
            keys::NUM_EMPIRE_DEFAULT,
            safe.min(share(most, 2)).to_string(),
        ),
        (keys::ADVANCED_EMPIRE_DEFAULT, share(most, 8).to_string()),
        (keys::NOMAD_EMPIRE_DEFAULT, share(most, 10).to_string()),
        (keys::NOMAD_EMPIRE_MAX, most.to_string()),
    ]
}

/// How many seats `galaxy` holds and how many of them are reserved.
pub fn seat_counts(galaxy: &Galaxy) -> (u32, u32) {
    let seats = galaxy.systems.values().filter(|s| is_seat(s)).count();
    let reserved = galaxy.systems.values().filter(|s| is_reserved(s)).count();
    (crate::as_u32(seats), crate::as_u32(reserved))
}

/// The header's own count of the seats it allows: `num_empires.max` and
/// `num_empire_default` as the file states them, checked against `seats` and
/// `reserved`. `Some(allowed)` names the failing value when either is off.
pub fn header_mismatch(galaxy: &Galaxy, seats: u32, reserved: u32) -> Option<u32> {
    let most = seats.saturating_sub(1);
    let safe = seats.saturating_sub(reserved).saturating_sub(1);
    match (galaxy.num_empires_max, galaxy.num_empire_default) {
        (Some(max), _) if max != most => Some(max),
        (_, Some(default)) if default > safe => Some(default),
        _ => None,
    }
}

/// A seat: a system with a scripted Paint a Galaxy seat or a positive plain weight.
pub fn is_seat(system: &SystemNode) -> bool {
    system.spawn_script.is_some() || system.spawn_weight.is_some_and(|w| w > 0.0)
}

/// A seat one empire holds by trait: a reserved letter or Sol.
pub fn is_reserved(system: &SystemNode) -> bool {
    matches!(
        system.spawn_script,
        Some(SpawnScript::PaintAGalaxy {
            kind: PaintSpawnKind::Reserved(_) | PaintSpawnKind::Sol,
            ..
        })
    )
}

/// `round(most / part)`, as the app sizes the advanced and nomad empires.
fn share(most: u32, part: u32) -> u32 {
    (f64::from(most) / f64::from(part)).round() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_counts_follow_the_apps_formulas_and_never_go_below_zero() {
        let text = |seats, reserved| -> Vec<String> {
            empire_counts(seats, reserved)
                .into_iter()
                .map(|(k, v)| format!("{k} = {v}"))
                .collect()
        };
        assert_eq!(
            text(17, 0),
            [
                "num_empires = { min = 0 max = 16 }",
                "num_empire_default = 8",
                "advanced_empire_default = 2",
                "nomad_empire_default = 2",
                "nomad_empire_max = 16",
            ]
        );
        assert_eq!(
            text(4, 2),
            [
                "num_empires = { min = 0 max = 3 }",
                "num_empire_default = 1",
                "advanced_empire_default = 0",
                "nomad_empire_default = 0",
                "nomad_empire_max = 3",
            ]
        );
        assert_eq!(
            text(0, 0),
            [
                "num_empires = { min = 0 max = 0 }",
                "num_empire_default = 0",
                "advanced_empire_default = 0",
                "nomad_empire_default = 0",
                "nomad_empire_max = 0",
            ]
        );
        assert_eq!(text(1, 5)[1], "num_empire_default = 0");
    }
}
