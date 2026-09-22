//! The empire counts a Paint a Galaxy header carries, sized by the seats the map holds
//! the way the app's `generate_galaxy_txt.ts` sizes them: `S` seats of which `R` are
//! reserved for one empire (a reserved letter or Sol) leave `S - R - 1` seats any
//! empire may take, the `1` the player's own seat, which is already among the `R`
//! when it is reserved; the defaults are shares of `S - 1`. The fallen empire counts
//! follow the zones the same way: one fallen empire per zone, up to the six kinds the
//! mod knows. The marauder counts follow the clan homes: each home spawns its clan, so
//! no more can appear than are placed.

use crate::keys::scenario as keys;
use crate::projections::galaxy::{Galaxy, PaintSpawnKind, SpawnScript, SystemNode};

/// The nine keys [`empire_counts`] writes, in the order it lists them.
pub const KEYS: [&str; 9] = [
    keys::NUM_EMPIRES,
    keys::NUM_EMPIRE_DEFAULT,
    keys::ADVANCED_EMPIRE_DEFAULT,
    keys::NOMAD_EMPIRE_DEFAULT,
    keys::NOMAD_EMPIRE_MAX,
    keys::FALLEN_EMPIRE_MAX,
    keys::FALLEN_EMPIRE_DEFAULT,
    keys::MARAUDER_EMPIRE_DEFAULT,
    keys::MARAUDER_EMPIRE_MAX,
];

/// The most fallen empires the mod can seat: it knows six kinds.
pub const MOST_FALLEN_EMPIRES: u32 = 6;

/// A map's seats, how many are reserved, and whether the player's seat is one of those.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SeatCounts {
    pub seats: u32,
    pub reserved: u32,
    /// The player's marker is on a Sol or reserved seat, so `reserved` already counts it.
    pub player_on_reserved: bool,
}

impl SeatCounts {
    /// `seats` seats with `scripts`: how many are reserved, and whether the player's is one.
    pub fn from_scripts<'a>(
        seats: u32,
        scripts: impl IntoIterator<Item = &'a SpawnScript>,
    ) -> Self {
        let mut reserved = 0;
        let mut player_on_reserved = false;
        for script in scripts {
            if is_reserved_script(script) {
                reserved += 1;
                player_on_reserved |= holds_player(script);
            }
        }
        Self {
            seats,
            reserved,
            player_on_reserved,
        }
    }

    /// The most empires the seats hold: all but the player's.
    pub fn most(self) -> u32 {
        self.seats.saturating_sub(1)
    }

    /// The seats any empire may take: less the reserved ones and the player's, counted once.
    pub fn safe(self) -> u32 {
        let player = if self.player_on_reserved { 0 } else { 1 };
        self.seats
            .saturating_sub(self.reserved)
            .saturating_sub(player)
    }
}

/// The header values for `seats`, `zones` fallen empire zones and `clans` marauder clan
/// homes, each as the raw text right of `=`.
pub fn empire_counts(seats: SeatCounts, zones: u32, clans: u32) -> Vec<(&'static str, String)> {
    let fallen = fallen_count(zones).to_string();
    let marauders = clans.to_string();
    let mut entries = seat_entries(seats);
    entries.push((keys::FALLEN_EMPIRE_MAX, fallen.clone()));
    entries.push((keys::FALLEN_EMPIRE_DEFAULT, fallen));
    entries.push((keys::MARAUDER_EMPIRE_DEFAULT, marauders.clone()));
    entries.push((keys::MARAUDER_EMPIRE_MAX, marauders));
    entries
}

/// The first five of [`KEYS`], the ones sized by the seats.
pub fn seat_entries(seats: SeatCounts) -> Vec<(&'static str, String)> {
    let most = seats.most();
    let safe = seats.safe();
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

/// The seats `galaxy` holds, the reserved ones and the player's among them.
pub fn seat_counts(galaxy: &Galaxy) -> SeatCounts {
    let seats = galaxy.systems.values().filter(|s| is_seat(s)).count();
    let scripts = galaxy
        .systems
        .values()
        .filter_map(|s| s.spawn_script.as_ref());
    SeatCounts::from_scripts(crate::as_u32(seats), scripts)
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
    /// `marauder_empire_max` is not the clan homes the map places (a clan spawns only
    /// from its home), or `marauder_empire_default` is more than the homes.
    Marauders { allowed: u32 },
}

/// The header's own counts as the file states them, checked against `seats`, `zones`
/// and `clans`; the seats are checked first, then the fallen empires, then the
/// marauders.
pub fn header_mismatch(
    galaxy: &Galaxy,
    seats: SeatCounts,
    zones: u32,
    clans: u32,
) -> Option<HeaderMismatch> {
    let most = seats.most();
    let safe = seats.safe();
    let count = |key| galaxy.header_count(key);
    let empires = match (
        galaxy.header_block_count(keys::NUM_EMPIRES, keys::MAX),
        count(keys::NUM_EMPIRE_DEFAULT),
    ) {
        (Some(max), _) if max != most => Some(max),
        (_, Some(default)) if default > safe => Some(default),
        _ => None,
    };
    if let Some(allowed) = empires {
        return Some(HeaderMismatch::Empires { allowed });
    }
    let fallen = match (
        count(keys::FALLEN_EMPIRE_MAX),
        count(keys::FALLEN_EMPIRE_DEFAULT),
    ) {
        (Some(max), _) if max != fallen_count(zones) => Some(max),
        (_, Some(default)) if default > zones => Some(default),
        _ => None,
    };
    if let Some(allowed) = fallen {
        return Some(HeaderMismatch::FallenEmpires { allowed });
    }
    let marauders = match (
        count(keys::MARAUDER_EMPIRE_MAX),
        count(keys::MARAUDER_EMPIRE_DEFAULT),
    ) {
        (Some(max), _) if max != clans => Some(max),
        (_, Some(default)) if default > clans => Some(default),
        _ => None,
    };
    marauders.map(|allowed| HeaderMismatch::Marauders { allowed })
}

/// A seat: a system with a scripted Paint a Galaxy seat or a positive plain weight.
pub fn is_seat(system: &SystemNode) -> bool {
    system.spawn_script.is_some() || system.spawn_weight.is_some_and(|w| w > 0.0)
}

/// A script seating one empire by trait: a reserved letter or Sol.
pub fn is_reserved_script(script: &SpawnScript) -> bool {
    matches!(
        script,
        SpawnScript::PaintAGalaxy {
            kind: PaintSpawnKind::Reserved(_) | PaintSpawnKind::Sol,
            ..
        }
    )
}

/// A script carrying the player's marker.
pub fn holds_player(script: &SpawnScript) -> bool {
    let SpawnScript::PaintAGalaxy { player, .. } = script;
    *player
}

/// `round(most / part)`, as the app sizes the advanced and nomad empires.
fn share(most: u32, part: u32) -> u32 {
    (f64::from(most) / f64::from(part)).round() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counts(seats: u32, reserved: u32, player_on_reserved: bool) -> SeatCounts {
        SeatCounts {
            seats,
            reserved,
            player_on_reserved,
        }
    }

    #[test]
    fn the_counts_follow_the_apps_formulas_and_never_go_below_zero() {
        let text = |seats, reserved, zones, clans| -> Vec<String> {
            empire_counts(counts(seats, reserved, false), zones, clans)
                .into_iter()
                .map(|(k, v)| format!("{k} = {v}"))
                .collect()
        };
        assert_eq!(
            text(17, 0, 3, 2),
            [
                "num_empires = { min = 0 max = 16 }",
                "num_empire_default = 8",
                "advanced_empire_default = 2",
                "nomad_empire_default = 2",
                "nomad_empire_max = 16",
                "fallen_empire_max = 3",
                "fallen_empire_default = 3",
                "marauder_empire_default = 2",
                "marauder_empire_max = 2",
            ]
        );
        assert_eq!(
            text(4, 2, 9, 3),
            [
                "num_empires = { min = 0 max = 3 }",
                "num_empire_default = 1",
                "advanced_empire_default = 0",
                "nomad_empire_default = 0",
                "nomad_empire_max = 3",
                "fallen_empire_max = 6",
                "fallen_empire_default = 6",
                "marauder_empire_default = 3",
                "marauder_empire_max = 3",
            ]
        );
        assert_eq!(
            text(0, 0, 0, 0),
            [
                "num_empires = { min = 0 max = 0 }",
                "num_empire_default = 0",
                "advanced_empire_default = 0",
                "nomad_empire_default = 0",
                "nomad_empire_max = 0",
                "fallen_empire_max = 0",
                "fallen_empire_default = 0",
                "marauder_empire_default = 0",
                "marauder_empire_max = 0",
            ]
        );
        assert_eq!(text(1, 5, 0, 0)[1], "num_empire_default = 0");
    }
}
