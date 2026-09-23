//! Validation rules over the galaxy projection. Cheap enough to run after every op.

mod paint;
mod scenario;

use std::collections::{BTreeMap, HashSet};
use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::projections::galaxy::{BypassLink, GalaxyGraph, Nebula};
use crate::views::DocumentKind;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Error,
    Warning,
    /// Worth a look, not a fault: the file works as it stands.
    Info,
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Error => "error",
            Self::Warning => "warning",
            Self::Info => "info",
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
    /// A Paint a Galaxy scenario carries no automatic fallen empire zones, so the game
    /// has only the placed rings to choose from.
    FeZoneNoAutomatic,
    /// A zone anchor takes custom connections but no system links to it, or it anchors
    /// no zone, so the mod lays no hyperlane to the fallen empire.
    FeLinkIsolated,
    /// A system links to a fallen empire connection id no zone anchor takes.
    FeLinkDangling,
    /// Two or more zone anchors take custom connections under one id.
    FeLinkShared,
    /// A system links to a fallen empire zone from farther than the mod's own rule
    /// reaches; the mod lays the hyperlane anyway.
    FeLinkFar,
    /// A Paint a Galaxy header allows more empires than the seats can take, or caps
    /// them at other than the seats less one.
    HeaderEmpireCount,
    /// Two or more seats reserve the same letter, or Sol, which one empire holds.
    SeatLetterDuplicate,
    /// Two or more seats carry the player's marker, which the first empire placed draws
    /// once.
    PlayerSeatDuplicate,
    /// A Sol seat stands on a system naming the game's Sol initializer, and the game
    /// never seats an empire on a seat naming that empire's own initializer.
    SolSeatMismatch,
    /// A system stands where the game builds the L-Cluster at galaxy generation.
    LClusterSystem,
    /// Two or more systems carry the same marauder clan's home initializer, and the
    /// clan spawns from only one of them.
    MarauderHomeDuplicate,
    /// A marauder raid base with no hyperlane to its clan's home, so nothing spawns
    /// there.
    MarauderBaseOrphan,
    /// A marauder clan's home with fewer than two raid bases of its clan hyperlaned to
    /// it: a warning with none, a note with one, which an older save can hold and run.
    MarauderBasesMissing,
    /// A marauder clan's home stands within [`marauder::SEAT_CLEARANCE`] of a seat, so
    /// the raids hit that empire first.
    MarauderNearSeat,
}

impl IssueCode {
    pub const fn severity(self) -> Severity {
        match self {
            Self::LaneAsymmetric | Self::LaneEndpointMissing | Self::LaneSelf => Severity::Error,
            Self::SystemIsolated
            | Self::OutOfBounds
            | Self::Disconnected
            | Self::NebulaMembership
            | Self::CoordinateTransform
            | Self::PositionRange
            | Self::ExportDropped
            | Self::HomeInitializer
            | Self::FeZoneBlocked
            | Self::FeZoneOverlap
            | Self::FeZoneOffMap
            | Self::FeZoneNoAutomatic
            | Self::FeLinkIsolated
            | Self::FeLinkDangling
            | Self::FeLinkShared
            | Self::HeaderEmpireCount
            | Self::SeatLetterDuplicate
            | Self::PlayerSeatDuplicate
            | Self::SolSeatMismatch
            | Self::LClusterSystem
            | Self::MarauderHomeDuplicate
            | Self::MarauderBaseOrphan
            | Self::MarauderBasesMissing => Severity::Warning,
            // The game itself writes duplicate lane entries (708<->154, 401<->521 in the
            // sample), so a duplicate is worth a note, not a fault.
            Self::LaneDuplicate | Self::MarauderNearSeat | Self::FeLinkFar => Severity::Info,
        }
    }

    /// Whether an issue of this code is a note on how the document came to be rather than
    /// a finding the validator makes again: it stays out of the baseline, counts as new
    /// and outlives every edit.
    pub const fn is_note(self) -> bool {
        matches!(self, Self::ExportDropped | Self::HomeInitializer)
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
            Self::FeZoneNoAutomatic => "fe_zone_no_automatic",
            Self::FeLinkIsolated => "fe_link_isolated",
            Self::FeLinkDangling => "fe_link_dangling",
            Self::FeLinkShared => "fe_link_shared",
            Self::FeLinkFar => "fe_link_far",
            Self::HeaderEmpireCount => "header_empire_count",
            Self::SeatLetterDuplicate => "seat_letter_duplicate",
            Self::PlayerSeatDuplicate => "player_seat_duplicate",
            Self::SolSeatMismatch => "sol_seat_mismatch",
            Self::LClusterSystem => "l_cluster_system",
            Self::MarauderHomeDuplicate => "marauder_home_duplicate",
            Self::MarauderBaseOrphan => "marauder_base_orphan",
            Self::MarauderBasesMissing => "marauder_bases_missing",
            Self::MarauderNearSeat => "marauder_near_seat",
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
    /// [`IssueCode::is_note`] of the code.
    #[serde(default)]
    pub note: bool,
}

impl Issue {
    pub(crate) fn new(code: IssueCode, message: String, systems: Vec<u32>) -> Self {
        Self::at(code.severity(), code, message, systems)
    }

    pub(crate) fn at(
        severity: Severity,
        code: IssueCode,
        message: String,
        systems: Vec<u32>,
    ) -> Self {
        Self {
            severity,
            code,
            message,
            systems,
            note: code.is_note(),
        }
    }
}

/// Check the graph; issues come back sorted by code then by the systems involved.
pub fn validate(g: &GalaxyGraph) -> Vec<Issue> {
    let mut issues = Vec::new();
    let reach = Reach::of(g);
    // The unordered pairs listed twice, each mapped to whether the lower id is an end that
    // lists it twice, so the message names an end that really does.
    let mut duplicate_pairs: BTreeMap<(u32, u32), bool> = BTreeMap::new();
    for system in g.systems.values() {
        let a = system.id;
        let mut seen: HashSet<u32> = HashSet::with_capacity(system.lanes.len());
        for lane in &system.lanes {
            let b = lane.to;
            if !seen.insert(b) {
                let pair = (a.min(b), a.max(b));
                *duplicate_pairs.entry(pair).or_insert(false) |= a == pair.0;
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
        if system.lanes.is_empty()
            && let Some(issue) = reach.isolated(a)
        {
            issues.push(issue);
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

    for (&(lo, hi), &low_lists_it) in &duplicate_pairs {
        let (a, b) = if low_lists_it { (lo, hi) } else { (hi, lo) };
        issues.push(Issue::new(
            IssueCode::LaneDuplicate,
            format!("system {a} lists a lane to {b} more than once"),
            vec![a, b],
        ));
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

    paint::fe_zones(g, &mut issues);
    if g.kind == DocumentKind::Scenario {
        paint::seats(g, &mut issues);
        paint::automatic_zones(g, &mut issues);
        paint::fe_links(g, &mut issues);
        scenario::l_cluster(g, &mut issues);
        scenario::marauders(g, &mut issues);
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

/// Which systems a bypass reaches from, so a lane-less system is not called isolated when
/// something else connects it.
struct Reach {
    /// Systems named as an end of a wormhole pair.
    wormhole_ends: HashSet<u32>,
    /// Systems whose gateway is built and open.
    active_gateways: HashSet<u32>,
    lgates: HashSet<u32>,
}

impl Reach {
    fn of(g: &GalaxyGraph) -> Self {
        let mut reach = Self {
            wormhole_ends: HashSet::new(),
            active_gateways: HashSet::new(),
            lgates: HashSet::new(),
        };
        for link in &g.bypasses {
            match *link {
                BypassLink::Wormhole { a, b } => {
                    reach.wormhole_ends.insert(a);
                    reach.wormhole_ends.insert(b);
                }
                BypassLink::Gateway { system, active } => {
                    if active {
                        reach.active_gateways.insert(system);
                    }
                }
                BypassLink::LGate { system } => {
                    reach.lgates.insert(system);
                }
                BypassLink::Other { .. } => {}
            }
        }
        reach
    }

    /// The issue a lane-less system earns, or `None` when a bypass already connects it.
    fn isolated(&self, a: u32) -> Option<Issue> {
        if self.wormhole_ends.contains(&a) {
            return None;
        }
        // A gateway reaches the other open gateways, so one on its own reaches nothing.
        if self.active_gateways.contains(&a) && self.active_gateways.len() > 1 {
            return None;
        }
        // An L-Gate reaches the L-Cluster only once the L-Gates are open, which a save may
        // never have reached.
        if self.lgates.contains(&a) {
            return Some(Issue::at(
                Severity::Info,
                IssueCode::SystemIsolated,
                format!(
                    "system {a} has no hyperlanes and is reached only through its L-Gate, once the L-Gates are open"
                ),
                vec![a],
            ));
        }
        Some(Issue::new(
            IssueCode::SystemIsolated,
            format!("system {a} has no hyperlanes"),
            vec![a],
        ))
    }
}

/// `a`, `a and b`, `a, b and c`.
fn listed(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
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
