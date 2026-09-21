//! The empire counts a Paint a Galaxy header carries, sized by the seats the map holds
//! the way the app's `generate_galaxy_txt.ts` sizes them: `S` seats of which `R` are
//! reserved for one empire (a reserved letter or Sol) leave `S - R - 1` seats any
//! empire may take, and the defaults are shares of `S - 1`. The fallen empire counts
//! follow the zones the same way: one fallen empire per zone, up to the six kinds the
//! mod knows.

use crate::keys::scenario as keys;
use crate::projections::galaxy::{Galaxy, PaintSpawnKind, SpawnScript, SystemNode};

/// The seven keys [`empire_counts`] writes, in the order it lists them.
pub const KEYS: [&str; 7] = [
    keys::NUM_EMPIRES,
    keys::NUM_EMPIRE_DEFAULT,
    keys::ADVANCED_EMPIRE_DEFAULT,
    keys::NOMAD_EMPIRE_DEFAULT,
    keys::NOMAD_EMPIRE_MAX,
    keys::FALLEN_EMPIRE_MAX,
    keys::FALLEN_EMPIRE_DEFAULT,
];

/// The most fallen empires the mod can seat: it knows six kinds.
pub const MOST_FALLEN_EMPIRES: u32 = 6;

/// The header values for `seats` seats of which `reserved` are held for one empire
/// and `zones` fallen empire zones, each as the raw text right of `=`.
pub fn empire_counts(seats: u32, reserved: u32, zones: u32) -> Vec<(&'static str, String)> {
    let fallen = fallen_count(zones).to_string();
    let mut entries = seat_entries(seats, reserved);
    entries.push((keys::FALLEN_EMPIRE_MAX, fallen.clone()));
    entries.push((keys::FALLEN_EMPIRE_DEFAULT, fallen));
    entries
}

/// The first five of [`KEYS`], the ones sized by the seats.
pub fn seat_entries(seats: u32, reserved: u32) -> Vec<(&'static str, String)> {
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

/// How many fallen empires `zones` zones seat: one each, up to the kinds the mod knows.
pub fn fallen_count(zones: u32) -> u32 {
    zones.min(MOST_FALLEN_EMPIRES)
}

/// How many seats `galaxy` holds and how many of them are reserved.
pub fn seat_counts(galaxy: &Galaxy) -> (u32, u32) {
    let seats = galaxy.systems.values().filter(|s| is_seat(s)).count();
    let reserved = galaxy.systems.values().filter(|s| is_reserved(s)).count();
    (crate::as_u32(seats), crate::as_u32(reserved))
}

/// How many fallen empire zones `galaxy` holds, placed by hand or by the rule.
pub fn zone_count(galaxy: &Galaxy) -> u32 {
    let zones = galaxy
        .systems
        .values()
        .filter(|s| s.fe_zone.is_some())
        .count();
    crate::as_u32(zones)
}

/// A header count the map cannot honour, naming the value the file states.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HeaderMismatch {
    /// `num_empires.max` is not the seats less one, or `num_empire_default` is more
    /// than the seats any empire may take.
    Empires { allowed: u32 },
    /// `fallen_empire_max` is not the zones the mod can fill (it skips a fallen empire
    /// it finds no zone for, and seats at most six), or `fallen_empire_default` is more
    /// than the zones.
    FallenEmpires { allowed: u32 },
}

/// The header's own counts as the file states them, checked against `seats`,
/// `reserved` and `zones`; the seats are checked first.
pub fn header_mismatch(
    galaxy: &Galaxy,
    seats: u32,
    reserved: u32,
    zones: u32,
) -> Option<HeaderMismatch> {
    let most = seats.saturating_sub(1);
    let safe = seats.saturating_sub(reserved).saturating_sub(1);
    let empires = match (galaxy.num_empires_max, galaxy.num_empire_default) {
        (Some(max), _) if max != most => Some(max),
        (_, Some(default)) if default > safe => Some(default),
        _ => None,
    };
    if let Some(allowed) = empires {
        return Some(HeaderMismatch::Empires { allowed });
    }
    let fallen = match (galaxy.fallen_empire_max, galaxy.fallen_empire_default) {
        (Some(max), _) if max != fallen_count(zones) => Some(max),
        (_, Some(default)) if default > zones => Some(default),
        _ => None,
    };
    fallen.map(|allowed| HeaderMismatch::FallenEmpires { allowed })
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
        let text = |seats, reserved, zones| -> Vec<String> {
            empire_counts(seats, reserved, zones)
                .into_iter()
                .map(|(k, v)| format!("{k} = {v}"))
                .collect()
        };
        assert_eq!(
            text(17, 0, 3),
            [
                "num_empires = { min = 0 max = 16 }",
                "num_empire_default = 8",
                "advanced_empire_default = 2",
                "nomad_empire_default = 2",
                "nomad_empire_max = 16",
                "fallen_empire_max = 3",
                "fallen_empire_default = 3",
            ]
        );
        assert_eq!(
            text(4, 2, 9),
            [
                "num_empires = { min = 0 max = 3 }",
                "num_empire_default = 1",
                "advanced_empire_default = 0",
                "nomad_empire_default = 0",
                "nomad_empire_max = 3",
                "fallen_empire_max = 6",
                "fallen_empire_default = 6",
            ]
        );
        assert_eq!(
            text(0, 0, 0),
            [
                "num_empires = { min = 0 max = 0 }",
                "num_empire_default = 0",
                "advanced_empire_default = 0",
                "nomad_empire_default = 0",
                "nomad_empire_max = 0",
                "fallen_empire_max = 0",
                "fallen_empire_default = 0",
            ]
        );
        assert_eq!(text(1, 5, 0)[1], "num_empire_default = 0");
    }
}
