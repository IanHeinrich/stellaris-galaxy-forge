//! Nebulae: a statement carries its own centre, radius and name, and its members follow
//! the radius rather than a list, so moving one moves nothing else.

use super::{index, nebula_indent, set_position};
use crate::emit::coord;
use crate::format;
use crate::format::scenario::emit::nebula_stmt;
use crate::format::scenario::index::{SCENARIO_X_SIGN, SCENARIO_Y_SIGN};
use crate::keys::scenario as keys;
use crate::ops::rules::nebula as nebula_rules;
use crate::ops::rules::quoted;
use crate::ops::{Emitted, OpError, Plan, Planned, Subject};
use crate::session::Session;

pub(super) fn move_nebula(
    plan: &mut Plan,
    s: &Session,
    index: usize,
    x: f64,
    y: f64,
) -> Result<Planned, OpError> {
    let moved = nebula_rules::decide_move(&s.graph, index, x, y)?;
    let edit = plan.edit_nebula(&s.doc, index)?;
    set_position(edit, moved.to.0, moved.to.1)?;
    Ok(Planned {
        description: moved.describe(),
        inverse: moved.inverse(),
    })
}

/// A nebula statement carries its own members through its radius, so nothing but the
/// statement is written; the rebuild re-projects who is in it.
pub(super) fn add_nebula(
    plan: &mut Plan,
    s: &Session,
    x: f64,
    y: f64,
    radius: f64,
    name: Option<&str>,
) -> Result<Planned, OpError> {
    let added = nebula_rules::decide_add(&s.graph, x, y, radius, name)?;
    let scenario = index(&s.doc);
    let text = nebula_stmt(
        &nebula_indent(&s.doc, scenario),
        &added.name,
        added.x * SCENARIO_X_SIGN,
        added.y * SCENARIO_Y_SIGN,
        added.radius,
    );
    plan.emit(Emitted::Nebula(added.index), scenario.insert_at, text);
    Ok(Planned {
        description: added.describe(),
        inverse: added.inverse(),
    })
}

pub(super) fn remove_nebula(
    plan: &mut Plan,
    s: &Session,
    index: usize,
) -> Result<Planned, OpError> {
    let removed = nebula_rules::decide_remove(&s.graph, index)?;
    let anchor = format::of(s.doc.kind()).statement(&s.doc, Subject::Nebula(index))?;
    plan.erase(&s.doc, Subject::Nebula(index), anchor)?;
    Ok(Planned {
        description: removed.describe(&s.graph),
        inverse: removed.inverse(),
    })
}

pub(super) fn set_radius(
    plan: &mut Plan,
    s: &Session,
    index: usize,
    radius: f64,
) -> Result<Planned, OpError> {
    let set = nebula_rules::decide_radius(&s.graph, index, radius)?;
    plan.edit_nebula(&s.doc, index)?
        .set_value(&[keys::RADIUS], coord(set.to))?;
    Ok(Planned {
        description: set.describe(),
        inverse: set.inverse(),
    })
}

/// A scenario keeps the name in the statement's own `name = "…"` scalar.
pub(super) fn set_name(
    plan: &mut Plan,
    s: &Session,
    index: usize,
    name: &str,
) -> Result<Planned, OpError> {
    let set = nebula_rules::decide_name(&s.graph, index, name)?;
    plan.edit_nebula(&s.doc, index)?
        .set_scalar(&[keys::NAME], quoted(&set.to))?;
    Ok(Planned {
        description: set.describe(),
        inverse: set.inverse(),
    })
}
