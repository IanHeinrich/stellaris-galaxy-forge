//! Validation rules over the galaxy projection. Cheap enough to run after every op.

use std::collections::HashSet;
use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::format::scenario::fe_zone;
use crate::ops::rules::fe_zone::label;
use crate::projections::galaxy::{GalaxyGraph, Nebula, SystemNode};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Error,
    Warning,
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Error => "error",
            Self::Warning => "warning",
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum IssueCode {
    LaneAsymmetric,
    LaneEndpointMissing,
    LaneSelf,
    LaneDuplicate,
    SystemIsolated,
    OutOfBounds,
    Disconnected,
    /// A nebula lists a system outside its radius, or covers one that no nebula lists.
    NebulaMembership,
    /// The scenario transforms its coordinates, so the map is not what the file says.
    CoordinateTransform,
    /// A scenario system writes an axis as a range the generator picks in; the map plots
    /// the midpoint and a move fixes the axis to a point.
    PositionRange,
    /// Bypasses the save had (wormhole pairs, gateways, L-Gates) that a scenario cannot
    /// state, so the export left them out.
    ExportDropped,
    /// An empire seat whose initializer is not one the generator seats any empire on,
    /// so it may only fit the empire that started there.
    HomeInitializer,
    /// A system stands in the ring of a Paint a Galaxy fallen empire zone, where the
    /// mod builds the fallen empire's systems at game start.
    FeZoneBlocked,
    /// Two fallen empire zones share space, so the mod cannot fill both.
    FeZoneOverlap,
    /// A fallen empire zone's centre lies beyond the canvas the mod paints on.
    FeZoneOffMap,
}

impl IssueCode {
    pub const fn severity(self) -> Severity {
        match self {
            Self::LaneAsymmetric | Self::LaneEndpointMissing | Self::LaneSelf => Severity::Error,
            // The game itself writes duplicate lane entries (708<->154, 401<->521 in the
            // sample), so a duplicate is a warning, not an error.
            Self::LaneDuplicate
            | Self::SystemIsolated
            | Self::OutOfBounds
            | Self::Disconnected
            | Self::NebulaMembership
            | Self::CoordinateTransform
            | Self::PositionRange
            | Self::ExportDropped
            | Self::HomeInitializer
            | Self::FeZoneBlocked
            | Self::FeZoneOverlap
            | Self::FeZoneOffMap => Severity::Warning,
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::LaneAsymmetric => "lane_asymmetric",
            Self::LaneEndpointMissing => "lane_endpoint_missing",
            Self::LaneSelf => "lane_self",
            Self::LaneDuplicate => "lane_duplicate",
            Self::SystemIsolated => "system_isolated",
            Self::OutOfBounds => "out_of_bounds",
            Self::Disconnected => "disconnected",
            Self::NebulaMembership => "nebula_membership",
            Self::CoordinateTransform => "coordinate_transform",
            Self::PositionRange => "position_range",
            Self::ExportDropped => "export_dropped",
            Self::HomeInitializer => "home_initializer",
            Self::FeZoneBlocked => "fe_zone_blocked",
            Self::FeZoneOverlap => "fe_zone_overlap",
            Self::FeZoneOffMap => "fe_zone_off_map",
        }
    }
}

impl fmt::Display for IssueCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Issue {
    pub severity: Severity,
    pub code: IssueCode,
    pub message: String,
    /// The systems involved, in the order the message names them.
    pub systems: Vec<u32>,
}

impl Issue {
    pub(crate) fn new(code: IssueCode, message: String, systems: Vec<u32>) -> Self {
        Self {
            severity: code.severity(),
            code,
            message,
            systems,
        }
    }
}

/// Check the graph; issues come back sorted by code then by the systems involved.
pub fn validate(g: &GalaxyGraph) -> Vec<Issue> {
    let mut issues = Vec::new();
    for system in g.systems.values() {
        let a = system.id;
        let mut seen: HashSet<u32> = HashSet::with_capacity(system.lanes.len());
        for lane in &system.lanes {
            let b = lane.to;
            if !seen.insert(b) {
                issues.push(Issue::new(
                    IssueCode::LaneDuplicate,
                    format!("system {a} lists a lane to {b} more than once"),
                    vec![a, b],
                ));
                continue;
            }
            if b == a {
                issues.push(Issue::new(
                    IssueCode::LaneSelf,
                    format!("system {a} has a lane to itself"),
                    vec![a],
                ));
                continue;
            }
            if !g.systems.contains_key(&b) {
                issues.push(Issue::new(
                    IssueCode::LaneEndpointMissing,
                    format!("system {a} has a lane to {b}, which does not exist"),
                    vec![a, b],
                ));
                continue;
            }
            if g.lane(b, a).is_none() {
                issues.push(Issue::new(
                    IssueCode::LaneAsymmetric,
                    format!("system {a} lists a lane to {b} but {b} does not list {a}"),
                    vec![a, b],
                ));
            }
        }
        if system.lanes.is_empty() {
            issues.push(Issue::new(
                IssueCode::SystemIsolated,
                format!("system {a} has no hyperlanes"),
                vec![a],
            ));
        }
        if system.position_range {
            issues.push(Issue::new(
                IssueCode::PositionRange,
                format!("system {a} position was a range and will be fixed on move"),
                vec![a],
            ));
        }
        let distance = system.x.hypot(system.y);
        if distance > g.galaxy_radius {
            issues.push(Issue::new(
                IssueCode::OutOfBounds,
                format!(
                    "system {a} is {distance:.2} from the centre, beyond the galaxy radius {:.2}",
                    g.galaxy_radius
                ),
                vec![a],
            ));
        }
    }

    for system in g.systems.values() {
        let distance = |n: &Nebula| (system.x - n.x).hypot(system.y - n.y);
        match system.nebula.and_then(|i| g.nebulae.get(i)) {
            Some(nebula) => {
                let d = distance(nebula);
                if d > nebula.radius {
                    issues.push(Issue::new(
                        IssueCode::NebulaMembership,
                        format!(
                            "system {} ({}) is listed in nebula {} but lies {d:.2} from its centre, beyond its radius {}",
                            system.id,
                            system.display_name(),
                            nebula.display_name(),
                            nebula.radius
                        ),
                        vec![system.id],
                    ));
                }
            }
            None => {
                if let Some(nebula) = g.nebulae.iter().find(|n| distance(n) <= n.radius) {
                    issues.push(Issue::new(
                        IssueCode::NebulaMembership,
                        format!(
                            "system {} ({}) lies {:.2} from the centre of nebula {} (radius {}) but no nebula lists it",
                            system.id,
                            system.display_name(),
                            distance(nebula),
                            nebula.display_name(),
                            nebula.radius
                        ),
                        vec![system.id],
                    ));
                }
            }
        }
    }

    fe_zones(g, &mut issues);

    let components = g.components();
    if components.len() > g.baseline_components {
        let systems = g.separated_systems(&components);
        issues.push(Issue::new(
            IssueCode::Disconnected,
            format!(
                "galaxy has {} components, {} at load; newly separated: {}",
                components.len(),
                g.baseline_components,
                ids(&systems)
            ),
            systems,
        ));
    }

    sort(&mut issues);
    issues
}

/// Every fallen empire zone's ring must hold no system, its centre must lie on the map
/// and no two rings may share space. A save's systems anchor no zone, so this finds
/// nothing there.
fn fe_zones(g: &GalaxyGraph, issues: &mut Vec<Issue>) {
    let mut anchors: Vec<(&SystemNode, (f64, f64), bool)> = g
        .systems
        .values()
        .filter_map(|system| {
            let zone = system.fe_zone.as_ref()?;
            let centre = fe_zone::centre((system.x, system.y), zone);
            Some((system, centre, !zone.preferred))
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
        if fe_zone::is_off_map(centre) {
            issues.push(Issue::new(
                IssueCode::FeZoneOffMap,
                format!("Fallen empire zone from {} is off the map.", label(anchor)),
                vec![anchor.id],
            ));
        }
        for blocker in g.systems.values() {
            if blocker.id != anchor.id && fe_zone::inside(centre, (blocker.x, blocker.y)) {
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

/// By code, then by the systems involved: the order every issue list is reported in.
pub fn sort(issues: &mut [Issue]) {
    issues.sort_by(|x, y| x.code.cmp(&y.code).then_with(|| x.systems.cmp(&y.systems)));
}

fn ids(systems: &[u32]) -> String {
    systems
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(", ")
}
