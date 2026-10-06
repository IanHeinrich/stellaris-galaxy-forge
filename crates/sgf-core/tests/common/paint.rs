//! What every Paint a Galaxy export of a save must hold to, for the sample and the
//! corpus alike, and the scripted spawns and zones the scenario tests write.
use std::collections::{BTreeMap, BTreeSet};

use sgf_core::export::policy::is_generic_home;
use sgf_core::export::{ExportReport, ScenarioProfile};
use sgf_core::format::scenario::fe_zone::{FeDirection, FeKind, FeZone};
use sgf_core::ops::Op;
use sgf_core::projections::galaxy::{Galaxy, GalaxyGraph, PaintSpawnKind, SpawnScript};
use sgf_core::session::Session;
use sgf_core::validate::IssueCode;

use super::fixture::PAINTED;

/// The ids of the save that the export holds no longer, ascending.
pub fn left_out(save: &Galaxy, written: &Galaxy) -> BTreeSet<u32> {
    save.systems
        .keys()
        .filter(|id| !written.systems.contains_key(id))
        .copied()
        .collect()
}

/// What every Paint a Galaxy export of a save must hold to: nothing missing but what the
/// report says was left out, every lane between held systems, seats on generic starts,
/// zones the validator accepts, every custom connection linked both ways and a header
/// the seats and zones bear out. Returns the typed zones, keyed by anchor.
pub fn assert_paint_export_holds_together(
    save: &Galaxy,
    graph: &GalaxyGraph,
    report: &ExportReport,
) -> BTreeMap<u32, FeZone> {
    let written: &Galaxy = graph;
    let omitted: u32 = report.omitted.iter().map(|c| c.systems).sum();
    let clusters: u32 = report
        .fallen_empires
        .iter()
        .map(|f| f.systems_left_out)
        .sum();
    let missing = left_out(save, written);
    assert_eq!(missing.len() as u32, omitted + clusters, "{missing:?}");
    let mut ids: Vec<u32> = written.order.clone();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(ids.len(), written.order.len(), "ids repeat");
    assert_eq!(ids.len(), written.systems.len());
    for system in written.systems.values() {
        for lane in &system.lanes {
            assert!(
                written.systems.contains_key(&lane.to),
                "{} has a lane to {}, which the export does not hold",
                system.id,
                lane.to
            );
        }
        if let Some(script) = &system.spawn_script {
            let listed = report
                .home_initializers
                .iter()
                .any(|h| h.system == system.id && !h.replaced);
            assert!(
                is_generic_home(ScenarioProfile::PaintAGalaxy, &system.initializer) || listed,
                "{}: {script:?} on {}",
                system.id,
                system.initializer
            );
        }
    }
    let issues = sgf_core::validate::validate(graph);
    for issue in &issues {
        assert!(
            !matches!(
                issue.code,
                IssueCode::FeZoneBlocked
                    | IssueCode::FeZoneOverlap
                    | IssueCode::FeZoneOffMap
                    | IssueCode::FeLinkIsolated
                    | IssueCode::FeLinkDangling
                    | IssueCode::FeLinkShared
                    | IssueCode::HeaderEmpireCount
            ),
            "{issue:?}"
        );
    }
    let mut takers: BTreeMap<u8, Vec<u32>> = BTreeMap::new();
    for system in written.systems.values() {
        if system.fe_link.custom {
            let id = system
                .fe_link
                .id
                .expect("an anchor taking connections has an id");
            takers.entry(id).or_default().push(system.id);
            assert!(
                written
                    .systems
                    .values()
                    .any(|other| other.fe_link.to.contains(&id)),
                "{} takes connections nobody links to",
                system.id
            );
        }
        for n in &system.fe_link.to {
            let anchors: Vec<u32> = written
                .systems
                .values()
                .filter(|other| other.fe_link.custom && other.fe_link.id == Some(*n))
                .map(|other| other.id)
                .collect();
            assert_eq!(anchors.len(), 1, "{} links to {n}: {anchors:?}", system.id);
        }
    }
    assert!(
        takers.values().all(|anchors| anchors.len() == 1),
        "{takers:?}"
    );
    let zones = written
        .systems
        .values()
        .filter(|s| s.fe_zone.is_some())
        .count() as u32;
    let fallen_max = written
        .header_count("fallen_empire_max")
        .expect("fallen_empire_max");
    let fallen_default = written
        .header_count("fallen_empire_default")
        .expect("fallen_empire_default");
    assert!(
        fallen_default <= fallen_max && fallen_max <= zones,
        "{fallen_default} <= {fallen_max} <= {zones}"
    );
    let mut typed = BTreeMap::new();
    for fallen in &report.fallen_empires {
        let Some(anchor) = fallen.anchor else {
            continue;
        };
        let zone = written.systems[&anchor]
            .fe_zone
            .clone()
            .expect("the anchor carries its zone");
        assert_eq!(zone.kind, fallen.kind, "{anchor}");
        assert!(zone.preferred && !zone.fallback, "{anchor}: {zone:?}");
        typed.insert(anchor, zone);
    }
    assert_eq!(
        typed.len() as u32 + report.fallen_empire_zones,
        zones,
        "the zones are the typed ones and the ones the rule placed"
    );
    typed
}

/// The flag a painted scenario sets on a fallen empire's preferred zone.
pub const PREFERRED_FLAG: &str = " set_star_flag = painted_galaxy_fe_spawn_preferred";

/// A Paint a Galaxy spawn of `kind`, nobody's seat.
pub fn script(kind: PaintSpawnKind, random_value: u8) -> Option<SpawnScript> {
    Some(SpawnScript::PaintAGalaxy {
        kind,
        random_value,
        player: false,
    })
}

/// The 1st Player spawn as the player's seat.
pub fn player(random_value: u8) -> Option<SpawnScript> {
    seat(PaintSpawnKind::Preferred, random_value)
}

/// A Paint a Galaxy spawn of `kind` as the player's seat.
pub fn seat(kind: PaintSpawnKind, random_value: u8) -> Option<SpawnScript> {
    Some(SpawnScript::PaintAGalaxy {
        kind,
        random_value,
        player: true,
    })
}

pub fn reserved(letter: &str) -> PaintSpawnKind {
    PaintSpawnKind::Reserved(letter.to_owned())
}

pub fn set(id: u32, script: Option<SpawnScript>) -> Op {
    Op::SetSpawnScript { system: id, script }
}

/// The fixture with system 9's zone made automatic: its `preferred` flag dropped.
pub fn open_with_automatic_9() -> Session {
    let session = PAINTED.open_edited(&[(PREFERRED_FLAG, "")]);
    assert!(
        !session.graph().systems[&9]
            .fe_zone
            .as_ref()
            .unwrap()
            .preferred
    );
    session
}

pub fn zone(direction: FeDirection, kind: FeKind, distance: u16, preferred: bool) -> FeZone {
    FeZone {
        direction,
        kind,
        distance,
        preferred,
        fallback: false,
    }
}

pub fn automatic(direction: FeDirection) -> FeZone {
    zone(direction, FeKind::Random, 40, false)
}
