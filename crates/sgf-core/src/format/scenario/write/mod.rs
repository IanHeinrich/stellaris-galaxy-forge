//! Turning an op's decision into scenario-script bytes.
//!
//! The graph says what should change; this says how a `static_galaxy_scenario` says it.
//! Positions are `position = { x = … y = … }` with no lengths to keep in step, a lane is
//! one standalone `add_hyperlane` statement rather than an entry inside both ends, and a
//! nebula's members follow its radius, so moving one moves nothing else.
//!
//! New statements go on the line before the closing brace, indented like the statements
//! they join; a header key the file lacks goes before the first system instead. Removing
//! one empties its slot; `ScenarioIndex::refresh` reads the result back, so nothing here
//! keeps a tally of what the file now holds.
//!
//! One module per feature: [`system`] for systems and their positions, [`lanes`] for the
//! hyperlanes between them, [`nebula`] for the clouds over them, [`header`] for the
//! scenario's own keys, [`spawn`] for the weights the generator seats empires by and
//! [`fe_zone`] for the star flags Paint a Galaxy seats fallen empires by, [`fe_link`]
//! for the ones it lays a fallen empire's hyperlanes by and [`wormhole`] for the ones
//! it joins a wormhole pair by; [`flags`] rewrites a feature's flags for those three.

mod fe_link;
mod fe_zone;
mod flags;
mod header;
mod lanes;
mod nebula;
mod spawn;
mod system;
mod wormhole;

use std::collections::BTreeMap;

use crate::document::Document;
use crate::emit::coord;
use crate::format::scenario::index::{
    DEFAULT_INDENT, LaneStmt, SCENARIO_X_SIGN, SCENARIO_Y_SIGN, ScenarioIndex, indent_of, index,
};
use crate::keys::scenario as keys;
use crate::ops::rules::lanes::undirected;
use crate::ops::{Edit, Op, OpError, Plan, Planned, Subject};
use crate::overlay::Anchor;
use crate::session::Session;
use crate::views::DocumentKind;

pub(crate) fn write(plan: &mut Plan, s: &Session, op: &Op) -> Result<Planned, OpError> {
    match op {
        Op::MoveSystem { id, x, y } => system::move_one(plan, s, *id, *x, *y),
        Op::MoveSystems { moves } => system::move_many(plan, s, moves),
        Op::AddLane { a, b, bridge } => lanes::add_lane(plan, s, *a, *b, *bridge),
        Op::AddLanes { from, to } => lanes::add_lanes(plan, s, *from, to),
        Op::AddLanePairs { lanes } => lanes::add_lane_pairs(plan, s, lanes),
        Op::RemoveLane { a, b } => lanes::remove_lane(plan, s, *a, *b),
        Op::RemoveLanes { from, to } => lanes::remove_lanes(plan, s, *from, to),
        Op::RemoveLanePairs { lanes } => lanes::remove_lane_pairs(plan, s, lanes),
        Op::IsolateSystem { id } => lanes::isolate_one(plan, s, *id),
        Op::IsolateSystems { ids } => lanes::isolate_many(plan, s, ids),
        Op::PreventLane { a, b } => lanes::prevent_lane(plan, s, *a, *b),
        Op::UnpreventLane { a, b } => lanes::unprevent_lane(plan, s, *a, *b),
        Op::MoveNebula { index, x, y } => nebula::move_nebula(plan, s, *index, *x, *y),
        Op::AddNebula { x, y, radius, name } => {
            nebula::add_nebula(plan, s, *x, *y, *radius, name.as_deref())
        }
        Op::RemoveNebula { index } => nebula::remove_nebula(plan, s, *index),
        Op::SetNebulaRadius { index, radius } => nebula::set_radius(plan, s, *index, *radius),
        Op::SetNebulaName { index, name } => nebula::set_name(plan, s, *index, name),
        Op::AddSystem {
            id,
            x,
            y,
            name,
            initializer,
            spawn_weight,
            spawn_script,
        } => system::add_system(
            plan,
            s,
            system::SystemFields {
                id: *id,
                x: *x,
                y: *y,
                name: name.as_deref(),
                initializer: initializer.as_deref(),
                spawn_weight: *spawn_weight,
                spawn_script: spawn_script.as_ref(),
                statement: None,
            },
        ),
        Op::RemoveSystem { id } => system::remove_system(plan, s, *id),
        Op::AddSystems { systems } => system::add_systems(plan, s, systems),
        Op::RemoveSystems { ids } => system::remove_systems(plan, s, ids),
        Op::SetSystemName { id, name } => system::set_name(plan, s, *id, name),
        Op::SetInitializer { id, initializer } => {
            system::set_initializer(plan, s, *id, initializer.as_deref())
        }
        Op::SetInitializers { entries } => system::set_initializers(plan, s, entries),
        Op::SetHeaderField { key, value } => header::set_field(plan, s, key, value.as_deref()),
        Op::SetHeaderKeys { entries } => header::set_fields(plan, s, entries),
        Op::SetHeaderList { key, values } => header::set_list(plan, s, key, values),
        Op::SetSpawnWeight { id, base } => spawn::set_weight(plan, s, *id, *base),
        Op::SetSpawnWeights { entries } => spawn::set_weights(plan, s, entries),
        Op::SetSpawnScript { id, script } => spawn::set_script(plan, s, *id, script.as_ref()),
        Op::SetSpawnScripts { entries } => spawn::set_scripts(plan, s, entries),
        Op::SetFeZone { id, zone } => fe_zone::set_zone(plan, s, *id, zone.as_ref()),
        Op::SetFeZones { entries } => fe_zone::set_zones(plan, s, entries),
        Op::SetWormholePair { a, b, pair } => wormhole::set_pair(plan, s, *a, *b, *pair),
        Op::SetWormholeEnds { entries } => wormhole::set_ends(plan, s, entries),
        Op::SetFeLinks { anchor, linked } => fe_link::set_links(plan, s, *anchor, linked),
        Op::SetFeLinkFlags { entries } => fe_link::set_flags(plan, s, entries),
        // A scenario's lanes carry no length: the game measures them from the two ends.
        Op::SetLaneLength { .. }
        | Op::SetLaneLengths { .. }
        | Op::NormaliseLaneLength { .. }
        | Op::NormaliseLaneLengths { .. } => Err(OpError::Unsupported {
            op: op.name(),
            kind: DocumentKind::Scenario,
        }),
        // A scenario holds no global flags: the game rolls the outcome once it starts. Its
        // stars are drawn by the generator from the initializer, and it holds no planets.
        Op::SetLGateOutcome { .. } | Op::SetStarClass { .. } => Err(OpError::Unsupported {
            op: op.name(),
            kind: DocumentKind::Scenario,
        }),
        Op::Batch { .. } => Err(OpError::NestedBatch),
    }
}

/// Fix both axes to a point. An axis the generator was free to pick from
/// (`x = { min = 20 max = 30 }`) is a block, so the value goes, not just its text.
fn set_position(edit: &mut Edit, x: f64, y: f64) -> Result<(), OpError> {
    edit.set_value(&[keys::POSITION, keys::X], coord(x * SCENARIO_X_SIGN))?;
    edit.set_value(&[keys::POSITION, keys::Y], coord(y * SCENARIO_Y_SIGN))
}

fn some_text(text: &str) -> Option<String> {
    (!text.is_empty()).then(|| text.to_owned())
}

/// Every hyperlane statement naming one of `ids` that the predicate picks, once each, in
/// file order.
fn matching(
    doc: &Document,
    ids: impl IntoIterator<Item = u32>,
    keep: impl Fn(&LaneStmt) -> bool,
) -> Vec<LaneStmt> {
    let scenario = index(doc);
    let found: BTreeMap<Anchor, LaneStmt> = ids
        .into_iter()
        .flat_map(|id| scenario.lanes_naming(id))
        .filter(keep)
        .map(|stmt| (stmt.anchor, stmt))
        .collect();
    found.into_values().collect()
}

fn erase(plan: &mut Plan, doc: &Document, stmt: &LaneStmt) -> Result<(), OpError> {
    let subject = Subject::Statement {
        anchor: stmt.anchor,
        ends: (stmt.from, stmt.to),
    };
    plan.erase(doc, subject, stmt.anchor)
}

/// A new lane statement is indented like the last one the file holds, else like the last
/// system, else with one tab.
fn lane_indent(doc: &Document, scenario: &ScenarioIndex) -> Vec<u8> {
    scenario
        .lane_statements()
        .rfind(|l| !l.prevent)
        .map(|l| l.anchor)
        .map_or_else(|| system_indent(doc, scenario), |a| indent(doc, a))
}

/// A new nebula statement is indented like the last one the file holds, else like the
/// last system, else with one tab.
fn nebula_indent(doc: &Document, scenario: &ScenarioIndex) -> Vec<u8> {
    scenario
        .nebulae()
        .last()
        .map_or_else(|| system_indent(doc, scenario), |&a| indent(doc, a))
}

/// A new system statement is indented like the last system the file holds, else with one
/// tab.
fn system_indent(doc: &Document, scenario: &ScenarioIndex) -> Vec<u8> {
    scenario
        .last_system()
        .map_or_else(|| DEFAULT_INDENT.to_vec(), |(_, a)| indent(doc, a))
}

fn indent(doc: &Document, anchor: Anchor) -> Vec<u8> {
    indent_of(doc.original(), anchor, doc.current(anchor).ok())
}
