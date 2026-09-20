//! Validation rules over the galaxy projection. Cheap enough to run after every op.

use std::collections::HashSet;
use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::projections::galaxy::{GalaxyGraph, Nebula};

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
            | Self::PositionRange => Severity::Warning,
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
