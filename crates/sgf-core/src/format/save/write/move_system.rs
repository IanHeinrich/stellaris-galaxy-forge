//! `MoveSystem`: rewrite a system's coordinate and the `length` of every lane on both
//! ends, preserving the integer or decimal form each entry already has, and keep the
//! nebula membership lists in step with the new position.

use crate::emit::coord;
use crate::format::save::write::lanes::length_text;
use crate::format::save::write::nebula::plan_membership;
use crate::keys;
use crate::ops::rules::nebula::describe_membership;
use crate::ops::rules::systems::decide_move;
use crate::ops::{Edit, OpError, Plan, Planned, SystemMove, replace_lengths};
use crate::session::Session;

pub(crate) fn plan(
    plan: &mut Plan,
    s: &Session,
    id: u32,
    x: f64,
    y: f64,
) -> Result<Planned, OpError> {
    let moved = decide_move(&s.graph, id, x, y)?;
    let system = &s.graph.systems[&id];

    let mut neighbours: Vec<u32> = Vec::new();
    for lane in &system.lanes {
        if lane.to != id && s.graph.systems.contains_key(&lane.to) && !neighbours.contains(&lane.to)
        {
            neighbours.push(lane.to);
        }
    }

    splice_coordinate(plan.edit(&s.doc, id)?, x, y)?;

    let mut updated = 0;
    for &n in &neighbours {
        let other = &s.graph.systems[&n];
        let dist = (x - other.x).hypot(y - other.y);
        let text = move |existing: &str| length_text(existing, dist, false);
        updated += replace_lengths(plan.edit(&s.doc, id)?, n, text)?;
        updated += replace_lengths(plan.edit(&s.doc, n)?, id, text)?;
    }
    let membership = plan_membership(plan, s, &[SystemMove { id, x, y }])?;

    Ok(Planned {
        description: format!(
            "{}; updated {updated} lane lengths{}",
            moved.describe(),
            describe_membership(&s.graph, &membership, false)
        ),
        inverse: moved.inverse(),
    })
}

/// Rewrite `coordinate.x` and `coordinate.y` of the entity.
pub(crate) fn splice_coordinate(edit: &mut Edit, x: f64, y: f64) -> Result<(), OpError> {
    edit.set_scalar(&[keys::COORDINATE, keys::X], coord(x))?;
    edit.set_scalar(&[keys::COORDINATE, keys::Y], coord(y))
}
