//! The checks on what Paint a Galaxy reads: its fallen empire zones, its seats and the
//! custom connections between them.

use std::collections::BTreeMap;

use super::{Issue, IssueCode, listed};
use crate::format::scenario::fe_link::LINK_REACH;
use crate::format::scenario::fe_zone;
use crate::format::scenario::header_counts::{
    HeaderMismatch, header_mismatch, is_seat, seat_counts, zone_count,
};
use crate::format::scenario::marauder;
use crate::format::scenario::paint::SOL_INITIALIZER;
use crate::ops::rules::fe_zone::label;
use crate::projections::galaxy::{GalaxyGraph, PaintSpawnKind, SpawnScript, SystemNode};

/// Every fallen empire zone's ring must hold no system, its centre must lie on the map
/// and no two rings may share space. A save's systems anchor no zone, so this finds
/// nothing there.
pub(super) fn fe_zones(g: &GalaxyGraph, issues: &mut Vec<Issue>) {
    let mut anchors: Vec<(&SystemNode, (f64, f64), bool)> = g
        .systems
        .values()
        .filter_map(|system| {
            let zone = system.fe_zone.as_ref()?;
            let centre = fe_zone::centre((system.x, system.y), zone);
            Some((system, centre, !zone.preferred && !system.fe_link.custom))
        })
        .collect();
    anchors.sort_unstable_by_key(|(anchor, _, _)| anchor.id);
    let recompute = |automatic: bool| {
        if automatic {
            " Recompute automatic zones to clear it."
        } else {
            ""
        }
    };
    for (i, &(anchor, centre, automatic)) in anchors.iter().enumerate() {
        let obstacles = fe_zone::obstacles(g, anchor.id, centre);
        if obstacles.off_map {
            issues.push(Issue::new(
                IssueCode::FeZoneOffMap,
                format!("Fallen empire zone from {} is off the map.", label(anchor)),
                vec![anchor.id],
            ));
        }
        for blocker in obstacles.blockers {
            issues.push(Issue::new(
                IssueCode::FeZoneBlocked,
                format!(
                    "Fallen empire zone from {} is blocked by {}: the mod needs the ring empty.{}",
                    label(anchor),
                    label(blocker),
                    recompute(automatic)
                ),
                vec![anchor.id, blocker.id],
            ));
        }
        for &(other, other_centre, other_automatic) in &anchors[i + 1..] {
            if fe_zone::overlaps(centre, other_centre) {
                issues.push(Issue::new(
                    IssueCode::FeZoneOverlap,
                    format!(
                        "Fallen empire zones from {} and {} overlap: the mod cannot fill both.{}",
                        label(anchor),
                        label(other),
                        recompute(automatic || other_automatic)
                    ),
                    vec![anchor.id, other.id],
                ));
            }
        }
    }
}

/// What Paint a Galaxy's seats say against each other and against the header: the
/// header's counts must fit the seats, one letter and Sol reserve one seat each, the
/// player's marker is on one seat, and a Sol seat and the Sol initializer go together.
/// A map with no scripted seat is not the mod's, so none of this applies to it.
pub(super) fn seats(g: &GalaxyGraph, issues: &mut Vec<Issue>) {
    let mut seated: Vec<&SystemNode> = g
        .systems
        .values()
        .filter(|system| system.spawn_script.is_some())
        .collect();
    if seated.is_empty() {
        return;
    }
    seated.sort_unstable_by_key(|system| system.id);
    let seats = seat_counts(g);
    let zones = zone_count(g);
    let clans = marauder::clan_count(g);
    let message = header_mismatch(g, seats, zones, clans).map(|mismatch| match mismatch {
        HeaderMismatch::Empires { allowed } => format!(
            "Header allows {allowed} empires but the file has {} seats. Update the empire counts.",
            seats.seats
        ),
            HeaderMismatch::FallenEmpires { allowed } => format!(
                "Header allows {allowed} fallen empires but the map has {zones} fallen empire zones. Update the empire counts."
            ),
            HeaderMismatch::Marauders { allowed } => format!(
                "Header allows {allowed} marauder clans but the map has {clans} clan homes. Update the empire counts."
            ),
        });
    if let Some(message) = message {
        issues.push(Issue::new(
            IssueCode::HeaderEmpireCount,
            message,
            Vec::new(),
        ));
    }
    let mut holders: BTreeMap<String, Vec<u32>> = BTreeMap::new();
    let mut players = Vec::new();
    for system in &seated {
        let Some(SpawnScript::PaintAGalaxy { kind, player, .. }) = &system.spawn_script else {
            continue;
        };
        match kind {
            PaintSpawnKind::Reserved(letter) => {
                holders.entry(letter.clone()).or_default().push(system.id);
            }
            PaintSpawnKind::Sol => holders.entry("Sol".to_owned()).or_default().push(system.id),
            PaintSpawnKind::Enabled | PaintSpawnKind::Preferred => {}
        }
        if *player {
            players.push(system.id);
        }
        if matches!(kind, PaintSpawnKind::Sol) && system.initializer == SOL_INITIALIZER {
            issues.push(Issue::new(
                IssueCode::SolSeatMismatch,
                format!(
                    "{} has a Sol seat and the Sol initializer: the game will not seat the United Nations of Earth on a seat naming its own initializer. Give it a generic start.",
                    label(system)
                ),
                vec![system.id],
            ));
        }
    }
    for (letter, systems) in holders {
        if systems.len() < 2 {
            continue;
        }
        issues.push(Issue::new(
            IssueCode::SeatLetterDuplicate,
            format!(
                "Reserved {} is on {} systems: only one empire holds the trait.",
                letter.to_uppercase(),
                systems.len()
            ),
            systems,
        ));
    }
    if players.len() > 1 {
        issues.push(Issue::new(
            IssueCode::PlayerSeatDuplicate,
            format!(
                "The player's seat is on {} systems: the player starts on only one.",
                players.len()
            ),
            players,
        ));
    }
    marauders_near_seats(g, issues);
}

/// Every marauder clan home standing within reach of a seat, which its raids hit first.
fn marauders_near_seats(g: &GalaxyGraph, issues: &mut Vec<Issue>) {
    let mut seats: Vec<&SystemNode> = g.systems.values().filter(|s| is_seat(s)).collect();
    seats.sort_unstable_by_key(|seat| seat.id);
    for (clan, homes) in marauder::homes(g) {
        for id in homes {
            let Some(home) = g.systems.get(&id) else {
                continue;
            };
            for seat in &seats {
                if seat.id != home.id && marauder::near_seat((home.x, home.y), (seat.x, seat.y)) {
                    issues.push(Issue::new(
                        IssueCode::MarauderNearSeat,
                        format!(
                            "Marauder clan {clan}'s home is within {} of the seat {}. Raids hit that empire first.",
                            marauder::SEAT_CLEARANCE,
                            label(seat)
                        ),
                        vec![home.id, seat.id],
                    ));
                }
            }
        }
    }
}

/// A painted scenario with systems but no automatic zones leaves the game only the rings
/// placed by hand, however many fallen empires it was asked for.
pub(super) fn automatic_zones(g: &GalaxyGraph, issues: &mut Vec<Issue>) {
    let painted = g
        .systems
        .values()
        .any(|system| system.spawn_script.is_some() || system.fe_zone.is_some());
    let zoned = g.systems.values().any(|system| system.fe_zone.is_some());
    if painted && !zoned {
        issues.push(Issue::new(
            IssueCode::FeZoneNoAutomatic,
            "No fallen empire zones. Fit some so the game has rings to choose from.".to_owned(),
            Vec::new(),
        ));
    }
}

/// What the custom connections say against the zones: an anchor that takes them needs
/// an id some system links to, a link needs an anchor that takes its id, one id goes
/// to one anchor, and a link from beyond the mod's own reach is worth a look.
pub(super) fn fe_links(g: &GalaxyGraph, issues: &mut Vec<Issue>) {
    let mut systems: Vec<&SystemNode> = g.systems.values().collect();
    systems.sort_unstable_by_key(|system| system.id);
    let mut takers: BTreeMap<u8, Vec<&SystemNode>> = BTreeMap::new();
    for system in &systems {
        if system.fe_link.custom
            && system.fe_zone.is_some()
            && let Some(n) = system.fe_link.id
        {
            takers.entry(n).or_default().push(system);
        }
    }
    for anchor in systems.iter().filter(|system| system.fe_link.custom) {
        if anchor.fe_zone.is_none() {
            issues.push(Issue::new(
                IssueCode::FeLinkIsolated,
                format!(
                    "{} takes custom connections but anchors no fallen empire zone.",
                    label(anchor)
                ),
                vec![anchor.id],
            ));
            continue;
        }
        let linked = anchor
            .fe_link
            .id
            .is_some_and(|n| systems.iter().any(|system| system.fe_link.to.contains(&n)));
        if !linked {
            issues.push(Issue::new(
                IssueCode::FeLinkIsolated,
                format!(
                    "{} takes custom connections for its fallen empire zone but no system links to it. The mod will lay no hyperlanes to the fallen empire.",
                    label(anchor)
                ),
                vec![anchor.id],
            ));
        }
    }
    for (n, anchors) in takers.iter().filter(|(_, anchors)| anchors.len() > 1) {
        for anchor in anchors {
            let others: Vec<&&SystemNode> = anchors
                .iter()
                .filter(|other| other.id != anchor.id)
                .collect();
            let names: Vec<String> = others.iter().map(|other| label(other)).collect();
            let mut involved = vec![anchor.id];
            involved.extend(others.iter().map(|other| other.id));
            issues.push(Issue::new(
                IssueCode::FeLinkShared,
                format!(
                    "{} shares fallen empire connection {n} with {}. The systems linked to it join both fallen empires.",
                    label(anchor),
                    listed(&names)
                ),
                involved,
            ));
        }
    }
    for system in &systems {
        for n in &system.fe_link.to {
            let Some(anchors) = takers.get(n) else {
                issues.push(Issue::new(
                    IssueCode::FeLinkDangling,
                    format!(
                        "{} links to fallen empire connection {n}, which no zone takes.",
                        label(system)
                    ),
                    vec![system.id],
                ));
                continue;
            };
            for anchor in anchors {
                let zone = anchor.fe_zone.as_ref().expect("a taker anchors a zone");
                let centre = fe_zone::centre((anchor.x, anchor.y), zone);
                let d = fe_zone::distance(centre, (system.x, system.y));
                if d > LINK_REACH {
                    issues.push(Issue::new(
                        IssueCode::FeLinkFar,
                        format!(
                            "{} is {d:.0} from the fallen empire zone it links to. The mod lays the hyperlane anyway.",
                            label(system)
                        ),
                        vec![system.id, anchor.id],
                    ));
                }
            }
        }
    }
}
