//! One system of the graph: its position, star class, hyperlanes and owner.

use std::collections::{BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::format::scenario::{FeLinkFlags, FeZone, MarauderRole};
use crate::projections::galaxy::{SpawnModifier, SpawnScript, display_template};
use crate::projections::name::NameTemplate;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Lane {
    pub to: u32,
    /// Travel-time length. The generator writes `floor(distance)` as an integer; lanes added
    /// by events carry the exact distance as a decimal (`14.03876`). Ops preserve the form of
    /// the entry they rewrite.
    pub length: f64,
    pub bridge: bool,
    /// Whether `length` differs from [`lane_length`]; set by [`mark_stale`], not by
    /// extraction, because the other end's position is needed to measure it.
    pub stale: bool,
}

/// The length rule: `length = floor(euclidean distance)`, as the generator writes it.
pub fn lane_length(a: &SystemNode, b: &SystemNode) -> f64 {
    (a.x - b.x).hypot(a.y - b.y).floor()
}

/// Re-measure the lanes of `ids` and of the systems they lead to, which is every lane
/// a move of `ids` can have changed: staleness depends on the two ends alone. A lane to
/// itself, which no length rule measures, and one to a system the save does not hold are
/// never stale.
pub(super) fn mark_stale(systems: &mut HashMap<u32, SystemNode>, ids: &[u32]) {
    let mut affected: BTreeSet<u32> = BTreeSet::new();
    for id in ids {
        if let Some(system) = systems.get(id) {
            affected.insert(*id);
            affected.extend(system.lanes.iter().map(|lane| lane.to));
        }
    }
    let marked: Vec<(u32, Vec<bool>)> = affected
        .iter()
        .filter_map(|id| {
            let system = systems.get(id)?;
            let stale = system
                .lanes
                .iter()
                .map(|lane| {
                    lane.to != system.id
                        && systems
                            .get(&lane.to)
                            .is_some_and(|other| lane.length != lane_length(system, other))
                })
                .collect();
            Some((*id, stale))
        })
        .collect();
    for (id, stale) in marked {
        if let Some(system) = systems.get_mut(&id) {
            for (lane, stale) in system.lanes.iter_mut().zip(stale) {
                lane.stale = stale;
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SystemNode {
    pub id: u32,
    pub name: NameTemplate,
    pub x: f64,
    pub y: f64,
    pub star_class: String,
    pub lanes: Vec<Lane>,
    /// Index into `Galaxy::nebulae`.
    pub nebula: Option<usize>,
    pub bypass_ids: Vec<u32>,
    pub planet_count: u32,
    pub initializer: String,
    /// What the initializer makes of the system for the marauders: a clan's home or one
    /// of its raid bases. Read the same way from a save and a scenario.
    pub marauder: Option<MarauderRole>,
    /// A scenario system's `spawn_weight = { base = N }`, the weight the generator gives
    /// this system when it places an empire. `None` when the statement states no `base`,
    /// which includes a `spawn_weight` carrying only `modifier` entries: those are script
    /// this editor does not read, so calling such a system's weight 0 would report it
    /// unspawnable when a country flag may well make it a start. Always `None` for a save.
    pub spawn_weight: Option<f64>,
    /// The `modifier` blocks the scenario system's `spawn_weight` holds, in file order.
    /// Their triggers are script this editor reads and never rewrites. Always empty for
    /// a save.
    pub spawn_modifiers: Vec<SpawnModifier>,
    /// The recognised meaning of a scripted weight source: what the scenario system's
    /// `spawn_weight` says through a script value its `add` names. `None` when it names
    /// none this editor reads, and always for a save.
    pub spawn_script: Option<SpawnScript>,
    /// The scenario system's `spawn_design`, the empire design the generator seats here;
    /// it ignores the spawn weight beside it. Always `None` for a save.
    pub spawn_design: Option<String>,
    /// The Paint a Galaxy fallen empire zone this scenario system anchors, read from the
    /// `set_star_flag`s of its `effect` block. Always `None` for a save.
    pub fe_zone: Option<FeZone>,
    /// The Paint a Galaxy wormhole pair this scenario system is one end of, read from
    /// the `painted_galaxy_wormhole_<n>` flag of its `effect` block. Always `None` for
    /// a save.
    pub wormhole_pair: Option<u32>,
    /// The Paint a Galaxy custom connection flags of this scenario system's `effect`
    /// block, read the same way `fe_zone` and `wormhole_pair` are. Default for a save.
    pub fe_link: FeLinkFlags,
    /// The systems this scenario system is `prevent_hyperlane`d from, ascending and
    /// deduplicated, mirrored on both ends. A pair can be both linked and prevented,
    /// which is the file's state, not one the projection collapses. Always empty for a
    /// save.
    pub prevented: Vec<u32>,
    /// Whether the scenario statement writes an axis as `{ min = a max = b }`, a range the
    /// generator picks in; `x` and `y` are then the midpoint the map plots, and a move
    /// fixes the axis to a point. Always false for a save.
    pub position_range: bool,
    /// Flag names, in file order (e.g. `guardian`, `hostile_system`).
    pub flags: Vec<String>,
    /// Owning country id: the owner of the system's `sector`, or else the owner of its first
    /// starbase (marauder systems have a null sector but a marauder starbase). `None` when
    /// neither resolves.
    pub owner: Option<u32>,
}

impl SystemNode {
    /// See [`display_template`].
    pub fn display_name(&self) -> String {
        display_template(&self.name)
    }
}
