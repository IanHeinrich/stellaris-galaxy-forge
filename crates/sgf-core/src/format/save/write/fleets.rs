//! The fleets standing in a system, and moving one with its ships from one system to
//! another.

use crate::emit::coord;
use crate::format::save::{entity, entity_at, system_statement};
use crate::keys;
use crate::ops::{Edit, OpError, Plan, Subject};
use crate::overlay::Anchor;
use crate::projections::read;
use crate::scan::Value;
use crate::session::Session;

/// Whether fleet `fleet` is a fleet of the save standing in system `from`: its
/// `movement_manager.coordinate` names `from`. A station fleet that is gone, or stands
/// elsewhere, stays out of both systems' `fleet_presence`.
pub(crate) fn stationed(s: &Session, fleet: u32, from: u32) -> bool {
    let Some(anchor) = record(s, keys::FLEET, fleet) else {
        return false;
    };
    let Ok(Some((node, src))) = entity_at(&s.doc, anchor) else {
        return false;
    };
    node.find(keys::MOVEMENT_MANAGER, src)
        .and_then(|m| m.find(keys::COORDINATE, src))
        .and_then(|c| read::scalar_u32(c, keys::ORIGIN, src))
        == Some(from)
}

/// The fleets system `id`'s `fleet_presence` lists.
pub(crate) fn present_fleets(s: &Session, id: u32) -> Result<Vec<u32>, OpError> {
    let anchor = system_statement(&s.doc, id).ok_or(OpError::UnknownSystem(id))?;
    let (node, src) = entity(&s.doc, Subject::System(id), anchor)?;
    Ok(read::ids(&node, keys::FLEET_PRESENCE, src))
}

/// Move fleet `fleet` and its ships from system `from` to `to`, by `step` when given: the
/// fleet's `movement_manager.coordinate` and each ship's `coordinate` and
/// `target_coordinate` shift, and the fleet's `combat.coordinate`, which stands at the
/// system's centre, only takes the new `origin`. A coordinate with any other origin, the
/// null one included, is left as it stands.
pub(crate) fn move_fleet(
    plan: &mut Plan,
    s: &Session,
    fleet: u32,
    [from, to]: [u32; 2],
    step: Option<(f64, f64)>,
) -> Result<(), OpError> {
    let Some(anchor) = record(s, keys::FLEET, fleet) else {
        return Ok(());
    };
    let edit = plan.edit_record(&s.doc, anchor)?;
    let systems = [from, to];
    shift(
        edit,
        &[keys::MOVEMENT_MANAGER, keys::COORDINATE],
        systems,
        step,
    )?;
    shift(edit, &[keys::COMBAT, keys::COORDINATE], systems, None)?;
    let ships = read::ids(edit.entity()?, keys::SHIPS, &edit.buf);
    for ship in ships {
        let Some(anchor) = record(s, keys::SHIPS, ship) else {
            continue;
        };
        let edit = plan.edit_record(&s.doc, anchor)?;
        shift(edit, &[keys::COORDINATE], systems, step)?;
        shift(edit, &[keys::TARGET_COORDINATE], systems, step)?;
    }
    Ok(())
}

/// The statement of entity `id` of the top-level table `section`; `None` for one the save
/// does not hold or holds as a tombstone.
fn record(s: &Session, section: &str, id: u32) -> Option<Anchor> {
    s.doc
        .index()
        .entity(section, u64::from(id))
        .filter(|e| matches!(e.value, Value::Block { .. }))
        .map(|e| Anchor::Original(e.stmt))
}

/// Give the coordinate at `path` origin `to` when its origin is `from`, and shift its point
/// by `step` when there is one.
fn shift(
    edit: &mut Edit,
    path: &[&str],
    [from, to]: [u32; 2],
    step: Option<(f64, f64)>,
) -> Result<(), OpError> {
    let mut node = edit.entity()?;
    for key in path {
        match node.find(key, &edit.buf) {
            Some(child) => node = child,
            None => return Ok(()),
        }
    }
    if read::scalar_u32(node, keys::ORIGIN, &edit.buf) != Some(from) {
        return Ok(());
    }
    let point = (
        read::scalar_f64(node, keys::X, &edit.buf),
        read::scalar_f64(node, keys::Y, &edit.buf),
    );
    let axis = |key| [path, &[key]].concat();
    if let (Some(step), (Some(x), Some(y))) = (step, point) {
        edit.set_scalar(&axis(keys::X), coord(x + step.0))?;
        edit.set_scalar(&axis(keys::Y), coord(y + step.1))?;
    }
    edit.set_scalar(&axis(keys::ORIGIN), to.to_string())
}
